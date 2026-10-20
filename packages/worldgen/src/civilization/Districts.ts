import type { Civilization } from './Civilization';
import type { Settlement } from './types';
import type { RNG } from '@ascii-fort/core/RNG';
import { lerp, smoothstep } from '@ascii-fort/core/math';
import { W_SEA, W_LAKE } from '../terrain/Hydrology';
import { MACRO, CELL } from '../constants';
import {
  addBuilding, decor, TOWN,
  type Layout, type Building, type BuildingKind, type QuarterKind, type StallKind, type Stall, type District, type DecorKind, type Ctx,
} from './Layout';

// Quartiers des villes (étape 55) : des maisons, ateliers, échoppes et tavernes ajoutés aux villes, bourgs et grands
// villages, organisés en quartiers lisibles (artisans près des portes, marchands autour de la place, quartier aisé près du
// temple, résidentiel ailleurs), avec ruelles et petites places, et des étals permanents sur la place du marché.
// RÈGLE : AJOUT SANS DÉPLACEMENT. Le plan d'origine n'est pas touché (mêmes bâtiments, mêmes ids, mêmes tirages) : tout est
// ajouté EN FIN de liste, tiré du flux « quartiers » (qui ne décale aucun autre flux), sans chevaucher l'existant (bâtiments
// et le devant de leurs portes, murs, tours, décors, champs, routes, place) et en respectant le relief. GENERATOR_VERSION
// reste inchangée : les mondes, les sauvegardes et les salons existants restent valables.

/** Rectangle orienté (repère du plan : x local = largeur, z local = profondeur, porte en +z) et demi-étendue de sa boîte. */
interface Rect { x: number; z: number; c: number; s: number; hw: number; hd: number; ex: number; ez: number }
interface Circle { x: number; z: number; r: number }
/** Segment épais (rayon r) et sa boîte englobante. */
interface Seg { ax: number; az: number; bx: number; bz: number; r: number; x0: number; x1: number; z0: number; z1: number }

/** Programme de chaque type de lieu : tavernes, échoppes, ateliers, groupes de maisons (aisés, résidentiels), nouveaux étals. */
interface Plan { taverns: number; shops: number; workshops: number; homes: number; rich: number; stalls: number }
const PLAN: Record<string, Plan> = {
  bourg: { taverns: 1, shops: 1, workshops: 2, homes: 2, rich: 0, stalls: 1 },
  ville: { taverns: 2, shops: 2, workshops: 3, homes: 3, rich: 1, stalls: 2 },
  capitale: { taverns: 3, shops: 3, workshops: 4, homes: 4, rich: 2, stalls: 3 },
  village: { taverns: 0, shops: 0, workshops: 1, homes: 1, rich: 0, stalls: 0 },
};

export const TAVERN_NAMES = [
  'du Tonneau Percé', 'de la Chope Joyeuse', 'du Coq Hardi', 'du Bouc Ivre', 'des Deux Clés', 'du Pichet d’Or', 'de la Grappe',
  'du Vieux Fût', 'de l’Ours qui Danse', 'du Chaudron', 'de la Lune Rousse', 'du Hibou Moqueur', 'de la Pie Voleuse',
];
/** Métiers des ateliers (le nom du bâtiment est « atelier de <métier> ») ; titres accordés : sim/gameplay/Market.ts. */
export const CRAFTS = ['tisserand', 'tanneur', 'potier', 'menuisier', 'tonnelier', 'cordonnier', 'vannier', 'chandelier'] as const;
export type Craft = (typeof CRAFTS)[number];
/** Métier d'un atelier ajouté (null : pas un atelier des quartiers). */
export function craftOf(b: Pick<Building, 'kind' | 'name'>): Craft | null {
  if (b.kind !== 'atelier') return null;
  const c = b.name.replace(/^atelier de /, '');
  return (CRAFTS as readonly string[]).includes(c) ? (c as Craft) : null;
}

/** Spécialités des étals selon les biens produits par la région (puis un assortiment courant). */
const STALL_OF_GOOD: Partial<Record<string, StallKind>> = {
  grain: 'boulanger', poisson: 'poissonnier', gibier: 'boucher', laine: 'fromager', étoffe: 'drapier', herbes: 'herboriste',
  sel: 'saunier', vin: 'vigneron', outils: 'quincaillier', fer: 'quincaillier', bois: 'boisselier', minerai: 'quincaillier',
};
const STALL_COMMON: StallKind[] = ['maraîcher', 'fromager', 'boulanger', 'drapier', 'herboriste', 'boucher', 'quincaillier'];

/** Rayon d'encombrement des décors (m) pour le placement des ajouts. */
const DECOR_R: Partial<Record<DecorKind, number>> = {
  puits: 1.3, fontaine: 2.1, statue: 1.6, brasero: 0.6, étal: 1.5, lanterne: 0.4, tombe: 1.0, croix: 0.6, roue: 2.4, caisse: 0.6,
  pieu: 0.4, tente: 2.6, 'feu de camp': 1.2, menhir: 1.0, sanctuaire: 1.6, 'arbre géant': 2.8, 'tour de guet': 3.6, gravats: 1.4,
};

