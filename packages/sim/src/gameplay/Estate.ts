import type { Building, Layout } from '@ascii-fort/worldgen/civilization/Layout';
import { hash2i } from '@ascii-fort/core/RNG';
import type { NPCData } from '../entities/NPC';
import { Inventory, ITEMS, item, baseId, cleanId } from './Items';
import { sanitizeHorse, sanitizeMerc, type SavedHorse, type SavedMerc } from './Companions';

// Maison à acheter et coffre personnel : choix déterministe de la maison à vendre, relogement de ses
// habitants (au chargement, jamais dans generateNPCs : le monde ne change pas), prix, empreintes de
// bâtiments, transferts du coffre sans duplication, sauvegarde assainie. Logique pure et testable.

export const HOUSE_TYPES = ['village', 'village minier', 'port', 'bourg', 'ville', 'capitale'];
/** « grand village » : au moins 4 maisons debout (il en faut une autre pour reloger les habitants) */
export const MIN_HOUSES = 4;
export const CHEST_MAX_STACKS = 120;
export const CHEST_MAX_QTY = 9999;
export const CHEST_MAX_GOLD = 999999;
const HOUSE_BASE: Record<string, number> = { 'village minier': 1500, village: 1600, port: 1800, bourg: 2000, ville: 2400, capitale: 2900 };

export interface HouseRef { sid: number; bid: number }
type HouseB = Pick<Building, 'id' | 'kind' | 'ruined'>;
type Resident = Pick<NPCData, 'home' | 'profession' | 'work'>;

/** Prix : base du type de lieu + 12 or par m² au-delà de 48 m², arrondi à 10, toujours entre 1500 et 3000 (0 : lieu sans maison à vendre). */
export function housePrice(type: string, w: number, d: number): number {
  const base = HOUSE_BASE[type];
  if (!base) return 0;
  return Math.max(1500, Math.min(3000, Math.round((base + (w * d - 48) * 12) / 10) * 10));
}

/** Importance d'un habitant pour le village : un « remplisseur » (artisan ou fermier sans atelier) ne manque à personne. */
function residentWeight(n: Resident): number {
  if (n.profession === 'artisan' || n.profession === 'fermier') return n.work === -1 ? 1 : 4;
  return n.profession === 'chasseur' || n.profession === 'pêcheur' || n.profession === 'mineur' ? 2 : 4;
}

/**
 * Maison à vendre d'une implantation (id de bâtiment), ou null. Calculée sur les données brutes de generateNPCs (jamais sur
 * alive ni hp) : tous les clients d'un salon trouvent la même. On prend la maison la moins peuplée et la moins importante
 * (jamais celle d'une guérisseuse : son âtre est son atelier), départage par hash de (sid, id).
 */
export function houseForSale(sid: number, type: string, buildings: HouseB[], npcs: Resident[]): number | null {
  if (!HOUSE_TYPES.includes(type)) return null;
  const maisons = buildings.filter((b) => b.kind === 'maison' && !b.ruined);
  if (maisons.length < MIN_HOUSES || !npcs.some((n) => n.profession === 'aubergiste')) return null;
  let best: { id: number; score: number; h: number } | null = null;
  for (const b of maisons) {
    const res = npcs.filter((n) => n.home === b.id);
    if (res.some((n) => n.profession === 'guérisseuse')) continue;
    const score = res.reduce((s, n) => s + residentWeight(n), 0), h = hash2i(sid, b.id, 51);
    if (!best || score < best.score || (score === best.score && h < best.h)) best = { id: b.id, score, h };
  }
  return best ? best.id : null;
}

/**
 * Libère proprement les maisons réservées (à vendre, ou achetée) : tous les habitants d'une même maison s'installent
 * ensemble dans la maison la moins peuplée parmi les autres (la première en cas d'égalité). Ne change que `home` ;
 * idempotent. Renvoie le nombre de PNJ déplacés.
 */
export function rehomeHouses(buildings: HouseB[], npcs: Resident[], reserved: number[]): number {
  const free = buildings.filter((b) => b.kind === 'maison' && !b.ruined && !reserved.includes(b.id));
  if (!free.length) return 0;
  let moved = 0;
  for (const rb of reserved) {
    const res = npcs.filter((n) => n.home === rb);
    if (!res.length) continue;
    const count = (id: number) => npcs.filter((n) => n.home === id).length;
    const dest = free.reduce((a, b) => (count(b.id) < count(a.id) ? b : a));
    for (const n of res) { n.home = dest.id; moved++; }
  }
  return moved;
}

// ---------------------------------------------------------------- géométrie des bâtiments

