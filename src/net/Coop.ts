import { NET_HZ, MAX_SAVE, type ServerMsg, type ZoneEnts } from '@ascii-fort/net/protocol';
import { humanoid, drawModel, type ModelDef, type Pose, type Weapon } from '@ascii-fort/sim/entities/Models';
import { hitEntity, hitPlayer, type Element } from '@ascii-fort/sim/gameplay/Combat';
import type { Entity } from '@ascii-fort/sim/entities/Entity';
import type { EntityNet, RemoteTarget } from '@ascii-fort/sim/entities/EntityManager';
import { MIN_PER_DAY } from '@ascii-fort/core/Time';
import { item } from '@ascii-fort/sim/gameplay/Items';
import type { InstanceBuffer } from '@ascii-fort/ascii-engine/Renderer';
import { M } from '@ascii-fort/ascii-engine/Materials';
import { trsYawPitch, mat4 } from '@ascii-fort/core/math';
import type { CastFx } from '@ascii-fort/sim/gameplay/PlayerCombat';
import { C } from '@ascii-fort/ascii-engine/TextGrid';
import type { Game } from '../game/Game';
import type { SaveData } from '../game/SaveManager';
import type { NetClient, Welcome } from './NetClient';

// Mode coopératif : un salon (Durable Object) relie les joueurs. Chacun régénère le monde à
// partir de la seed ; circulent seulement les joueurs, les entités des zones (simulées par leur
// propriétaire), les coups portés d'une machine à l'autre et les faits du monde partagé.

/** Heure de jeu au moment de la création du salon (jour 1, 8 h 30), puis 1 min de jeu par seconde. */
const START = 1 * MIN_PER_DAY + 8 * 60 + 30;

/** État d'un joueur tel qu'il circule sur le réseau. */
interface PlayerState { x: number; y: number; z: number; h: number; sw: number; bl: number; d: number; hp: number; mhp: number; lk: string; dg: number; cr: number; sp: number }

/** Message adressé d'un client à un autre (champ « d » du message « to »). */
type Direct =
  | { k: 'dmg'; id: string; a: number; el?: Element }                    // coup sur une entité dont le destinataire est propriétaire
  | { k: 'hurt'; a: number; x: number; z: number; el?: Element; by: string } // une créature frappe le destinataire
  | { k: 'kill'; id: string; type: string; kind: 'npc' | 'monster'; sid?: number; fid?: number; camp?: number; x: number; z: number }
  // échanges entre joueurs
  | { k: 'trade-ask' } | { k: 'trade-answer'; ok: boolean } | { k: 'trade-cancel' }
  | { k: 'trade-offer'; items: [string, number][]; gold: number; v: number }
  | { k: 'trade-ok'; mine: number; theirs: number };

/** Échange en cours avec un autre joueur ; ok* = versions des deux offres au moment de la validation. */
export interface TradeSession {
  with: string; name: string;
  mine: { items: Map<string, number>; gold: number; v: number };
  theirs: { items: [string, number][]; gold: number; v: number };
  okMine: [number, number] | null; okTheirs: [number, number] | null;
}

export class RemotePlayer {
  x = 0; y = 0; z = 0; heading = 0;
  tx = 0; ty = 0; tz = 0; th = 0;
  pose: Pose = { walk: 0, swing: 0, dead: 0, hover: 0, block: 0 };
  hp = 100; maxHp = 100; dungeon = -1; crouch = false; sprint = false;
  look = '';
  model: ModelDef;
  seen = 0;
  prevSwing = 0;
  constructor(readonly id: string, public name: string) { this.model = playerModel(name, ''); }
}

const SKINS = [0xf0c8a0, 0xd8a878, 0xc08858, 0x8a5a3a, 0x6a4028];
const HAIRS = [0x2a1a10, 0x4a2a14, 0x8a5a2a, 0xc8a050, 0x1a1a1a, 0x9a3a1a];
const SHIRTS = [0x2a4a7a, 0x7a2a2a, 0x2a6a3a, 0x6a4a8a, 0x8a6a2a, 0x3a6a6a];

