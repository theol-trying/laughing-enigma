import type { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import type { Layout } from '@ascii-fort/worldgen/civilization/Layout';
import type { Good } from '@ascii-fort/worldgen/civilization/types';
import type { WorldSeed } from '@ascii-fort/core/Seed';
import type { RNG } from '@ascii-fort/core/RNG';
import { NameGen } from '@ascii-fort/worldgen/civilization/Names';
import { segDist } from '@ascii-fort/core/math';
import { dangerAt } from '../entities/Monster';
import type { NPCData, Profession, Traits } from '../entities/NPC';
import type { HumanLook } from '../entities/Models';
import { ITEMS, item } from './Items';
import { GOOD_NAMES } from './Economy';

// Trafic des routes : caravanes (chariot bâché, marchand, cocher, gardes), pèlerins, colporteurs, messagers et patrouilles
// circulent entre les implantations reliées par une route. Simulation abstraite et déterministe : les départs du jour
// d'une route se tirent sur le flux « convois » (route, jour), la position à une heure donnée se calcule (route le jour,
// halte la nuit), les embuscades et leur issue sans témoin aussi. Le jeu n'incarne que les convois proches du joueur.
// Seuls les faits non déductibles du temps (issue observée d'une embuscade) viennent d'ailleurs : `Outcome`.
// Module pur : aucun accès au jeu (l'état des camps de bandits arrive par `campActive`).

const DAY = 1440;
/** Fenêtre de route (minutes du jour) : on part à l'aube, on fait halte au crépuscule. */
export const TRAVEL = { from: 6.5 * 60, to: 20 * 60 } as const;
const SPAN = TRAVEL.to - TRAVEL.from;
/** Préparatifs avant le départ et déchargement à l'arrivée (minutes, le convoi attend au bord du village). */
export const PREP = 40, UNLOAD = 40;
/** Durée d'une embuscade sans témoin (minutes) avant son issue abstraite ; jours pendant lesquels une épave reste visible. */
export const AMBUSH_WINDOW = 45, WRECK_DAYS = 4;
/** Marge autour des bâtiments, murs et décors que le chariot et sa colonne ne doivent pas toucher (m). */
const CLEAR = 1.6;

export type ConvoyKind = 'caravane' | 'pèlerins' | 'colporteur' | 'messager' | 'patrouille';
export type Role = 'marchand' | 'charretier' | 'escorte' | 'pèlerin' | 'colporteur' | 'messager' | 'soldat';
/** Allure (m par minute de jeu, soit m/s au rythme normal du temps). */
const SPEED: Record<ConvoyKind, number> = { caravane: 1.15, pèlerins: 1.0, colporteur: 1.25, messager: 2.0, patrouille: 1.35 };
const TITLE: Record<Role, [string, string]> = {
  marchand: ['marchand', 'marchande'], charretier: ['charretier', 'charretière'], escorte: ['garde de caravane', 'garde de caravane'],
  pèlerin: ['pèlerin', 'pèlerine'], colporteur: ['colporteur', 'colporteuse'], messager: ['messager', 'messagère'], soldat: ['soldat', 'soldat'],
};
/** Couleurs des bâches et des caisses. */
const COVERS = [0xd8ccb0, 0xc8b890, 0xb8a888, 0xd0c0a0, 0x9a8a6a, 0xa86a4a, 0x8a9a7a];
const CRATES = [0x8a6a40, 0x7a5a36, 0x9a7a4a, 0x6a4a2a];

// ---------------------------------------------------------------- temps de route

/** Minutes de route cumulées depuis le jour 0 à l'instant t (on ne voyage que dans la fenêtre du jour). */
export function activeAt(t: number): number {
  const d = Math.floor(t / DAY), m = t - d * DAY;
  return d * SPAN + Math.min(SPAN, Math.max(0, m - TRAVEL.from));
}
/** Premier instant où les minutes de route cumulées atteignent a (inverse de activeAt). */
export function timeOfActive(a: number): number {
  const d = Math.floor(a / SPAN), r = a - d * SPAN;
  if (r <= 0 && d > 0) return (d - 1) * DAY + TRAVEL.to;
  return d * DAY + TRAVEL.from + r;
}
export function inWindow(t: number): boolean { const m = t - Math.floor(t / DAY) * DAY; return m >= TRAVEL.from && m < TRAVEL.to; }

// ---------------------------------------------------------------- itinéraires

/** Itinéraire d'une route : ses points (sens a → b), praticable de s0 à s1 (hors des bâtiments, murs et décors aux deux bouts). */
export interface Route {
  road: number;
  xs: Float64Array; zs: Float64Array; cum: Float64Array;
  s0: number; s1: number;
  /** points écartés d'un obstacle rencontré en chemin (village traversé) */
  nudged: number;
}

export type Obstacle =
  | { t: 'r'; x: number; z: number; c: number; s: number; hw: number; hd: number }
  | { t: 'c'; x: number; z: number; r: number }
  | { t: 's'; ax: number; az: number; bx: number; bz: number; r: number };

const DECOR_R: Record<string, number> = {
  puits: 1.2, fontaine: 2.1, statue: 1.3, brasero: 0.5, étal: 1.4, lanterne: 0.3, tente: 2.6, caisse: 0.6, pieu: 0.3, tombe: 0.7, croix: 0.4,
  menhir: 0.8, sanctuaire: 1.6, 'arbre géant': 2.6, 'tour de guet': 3.2, gravats: 1.4, 'entrée grotte': 2.2, 'entrée mine': 2.2, clôture: 1.5, roue: 1.0,
  tanière: 2.2, 'feu de camp': 1.0,
};

/** Obstacles d'un plan (bâtiments, murs, tours, décors). */
export function obstaclesOf(L: Layout): Obstacle[] {
  const out: Obstacle[] = [];
  for (const b of L.buildings) out.push({ t: 'r', x: b.x, z: b.z, c: Math.cos(b.yaw), s: Math.sin(b.yaw), hw: b.w / 2, hd: b.d / 2 });
  for (const w of L.walls) out.push({ t: 's', ax: w.ax, az: w.az, bx: w.bx, bz: w.bz, r: w.stone ? 0.8 : 0.25 });
  for (const tw of L.towers) out.push({ t: 'c', x: tw.x, z: tw.z, r: tw.r });
  for (const d of L.decor) { const r = DECOR_R[d.kind]; if (r) out.push({ t: 'c', x: d.x, z: d.z, r: r * d.s }); }
  return out;
}

/** Poussée qui sort (x, z) de l'obstacle (marge comprise), ou null s'il est dégagé. */
export function pushOut(o: Obstacle, x: number, z: number, m = CLEAR): [number, number] | null {
  if (o.t === 'r') {
    const dx = x - o.x, dz = z - o.z, lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
    const px = o.hw + m - Math.abs(lx), pz = o.hd + m - Math.abs(lz);
    if (px <= 0 || pz <= 0) return null;
    const vx = px < pz ? Math.sign(lx || 1) * px : 0, vz = px < pz ? 0 : Math.sign(lz || 1) * pz;
    return [vx * o.c + vz * o.s, -vx * o.s + vz * o.c];
  }
  if (o.t === 'c') {
    const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), need = o.r + m;
    if (d >= need) return null;
    return d < 1e-6 ? [need, 0] : [(dx / d) * (need - d), (dz / d) * (need - d)];
  }
  const { d, t } = segDist(x, z, o.ax, o.az, o.bx, o.bz), need = o.r + m;
  if (d >= need) return null;
  const px = o.ax + (o.bx - o.ax) * t, pz = o.az + (o.bz - o.az) * t, dx = x - px, dz = z - pz, l = Math.hypot(dx, dz) || 1;
  return [(dx / l) * (need - d), (dz / l) * (need - d)];
}