/** Empreinte au sol d'un bâtiment (repère du plan : x local = largeur, z local = profondeur, la porte est en +z). */
export interface Rect { cx: number; cz: number; hw: number; hd: number; yaw: number }
export function insideRect(r: Rect, x: number, z: number): boolean {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw), dx = x - r.cx, dz = z - r.cz;
  return Math.abs(dx * c - dz * s) < r.hw && Math.abs(dx * s + dz * c) < r.hd;
}
export function rectOf(b: Pick<Building, 'x' | 'z' | 'yaw' | 'w' | 'd'>, margin = 0): Rect { return { cx: b.x, cz: b.z, hw: b.w / 2 + margin, hd: b.d / 2 + margin, yaw: b.yaw }; }
/** Distance max (hors `radius`) d'un bâtiment au centre de son lieu : les granges vont jusqu'à `radius + 52` m, avec marge. */
export const LAYOUT_REACH = 80;
/** Empreintes (marge 0,35 m) des bâtiments debout des plans à moins de `radius + 80` m de (x, z) : le cheval n'y entre pas. */
export function footprints(layouts: Pick<Layout, 'x' | 'z' | 'radius' | 'buildings'>[], x: number, z: number, margin = 0.35): Rect[] {
  const out: Rect[] = [];
  for (const L of layouts) {
    if (Math.hypot(L.x - x, L.z - z) > L.radius + LAYOUT_REACH) continue;
    for (const b of L.buildings) if (!b.ruined) out.push(rectOf(b, margin));
  }
  return out;
}
/** Point à `dist` m devant la porte (même formule que CivWorld.spawn), cap tourné vers le bâtiment. */
export function doorOutside(b: Pick<Building, 'x' | 'z' | 'yaw' | 'd' | 'doorX'>, dist = 3.5): { x: number; z: number; heading: number } {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw), lz = b.d / 2 + dist;
  const x = b.x + b.doorX * c + lz * s, z = b.z - b.doorX * s + lz * c;
  return { x, z, heading: Math.atan2(b.x - x, -(b.z - z)) };
}

// ---------------------------------------------------------------- coffre

/** Ni objet de quête ni clé de donjon dans le coffre (les quêtes et les portes lisent le sac). */
export function depositable(id: string): boolean { const c = item(id).cat; return c !== 'quête' && c !== 'clé'; }

/**
 * Déplace `qty` exemplaires (même id : l'usure « ~62 » voyage avec) de `from` vers `to`, atomiquement ; renvoie la quantité
 * réellement déplacée. keep : exemplaires à laisser (l'objet équipé) ; maxStacks / maxQty : plafonds de la destination.
 */
export function moveItem(from: Inventory, to: Inventory, id: string, qty: number, o: { keep?: number; maxStacks?: number; maxQty?: number } = {}): number {
  let n = Math.min(Math.floor(qty), from.count(id) - (o.keep ?? 0));
  if (o.maxQty !== undefined) n = Math.min(n, o.maxQty - to.count(id));
  if (!(n > 0)) return 0;
  if (o.maxStacks !== undefined && !to.items.has(id) && to.items.size >= o.maxStacks) return 0;
  if (!from.remove(id, n)) return 0;
  to.add(id, n);
  return n;
}
export function moveGold(from: { gold: number }, to: { gold: number }, n: number, cap = CHEST_MAX_GOLD): number {
  const k = Math.min(Math.floor(n), from.gold, cap - to.gold);
  if (!(k > 0)) return 0;
  from.gold -= k; to.gold += k;
  return k;
}

// ---------------------------------------------------------------- sauvegarde

export interface EstateSave { house?: HouseRef; chest?: [string, number][]; gold?: number; horse?: SavedHorse; merc?: SavedMerc }

/** Maison et coffre du joueur (le cheval et le mercenaire vivent dans EntityManager). */
export class Estate {
  house: HouseRef | null = null;
  /** coffre : items + or */
  readonly chest = new Inventory();
  reset(): void { this.house = null; this.chest.items.clear(); this.chest.gold = 0; }
}

/** Assainit une sauvegarde reçue (disque ou salon) : types, bornes, ids connus et nettoyés, doublons fusionnés, 120 piles au plus. */
export function sanitizeEstate(raw: unknown): EstateSave {
  const out: EstateSave = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const h = r.house as Record<string, unknown> | undefined;
  if (h && Number.isInteger(h.sid) && Number.isInteger(h.bid) && (h.sid as number) >= 0 && (h.bid as number) >= 0) out.house = { sid: h.sid as number, bid: h.bid as number };
  if (Array.isArray(r.chest)) {
    const m = new Map<string, number>();
    for (const e of r.chest) {
      if (!Array.isArray(e) || typeof e[0] !== 'string' || typeof e[1] !== 'number' || !Number.isFinite(e[1])) continue;
      const id = cleanId(e[0].slice(0, 80)), q = Math.floor(e[1]);
      if (q < 1 || !ITEMS.has(baseId(id)) || !depositable(id)) continue;
      if (!m.has(id) && m.size >= CHEST_MAX_STACKS) continue;
      m.set(id, Math.min(CHEST_MAX_QTY, (m.get(id) ?? 0) + q));
    }
    if (m.size) out.chest = [...m];
  }
  const g = typeof r.gold === 'number' && Number.isFinite(r.gold) ? Math.max(0, Math.min(CHEST_MAX_GOLD, Math.floor(r.gold))) : 0;
  if (g) out.gold = g;
  const horse = sanitizeHorse(r.horse), merc = sanitizeMerc(r.merc);
  if (horse) out.horse = horse;
  if (merc) out.merc = merc;
  return out;
}