/** Apparence d'un joueur : couleurs tirées de son nom, équipement visible (arme, bouclier, casque, armure). */
export function playerModel(name: string, look: string): ModelDef {
  let h = 2166136261;
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const [wk, shield, helm, metal] = look.split('|');
  const weapons: Record<string, Weapon> = { épée: 'épée', hache: 'hache', masse: 'massue', lance: 'lance', dague: 'dague', bâton: 'bâton', pioche: 'pioche' };
  return humanoid({
    skin: SKINS[h % SKINS.length], hair: HAIRS[(h >>> 5) % HAIRS.length],
    shirt: metal === '1' ? 0x8a8a94 : SHIRTS[(h >>> 9) % SHIRTS.length], pants: 0x3a3228,
    weapon: weapons[wk] ?? null, bow: wk === 'arc', shield: shield === 'f' ? 0x8a8a94 : shield === 'b' ? true : false,
    helmet: helm === '1', beard: (h >>> 13) % 3 === 0, hairLong: (h >>> 15) % 3 === 0, cape: (h >>> 17) % 2 ? SHIRTS[(h >>> 19) % SHIRTS.length] : undefined,
    letter: '@',
  });
}

export class Coop implements EntityNet {
  readonly players = new Map<string, RemotePlayer>();
  readonly owners = new Map<string, string>();
  readonly facts = new Map<string, unknown>();
  myId = '';
  created = 0;
  private sendT = 0;
  private saveT = 30;
  private applying = false;
  private pending = new Map<string, () => void>();
  private targets: RemoteTarget[] = [];
  /** tirs et sorts des autres joueurs, rejoués pour l'affichage (sans dégâts : ceux-ci passent par le propriétaire des zones) */
  shots: { kind: 'flèche' | 'feu'; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; stuck: boolean; dg: number }[] = [];
  private sparkles: { x: number; y: number; z: number; t: number }[] = [];
  private m4 = mat4();
  /** échange en cours, demande envoyée, et écrans ouverts par le jeu */
  trade: TradeSession | null = null;
  private asking: string | null = null;
  onTradeAsk: ((name: string, answer: (ok: boolean) => void) => void) | null = null;
  onTradeOpen: ((s: TradeSession) => void) | null = null;
  private off: () => void;

  constructor(readonly net: NetClient, readonly game: Game, welcome: Welcome) {
    this.off = net.on((m) => this.onMessage(m));
    this.welcome(welcome, true);
    const ev = game.events;
    // faits du monde partagé publiés à partir des événements locaux
    ev.on('entity:killed', (k) => {
      if (this.applying) return;
      const e = game.entities.entities.find((x) => x.id === k.victimId);
      if (e?.mon?.unique) this.fact('killed:' + e.mon.unique, 1);
      if (k.victimId.startsWith('dj')) this.fact('killed:' + k.victimId, 1);
      if (k.kind === 'npc') this.fact('npc:' + k.victimId, 0);
      // coup fatal porté par un autre joueur : il reçoit le crédit (XP, quêtes, délit)
      if (k.killerId?.startsWith('p:') && k.kind !== 'player') this.direct(k.killerId.slice(2), { k: 'kill', id: k.victimId, type: k.type, kind: k.kind as 'npc' | 'monster', sid: k.settlementId, fid: k.factionId, camp: k.campId, x: k.x, z: k.z });
    });
    ev.on('camp:cleared', (c) => { if (!this.applying) this.fact('camp:' + c.campId, 1); });
    game.entities.net = this;
    // nos tirs et sorts sont montrés aux autres joueurs
    game.fight.onCast = (fx) => { if (this.players.size) this.net.send({ t: 'fx', d: { ...fx, dg: game.dungeon ? game.dungeon.layout.id : -1 } }); };
  }

  dispose(): void {
    this.saveNow();
    this.off();
    this.net.close();
    this.game.entities.net = null;
    this.game.fight.onCast = null;
  }