/** L'itinéraire d'une route : ponts franchis dans l'axe, bouts rognés hors des villages, obstacles évités en chemin. */
export function buildRoute(civ: Civilization, layouts: Layout[], roadId: number): Route {
  // points de la route resserrés (1,3 m au plus) : un segment ne peut pas couper le coin d'un obstacle entre deux points dégagés
  const road = civ.roads[roadId], pts = road.points, px: number[] = [], pz: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    px.push(pts[i].x); pz.push(pts[i].z);
    if (i + 1 >= pts.length) break;
    const k = Math.ceil(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z) / 1.3);
    for (let j = 1; j < k; j++) { px.push(pts[i].x + ((pts[i + 1].x - pts[i].x) * j) / k); pz.push(pts[i].z + ((pts[i + 1].z - pts[i].z) * j) / k); }
  }
  const n = px.length, xs = Float64Array.from(px), zs = Float64Array.from(pz);
  // ponts : les points proches sont ramenés sur l'axe du tablier
  for (const br of road.bridges) {
    const s = Math.sin(br.yaw), c = Math.cos(br.yaw), hl = br.length / 2;
    // sur le tablier : exactement dans l'axe ; aux abords (12 m), on y converge en douceur (pas de coude)
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - br.x, dz = zs[i] - br.z, along = dx * s + dz * c, across = dx * c - dz * s;
      const wa = Math.abs(along) <= hl + 1 ? 1 : Math.max(0, 1 - (Math.abs(along) - hl - 1) / 12);
      const wc = Math.abs(across) <= br.width ? 1 : Math.max(0, 1 - (Math.abs(across) - br.width) / 6), w = wa * wc;
      if (w <= 0) continue;
      xs[i] -= c * across * w; zs[i] += s * across * w;
    }
  }
  // obstacles des plans voisins de la route
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]); z0 = Math.min(z0, zs[i]); z1 = Math.max(z1, zs[i]); }
  const near: { L: Layout; obs: Obstacle[]; reach: number }[] = [];
  for (const L of layouts) {
    const reach = L.radius + 60;
    if (L.x < x0 - reach || L.x > x1 + reach || L.z < z0 - reach || L.z > z1 + reach) continue;
    near.push({ L, obs: obstaclesOf(L), reach });
  }
  const blockedBy = (x: number, z: number): [number, number] | null => {
    for (const q of near) {
      if (Math.abs(q.L.x - x) > q.reach || Math.abs(q.L.z - z) > q.reach) continue;
      for (const o of q.obs) { const p = pushOut(o, x, z); if (p) return p; }
    }
    return null;
  };
  // bouts : on part du dernier obstacle rencontré dans l'emprise de chaque implantation (et à 7 m du centre au moins)
  const A = civ.settlements[road.a], B = civ.settlements[road.b];
  const inA = (i: number) => Math.hypot(xs[i] - A.x, zs[i] - A.z) < A.radius + 45;
  const inB = (i: number) => Math.hypot(xs[i] - B.x, zs[i] - B.z) < B.radius + 45;
  let i0 = 0, i1 = n - 1;
  for (let i = 0; i < n && inA(i); i++) if (blockedBy(xs[i], zs[i]) || Math.hypot(xs[i] - A.x, zs[i] - A.z) < 7) i0 = i + 4;
  for (let i = n - 1; i >= 0 && inB(i); i--) if (blockedBy(xs[i], zs[i]) || Math.hypot(xs[i] - B.x, zs[i] - B.z) < 7) i1 = i - 8;
  i0 = Math.min(n - 1, i0); i1 = Math.max(0, i1);
  // en chemin (village traversé, moulin ou cimetière sur la route) : le point est écarté de côté jusqu'à être dégagé (10 m au
  // plus), puis ses voisins s'alignent sur ce détour tant qu'ils restent dégagés
  // un point est dégagé si lui et les milieux des segments qui le relient à ses voisins le sont
  const clearAt = (i: number, x: number, z: number) => !blockedBy(x, z)
    && (i <= i0 || !blockedBy((x + xs[i - 1]) / 2, (z + zs[i - 1]) / 2)) && (i >= i1 || !blockedBy((x + xs[i + 1]) / 2, (z + zs[i + 1]) / 2));
  let nudged = 0;
  const moved = new Uint8Array(n);
  // d'abord les points eux-mêmes, puis les segments (un point ne se dégage pas tant que son voisin est dans l'obstacle)
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const ok = pass < 4 ? (i: number, x: number, z: number) => !blockedBy(x, z) : clearAt;
    for (let i = i0; i <= i1; i++) {
      if (ok(i, xs[i], zs[i])) continue;
      const j0 = Math.max(0, i - 4), j1 = Math.min(n - 1, i + 4), tx = xs[j1] - xs[j0], tz = zs[j1] - zs[j0], l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l, nz = tx / l;
      let off = 0;
      for (let k = 1; k <= 25 && !off; k++) for (const o of [k * 0.4, -k * 0.4]) if (ok(i, xs[i] + nx * o, zs[i] + nz * o)) { off = o; break; }
      if (!off) continue;   // impossible à contourner : on laisse le tracé de la route
      xs[i] += nx * off; zs[i] += nz * off; moved[i] = 1; nudged++; changed = true;
    }
    if (!changed) break;
  }
  // le détour se fond dans la route : chaque point voisin d'un point écarté glisse vers la moyenne de ses voisins s'il reste dégagé
  if (nudged) for (let it = 0; it < 14; it++) for (let i = i0 + 1; i < i1; i++) {
    let near = false;
    for (let k = -9; k <= 9 && !near; k++) if (moved[Math.max(0, Math.min(n - 1, i + k))]) near = true;
    if (!near) continue;
    const cx = (xs[i - 1] + 2 * xs[i] + xs[i + 1]) / 4, cz = (zs[i - 1] + 2 * zs[i] + zs[i + 1]) / 4;
    if (clearAt(i, cx, cz)) { xs[i] = cx; zs[i] = cz; }
  }
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  // une route qui reste obstruée (mur d'enceinte sans porte, détour impossible) ou qui zigzague n'a pas de convois
  let bad = false;
  for (let i = i0; i <= i1 && !bad; i++) bad = !!blockedBy(xs[i], zs[i]) || (i > i0 && Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]) > 3);
  return { road: roadId, xs, zs, cum, s0: cum[i0], s1: bad ? cum[i0] : cum[i1], nudged };
}

