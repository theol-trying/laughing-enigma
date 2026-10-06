// Serveur ASCII FORT sur Cloudflare : un seul Worker.
// - fichiers statiques : le build Vite (dist/), servi directement par Cloudflare ;
// - /api/new : code de salon libre ;
// - /ws/<CODE> : connexion WebSocket au salon, un Durable Object « Room » par code.
import { DurableObject } from 'cloudflare:workers';
import {
  PROTOCOL, MAX_PLAYERS, MAX_MESSAGE, ROOM_TTL_MS, ROOM_RE,
  roomCode, shortId, cleanName, cleanSeed, cleanCode,
  type ClientMsg, type ServerMsg, type PlayerInfo,
} from '@ascii-fort/net/protocol';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/new') return Response.json({ code: roomCode() }, { headers: { 'cache-control': 'no-store' } });
    const m = /^\/ws\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const code = cleanCode(m[1]);
      if (!ROOM_RE.test(code)) return new Response('Code de salon invalide', { status: 400 });
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket attendu', { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

/** Données attachées à chaque connexion (survivent à l'hibernation du Durable Object). */
interface Conn { id: string; name: string; key: string; ready: boolean; zones: string[]; owns: string[] }

interface Meta { seed: string; gen: string; created: number }

/**
 * Salon multijoueur. L'état vivant (joueurs, propriétaires de zones) est porté par les
 * connexions ; le stockage SQLite garde la seed, les faits du monde partagé (« f:<clé> ») et
 * la sauvegarde de chaque personnage (« c:<clé du joueur> »).
 */