  get online(): boolean { return this.net.status === 'en ligne'; }
  /** Heure de jeu commune à tout le salon. */
  clockMinutes(): number { return START + (this.net.now() - this.created) / 1000; }

  // ---------------------------------------------------------------- réception
  private welcome(w: Welcome, first: boolean) {
    this.myId = w.you; this.created = w.created;
    this.players.clear();
    for (const p of w.players) this.players.set(p.id, new RemotePlayer(p.id, p.name));
    this.owners.clear();
    for (const [z, id] of Object.entries(w.owners)) this.owners.set(z, id);
    if (first && w.save) { try { this.game.applySave(w.save as SaveData); } catch { /* sauvegarde illisible : on repart à zéro */ } }
    this.facts.clear();
    this.applying = true;
    for (const [k, v] of Object.entries(w.facts)) this.applyFact(k, v, false);
    this.applying = false;
    this.game.economy.refreshBlocked();
    // zones déjà actives chez nous : on (re)déclare notre intérêt
    for (const z of this.game.entities.activeZoneKeys()) this.net.send({ t: 'claim', z });
    if (!first) this.msg('Reconnecté au salon.', C.green);
  }

  private onMessage(m: ServerMsg) {
    const g = this.game;
    switch (m.t) {
      case 'welcome': this.welcome(m, false); break;
      case 'join': this.players.set(m.p.id, new RemotePlayer(m.p.id, m.p.name)); this.msg(`${m.p.name} rejoint la partie.`, C.cyan); break;
      case 'leave': { const p = this.players.get(m.id); this.players.delete(m.id); if (p) this.msg(`${p.name} quitte la partie.`, C.dim); if (this.trade?.with === m.id) { this.trade = null; this.msg('Échange annulé.', C.dim); } break; }
      case 'st': this.onState(m.id, m.s as PlayerState); break;
      case 'owner':
        if (m.id) this.owners.set(m.z, m.id); else this.owners.delete(m.z);
        g.entities.ownerChanged(m.z);
        break;
      case 'ents': for (const z of m.zs) if (this.owners.get(z.z) === m.id) g.entities.applySnapshot(z.z, z.l as unknown[][]); break;
      case 'to': this.onDirect(m.from, m.d as Direct); break;
      case 'fact': this.onFact(m.k, m.v, m.by); break;
      case 'fx': this.onFx(m.id, m.d as CastFx & { dg: number }); break;
      case 'chat': this.msg(`[${m.name}] ${m.text}`, m.id === this.myId ? C.white : C.yellow); break;
      case 'err': this.msg(m.msg, C.red); break;
    }
  }

  private onState(id: string, s: PlayerState) {
    const p = this.players.get(id);
    if (!p || !s) return;
    if (!p.seen) { p.x = s.x; p.y = s.y; p.z = s.z; p.heading = s.h; }
    p.tx = s.x; p.ty = s.y; p.tz = s.z; p.th = s.h;
    p.pose.swing = s.sw; p.pose.block = s.bl; p.hp = s.hp; p.maxHp = s.mhp; p.dungeon = s.dg; p.crouch = !!s.cr; p.sprint = !!s.sp;
    p.seen = performance.now();
    if (s.sw > 0.6 && p.prevSwing <= 0.6) this.game.audio.swing({ x: s.x, y: s.y + 1.2, z: s.z });
    p.prevSwing = s.sw;
    if (s.lk !== p.look) { p.look = s.lk; p.model = playerModel(p.name, s.lk); }
    p.pose.dead = s.d;
  }

  private onFx(from: string, f: CastFx & { dg: number }) {
    if (!f || typeof f.x !== 'number') return;
    const g = this.game, here = g.dungeon ? g.dungeon.layout.id : -1;
    if (f.dg !== here) return;
    if (f.k === 'shot') {
      this.shots.push({ kind: f.kind, x: f.x, y: f.y, z: f.z, vx: f.vx, vy: f.vy, vz: f.vz, life: f.kind === 'feu' ? 3 : 6, stuck: false, dg: f.dg });
      if (this.shots.length > 60) this.shots.shift();
      g.audio.shot(f.kind, { x: f.x, y: f.y, z: f.z });
    } else if (f.k === 'heal') {
      for (let i = 0; i < 14; i++) this.sparkles.push({ x: f.x + (Math.random() - 0.5) * 1.2, y: f.y + Math.random() * 1.6, z: f.z + (Math.random() - 0.5) * 1.2, t: 1.2 + Math.random() * 0.6 });
      void from;
    }
  }

