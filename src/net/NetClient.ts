import { PROTOCOL, shortId, type ClientMsg, type ServerMsg } from '@ascii-fort/net/protocol';
import { GENERATOR_VERSION } from '../version';

// Connexion WebSocket au salon (Durable Object), avec reconnexion automatique et
// synchronisation de l'horloge sur celle du serveur.

export type Welcome = Extract<ServerMsg, { t: 'welcome' }>;
export type NetStatus = 'connexion' | 'en ligne' | 'reconnexion' | 'hors ligne';

/** Adresse du salon : même origine en ligne ; en développement (Vite sur :5199), `wrangler dev` sur :8787. */
export function roomUrl(code: string): string {
  const l = location, dev = l.port === '5199';
  const host = dev ? `${l.hostname}:8787` : l.host;
  const proto = dev || l.protocol === 'http:' ? 'ws' : 'wss';
  return `${proto}://${host}/ws/${code}`;
}

/** Lien à partager pour rejoindre un salon. */
export function shareLink(code: string): string {
  return `${location.origin}${location.pathname}?salon=${code}`;
}

/** Identité stable du joueur sur ce navigateur (retrouve sa sauvegarde dans le salon). */
export function playerKey(): string {
  // ?cle=xxx : identité distincte par onglet (tester à plusieurs joueurs sur une seule machine)
  const forced = new URLSearchParams(location.search).get('cle');
  if (forced) return 'cle-' + forced.slice(0, 20);
  try {
    let k = localStorage.getItem('ascii-fort-player-key');
    if (!k) { k = shortId(16); localStorage.setItem('ascii-fort-player-key', k); }
    return k;
  } catch { return shortId(16); }
}

export class NetClient {
  status: NetStatus = 'connexion';
  /** heure serveur − heure locale (ms) */
  offset = 0;
  /** aller-retour (ms) */
  rtt = 0;
  lastError = '';
  private ws: WebSocket | null = null;
  private handlers = new Set<(m: ServerMsg) => void>();
  private pingTimer = 0;
  private tries = 0;
  private closing = false;
  private welcomed = false;

  constructor(readonly code: string, private name: string, private create?: { seed: string }) {}

  /** Première connexion : résout au message de bienvenue, échoue sur une erreur. */
  connect(): Promise<Welcome> {
    return new Promise((resolve, reject) => {
      const off = this.on((m) => {
        if (m.t === 'welcome') { off(); resolve(m); }
        else if (m.t === 'err' && m.fatal) { off(); reject(new Error(m.msg)); }
      });
      this.open((reason) => { off(); reject(new Error(reason)); });
    });
  }

  on(fn: (m: ServerMsg) => void): () => void { this.handlers.add(fn); return () => this.handlers.delete(fn); }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.status === 'en ligne') this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.closing = true;
    clearInterval(this.pingTimer);
    this.ws?.close(1000, 'quitte');
    this.status = 'hors ligne';
  }

  /** Heure du serveur (ms). */
  now(): number { return Date.now() + this.offset; }

  private open(onFail?: (reason: string) => void) {
    let ws: WebSocket;
    try { ws = new WebSocket(roomUrl(this.code)); } catch (e) { onFail?.(String(e)); return; }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      // le premier envoi part avant le statut « en ligne » : envoi direct
      ws.send(JSON.stringify({ t: 'hello', name: this.name, key: playerKey(), gen: GENERATOR_VERSION, proto: PROTOCOL, create: this.welcomed ? undefined : this.create } satisfies ClientMsg));
    };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.t === 'welcome') {
        this.welcomed = true; this.tries = 0; this.status = 'en ligne';
        this.offset = m.now - Date.now();
        clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => this.send({ t: 'ping', n: performance.now() }), 5000);
      }
      if (m.t === 'pong') {
        this.rtt = performance.now() - m.n;
        this.offset = this.offset * 0.7 + (m.now + this.rtt / 2 - Date.now()) * 0.3;
      }
      if (m.t === 'err') { this.lastError = m.msg; if (m.fatal) this.closing = true; }
      for (const h of [...this.handlers]) h(m);
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.closing) { this.status = 'hors ligne'; return; }
      if (!this.welcomed) { this.status = 'hors ligne'; onFail?.(opened ? (this.lastError || 'Connexion refusée.') : 'Serveur injoignable.'); return; }
      // coupure en cours de partie : nouvelles tentatives espacées
      this.status = 'reconnexion';
      if (++this.tries > 30) { this.status = 'hors ligne'; return; }
      setTimeout(() => { if (!this.closing) this.open(); }, Math.min(10000, 1000 * this.tries));
    };
  }
}