export class Room extends DurableObject<Env> {
  private meta: Meta | null = null;
  private rate = new WeakMap<WebSocket, { t: number; n: number }>();

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: shortId(), name: '', key: '', ready: false, zones: [], owns: [] } satisfies Conn);
    return new Response(null, { status: 101, webSocket: client });
  }

  private conn(ws: WebSocket): Conn { return ws.deserializeAttachment() as Conn; }
  private setConn(ws: WebSocket, c: Conn) { ws.serializeAttachment(c); }
  private sockets(): WebSocket[] { return this.ctx.getWebSockets().filter((w) => this.conn(w).ready); }
  private send(ws: WebSocket, m: ServerMsg) { try { ws.send(JSON.stringify(m)); } catch { /* connexion fermée */ } }
  private broadcast(m: ServerMsg, except?: WebSocket) {
    const s = JSON.stringify(m);
    for (const w of this.sockets()) if (w !== except) { try { w.send(s); } catch { /* ignore */ } }
  }
  private fail(ws: WebSocket, msg: string) { this.send(ws, { t: 'err', msg, fatal: true }); ws.close(4000, msg.slice(0, 100)); }

  private async loadMeta(): Promise<Meta | null> {
    if (!this.meta) this.meta = (await this.ctx.storage.get<Meta>('meta')) ?? null;
    return this.meta;
  }

  private owners(): Map<string, string> {
    const o = new Map<string, string>();
    for (const w of this.sockets()) { const c = this.conn(w); for (const z of c.owns) o.set(z, c.id); }
    return o;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    // limite de débit simple : 60 messages par seconde et par connexion
    const now = Date.now(), r = this.rate.get(ws) ?? { t: now, n: 0 };
    if (now - r.t > 1000) { r.t = now; r.n = 0; }
    if (++r.n > 60) return;
    this.rate.set(ws, r);
    let m: ClientMsg;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return;
    const c = this.conn(ws);
    if (m.t === 'hello') { await this.hello(ws, c, m); return; }
    if (!c.ready) return;
    switch (m.t) {
      case 'st': this.broadcast({ t: 'st', id: c.id, s: m.s }, ws); break;
      case 'ents':
        if (typeof m.z === 'string' && c.owns.includes(m.z) && Array.isArray(m.l)) this.broadcast({ t: 'ents', id: c.id, z: m.z, l: m.l }, ws);
        break;
      case 'claim': this.claim(ws, c, String(m.z).slice(0, 40)); break;
      case 'release': this.release(ws, c, String(m.z).slice(0, 40)); break;
      case 'to': for (const w of this.sockets()) if (this.conn(w).id === m.to) this.send(w, { t: 'to', from: c.id, d: m.d }); break;
      case 'fx': this.broadcast({ t: 'fx', id: c.id, d: m.d }, ws); break;
      case 'fact': await this.fact(ws, c, m); break;
      case 'save': if (c.key && JSON.stringify(m.c ?? null).length < 60_000) await this.ctx.storage.put('c:' + c.key, m.c); break;
      case 'chat': { const text = String(m.text ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 200); if (text) this.broadcast({ t: 'chat', id: c.id, name: c.name, text }); break; }
      case 'ping': this.send(ws, { t: 'pong', n: Number(m.n) || 0, now: Date.now() }); break;
    }
  }

  private async hello(ws: WebSocket, c: Conn, m: Extract<ClientMsg, { t: 'hello' }>) {
    if (c.ready) return;
    if (m.proto !== PROTOCOL) return this.fail(ws, 'Version du jeu différente du serveur : rechargez la page.');
    let meta = await this.loadMeta();
    if (!meta) {
      const seed = cleanSeed(m.create?.seed);
      if (!seed) return this.fail(ws, 'Salon introuvable (vérifiez le code).');
      meta = { seed, gen: String(m.gen).slice(0, 20), created: Date.now() };
      await this.ctx.storage.put('meta', meta);
      this.meta = meta;
    }
    if (meta.gen !== m.gen) return this.fail(ws, `Ce salon a été créé avec le générateur ${meta.gen} (le vôtre : ${m.gen}).`);
    const key = String(m.key ?? '').slice(0, 40);
    // même joueur reconnecté : l'ancienne connexion est fermée
    for (const w of this.sockets()) if (key && this.conn(w).key === key) { this.leave(w); w.close(4001, 'Reconnecté ailleurs'); }
    const others = this.sockets();
    if (others.length >= MAX_PLAYERS) return this.fail(ws, `Salon complet (${MAX_PLAYERS} joueurs).`);
    c.name = cleanName(m.name); c.key = key; c.ready = true;
    this.setConn(ws, c);
    await this.ctx.storage.deleteAlarm();
    const facts: Record<string, unknown> = {};
    for (const [k, v] of await this.ctx.storage.list({ prefix: 'f:' })) facts[k.slice(2)] = v;
    const save = key ? (await this.ctx.storage.get('c:' + key)) ?? null : null;
    const players: PlayerInfo[] = others.map((w) => ({ id: this.conn(w).id, name: this.conn(w).name }));
    this.send(ws, { t: 'welcome', you: c.id, seed: meta.seed, created: meta.created, now: Date.now(), players, facts, owners: Object.fromEntries(this.owners()), save });
    this.broadcast({ t: 'join', p: { id: c.id, name: c.name } }, ws);
  }

  private claim(ws: WebSocket, c: Conn, z: string) {
    if (!z || c.zones.includes(z) || c.zones.length >= 24) return;
    c.zones.push(z);
    const owner = this.owners().get(z);
    if (!owner) c.owns.push(z);
    this.setConn(ws, c);
    if (!owner) this.broadcast({ t: 'owner', z, id: c.id });
    else this.send(ws, { t: 'owner', z, id: owner });
  }

  private release(ws: WebSocket, c: Conn, z: string) {
    c.zones = c.zones.filter((x) => x !== z);
    const wasOwner = c.owns.includes(z);
    c.owns = c.owns.filter((x) => x !== z);
    this.setConn(ws, c);
    if (wasOwner) this.handOver(z, ws);
  }

  /** La zone change de propriétaire : un autre joueur qui s'y intéresse, sinon personne. */
  private handOver(z: string, except: WebSocket) {
    for (const w of this.sockets()) {
      if (w === except) continue;
      const o = this.conn(w);
      if (o.zones.includes(z)) { o.owns.push(z); this.setConn(w, o); this.broadcast({ t: 'owner', z, id: o.id }); return; }
    }
    this.broadcast({ t: 'owner', z, id: null }, except);
  }

  private async fact(ws: WebSocket, c: Conn, m: Extract<ClientMsg, { t: 'fact' }>) {
    const k = String(m.k ?? '').slice(0, 80);
    if (!k || JSON.stringify(m.v ?? null).length > 2000) return;
    if (m.once) {
      const prev = await this.ctx.storage.get('f:' + k);
      if (prev !== undefined) { this.send(ws, { t: 'fact', k, v: prev, by: '' }); return; }
    }
    if (m.v === null) await this.ctx.storage.delete('f:' + k);
    else await this.ctx.storage.put('f:' + k, m.v);
    this.broadcast({ t: 'fact', k, v: m.v, by: c.id });
  }

  private leave(ws: WebSocket) {
    const c = this.conn(ws);
    if (!c.ready) return;
    c.ready = false;
    this.setConn(ws, c);
    for (const z of c.owns) this.handOver(z, ws);
    this.broadcast({ t: 'leave', id: c.id }, ws);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.leave(ws);
    if (this.sockets().filter((w) => w !== ws).length === 0) await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  async webSocketError(ws: WebSocket): Promise<void> { await this.webSocketClose(ws); }

  /** Salon resté vide trop longtemps : effacé. */
  async alarm(): Promise<void> {
    if (this.sockets().length === 0) { await this.ctx.storage.deleteAll(); this.meta = null; }
  }
}