  private onDirect(from: string, d: Direct) {
    const g = this.game;
    if (!d) return;
    if (d.k === 'dmg') {
      const e = g.entities.entities.find((x) => x.id === d.id);
      if (e && e.alive) hitEntity(g.combat, e, d.a, 'p:' + from, d.el);
    } else if (d.k === 'hurt') {
      if (!g.god) hitPlayer(g.combat, d.a, { x: d.x, z: d.z } as Entity, d.el);
    } else if (d.k.startsWith('trade')) {
      this.onTrade(from, d);
    } else if (d.k === 'kill') {
      // crédit du coup fatal : rejoué localement comme si l'entité était simulée ici
      g.events.emit('entity:killed', { victimId: d.id, killerId: 'player', kind: d.kind, type: d.type, factionId: d.fid, settlementId: d.sid, campId: d.camp, x: d.x, z: d.z });
    }
  }

  // ---------------------------------------------------------------- échanges entre joueurs
  askTrade(id: string): void {
    const r = this.players.get(id);
    if (!r || this.trade) return;
    this.asking = id;
    this.direct(id, { k: 'trade-ask' });
    this.msg(`Proposition d'échange envoyée à ${r.name}…`, C.dim);
  }

  private onTrade(from: string, d: Direct) {
    const r = this.players.get(from);
    if (!r) return;
    const t = this.trade;
    switch (d.k) {
      case 'trade-ask':
        if (t || !this.onTradeAsk) { this.direct(from, { k: 'trade-answer', ok: false }); break; }
        this.onTradeAsk(r.name, (ok) => { this.direct(from, { k: 'trade-answer', ok }); if (ok) this.openTrade(from); });
        break;
      case 'trade-answer':
        if (this.asking !== from) break;
        this.asking = null;
        if (d.ok) this.openTrade(from); else this.msg(`${r.name} refuse l'échange.`, C.dim);
        break;
      case 'trade-offer':
        if (t?.with !== from) break;
        t.theirs = { items: (Array.isArray(d.items) ? d.items : []).filter(([id, n]) => this.tradeable(id) && n > 0).map(([id, n]) => [id, Math.floor(n)] as [string, number]), gold: Math.max(0, Math.floor(d.gold) || 0), v: d.v };
        t.okMine = null; t.okTheirs = null;
        break;
      case 'trade-ok':
        if (t?.with !== from) break;
        t.okTheirs = [d.mine, d.theirs];
        this.tryComplete();
        break;
      case 'trade-cancel':
        if (t?.with !== from) break;
        this.trade = null;
        this.msg(`${r.name} annule l'échange.`, C.dim);
        break;
    }
  }

  private tradeable(id: string): boolean {
    try { const d = item(id); return !!d && d.cat !== 'quête' && d.cat !== 'clé'; } catch { return false; }
  }

  private openTrade(id: string) {
    const r = this.players.get(id);
    if (!r) return;
    this.trade = { with: id, name: r.name, mine: { items: new Map(), gold: 0, v: 0 }, theirs: { items: [], gold: 0, v: 0 }, okMine: null, okTheirs: null };
    this.onTradeOpen?.(this.trade);
  }

  /** Change la quantité offerte d'un objet (ou de l'or). */
  setOffer(id: string, n: number): void {
    const t = this.trade;
    if (!t) return;
    if (id === 'or') t.mine.gold = n; else if (n > 0) t.mine.items.set(id, n); else t.mine.items.delete(id);
    t.mine.v++; t.okMine = null; t.okTheirs = null;
    this.direct(t.with, { k: 'trade-offer', items: [...t.mine.items], gold: t.mine.gold, v: t.mine.v });
  }

