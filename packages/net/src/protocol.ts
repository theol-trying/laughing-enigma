// Protocole du mode multijoueur, partagé entre le jeu et le serveur (Cloudflare Durable Object).
//
// Le serveur est un « salon » générique : il relaie les messages, arbitre la propriété des zones
// (le joueur propriétaire d'une zone y simule PNJ et créatures pour tout le monde), garde des
// faits persistants (clé → valeur : coffre ouvert, créature unique tuée, camp démantelé…) et la
// sauvegarde du personnage de chaque joueur. Il ne connaît pas les règles du jeu : chaque client
// régénère le monde à partir de la seed, seules les différences circulent.

/** Version du protocole : un client et un serveur de versions différentes refusent de se parler. */
export const PROTOCOL = 1;
export const MAX_PLAYERS = 8;
export const MAX_MESSAGE = 64 * 1024;
/** Fréquence d'envoi de l'état des joueurs et des entités (Hz). */
export const NET_HZ = 10;
/** Un salon vide est effacé après ce délai. */
export const ROOM_TTL_MS = 30 * 24 * 3600 * 1000;

export interface PlayerInfo { id: string; name: string }

export type ClientMsg =
  | { t: 'hello'; name: string; key: string; gen: string; proto: number; create?: { seed: string } }
  /** état du joueur (position, pose, apparence…), relayé aux autres */
  | { t: 'st'; s: unknown }
  /** entités d'une zone dont l'expéditeur est propriétaire */
  | { t: 'ents'; z: string; l: unknown[] }
  /** intérêt pour une zone (devient propriétaire si personne ne l'est) / fin d'intérêt */
  | { t: 'claim'; z: string }
  | { t: 'release'; z: string }
  /** message adressé à un joueur précis (dégâts, demande au propriétaire d'une zone…) */
  | { t: 'to'; to: string; d: unknown }
  /** fait persistant du monde partagé ; once : le premier arrivé gagne (coffres) */
  | { t: 'fact'; k: string; v: unknown; once?: boolean }
  /** événement relayé sans être stocké (effets visuels, sons) */
  | { t: 'fx'; d: unknown }
  /** sauvegarde du personnage (rendue au joueur quand il revient dans le salon) */
  | { t: 'save'; c: unknown }
  | { t: 'chat'; text: string }
  | { t: 'ping'; n: number };

export type ServerMsg =
  | { t: 'welcome'; you: string; seed: string; created: number; now: number; players: PlayerInfo[]; facts: Record<string, unknown>; owners: Record<string, string>; save: unknown }
  | { t: 'join'; p: PlayerInfo }
  | { t: 'leave'; id: string }
  | { t: 'st'; id: string; s: unknown }
  | { t: 'ents'; id: string; z: string; l: unknown[] }
  | { t: 'owner'; z: string; id: string | null }
  | { t: 'to'; from: string; d: unknown }
  | { t: 'fact'; k: string; v: unknown; by: string }
  | { t: 'fx'; id: string; d: unknown }
  | { t: 'chat'; id: string; name: string; text: string }
  | { t: 'pong'; n: number; now: number }
  | { t: 'err'; msg: string; fatal?: boolean };

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I/L
export const ROOM_RE = /^[A-Z0-9]{5,8}$/;

/** Code de salon aléatoire (6 caractères faciles à dicter). */
export function roomCode(len = 6): string {
  const r = crypto.getRandomValues(new Uint32Array(len));
  return Array.from(r, (v) => ALPHABET[v % ALPHABET.length]).join('');
}

/** Identifiant court aléatoire (joueurs). */
export function shortId(len = 8): string {
  const r = crypto.getRandomValues(new Uint32Array(len));
  return Array.from(r, (v) => 'abcdefghijklmnopqrstuvwxyz0123456789'[v % 36]).join('');
}

/** Nom de joueur affichable : 1 à 16 caractères imprimables. */
export function cleanName(s: unknown): string {
  const n = String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return n || 'Voyageur';
}

export function cleanSeed(s: unknown): string {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
}

export function cleanCode(s: unknown): string {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}