/** Point (et direction, sens a → b) d'un itinéraire à la distance s depuis a. */
export function routeAt(r: Route, s: number, out: { x: number; z: number; dx: number; dz: number }): void {
  const cum = r.cum, n = cum.length;
  s = Math.max(0, Math.min(cum[n - 1], s));
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const seg = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / seg;
  const dx = r.xs[hi] - r.xs[lo], dz = r.zs[hi] - r.zs[lo], l = Math.hypot(dx, dz) || 1;
  out.x = r.xs[lo] + dx * t; out.z = r.zs[lo] + dz * t; out.dx = dx / l; out.dz = dz / l;
}

// ---------------------------------------------------------------- convois

export interface Ambush {
  /** distance parcourue au moment de l'embuscade (m) et instant (minute absolue) */
  u: number; t: number;
  bandits: number; level: number;
  /** camp de bandits voisin (implantation « camp »), −1 : brigands des routes dangereuses */
  camp: number;
  /** issue sans témoin : pillé (sinon le convoi repousse l'attaque et repart) */
  loses: boolean;
}

export interface ConvoyPlan {
  /** « <jour>.<route>.<rang> » (« d<n> » : convoi de la console de développement) */
  id: string; road: number; day: number; k: number;
  kind: ConvoyKind;
  /** sens a → b de la route */
  fwd: boolean; from: number; to: number;
  /** départ (minute absolue), allure (m/min), longueur parcourue (m) */
  depart: number; speed: number; len: number;
  size: number;
  animal: 'cheval' | 'mules' | null; coat: number; cover: number; crate: number;
  /** bien transporté (caravane) et maison de négoce du marchand (0..2, −1 sans marchand) */
  cargo: Good | null; house: number;
  /** danger de la route : niveau des gardes et des brigands */
  level: number;
  ambush: Ambush | null;
  /** messager : un pli à confier au joueur */
  letter: boolean;
  /** côté de la route où le convoi campe la nuit (1 : droite) */
  side: 1 | -1;
}

export type ConvoyMode = 'absent' | 'départ' | 'route' | 'halte' | 'auberge' | 'embuscade' | 'arrivée' | 'épave';
export interface ConvoyState {
  mode: ConvoyMode;
  /** distance parcourue (m), position, direction de marche (cap au sens du jeu : 0 = nord) */
  u: number; x: number; z: number; h: number;
}
/** Issue observée d'une embuscade (fait partagé « conv:<id> ») : pillé (« p ») ou sauvé (« s »), et l'instant (reprise de la route). */
export interface Outcome { k: 'p' | 's'; t: number }
export interface Nearby { plan: ConvoyPlan; st: ConvoyState; d: number }

export function emptyState(): ConvoyState { return { mode: 'absent', u: 0, x: 0, z: 0, h: 0 }; }

/** « du grain », « de la laine », « de l'étoffe », « des herbes ». */
export function partitif(g: Good): string {
  const n = GOOD_NAMES[g];
  return n.startsWith('les ') ? 'des ' + n.slice(4) : n.startsWith('le ') ? 'du ' + n.slice(3) : 'de ' + n;
}
/** Valeur d'issue du fait partagé : « p1234 » ou « s1234 » (minutes entières) ; null si illisible. */
export function parseOutcome(v: unknown): Outcome | null {
  if (typeof v !== 'string' || !/^[ps]\d{1,9}$/.test(v)) return null;
  return { k: v[0] as 'p' | 's', t: Number(v.slice(1)) };
}
export function outcomeValue(o: Outcome): string { return `${o.k}${Math.max(0, Math.round(o.t))}`; }

export interface MemberSpec {
  id: string; role: Role; npc: NPCData;
  /** combattant (gardes, soldats) ; dégâts par coup */
  fighter: boolean; dmg: number;
  /** PV maximaux */
  max: number;
  /** graine d'apparence (variantes de tenue) */
  v: number;
}

/** Trafic de toutes les routes : itinéraires, départs du jour, positions, embuscades. */
export class Traffic {
  private routes = new Map<number, Route | null>();
  private cache = new Map<string, ConvoyPlan[]>();
  private crew = new Map<string, MemberSpec[]>();
  private bbox: { x0: number; z0: number; x1: number; z1: number }[];
  private lookback: number[] = [];
  /** convois créés par la console de développement */
  readonly dev: ConvoyPlan[] = [];
  private devN = 0;
  private tmp = { x: 0, z: 0, dx: 0, dz: 0 };