  validateTrade(): void {
    const t = this.trade;
    if (!t) return;
    t.okMine = [t.mine.v, t.theirs.v];
    this.direct(t.with, { k: 'trade-ok', mine: t.mine.v, theirs: t.theirs.v });
    this.tryComplete();
  }

  cancelTrade(): void {
    if (!this.trade) return;
    this.direct(this.trade.with, { k: 'trade-cancel' });
    this.trade = null;
  }

  tradeStatus(): string {
    const t = this.trade;
    if (!t) return '';
    if (t.okMine && t.okTheirs) return 'Échange en cours…';
    if (t.okMine) return `Vous avez validé : en attente de ${t.name}.`;
    if (t.okTheirs) return `${t.name} a validé : à vous de valider (Entrée).`;
    return 'Composez votre offre, puis validez (Entrée). Toute modification annule les validations.';
  }

  /** Les deux joueurs ont validé les mêmes offres : chacun applique l'échange de son côté. */
  private tryComplete() {
    const t = this.trade;
    if (!t || !t.okMine || !t.okTheirs) return;
    const [m0, m1] = t.okMine, [t0, t1] = t.okTheirs;
    if (m0 !== t.mine.v || m1 !== t.theirs.v || t0 !== t.theirs.v || t1 !== t.mine.v) return;
    const ch = this.game.character;
    const missing = ch.inv.gold < t.mine.gold || [...t.mine.items].some(([id, n]) => ch.inv.count(id) - (ch.isEquipped(id) ? 1 : 0) < n);
    if (missing) { this.msg('Échange impossible : vous n’avez plus tout ce que vous offriez.', C.red); this.cancelTrade(); return; }
    ch.inv.gold -= t.mine.gold;
    for (const [id, n] of t.mine.items) ch.inv.remove(id, n);
    ch.inv.gold += t.theirs.gold;
    for (const [id, n] of t.theirs.items) ch.inv.add(id, n);
    const got = [...(t.theirs.gold ? [`${t.theirs.gold} or`] : []), ...t.theirs.items.map(([id, n]) => `${item(id).name}${n > 1 ? ' ×' + n : ''}`)];
    const now = performance.now();
    if (t.theirs.gold) this.game.lootFeed.push({ text: `+ ${t.theirs.gold} pièces d’or`, color: 0xe8c050, t: now });
    for (const [id, n] of t.theirs.items) this.game.lootFeed.push({ text: `+ ${n > 1 ? n + ' ' : ''}${item(id).name}`, color: 0xe8e8e0, t: now });
    this.msg(`Échange conclu avec ${t.name}${got.length ? ' : vous recevez ' + got.join(', ') : ''}.`, C.green);
    this.trade = null;
    this.game.audio.chime();
    this.saveNow();
  }

  // ---------------------------------------------------------------- faits partagés
  private onFact(k: string, v: unknown, by: string) {
    const cb = this.pending.get(k);
    if (cb) {
      this.pending.delete(k);
      if (v === this.myId) cb();
      else this.msg(`${this.players.get(String(v))?.name ?? 'Quelqu’un'} a été plus rapide.`, C.dim);
    }
    this.applying = true;
    this.applyFact(k, v, by !== this.myId);
    this.applying = false;
  }

  /** Applique un fait au jeu local (live : reçu en cours de partie, avec ses conséquences visibles). */
  private applyFact(k: string, v: unknown, live: boolean) {
    const g = this.game, ents = g.entities;
    this.facts.set(k, v);
    const [kind, ...rest] = k.split(':'), key = rest.join(':');
    if (kind === 'killed') ents.killed.add(key);
    else if (kind === 'camp') {
      const sid = Number(key);
      if (!ents.clearedCamps.has(sid)) {
        ents.clearedCamps.add(sid);
        const l = ents.lairs.find((x) => x.sid === sid);
        if (l) { l.alive = 0; l.leaderAlive = false; }
        if (live) g.events.emit('camp:cleared', { campId: sid });
      }
    } else if (kind === 'npc') { const n = ents.findNpc(key); if (n) { n.alive = false; n.hp = 0; } }
    else if (kind === 'open') g.state.opened.add(key);
    else if (kind === 'node') g.world.chunks.removeNode(key);
    else if (kind === 'flag') { g.state.flags.set(key, v as boolean); if (key.startsWith('door:')) g.applyDoor(); }
  }