/** Grand village : assez peuplé pour un groupe de maisons et un atelier (les hameaux restent petits). */
export function grandVillage(s: Pick<Settlement, 'type' | 'population'>): boolean {
  return (s.type === 'village' || s.type === 'port' || s.type === 'village minier') && s.population >= 150;
}
/** Lieu qui reçoit des quartiers : bourgs, villes, capitales et grands villages vivants. */
export function hasDistricts(s: Pick<Settlement, 'type' | 'population' | 'abandoned'>): boolean { return !s.abandoned && (TOWN.has(s.type) || grandVillage(s)); }

/** Bâtiment ajouté par les quartiers (étape 55). */
export function isAdded(b: Pick<Building, 'quarter'>): boolean { return b.quarter !== undefined; }
/** Bâtiments du plan d'origine (avant l'étape 55), dans l'ordre. */
export function baseBuildings(L: Pick<Layout, 'buildings' | 'base'>): Building[] { return L.base ? L.buildings.slice(0, L.base.buildings) : L.buildings.filter((b) => !isAdded(b)); }

/** Ajoute les quartiers à tous les plans éligibles (appelé une fois, après generateLayouts). */
export function addDistricts(civ: Civilization, layouts: Layout[]): void {
  for (const L of layouts) {
    L.base = { buildings: L.buildings.length, decor: L.decor.length };
    if (L.sid < 0) continue;
    const s = civ.settlements[L.sid];
    if (!s || !hasDistricts(s)) continue;
    new Planner(civ, s, L).run();
  }
}

// ---------------------------------------------------------------- géométrie (sans allocation dans les tests)
function rectOf(x: number, z: number, yaw: number, w: number, d: number): Rect {
  const c = Math.cos(yaw), s = Math.sin(yaw), hw = w / 2, hd = d / 2;
  return { x, z, c, s, hw, hd, ex: Math.abs(hw * c) + Math.abs(hd * s), ez: Math.abs(hw * s) + Math.abs(hd * c) };
}
/** Devant de la porte (3,5 m sur 2,2) : rien n'y est posé. */
function doorRect(x: number, z: number, yaw: number, d: number, doorX: number): Rect {
  const c = Math.cos(yaw), s = Math.sin(yaw), lz = d / 2 + 1.75;
  return rectOf(x + doorX * c + lz * s, z - doorX * s + lz * c, yaw, 2.2, 3.5);
}
const seg = (ax: number, az: number, bx: number, bz: number, r: number): Seg =>
  ({ ax, az, bx, bz, r, x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) });