  constructor(private civ: Civilization, private seed: WorldSeed, private layouts: Layout[], private campActive: (campSid: number) => boolean) {
    this.bbox = civ.roads.map((r) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of r.points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      return { x0, z0, x1, z1 };
    });
  }

  /** Itinéraire praticable d'une route (null : trop court une fois rogné). */
  route(roadId: number): Route | null {
    let r = this.routes.get(roadId);
    if (r === undefined) {
      const b = buildRoute(this.civ, this.layouts, roadId);
      r = b.s1 - b.s0 > 60 ? b : null;
      this.routes.set(roadId, r);
    }
    return r;
  }
  /** Jours à remonter pour trouver les convois encore en route (ou leur épave) sur cette route. */
  private back(roadId: number): number {
    let k = this.lookback[roadId];
    if (k === undefined) {
      const r = this.route(roadId);
      k = r ? Math.ceil((r.s1 - r.s0 + 300) / (0.9 * SPAN)) + 1 + WRECK_DAYS : 0;
      this.lookback[roadId] = k;
    }
    return k;
  }

  /** Point de l'itinéraire d'un convoi, à la distance u parcourue (cap de marche dans `h`). */
  at(p: ConvoyPlan, u: number, out: { x: number; z: number; h: number }): void {
    const r = this.route(p.road);
    if (!r) { out.x = this.civ.settlements[p.from].x; out.z = this.civ.settlements[p.from].z; out.h = 0; return; }
    const t = this.tmp;
    routeAt(r, p.fwd ? r.s0 + u : r.s1 - u, t);
    out.x = t.x; out.z = t.z;
    const dx = p.fwd ? t.dx : -t.dx, dz = p.fwd ? t.dz : -t.dz;
    out.h = Math.atan2(dx, -dz);
  }

  /** Niveau de danger d'une route (le pire de trois points) : niveau des gardes et des brigands. */
  danger(roadId: number): number {
    let g = this.dangers.get(roadId);
    if (g !== undefined) return g;
    const r = this.route(roadId);
    g = 1;
    if (r) for (const f of [0.25, 0.5, 0.75]) { routeAt(r, r.s0 + (r.s1 - r.s0) * f, this.tmp); g = Math.max(g, dangerAt(this.civ, this.tmp.x, this.tmp.z)); }
    this.dangers.set(roadId, g);
    return g;
  }
  private dangers = new Map<number, number>();

  /** Départs du jour sur une route (déterministe : flux « convois », route, jour). */
  plans(roadId: number, day: number): ConvoyPlan[] {
    const key = `${roadId}:${day}`;
    let list = this.cache.get(key);
    if (list) return list;
    list = [];
    const road = this.civ.roads[roadId], route = this.route(roadId);
    if (road && route && day >= 0) {
      const rng = this.seed.stream('convois', roadId, day);
      const rate = road.kind === 2 ? 0.8 + road.trade * 1.6 : 0.35;
      const n = Math.floor(rate) + (rng.next() < rate - Math.floor(rate) ? 1 : 0);
      for (let k = 0; k < n; k++) list.push(this.make(rng.fork(k), roadId, day, k, route));
    }
    this.cache.set(key, list);
    return list;
  }

  private make(q: RNG, roadId: number, day: number, k: number, route: Route, force?: ConvoyKind): ConvoyPlan {
    const civ = this.civ, road = civ.roads[roadId];
    // tirages dans un ordre fixe : l'état du monde (camps) ne décale aucun autre champ
    const rDir = q.next(), rKind = q.next(), rDep = q.next(), rSpeed = q.next(), rSize = q.next(), rAnimal = q.next(), rCoat = q.next(), rCover = q.next(), rCrate = q.next();
    const rCargo = q.next(), rHouse = q.next(), rSide = q.next(), rLetter = q.next();
    const rCamp = q.next(), rDanger = q.next(), rFrac = q.next(), rBand = q.next(), rLoses = q.next();
    const fwd = rDir < 0.5, from = fwd ? road.a : road.b, to = fwd ? road.b : road.a;
    const A = civ.settlements[from], B = civ.settlements[to];
    // sorte de convoi : patrouilles sur les terres d'un royaume ou d'un ordre, pèlerins vers un monastère ou un temple
    const fac = civ.factions[A.factionId];
    const patrol = A.factionId >= 0 && A.factionId === B.factionId && (fac?.kind === 'royaume' || fac?.kind === 'ordre') && !['hameau', 'monastère', 'camp', 'ruines'].includes(A.type);
    const holy = B.type === 'monastère' || B.type === 'ville' || B.type === 'capitale' ? 3 : 1;
    const w: [ConvoyKind, number][] = road.kind === 2
      ? [['caravane', 0.48], ['colporteur', 0.12], ['messager', 0.13], ['pèlerins', 0.08 * holy], ['patrouille', patrol ? 0.19 : 0]]
      : [['caravane', 0.16], ['colporteur', 0.3], ['messager', 0.16], ['pèlerins', 0.14 * holy], ['patrouille', patrol ? 0.2 : 0]];
    let kind: ConvoyKind = force ?? w[w.length - 1][0];
    if (!force) { let t = rKind * w.reduce((a, [, x]) => a + x, 0); for (const [kk, x] of w) if ((t -= x) < 0) { kind = kk; break; } }
    const len = route.s1 - route.s0;
    const depart = day * DAY + TRAVEL.from + Math.floor(rDep * (kind === 'messager' ? 480 : 240));
    const speed = SPEED[kind] * (0.92 + rSpeed * 0.16);
    const size = kind === 'caravane' ? 2 + Math.floor(rSize * 3) : kind === 'pèlerins' ? 2 + Math.floor(rSize * 3) : kind === 'patrouille' ? 2 + Math.floor(rSize * 2) : 1;
    const cargo = kind === 'caravane' ? pickCargo(A.produces, B.needs, rCargo) : null;
    const p: ConvoyPlan = {
      id: `${day}.${roadId}.${k}`, road: roadId, day, k, kind, fwd, from, to, depart, speed, len, size,
      animal: kind === 'caravane' ? (rAnimal < 0.6 ? 'cheval' : 'mules') : null, coat: Math.floor(rCoat * 60), cover: COVERS[Math.floor(rCover * COVERS.length)], crate: CRATES[Math.floor(rCrate * CRATES.length)],
      cargo, house: kind === 'caravane' ? Math.floor(rHouse * 3) : -1, level: this.danger(roadId), ambush: null,
      letter: kind === 'messager' && rLetter < 0.75, side: rSide < 0.5 ? 1 : -1,
    };
    p.ambush = this.ambushOf(p, { rCamp, rDanger, rFrac, rBand, rLoses });
    return p;
  }

  /**
   * Embuscade d'un convoi (caravane, pèlerins, colporteur) : près d'un camp de bandits encore debout sur sa route (six fois
   * sur dix), sinon d'autant plus probable que la route est dangereuse. Les patrouilles et les messagers ne sont pas attaqués.
   */
  private ambushOf(p: ConvoyPlan, r: { rCamp: number; rDanger: number; rFrac: number; rBand: number; rLoses: number }): Ambush | null {
    if (p.kind !== 'caravane' && p.kind !== 'pèlerins' && p.kind !== 'colporteur') return null;
    const civ = this.civ, road = civ.roads[p.road], route = this.route(p.road)!, pt = { x: 0, z: 0, h: 0 };
    const A = civ.settlements[p.from], B = civ.settlements[p.to];
    const camp = civ.pois.find((x) => x.kind === 'camp de bandits' && x.roadId === p.road && this.campActive(x.settlementId));
    let u = -1, bandits = 0, level = p.level, campSid = -1;
    if (camp && r.rCamp < 0.6) {
      // point de l'itinéraire le plus proche du camp
      let best = Infinity;
      for (let s = route.s0; s <= route.s1; s += 6) {
        routeAt(route, s, this.tmp);
        const d = Math.hypot(this.tmp.x - camp.x, this.tmp.z - camp.z);
        if (d < best) { best = d; u = p.fwd ? s - route.s0 : route.s1 - s; }
      }
      u = Math.max(80, Math.min(p.len - 80, u));
      bandits = 3 + (r.rBand < 0.5 ? 0 : 1);
      level = dangerAt(civ, camp.x, camp.z);
      campSid = camp.settlementId;
    } else {
      const chance = Math.min(0.3, 0.05 * (p.level - 1) + (road.kind === 1 ? 0.04 : 0));
      if (r.rDanger >= chance) return null;
      u = p.len * (0.25 + r.rFrac * 0.5);
      this.at(p, u, pt);
      if (Math.hypot(pt.x - A.x, pt.z - A.z) < A.radius + 110 || Math.hypot(pt.x - B.x, pt.z - B.z) < B.radius + 110) return null;
      level = dangerAt(civ, pt.x, pt.z);
      bandits = Math.min(p.kind === 'caravane' ? 4 : 3, 2 + (level >= 4 ? 1 : 0) + (level >= 7 ? 1 : 0));
    }
    if (u <= 0 || u >= p.len) return null;
    const guards = p.kind === 'caravane' ? p.size - 2 : 0;
    const lose = Math.max(0.1, Math.min(0.9, 0.3 + 0.15 * (bandits - guards) + (campSid >= 0 ? 0.1 : 0)));
    return { u, t: timeOfActive(activeAt(p.depart) + u / p.speed), bandits, level, camp: campSid, loses: r.rLoses < lose };
  }

  /** Convoi par identifiant (« <jour>.<route>.<rang> » ou convoi de développement). */
  plan(id: string): ConvoyPlan | undefined {
    if (id.startsWith('d')) return this.dev.find((p) => p.id === id);
    const [d, r, k] = id.split('.').map(Number);
    if (!Number.isInteger(d) || !Number.isInteger(r) || !Number.isInteger(k) || !this.civ.roads[r]) return undefined;
    return this.plans(r, d)[k];
  }

  /** État d'un convoi à l'instant t (issue observée de son embuscade s'il y en a une). */
  stateAt(p: ConvoyPlan, t: number, o: Outcome | undefined, out: ConvoyState = emptyState()): ConvoyState {
    out.mode = 'absent';
    if (t < p.depart - PREP) return out;
    const A0 = activeAt(p.depart);
    let u = 0, mode: ConvoyMode | '' = '', resume = -1;
    if (t < p.depart) mode = 'départ';
    else {
      u = p.speed * (activeAt(t) - A0);
      const am = p.ambush;
      if (am && u >= am.u) {
        const k = o ? o.k : am.loses ? 'p' : 's', ot = o ? o.t : am.t + AMBUSH_WINDOW;
        if (t < ot) { mode = 'embuscade'; u = am.u; }
        else if (k === 'p') { if (t >= ot + WRECK_DAYS * DAY) return out; mode = 'épave'; u = am.u; }
        else { resume = ot; u = am.u + p.speed * (activeAt(t) - activeAt(ot)); }
      }
      if (!mode && u >= p.len) {
        const arrive = resume >= 0 ? timeOfActive(activeAt(resume) + (p.len - p.ambush!.u) / p.speed) : timeOfActive(A0 + p.len / p.speed);
        if (t >= arrive + UNLOAD) return out;
        mode = 'arrivée'; u = p.len;
      }
      if (!mode) mode = inWindow(t) ? 'route' : 'halte';
    }
    out.u = Math.max(0, Math.min(p.len, u));
    this.at(p, out.u, out);
    // halte de nuit au bord d'un village : on dort à l'auberge (le convoi n'est pas dehors)
    if (mode === 'halte') for (const sid of [p.from, p.to]) {
      const s = this.civ.settlements[sid];
      if (Math.hypot(out.x - s.x, out.z - s.z) < s.radius + 25) { mode = 'auberge'; break; }
    }
    out.mode = mode;
    return out;
  }

  /** Convois présents à moins de r m de (x, z) à l'instant t (sans les absents ni ceux qui dorment à l'auberge). */
  near(x: number, z: number, t: number, r: number, outcome: (id: string) => Outcome | undefined): Nearby[] {
    const out: Nearby[] = [], day = Math.floor(t / DAY);
    const take = (p: ConvoyPlan) => {
      const st = this.stateAt(p, t, outcome(p.id));
      if (st.mode === 'absent' || st.mode === 'auberge') return;
      const d = Math.hypot(st.x - x, st.z - z);
      if (d <= r) out.push({ plan: p, st, d });
    };
    for (let ri = 0; ri < this.civ.roads.length; ri++) {
      const b = this.bbox[ri];
      if (x < b.x0 - r || x > b.x1 + r || z < b.z0 - r || z > b.z1 + r) continue;
      const back = this.back(ri);
      for (let d = day - back; d <= day; d++) for (const p of this.plans(ri, d)) take(p);
    }
    for (const p of this.dev) take(p);
    return out.sort((a, b) => a.d - b.d);
  }

  /** Embuscades dont l'issue (observée ou abstraite) tombe le jour donné : convois pillés ce jour-là, partout. */
  pillagedOn(day: number, outcome: (id: string) => Outcome | undefined): { plan: ConvoyPlan; t: number }[] {
    const out: { plan: ConvoyPlan; t: number }[] = [];
    for (let ri = 0; ri < this.civ.roads.length; ri++) {
      const back = this.back(ri);
      for (let d = day - back; d <= day; d++) for (const p of this.plans(ri, d)) {
        const am = p.ambush;
        if (!am) continue;
        const o = outcome(p.id), k = o ? o.k : am.loses ? 'p' : 's', t = o ? o.t : am.t + AMBUSH_WINDOW;
        if (k === 'p' && Math.floor(t / DAY) === day) out.push({ plan: p, t });
      }
    }
    return out;
  }

  /** Remise à zéro (chargement) : équipages régénérés vivants, départs retirés (embuscades forcées), convois de la console oubliés. */
  forget(): void { this.crew.clear(); this.cache.clear(); this.dev.length = 0; }

  /** Un camp de bandits est tombé : les départs déjà tirés des jours à venir sur sa route sont recalculés (sans son embuscade). */
  forgetRoad(roadId: number, fromDay: number): void {
    for (const k of [...this.cache.keys()]) { const [r, d] = k.split(':').map(Number); if (r === roadId && d >= fromDay) this.cache.delete(k); }
  }

  /** Oublie les départs trop anciens (appelé une fois par jour). */
  prune(day: number): void {
    for (const k of [...this.cache.keys()]) if (Number(k.split(':')[1]) < day - 24) this.cache.delete(k);
    for (const k of [...this.crew.keys()]) { const d = Number(k.split('.')[0]); if (Number.isFinite(d) && d < day - 24) this.crew.delete(k); }
  }

  /**
   * Convoi de la console : sur la route la plus proche de (x, z), placé pour passer à cet endroit maintenant (il arrive
   * de `back` mètres en amont). Sa sorte est imposée ; pas d'embuscade (la console en déclenche une à la demande).
   */
  spawnDev(x: number, z: number, t: number, kind: ConvoyKind, back = 25): ConvoyPlan | null {
    let best: { road: number; s: number; d: number } | null = null;
    for (let ri = 0; ri < this.civ.roads.length; ri++) {
      const r = this.route(ri);
      if (!r) continue;
      const b = this.bbox[ri];
      if (x < b.x0 - 400 || x > b.x1 + 400 || z < b.z0 - 400 || z > b.z1 + 400) continue;
      for (let s = r.s0; s <= r.s1; s += 4) { routeAt(r, s, this.tmp); const d = Math.hypot(this.tmp.x - x, this.tmp.z - z); if (!best || d < best.d) best = { road: ri, s, d }; }
    }
    if (!best) return null;
    const r = this.route(best.road)!, day = Math.floor(t / DAY), n = ++this.devN;
    const p = this.make(this.seed.stream('convois', 'dev', n), best.road, day, 0, r, kind);
    p.id = `d${n}`; p.ambush = null;
    // départ tel que la distance parcourue maintenant vaille (point le plus proche − back), en tenant compte de la nuit
    const u = Math.max(0, Math.min(p.len - 20, (p.fwd ? best.s - r.s0 : r.s1 - best.s) - back));
    p.depart = timeOfActive(activeAt(t) - u / p.speed);
    this.dev.push(p);
    return p;
  }

  /**
   * Force une embuscade maintenant sur ce convoi (console) : il s'arrête là où il est. Sans témoin, il est pillé à la fin
   * de la fenêtre habituelle. `u` : distance parcourue à cet instant (convoi déjà repris après une embuscade, par exemple).
   */
  forceAmbush(p: ConvoyPlan, t: number, u: number, bandits = 3): void {
    const pt = { x: 0, z: 0, h: 0 };
    u = Math.max(1, Math.min(p.len - 1, u));
    this.at(p, u, pt);
    p.ambush = { u, t, bandits, level: dangerAt(this.civ, pt.x, pt.z), camp: -1, loses: true };
  }

  // ---------------------------------------------------------------- équipages

  /** Membres d'un convoi (déterministes) : PNJ complets, rôle, moyens au combat. */
  members(p: ConvoyPlan): MemberSpec[] {
    let list = this.crew.get(p.id);
    if (list) return list;
    list = [];
    const civ = this.civ, A = civ.settlements[p.from], rng = this.seed.stream('convois', 'équipage', p.id);
    const names = new NameGen(rng.fork('noms'));
    const roles: Role[] = p.kind === 'caravane' ? ['marchand', 'charretier', ...Array.from({ length: p.size - 2 }, () => 'escorte' as Role)]
      : p.kind === 'pèlerins' ? Array.from({ length: p.size }, () => 'pèlerin' as Role)
      : p.kind === 'patrouille' ? Array.from({ length: p.size }, () => 'soldat' as Role)
      : [p.kind === 'colporteur' ? 'colporteur' : 'messager'];
    const lv = Math.max(1, p.level);
    roles.forEach((role, i) => {
      const q = rng.fork(i);
      const house = role === 'marchand' ? this.merchant(p.from, p.house) : null;
      const sex: 'm' | 'f' = house ? house.sex : q.chance(role === 'escorte' || role === 'soldat' ? 0.25 : role === 'charretier' ? 0.2 : 0.45) ? 'f' : 'm';
      const nm = house ?? names.person(sex);
      const fighter = role === 'escorte' || role === 'soldat';
      const hp = fighter ? Math.round(60 * (1 + 0.15 * (lv - 1))) : role === 'charretier' ? 35 : 30;
      const traits: Traits = house?.traits ?? { bravery: q.next(), kindness: q.next(), greed: q.next(), piety: role === 'pèlerin' ? 0.8 + q.next() * 0.2 : q.next(), sociability: q.next(), honesty: q.next() };
      const prof: Profession = role;
      const npc: NPCData = {
        id: `v${p.id}:${i}`, sid: p.from, first: nm.first, last: nm.last, sex, age: house?.age ?? q.int(role === 'escorte' || role === 'soldat' || role === 'messager' ? 19 : 22, role === 'pèlerin' ? 70 : 55),
        profession: prof, home: -1, work: -1, factionId: A.factionId, traits, relations: [],
        wealth: role === 'marchand' ? 260 + q.int(0, 200) : role === 'colporteur' ? 90 + q.int(0, 60) : q.int(5, 40), inventory: [],
        needs: { faim: 0.2, fatigue: 0.3, social: 0.4, sécurité: 0.2 },
        knowledge: [`settlement:${p.from}`, `settlement:${p.to}`, ...civ.pois.filter((x) => x.kind !== 'pont' && Math.hypot(x.x - A.x, x.z - A.z) < 1500).slice(0, 6).map((x) => `poi:${x.id}`)],
        goal: role === 'marchand' ? 'arriver à bon port avec sa marchandise' : role === 'pèlerin' ? 'prier là où les saints ont prié' : role === 'messager' ? 'porter ses plis à temps' : 'finir la route sans encombre',
        schedule: [{ from: 0, to: DAY, act: 'voyager', place: 'wild' }], shift: 'jour',
        colors: house?.colors ?? { skin: q.pick(SKINS), shirt: q.pick(SHIRTS), pants: q.pick(PANTS), hair: q.pick(HAIRS) },
        look: fighter ? 'garde' : role === 'pèlerin' ? 'moine' : 'civil', alive: true, hp, memories: [],
        title: TITLE[role][sex === 'f' ? 1 : 0], road: { from: p.from, to: p.to, convoy: p.id },
      };
      list!.push({ id: npc.id, role, npc, fighter, max: hp, dmg: fighter ? Math.round(9 * (1 + 0.12 * (lv - 1)) * 10) / 10 : role === 'charretier' ? 5 : 3, v: q.int(0, 255) });
    });
    this.crew.set(p.id, list);
    return list;
  }

  /** Maison de négoce d'une implantation (trois par lieu) : le marchand qui mène ses caravanes, toujours le même. */
  merchant(sid: number, house: number): { first: string; last: string; sex: 'm' | 'f'; age: number; traits: Traits; colors: NPCData['colors'] } {
    const q = this.seed.stream('convois', 'négoce', sid, house), names = new NameGen(q.fork('noms'));
    const sex: 'm' | 'f' = q.chance(0.35) ? 'f' : 'm', nm = names.person(sex);
    return { ...nm, sex, age: q.int(28, 64), traits: { bravery: q.next() * 0.6, kindness: q.next(), greed: q.next(), piety: q.next(), sociability: 0.4 + q.next() * 0.6, honesty: q.next() },
      colors: { skin: q.pick(SKINS), shirt: q.pick(RICH), pants: q.pick(PANTS), hair: q.pick(HAIRS) } };
  }

  /** Destinataire d'un pli de messager : une implantation voisine de sa destination (ou la destination elle-même). */
  letterTo(p: ConvoyPlan): number {
    const civ = this.civ, B = civ.settlements[p.to], cands: number[] = [];
    for (const r of civ.roads) {
      const o = r.a === p.to ? r.b : r.b === p.to ? r.a : -1;
      if (o < 0 || o === p.from || civ.settlements[o].abandoned) continue;
      if (['hameau', 'village', 'village minier', 'port', 'bourg', 'ville', 'capitale', 'monastère', 'château', 'fort'].includes(civ.settlements[o].type)) cands.push(o);
    }
    if (!cands.length) return p.to;
    cands.sort((a, b) => Math.hypot(civ.settlements[a].x - B.x, civ.settlements[a].z - B.z) - Math.hypot(civ.settlements[b].x - B.x, civ.settlements[b].z - B.z) || a - b);
    return cands[Math.floor(this.seed.stream('convois', 'pli', p.id).next() * Math.min(2, cands.length))];
  }
}