  fact(k: string, v: unknown): void {
    if (this.facts.get(k) === v) return;
    this.facts.set(k, v);
    this.net.send({ t: 'fact', k, v });
  }

  /** Ressource unique (coffre, cadavre) : le premier joueur qui la réclame l'obtient. */
  claimOnce(k: string, onWin: () => void): void {
    if (this.facts.has(k)) { this.msg('Quelqu’un est déjà passé par là.', C.dim); return; }
    if (!this.online) { onWin(); this.net.send({ t: 'fact', k, v: this.myId }); return; }
    this.pending.set(k, onWin);
    this.net.send({ t: 'fact', k, v: this.myId, once: true });
  }

  // ---------------------------------------------------------------- autorité par zone (EntityNet)
  owns(zone: string): boolean {
    if (!this.online) return true;            // hors ligne : on simule tout
    const o = this.owners.get(zone);
    return o === undefined ? false : o === this.myId;
  }
  claim(zone: string): void { this.net.send({ t: 'claim', z: zone }); }
  release(zone: string): void {
    if (this.owners.get(zone) === this.myId) this.owners.delete(zone);
    this.net.send({ t: 'release', z: zone });
  }
  others(): RemoteTarget[] { return this.targets; }
  hurtRemote(id: string, amount: number, src: Entity, element?: Element): void {
    this.direct(id.slice(2), { k: 'hurt', a: amount, x: src.x, z: src.z, el: element, by: src.id });
  }
  forwardHit(e: Entity, amount: number, element?: Element): boolean {
    const z = this.game.entities.zoneOf(e);
    if (!z || this.owns(z)) return false;
    const owner = this.owners.get(z);
    if (owner) this.direct(owner, { k: 'dmg', id: e.id, a: amount, el: element });
    return true;
  }

  private direct(to: string, d: Direct) { this.net.send({ t: 'to', to, d }); }