/** Boîtes englobantes à moins de m l'une de l'autre (pré-test bon marché). */
const nearRR = (a: Rect, b: Rect, m: number) => Math.abs(a.x - b.x) <= a.ex + b.ex + m && Math.abs(a.z - b.z) <= a.ez + b.ez + m;
const nearRS = (a: Rect, q: Seg, m: number) => a.x + a.ex + m >= q.x0 && a.x - a.ex - m <= q.x1 && a.z + a.ez + m >= q.z0 && a.z - a.ez - m <= q.z1;
/** Rectangles orientés qui se chevauchent, a agrandi de m de chaque côté (axes séparateurs). */
function rectsOverlap(a: Rect, b: Rect, m: number): boolean {
  if (!nearRR(a, b, m)) return false;
  const dx = b.x - a.x, dz = b.z - a.z;
  for (let i = 0; i < 4; i++) {
    const ux = i === 0 ? a.c : i === 1 ? a.s : i === 2 ? b.c : b.s, uz = i === 0 ? -a.s : i === 1 ? a.c : i === 2 ? -b.s : b.c;
    const ra = (a.hw + m) * Math.abs(a.c * ux - a.s * uz) + (a.hd + m) * Math.abs(a.s * ux + a.c * uz);
    const rb = b.hw * Math.abs(b.c * ux - b.s * uz) + b.hd * Math.abs(b.s * ux + b.c * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}
/** Distance d'un point au rectangle (0 dedans). */
function rectPointDist(r: Rect, x: number, z: number): number {
  const dx = x - r.x, dz = z - r.z, lx = dx * r.c - dz * r.s, lz = dx * r.s + dz * r.c;
  return Math.hypot(Math.max(Math.abs(lx) - r.hw, 0), Math.max(Math.abs(lz) - r.hd, 0));
}
function pointSegD(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
/** Le segment local coupe-t-il la boîte [−hw, hw] × [−hd, hd] (Liang-Barsky) ? */
function clipHits(x0: number, z0: number, x1: number, z1: number, hw: number, hd: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  for (let i = 0; i < 4; i++) {
    const p = i === 0 ? -dx : i === 1 ? dx : i === 2 ? -dz : dz, q = i === 0 ? x0 + hw : i === 1 ? hw - x0 : i === 2 ? z0 + hd : hd - z0;
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}
/** Distance exacte entre un segment et un rectangle orienté (0 s'ils se coupent). */
export function rectSegDist(r: Pick<Rect, 'x' | 'z' | 'c' | 's' | 'hw' | 'hd'>, ax: number, az: number, bx: number, bz: number): number {
  const dax = ax - r.x, daz = az - r.z, dbx = bx - r.x, dbz = bz - r.z;
  const x0 = dax * r.c - daz * r.s, z0 = dax * r.s + daz * r.c, x1 = dbx * r.c - dbz * r.s, z1 = dbx * r.s + dbz * r.c;
  if (clipHits(x0, z0, x1, z1, r.hw, r.hd)) return 0;
  const box = (x: number, z: number) => Math.hypot(Math.max(Math.abs(x) - r.hw, 0), Math.max(Math.abs(z) - r.hd, 0));
  return Math.min(box(x0, z0), box(x1, z1), pointSegD(-r.hw, -r.hd, x0, z0, x1, z1), pointSegD(r.hw, -r.hd, x0, z0, x1, z1),
    pointSegD(r.hw, r.hd, x0, z0, x1, z1), pointSegD(-r.hw, r.hd, x0, z0, x1, z1));
}
/** Coin k (0..3) du rectangle, en coordonnées du monde. */
function cornerX(r: Rect, k: number): number { const lx = k === 0 || k === 3 ? -r.hw : r.hw, lz = k < 2 ? -r.hd : r.hd; return r.x + lx * r.c + lz * r.s; }
function cornerZ(r: Rect, k: number): number { const lx = k === 0 || k === 3 ? -r.hw : r.hw, lz = k < 2 ? -r.hd : r.hd; return r.z - lx * r.s + lz * r.c; }

interface Slot { kind: BuildingKind; q: QuarterKind; x: number; z: number; yaw: number; w: number; d: number; doorX: number; extra: Partial<Building> }
interface Spot { x: number; z: number; nx: number; nz: number; rw: number }

class Planner {
  private rng: RNG;
  private ctx: Ctx;
  private P: { x: number; z: number; r: number } | null;
  private Rin: number;
  private town: boolean;
  private rects: Rect[] = [];
  private doors: Rect[] = [];
  private circles: Circle[] = [];
  private walls: Seg[] = [];
  private fields: Rect[] = [];
  private roads: Seg[] = [];
  private paths: Seg[] = [];
  private gates: { x: number; z: number }[] = [];
  private anchor: { x: number; z: number };
  private spots: Spot[] | null = null;
  private D: District = { quarters: [], stalls: [], taverns: [], paths: [], squares: [] };
  private placed = new Map<QuarterKind, Building[]>();

  constructor(private civ: Civilization, private s: Settlement, private L: Layout) {
    this.rng = civ.seed.stream('quartiers', s.id);
    this.ctx = { civ, L, rng: this.rng, s };
    this.town = TOWN.has(s.type);
    this.P = L.plaza ? { x: L.plaza.x, z: L.plaza.z, r: L.plaza.r } : null;
    // enceinte : bourg (palissade à R + 6), ville et capitale (rempart à R + 8) ; grand village : un peu au-delà du bâti
    this.Rin = s.type === 'bourg' ? s.radius + 2 : this.town ? s.radius + 2.5 : s.radius + 4;
    for (const b of L.buildings) {
      this.rects.push(rectOf(b.x, b.z, b.yaw, b.w, b.d));
      if (!b.ruined) this.doors.push(doorRect(b.x, b.z, b.yaw, b.d, b.doorX));
    }
    for (const t of L.towers) this.circles.push({ x: t.x, z: t.z, r: t.r + 1.5 });
    for (const w of L.walls) this.walls.push(seg(w.ax, w.az, w.bx, w.bz, w.stone ? 0.8 : 0.25));
    for (const d of L.decor) this.circles.push({ x: d.x, z: d.z, r: (DECOR_R[d.kind] ?? 1.2) * d.s });
    for (const f of L.fields) this.fields.push(rectOf(f.x, f.z, f.yaw, f.w, f.d));
    // routes : tronçons proches du lieu (rayon = demi-largeur) ; portes = points où une route sort du bâti
    const reach = this.Rin + 40;
    for (const r of civ.roads) {
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i], b = r.points[i + 1];
        if (pointSegD(s.x, s.z, a.x, a.z, b.x, b.z) > reach) continue;
        this.roads.push(seg(a.x, a.z, b.x, b.z, r.width / 2));
        const ina = Math.hypot(a.x - s.x, a.z - s.z) < s.radius, inb = Math.hypot(b.x - s.x, b.z - s.z) < s.radius;
        if (ina !== inb) this.gates.push(ina ? { x: a.x, z: a.z } : { x: b.x, z: b.z });
      }
    }
    // ancrage du quartier aisé : le temple (ou la chapelle, le donjon), sinon la place
    const a = L.buildings.find((b) => b.kind === 'temple') ?? L.buildings.find((b) => b.kind === 'donjon' || b.kind === 'chapelle');
    this.anchor = a ? { x: a.x, z: a.z } : { x: s.x, z: s.z };
  }

  run(): void {
    const plan = PLAN[this.s.type] ?? PLAN.village, L = this.L;
    // 1. tavernes (au moins une dans chaque bourg et chaque ville), 2. étals du marché, 3. échoppes et ateliers en façade
    //    sur les rues, 4. groupes de maisons du quartier aisé et du quartier résidentiel (placettes et ruelles)
    const tq: QuarterKind[] = ['marchand', 'artisan', 'résidentiel'];
    for (let i = 0; i < plan.taverns; i++) this.tavern(tq[i] ?? 'résidentiel');
    if (this.P && this.town) this.stalls(plan.stalls);
    for (let i = 0; i < plan.shops; i++) this.frontage('échoppe', 'marchand', [6, 8], [5.5, 7]);
    for (let i = 0; i < plan.workshops; i++) {
      const craft = this.rng.pick([...CRAFTS]);
      this.frontage('atelier', 'artisan', [7, 8.5], [6, 7], { name: `atelier de ${craft}` });
    }
    for (let i = 0; i < plan.rich; i++) this.group('aisé');
    for (let i = 0; i < plan.homes; i++) this.group('résidentiel');
    // quartiers lisibles : centre et étendue de chaque groupe de bâtiments ajoutés
    for (const [kind, list] of this.placed) {
      if (!list.length) continue;
      const x = list.reduce((a, b) => a + b.x, 0) / list.length, z = list.reduce((a, b) => a + b.z, 0) / list.length;
      const r = Math.max(8, ...list.map((b) => Math.hypot(b.x - x, b.z - z) + Math.hypot(b.w, b.d) / 2));
      this.D.quarters.push({ kind, x, z, r });
    }
    if (L.buildings.length > (L.base?.buildings ?? 0) || this.D.stalls.length) L.district = this.D;
  }

  // ---------------------------------------------------------------- tests d'occupation
  private inside(r: Rect, pad = 0): boolean {
    const R = this.Rin - pad;
    for (let k = 0; k < 4; k++) if (Math.hypot(cornerX(r, k) - this.s.x, cornerZ(r, k) - this.s.z) > R) return false;
    return true;
  }
  /**
   * Au sec : pas de lac ni de mer dans les cellules voisines dont le niveau monterait jusqu'ici (mêmes cellules que l'eau
   * dormante du relief, TerrainSampler.standingWater), avec 2 m de marge au-dessus de l'eau.
   */
  private dry(x: number, z: number): boolean {
    const m = this.civ.macro, i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    let level = NaN;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= MACRO || jj >= MACRO) continue;
      const c = jj * MACRO + ii, w = m.hydro.water[c];
      if (w === W_LAKE) level = Number.isNaN(level) ? m.hydro.lakeLevel[c] : Math.max(level, m.hydro.lakeLevel[c]);
      else if (w === W_SEA && Number.isNaN(level)) level = 0;
    }
    return Number.isNaN(level) || Math.min(m.elevAt(x, z), this.flatH(x, z)) >= level + 2;
  }
  /** Altitude approchée du sol du lieu (relief macro aplani comme le fait CivWorld.feature). */
  private flatH(x: number, z: number): number {
    const s = this.s, h = this.civ.macro.elevAt(x, z), d = Math.hypot(x - s.x, z - s.z), R = s.radius + 30;
    return d >= R ? h : lerp(h, s.y + 0.3, (1 - smoothstep(s.radius * 0.7, R, d)) * 0.9);
  }
  /** Sol constructible : loin des rivières, hors de l'eau, pente douce sur l'emprise. */
  private ground(r: Rect): boolean {
    const riv = this.civ.macro.riverIndex.nearest(r.x, r.z), diag = Math.hypot(r.hw, r.hd);
    if (riv && riv.d < riv.width / 2 + diag + 4) return false;
    let lo = this.flatH(r.x, r.z), hi = lo;
    if (lo < 0.8 || !this.dry(r.x, r.z)) return false;
    for (let k = 0; k < 4; k++) {
      const x = cornerX(r, k), z = cornerZ(r, k), h = this.flatH(x, z);
      if (h < 0.8 || !this.dry(x, z)) return false;
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return hi - lo <= 3;
  }
  /** Le bâtiment (et le devant de sa porte) tient-il sans rien chevaucher ? roadGap : marge entre la chaussée et le mur. */
  private fits(r: Rect, door: Rect, roadGap = 2.2): boolean {
    if (!this.inside(r) || !this.inside(door, -2)) return false;
    const P = this.P;
    if (P && rectPointDist(r, P.x, P.z) < P.r + 2.5) return false;
    for (const o of this.rects) if (rectsOverlap(r, o, 2.6) || rectsOverlap(door, o, 0.3)) return false;
    for (const o of this.doors) if (rectsOverlap(r, o, 0.2)) return false;
    for (const c of this.circles) {
      if (Math.abs(c.x - r.x) > r.ex + c.r + 3 || Math.abs(c.z - r.z) > r.ez + c.r + 3) continue;
      if (rectPointDist(r, c.x, c.z) < c.r + 1.2 || rectPointDist(door, c.x, c.z) < c.r + 0.3) return false;
    }
    for (const w of this.walls) {
      if (nearRS(r, w, w.r + 3) && rectSegDist(r, w.ax, w.az, w.bx, w.bz) < w.r + 3) return false;
      if (nearRS(door, w, w.r + 0.6) && rectSegDist(door, w.ax, w.az, w.bx, w.bz) < w.r + 0.6) return false;
    }
    for (const q of this.roads) if (nearRS(r, q, q.r + roadGap) && rectSegDist(r, q.ax, q.az, q.bx, q.bz) < q.r + roadGap) return false;
    for (const q of this.paths) if (nearRS(r, q, q.r + 0.5) && rectSegDist(r, q.ax, q.az, q.bx, q.bz) < q.r + 0.5) return false;
    for (const f of this.fields) if (rectsOverlap(r, f, 3) || rectsOverlap(door, f, 0)) return false;
    for (const q of this.D.squares) if (rectPointDist(r, q.x, q.z) < q.r + 0.4) return false;
    return this.ground(r);
  }

  private commit(sl: Slot): Building {
    const b = addBuilding(this.ctx, sl.kind, sl.x, sl.z, sl.yaw, sl.w, sl.d, { doorX: sl.doorX, quarter: sl.q, ...sl.extra });
    this.rects.push(rectOf(b.x, b.z, b.yaw, b.w, b.d));
    this.doors.push(doorRect(b.x, b.z, b.yaw, b.d, b.doorX));
    let l = this.placed.get(sl.q);
    if (!l) this.placed.set(sl.q, (l = []));
    l.push(b);
    return b;
  }

  // ---------------------------------------------------------------- préférences des quartiers
  private gateD(x: number, z: number): number { let d = Infinity; for (const g of this.gates) d = Math.min(d, Math.hypot(g.x - x, g.z - z)); return Number.isFinite(d) ? d : this.Rin; }
  private score(q: QuarterKind, x: number, z: number): number {
    const rc = Math.hypot(x - this.s.x, z - this.s.z), P = this.P ?? { x: this.s.x, z: this.s.z, r: 6 };
    const pd = Math.hypot(x - P.x, z - P.z);
    switch (q) {
      case 'marchand': return Math.abs(pd - (P.r + 10));
      case 'artisan': return this.gateD(x, z) + 0.5 * Math.abs(rc - 0.8 * this.Rin) + (pd < P.r + 14 ? 30 : 0);
      case 'aisé': return Math.hypot(x - this.anchor.x, z - this.anchor.z) + (this.gateD(x, z) < 22 ? 25 : 0);
      default: return Math.abs(rc - 0.6 * this.Rin) + (this.gateD(x, z) < 18 ? 15 : 0) + (pd < P.r + 16 ? 15 : 0);
    }
  }

  /** Points des rues (tous les 2,5 m) et normales de part et d'autre, dans le lieu (calculés une fois). */
  private streetSpots(): Spot[] {
    if (this.spots) return this.spots;
    const out: Spot[] = [];
    for (const q of this.roads) {
      const len = Math.hypot(q.bx - q.ax, q.bz - q.az);
      if (len < 0.01) continue;
      const tx = (q.bx - q.ax) / len, tz = (q.bz - q.az) / len;
      for (let t = 0; t < len; t += 2.5) {
        const x = q.ax + tx * t, z = q.az + tz * t;
        if (Math.hypot(x - this.s.x, z - this.s.z) > this.Rin - 4) continue;
        out.push({ x, z, nx: -tz, nz: tx, rw: q.r * 2 }, { x, z, nx: tz, nz: -tx, rw: q.r * 2 });
      }
    }
    return (this.spots = out);
  }
  /** Les meilleures positions selon le quartier (un peu de hasard pour varier d'une ville à l'autre). */
  private ranked<T extends { x: number; z: number }>(list: T[], q: QuarterKind, jitter: number, max: number): T[] {
    return list.map((p) => ({ p, k: this.score(q, p.x, p.z) + this.rng.float(0, jitter) })).sort((a, b) => a.k - b.k).slice(0, max).map((e) => e.p);
  }
  /** Grille polaire du lieu (pas de 4 m) entre deux rayons. */
  private grid(r0: number, r1: number): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (let rr = r0; rr < r1; rr += 4) for (let a = 0; a < Math.PI * 2; a += 4 / rr) out.push({ x: this.s.x + Math.cos(a) * rr, z: this.s.z + Math.sin(a) * rr });
    return out;
  }

  /** Bâtiment en façade sur une rue (porte vers la chaussée), sinon posé librement, porte tournée vers la place. */
  private frontage(kind: BuildingKind, q: QuarterKind, W: [number, number], Dd: [number, number], extra: Partial<Building> = {}, center = false): Building | null {
    const rng = this.rng;
    for (const p of this.ranked(this.streetSpots(), q, 6, 260)) {
      const w = rng.float(W[0], W[1]), d = rng.float(Dd[0], Dd[1]), off = p.rw / 2 + 2.8 + d / 2;
      const x = p.x + p.nx * off, z = p.z + p.nz * off, yaw = Math.atan2(-p.nx, -p.nz);
      const doorX = center ? 0 : rng.float(-w / 8, w / 8);
      if (this.fits(rectOf(x, z, yaw, w, d), doorRect(x, z, yaw, d, doorX))) return this.commit({ kind, q, x, z, yaw, w, d, doorX, extra });
    }
    const tx = this.P?.x ?? this.s.x, tz = this.P?.z ?? this.s.z;
    for (const c of this.ranked(this.grid((this.P?.r ?? 6) + 10, this.Rin - 4), q, 6, 260)) {
      const w = rng.float(W[0], W[1]), d = rng.float(Dd[0], Dd[1]), l = Math.hypot(tx - c.x, tz - c.z) || 1;
      const yaw = Math.atan2((tx - c.x) / l, (tz - c.z) / l), doorX = center ? 0 : rng.float(-w / 8, w / 8);
      if (this.fits(rectOf(c.x, c.z, yaw, w, d), doorRect(c.x, c.z, yaw, d, doorX))) return this.commit({ kind, q, x: c.x, z: c.z, yaw, w, d, doorX, extra });
    }
    return null;
  }

  private tavern(q: QuarterKind): void {
    const name = `Taverne ${this.rng.pick(TAVERN_NAMES.filter((n) => !this.L.buildings.some((b) => b.name.endsWith(n))))}`;
    const b = this.frontage('taverne', q, [11, 12.5], [9, 10], { name }, true);
    if (b) this.D.taverns.push(b.id);
  }

  /** Groupe de maisons : une placette entourée de maisons, sinon une ruelle bordée de maisons qui part d'une rue. */
  private group(q: QuarterKind): void {
    if (!this.square(q)) this.alley(q);
  }

  /** Placette : 3 ou 4 maisons tournées vers une petite place, une ruelle vers la rue la plus proche. */
  private square(q: QuarterKind): boolean {
    const rng = this.rng, rich = q === 'aisé';
    for (const c of this.ranked(this.grid((this.P?.r ?? 6) + 12, this.Rin - 10), q, 8, 220)) {
      const k = rich ? 3 : rng.int(3, 4);
      const sizes: [number, number][] = [];
      for (let j = 0; j < k; j++) sizes.push(rich ? [rng.float(8.5, 10), rng.float(7, 8)] : [rng.float(6, 7.5), rng.float(5.5, 6.5)]);
      // rayon intérieur : assez grand pour laisser 3 m entre deux maisons voisines
      const a = Math.max(...sizes.map((x) => x[0])) / 2;
      let rho = rich ? 5.4 : 4.2;
      while (2 * rho * (Math.PI / k - Math.atan(a / rho)) < 3.2 && rho < 12) rho += 0.25;
      const pr = rho - 0.4;
      if (!this.squareFree(c.x, c.z, pr)) continue;
      // la ruelle part vers la rue la plus proche (ou la place) : l'espace entre deux maisons lui est réservé
      const t = this.nearestStreet(c.x, c.z);
      const ang = t ? Math.atan2(t.z - c.z, t.x - c.x) : rng.float(0, Math.PI * 2);
      const slots: Slot[] = [];
      for (let j = 0; j < k; j++) {
        const th = ang + ((j + 0.5) / k) * Math.PI * 2, [w, d] = sizes[j];
        const dist = rho + d / 2, x = c.x + Math.cos(th) * dist, z = c.z + Math.sin(th) * dist;
        const yaw = Math.atan2(-Math.cos(th), -Math.sin(th)), doorX = rng.float(-w / 10, w / 10);
        const r = rectOf(x, z, yaw, w, d);
        if (!this.fits(r, doorRect(x, z, yaw, d, doorX))) continue;
        if (slots.some((o) => rectsOverlap(r, rectOf(o.x, o.z, o.yaw, o.w, o.d), 2.6))) continue;
        slots.push({ kind: 'maison', q, x, z, yaw, w, d, doorX, extra: rich ? { stone: true } : {} });
      }
      if (slots.length < (this.town ? 3 : 2)) continue;
      for (const sl of slots) this.commit(sl);
      this.D.squares.push({ x: c.x, z: c.z, r: pr });
      this.circles.push({ x: c.x, z: c.z, r: pr });
      if (t && t.d < 45) {
        const sx = c.x + Math.cos(ang) * pr * 0.8, sz = c.z + Math.sin(ang) * pr * 0.8;
        // ruelle seulement si elle ne traverse aucun bâtiment
        const p = seg(sx, sz, t.x, t.z, 1.1);
        if (this.rects.every((o) => !nearRS(o, p, 0.6) || rectSegDist(o, sx, sz, t.x, t.z) > 0.6)) this.addPath(p);
      }
      return true;
    }
    return false;
  }

  /** Ruelle : un passage qui part d'une rue, bordé de 2 à 4 maisons tournées vers lui, une petite place au bout. */
  private alley(q: QuarterKind): boolean {
    const rng = this.rng, rich = q === 'aisé';
    for (const p of this.ranked(this.streetSpots(), q, 8, 220)) {
      const len = rng.float(16, 24), x0 = p.x + p.nx * (p.rw / 2 + 0.5), z0 = p.z + p.nz * (p.rw / 2 + 0.5);
      const x1 = x0 + p.nx * len, z1 = z0 + p.nz * len;
      const lane = seg(x0, z0, x1, z1, 1.2);
      // le passage lui-même ne traverse rien
      if (!this.laneFree(lane)) continue;
      const tx = -p.nz, tz = p.nx, slots: Slot[] = [];
      for (let t = 6; t < len - 2; t += rich ? 12 : 9.5) for (const side of [-1, 1]) {
        const [w, d] = rich ? [rng.float(8.5, 9.5), rng.float(7, 8)] : [rng.float(6.5, 8), rng.float(5.5, 6.5)];
        const off = 1.2 + 1.4 + d / 2, x = x0 + p.nx * t + tx * side * off, z = z0 + p.nz * t + tz * side * off;
        const yaw = Math.atan2(-tx * side, -tz * side), doorX = rng.float(-w / 10, w / 10);
        const r = rectOf(x, z, yaw, w, d);
        if (!this.fits(r, doorRect(x, z, yaw, d, doorX))) continue;
        if (slots.some((o) => rectsOverlap(r, rectOf(o.x, o.z, o.yaw, o.w, o.d), 2.6))) continue;
        slots.push({ kind: 'maison', q, x, z, yaw, w, d, doorX, extra: rich ? { stone: true } : {} });
      }
      if (slots.length < 2) continue;
      const sq = { x: x1, z: z1, r: 3 }, sqOk = this.squareFree(sq.x, sq.z, sq.r);
      for (const sl of slots) this.commit(sl);
      this.addPath(lane);
      if (sqOk && this.rects.every((o) => rectPointDist(o, sq.x, sq.z) > sq.r + 0.5)) { this.D.squares.push(sq); this.circles.push(sq); }
      return true;
    }
    return false;
  }

  private addPath(p: Seg): void {
    this.paths.push(p);
    this.D.paths.push({ ax: p.ax, az: p.az, bx: p.bx, bz: p.bz, w: p.r * 2 });
  }
  /** Passage libre : ni bâtiment ni devant de porte, ni décor, ni mur, ni champ, dans le lieu. */
  private laneFree(q: Seg): boolean {
    if (Math.hypot(q.bx - this.s.x, q.bz - this.s.z) > this.Rin - 3) return false;
    const P = this.P;
    if (P && pointSegD(P.x, P.z, q.ax, q.az, q.bx, q.bz) < P.r + 2) return false;
    for (const o of this.rects) if (nearRS(o, q, q.r + 0.8) && rectSegDist(o, q.ax, q.az, q.bx, q.bz) < q.r + 0.8) return false;
    for (const o of this.doors) if (nearRS(o, q, q.r) && rectSegDist(o, q.ax, q.az, q.bx, q.bz) < q.r) return false;
    for (const c of this.circles) if (pointSegD(c.x, c.z, q.ax, q.az, q.bx, q.bz) < c.r + q.r + 0.5) return false;
    for (const w of this.walls) if (Math.min(pointSegD(w.ax, w.az, q.ax, q.az, q.bx, q.bz), pointSegD(w.bx, w.bz, q.ax, q.az, q.bx, q.bz), pointSegD(q.bx, q.bz, w.ax, w.az, w.bx, w.bz)) < w.r + q.r + 3) return false;
    for (const f of this.fields) if (rectSegDist(f, q.ax, q.az, q.bx, q.bz) < q.r + 2) return false;
    // ni sur une autre route (au-delà de son départ)
    for (const r of this.roads) if (pointSegD(q.bx, q.bz, r.ax, r.az, r.bx, r.bz) < r.r + q.r + 4) return false;
    return this.dry(q.bx, q.bz);
  }

  private squareFree(x: number, z: number, r: number): boolean {
    if (Math.hypot(x - this.s.x, z - this.s.z) > this.Rin - r - 6) return false;
    const P = this.P;
    if (P && Math.hypot(x - P.x, z - P.z) < P.r + r + 6) return false;
    for (const o of this.rects) if (Math.abs(o.x - x) < o.ex + r + 1 && Math.abs(o.z - z) < o.ez + r + 1 && rectPointDist(o, x, z) < r + 1) return false;
    for (const o of this.doors) if (Math.abs(o.x - x) < o.ex + r && Math.abs(o.z - z) < o.ez + r && rectPointDist(o, x, z) < r) return false;
    for (const c of this.circles) if (Math.hypot(c.x - x, c.z - z) < c.r + r + 1) return false;
    for (const f of this.fields) if (rectPointDist(f, x, z) < r + 3) return false;
    for (const w of this.walls) if (pointSegD(x, z, w.ax, w.az, w.bx, w.bz) < r + 4) return false;
    for (const q of this.roads) if (pointSegD(x, z, q.ax, q.az, q.bx, q.bz) < q.r + r + 1) return false;
    for (const q of this.paths) if (pointSegD(x, z, q.ax, q.az, q.bx, q.bz) < q.r + r) return false;
    return this.ground(rectOf(x, z, 0, r * 2, r * 2));
  }

  /** Point de rue (axe d'une route) ou du bord de la place le plus proche. */
  private nearestStreet(x: number, z: number): { x: number; z: number; d: number } | null {
    let best: { x: number; z: number; d: number } | null = null;
    for (const q of this.roads) {
      const dx = q.bx - q.ax, dz = q.bz - q.az, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - q.ax) * dx + (z - q.az) * dz) / l2)) : 0;
      const px = q.ax + dx * t, pz = q.az + dz * t, d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { x: px, z: pz, d };
    }
    const P = this.P;
    if (P) {
      const pd = Math.hypot(x - P.x, z - P.z) - P.r;
      if (!best || pd < best.d) { const l = pd + P.r || 1; best = { x: P.x + ((x - P.x) / l) * P.r, z: P.z + ((z - P.z) / l) * P.r, d: pd }; }
    }
    return best;
  }

  // ---------------------------------------------------------------- marché
  /** Étals permanents : ceux du plan d'origine, plus de nouveaux sur la place, à l'écart des chaussées et des décors. */
  private stalls(count: number): void {
    const P = this.P!, rng = this.rng, L = this.L;
    const pos: { x: number; z: number }[] = [];
    for (let i = 0; i < L.decor.length; i++) {
      const d = L.decor[i];
      if (d.kind !== 'étal') continue;
      // deux étals d'origine presque confondus ne font qu'un étal tenu (un seul marchand, un seul étalage)
      if (pos.some((o) => Math.hypot(o.x - d.x, o.z - d.z) < 2.2)) continue;
      // étal d'origine (comptoir symétrique) : le marchand se met du côté dégagé (le décor lui-même ne bouge pas)
      const free = (yaw: number) => {
        const x = d.x - Math.sin(yaw) * 1.7, z = d.z - Math.cos(yaw) * 1.7;
        return !this.circles.some((c) => (c.x !== d.x || c.z !== d.z) && Math.hypot(c.x - x, c.z - z) < c.r + 0.45) && !this.rects.some((o) => rectPointDist(o, x, z) < 0.6);
      };
      const yaw = free(d.yaw) || !free(d.yaw + Math.PI) ? d.yaw : d.yaw + Math.PI;
      this.D.stalls.push({ x: d.x, z: d.z, yaw, decor: i, kind: 'maraîcher', existing: true });
      pos.push(d);
    }
    // tableau des primes et bannière de la place (posés par le jeu) : à éviter aussi
    const keep: Circle[] = [{ x: P.x - P.r * 0.6, z: P.z + P.r * 0.25, r: 1.4 }, { x: P.x + P.r * 0.55, z: P.z, r: 0.6 }];
    const cand: { x: number; z: number; k: number }[] = [];
    for (const f of [0.55, 0.7, 0.85, 1]) {
      const rr = P.r * f;
      for (let a = 0; a < Math.PI * 2; a += 2.4 / rr) cand.push({ x: P.x + Math.cos(a) * rr, z: P.z + Math.sin(a) * rr, k: Math.abs(f - 0.72) * 10 + rng.float(0, 2) });
    }
    cand.sort((a, b) => a.k - b.k);
    let added = 0;
    for (const c of cand) {
      if (added >= count) break;
      if (pos.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 4.4)) continue;
      // à l'écart de l'axe des routes (les convois passent par la place) et des décors
      if (this.roads.some((q) => pointSegD(c.x, c.z, q.ax, q.az, q.bx, q.bz) < Math.max(4, q.r + 2.6))) continue;
      if (this.circles.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < o.r + 2.6) || keep.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < o.r + 2.6)) continue;
      if (this.rects.some((o) => rectPointDist(o, c.x, c.z) < 4.2) || this.doors.some((o) => rectPointDist(o, c.x, c.z) < 1.8)) continue;
      if (!this.dry(c.x, c.z)) continue;
      const yaw = Math.atan2(P.x - c.x, P.z - c.z), i = L.decor.length;
      decor(L, 'étal', c.x, c.z, yaw);
      this.D.stalls.push({ x: c.x, z: c.z, yaw, decor: i, kind: 'maraîcher', existing: false });
      this.circles.push({ x: c.x, z: c.z, r: 1.5 });
      pos.push(c);
      added++;
    }
    // spécialités : biens de la région d'abord, puis l'assortiment courant
    const regional = [...new Set(this.s.produces.map((g) => STALL_OF_GOOD[g]).filter((k): k is StallKind => !!k))];
    rng.shuffle(regional);
    const kinds = [...regional, ...STALL_COMMON.filter((k) => !regional.includes(k))];
    this.D.stalls.forEach((st: Stall, i) => { st.kind = kinds[i % kinds.length]; });
  }
}