const SKINS = [0xe0b090, 0xc89870, 0xa87850, 0xf0c8a8, 0x8a6040];
const HAIRS = [0x2a1a10, 0x5a3a20, 0x8a6a30, 0xc8a050, 0x6a6a6a, 0x1a1a1a, 0xa04020];
const SHIRTS = [0x8a3a2a, 0x3a5a8a, 0x5a7a3a, 0x8a7a4a, 0x6a4a6a, 0xa88a5a, 0x4a4a4a, 0x7a2a3a];
const RICH = [0x6a2a4a, 0x2a3a6a, 0x5a2a2a, 0x2a5a4a, 0x6a5a2a];
const PANTS = [0x3a3a4a, 0x4a3a2a, 0x2a3a2a, 0x5a4a3a];
const ROBES = [0x6a5a48, 0x5a5048, 0x7a6a58, 0x4a4038, 0x8a7a68];

function pickCargo(produces: Good[], needs: Good[], r: number): Good {
  const both = produces.filter((g) => needs.includes(g)), pool = both.length ? both : produces.length ? produces : (['grain'] as Good[]);
  return pool[Math.floor(r * pool.length) % pool.length];
}

/** Tenue d'un membre selon son rôle ; `faction` : couleur des tabards (gardes du marchand, soldats de la patrouille). */
export function memberLook(m: MemberSpec, faction: number, cloak = 0x5a3a5a): HumanLook {
  const n = m.npc, f = n.sex === 'f', v = m.v, c = n.colors;
  const base: HumanLook = {
    skin: c.skin, shirt: c.shirt, pants: c.pants, hair: n.age > 58 ? 0xb8b4ac : c.hair, face: true, scale: (f ? 0.9 : 0.96) + (v % 9) / 100,
    hairStyle: f ? (['long', 'chignon', 'queue'] as const)[v % 3] : n.age > 50 && v % 3 === 0 ? 'chauve' : 'court',
    beardStyle: !f && v % 5 < 3 ? (['barbe', 'moustache', 'bouc'] as const)[v % 3] : undefined, letter: '@',
  };
  switch (m.role) {
    case 'marchand': return { ...base, hat: 'béret', hatColor: 0x3a2a4a, cape: cloak, belt: 0x8a6a2a, dress: f && v % 2 === 0, satchel: 0x6a4a2a };
    case 'charretier': return { ...base, hat: v % 2 ? 'paille' : 'bonnet', hatColor: 0x6a4a3a, bareArms: v % 3 === 0, weapon: v % 2 ? 'bâton' : null, shirt: [0x7a6a4a, 0x6a5a3a, 0x5a4a3a][v % 3] };
    case 'escorte': return { ...base, helmet: true, tabard: faction, emblem: 0xe8d8a0, weapon: v % 3 === 0 ? 'lance' : 'épée', shield: v % 3 !== 0, shirt: 0x8a8a94, cape: v % 4 === 0 ? 0x4a3a2a : undefined, beardStyle: undefined };
    case 'soldat': return { ...base, helmet: true, tabard: faction, emblem: 0xe8d8a0, weapon: 'lance', shield: true, shirt: 0x8a8a94, beardStyle: undefined };
    case 'pèlerin': return { ...base, robe: true, hood: v % 3 !== 0, shirt: ROBES[v % ROBES.length], hoodColor: ROBES[(v + 2) % ROBES.length], weapon: 'bâton', beardStyle: !f && n.age > 40 ? 'barbe' : undefined };
    case 'colporteur': return { ...base, hat: 'bonnet', hatColor: 0x7a3a2a, pack: 0x8a6a3a, weapon: 'bâton' };
    case 'messager': return { ...base, cape: [0x2a4a7a, 0x7a2a2a, 0x2a6a3a][v % 3], satchel: 0x5a3a20, hat: 'béret', hatColor: 0x2a2a3a, beardStyle: undefined };
  }
}