  // ---------------------------------------------------------------- boucle
  update(dt: number): void {
    const g = this.game, p = g.player;
    // joueurs distants : interpolation vers le dernier état reçu
    const k = Math.min(1, dt * 12);
    this.targets.length = 0;
    for (const r of this.players.values()) {
      if (!r.seen) continue;
      const dx = r.tx - r.x, dz = r.tz - r.z;
      const far = Math.hypot(dx, dz) > 8;
      r.x = far ? r.tx : r.x + dx * k; r.y = far ? r.ty : r.y + (r.ty - r.y) * k; r.z = far ? r.tz : r.z + dz * k;
      let dh = r.th - r.heading; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
      r.heading += dh * k;
      const moved = far ? 0 : Math.hypot(dx * k, dz * k);
      r.pose.walk = moved > 0.002 ? r.pose.walk + moved * 3.2 : r.pose.walk * 0.85;
      this.targets.push({ id: 'p:' + r.id, x: r.x, y: r.y, z: r.z, dead: r.pose.dead > 0.5, crouch: r.crouch, sprint: r.sprint });
    }
    // tirs des autres joueurs : même trajectoire que chez eux (gravité pour les flèches)
    for (const s of this.shots) {
      s.life -= dt;
      if (s.stuck) continue;
      if (s.kind === 'flèche') s.vy -= 9.8 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const ground = g.dungeon ? 0 : g.world.heightAt(s.x, s.z);
      let hit = s.y < ground;
      for (const e of g.entities.entities) if (e.alive && Math.hypot(e.x - s.x, e.z - s.z) < e.radius + 0.15 && s.y > e.y && s.y < e.y + e.model.height) { hit = true; break; }
      if (hit) { s.stuck = true; s.life = s.kind === 'feu' ? 0 : Math.min(s.life, 15); }
    }
    this.shots = this.shots.filter((s) => s.life > 0);
    if (this.trade) { const r = this.players.get(this.trade.with); if (r && Math.hypot(r.x - p.x, r.z - p.z) > 15) { this.cancelTrade(); this.msg('Échange annulé : vous vous êtes éloignés.', C.dim); } }
    for (const sp of this.sparkles) { sp.t -= dt; sp.y += dt * 0.9; }
    this.sparkles = this.sparkles.filter((s) => s.t > 0);
    if (!this.online) return;
    this.sendT -= dt;
    if (this.sendT <= 0 && this.players.size) {
      this.sendT = 1 / NET_HZ;
      const ch = g.character, w = ch.weapon?.weapon?.kind ?? '-';
      const lk = `${w}|${ch.equip.bouclier === 'bouclier de fer' ? 'f' : ch.equip.bouclier ? 'b' : ''}|${ch.equip.tête ? 1 : 0}|${ch.equip.corps && /maille|plate/.test(ch.equip.corps) ? 1 : 0}`;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const s: PlayerState = {
        x: r2(p.x), y: r2(p.y), z: r2(p.z), h: r2(p.heading), sw: r2(g.fight.swing), bl: p.blocking ? 1 : 0, d: p.dead ? 1 : 0,
        hp: Math.round(p.hp), mhp: p.maxHp, lk, dg: g.dungeon ? g.dungeon.layout.id : -1, cr: p.crouch ? 1 : 0, sp: p.sprinting ? 1 : 0,
      };
      this.net.send({ t: 'st', s });
      const zs: ZoneEnts[] = g.entities.snapshot();
      if (zs.length) this.net.send({ t: 'ents', zs });
    }
    this.saveT -= dt;
    if (this.saveT <= 0) { this.saveT = 30; this.saveNow(); }
  }

  /** Sauvegarde du personnage dans le salon. */
  saveNow(): void {
    if (!this.online) return;
    const d = this.game.toSave('salon');
    if (JSON.stringify(d).length > MAX_SAVE) { d.rumors = []; d.npcs = d.npcs.filter((n) => n.memories.length || !n.alive); }
    this.net.send({ t: 'save', c: d });
  }

  chat(text: string): void { this.net.send({ t: 'chat', text }); }

  render(ib: InstanceBuffer, cx: number, cz: number): void {
    const dg = this.game.dungeon ? this.game.dungeon.layout.id : -1;
    for (const r of this.players.values()) {
      if (!r.seen || r.dungeon !== dg || Math.hypot(r.x - cx, r.z - cz) > 170) continue;
      drawModel(ib, r.model, r.x, r.y, r.z, r.heading, r.pose);
    }
    for (const s of this.shots) {
      const sp = Math.hypot(s.vx, s.vz) || 1, fire = s.kind === 'feu';
      trsYawPitch(this.m4, s.x, s.y, s.z, -Math.atan2(s.vx, -s.vz), Math.atan2(s.vy, sp), fire ? 0.35 : 0.03, fire ? 0.35 : 0.03, fire ? 0.35 : 0.8);
      ib.add(this.m4, fire ? 0xff7a20 : 0xb8a070, fire ? M.FIRE : M.WOOD, 0, 0, 1);
    }
    for (const s of this.sparkles) {
      trsYawPitch(this.m4, s.x, s.y, s.z, 0, 0, 0.08, 0.08, 0.08);
      ib.add(this.m4, 0x70f090, M.GLOW, '+'.charCodeAt(0) - 31, 0, 1, 2);
    }
  }

  /** Lumières des traits de feu des autres joueurs. */
  lights(): { x: number; y: number; z: number; radius: number; r: number; g: number; b: number }[] {
    return this.shots.filter((s) => s.kind === 'feu' && !s.stuck).map((s) => ({ x: s.x, y: s.y, z: s.z, radius: 8, r: 2, g: 0.9, b: 0.3 }));
  }

  private msg(text: string, color = C.text) { this.game.events.emit('message', { text, color }); }
}