/** Marchandises d'un membre pour la journée : biens de la ville d'origine (marchand), petit commerce (colporteur). */
export function convoyStock(civ: Civilization, seed: WorldSeed, p: ConvoyPlan, m: MemberSpec, day: number): { id: string; qty: number }[] {
  const rng = seed.stream('convois', 'stock', p.id, m.id, day), out: { id: string; qty: number }[] = [];
  if (m.role === 'marchand') {
    const goods = new Set<Good>(civ.settlements[p.from].produces);
    if (p.cargo) goods.add(p.cargo);
    const pool = [...ITEMS.values()].filter((d) => d.good && goods.has(d.good) && !d.rarity && !d.quality && d.value > 0 && d.cat !== 'quête' && d.cat !== 'clé' && d.cat !== 'parchemin' && d.cat !== 'valeur').map((d) => d.id);
    rng.shuffle(pool);
    // le chargement d'abord (ce qu'il transporte en quantité), puis le reste
    pool.sort((a, b) => (item(b).good === p.cargo ? 1 : 0) - (item(a).good === p.cargo ? 1 : 0));
    for (const id of pool.slice(0, 9)) {
      const d = item(id), heavy = d.cat === 'arme' || d.cat === 'armure' || d.cat === 'bouclier';
      out.push({ id, qty: d.cat === 'munition' ? rng.int(20, 40) : heavy ? 1 : d.cat === 'potion' ? rng.int(2, 4) : rng.int(3, 8) + (d.good === p.cargo ? 4 : 0) });
    }
  } else if (m.role === 'colporteur') {
    const pool = ['crochet', 'canne à pêche', 'herbe médicinale', 'antidote', 'potion de soin', 'pain', 'pomme', 'flèche', 'gants', 'bottes', 'étoffe', 'sel', 'cuir', 'parchemin : lumière'];
    rng.shuffle(pool);
    for (const id of pool.slice(0, rng.int(5, 7))) out.push({ id, qty: id === 'flèche' ? rng.int(10, 20) : item(id).cat === 'armure' || id.startsWith('parchemin') || id === 'canne à pêche' ? 1 : rng.int(1, 4) });
  }
  return out;
}

/** Ce qui reste dans une épave : un peu du chargement et quelques pièces (déterministe). */
export function wreckLoot(civ: Civilization, seed: WorldSeed, p: ConvoyPlan): { id: string; qty: number }[] {
  const rng = seed.stream('convois', 'épave', p.id), out: { id: string; qty: number }[] = [];
  const goods = p.cargo ? [p.cargo] : civ.settlements[p.from].produces;
  const pool = [...ITEMS.values()].filter((d) => d.good && goods.includes(d.good) && !d.rarity && !d.quality && d.value > 0 && (d.cat === 'nourriture' || d.cat === 'matériau' || d.cat === 'munition' || d.cat === 'potion')).map((d) => d.id);
  rng.shuffle(pool);
  for (const id of pool.slice(0, rng.int(1, 3))) out.push({ id, qty: item(id).cat === 'munition' ? rng.int(5, 15) : rng.int(1, 3) });
  out.push({ id: 'or', qty: rng.int(3, 14) });
  return out;
}

// ---------------------------------------------------------------- sauvegarde

/** Course de messager en cours : pli à remettre à un PNJ d'une autre implantation, avant un jour donné. */
export interface SavedCourse {
  /** quête « course:<convoi> », objet de quête (la lettre) */
  id: string; item: string;
  /** implantation de départ et de destination, destinataire (PNJ), échéance (jour), récompense */
  from: number; to: number; npc: string; due: number; gold: number; xp: number;
}
export interface ConvoySave {
  /** issues observées des embuscades : [convoi, « p<minute> » | « s<minute> »] */
  out?: [string, string][];
  /** membres de convoi tués (ids « v<convoi>:<rang> ») */
  dead?: string[];
  courses?: SavedCourse[];
  /** remises durables : [maison de négoce « m<lieu>:<maison> », multiplicateur] */
  remises?: [string, number][];
  /** dernier jour dont les pillages (prix, rumeurs) ont été traités */
  jour?: number;
  /** convois déjà rencontrés (carte) */
  vus?: string[];
}
export const MAX_COURSES = 3;

/** Sauvegarde des convois assainie : structure vérifiée, valeurs bornées ; champ absent = état par défaut. */
export function sanitizeConvoySave(raw: unknown): Required<ConvoySave> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as ConvoySave;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 80;
  const out: [string, string][] = [];
  if (Array.isArray(r.out)) for (const t of r.out) if (Array.isArray(t) && str(t[0]) && parseOutcome(t[1]) && !out.some((x) => x[0] === t[0])) out.push([t[0], t[1] as string]);
  const dead = Array.isArray(r.dead) ? [...new Set(r.dead.filter((x) => str(x) && x.startsWith('v')))] : [];
  const courses: SavedCourse[] = [];
  if (Array.isArray(r.courses)) for (const c of r.courses) {
    if (courses.length >= MAX_COURSES || !c || typeof c !== 'object') continue;
    if (!str(c.id) || !c.id.startsWith('course:') || !str(c.item) || !c.item.startsWith('quête:lettre:') || !str(c.npc) || !num(c.from) || !num(c.to) || !num(c.due) || !num(c.gold) || !num(c.xp)) continue;
    if (courses.some((x) => x.id === c.id)) continue;
    courses.push({ id: c.id, item: c.item, from: Math.floor(c.from), to: Math.floor(c.to), npc: c.npc, due: Math.floor(c.due), gold: Math.max(0, Math.min(500, Math.round(c.gold))), xp: Math.max(0, Math.min(500, Math.round(c.xp))) });
  }
  const remises: [string, number][] = [];
  if (Array.isArray(r.remises)) for (const t of r.remises) if (Array.isArray(t) && str(t[0]) && /^m\d+:\d$/.test(t[0]) && num(t[1]) && !remises.some((x) => x[0] === t[0])) remises.push([t[0], Math.max(0.6, Math.min(1, t[1]))]);
  const vus = Array.isArray(r.vus) ? [...new Set(r.vus.filter(str))].slice(0, 200) : [];
  return { out, dead, courses, remises, jour: num(r.jour) ? Math.floor(r.jour) : -1, vus };
}
