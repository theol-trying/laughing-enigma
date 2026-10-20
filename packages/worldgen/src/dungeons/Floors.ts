import { MeshBuilder, type MeshData } from '@ascii-fort/ascii-engine/Mesh';
import { M } from '@ascii-fort/ascii-engine/Materials';
import type { WorldSeed } from '@ascii-fort/core/Seed';
import { ChunkData } from '../Chunk';
import type { Civilization } from '../civilization/Civilization';
import type { Dungeon } from '../civilization/types';
import type { DRoom, DLink, DungeonLayout } from './DungeonGenerator';
import { type UnderLayout, type USpawn, type UnderChest, type EliteDef, floorOrigin, frameOf, stairsDown, stairsUp } from './Under';

// Étape 55 (passe 2) : étages inférieurs des donjons. Le niveau 1 garde son plan, ses tirages et ses clés (« dj<id>:… ») ;
// les étages viennent d'un flux à part (« étages », id, niveau), vivent 400 m plus au sud par étage dans la même tranche en x,
// et leurs clés portent le niveau (« dj<id>.<n>:… »). Un escalier ajouté dans une salle reculée du niveau 1 y descend.

export type FloorTheme = 'catacombes' | 'cachots' | 'galeries' | 'salles inondées' | 'grottes profondes';
/** Élément propre à un étage : salle de trésor gardée, gardien nommé, herse ouverte par des leviers, pièges. */
export type FloorFeature = 'trésor' | 'gardien' | 'leviers' | 'pièges';

export interface FloorLayout extends UnderLayout {
  level: number; floors: number; theme: FloorTheme;
  /** nom du donjon (sans l'étage) */
  base: string;
  ox: number; oz: number;
  rooms: DRoom[]; links: DLink[];
  /** escalier qui remonte (salle d'arrivée) et celui qui descend (absent au dernier étage) */
  up: { x: number; z: number; key: string };
  down: { x: number; z: number; key: string } | null;
  /** leviers à actionner (tous) pour lever la herse qui ferme la salle du trésor */
  levers: { x: number; z: number; key: string }[];
  /** herse : milieu du passage, orientation, clé ; (px, pz) : où l'on s'en approche (côté libre) */
  gate: { x: number; z: number; horizontal: boolean; key: string; px: number; pz: number } | null;
  features: FloorFeature[];
  /** flaques et bassins (salles inondées) : décor */
  pools: { x: number; z: number; w: number; d: number }[];
  /** gardien de l'étage (nom affiché), s'il y en a un */
  guardian: string | null;
}

/** Danger d'un lieu (même règle que les créatures : 1 autour du départ, +1 tous les 650 m, 12 au plus). */
export function dangerOf(civ: Civilization, x: number, z: number): number {
  const s = civ.settlements[civ.startId];
  return s ? Math.max(1, Math.min(12, 1 + Math.floor(Math.hypot(x - s.x, z - s.z) / 650))) : 1;
}

/** Nombre d'étages d'un donjon : forteresses (3) et mines (2) descendent, les grottes profondes ou lointaines aussi ; les petits restent à un niveau. */
export function floorCount(civ: Civilization, d: Dungeon): number {
  const p = civ.pois.find((x) => x.id === d.poiId);
  const danger = p ? dangerOf(civ, p.x, p.z) : 1;
  switch (d.kind) {
    case 'forteresse': return 3;                                   // cachots, puis catacombes
    case 'mine': return danger >= 7 ? 3 : 2;                        // galeries abandonnées, salles inondées tout au fond
    case 'grotte': return d.depth >= 3 || danger >= 7 ? 2 : 1;      // les grottes profondes ou lointaines
    default: return d.depth >= 2 ? 2 : 1;                           // les cryptes restent à un niveau
  }
}

function themeOf(kind: Dungeon['kind'], level: number): FloorTheme {
  switch (kind) {
    case 'crypte': return 'catacombes';
    case 'forteresse': return level === 2 ? 'cachots' : 'catacombes';
    case 'mine': return level === 2 ? 'galeries' : 'salles inondées';
    default: return level === 2 ? 'grottes profondes' : 'salles inondées';
  }
}

interface ThemeDef {
  wall: number; wallM: number; floor: number; floorM: number; h: number;
  light: { c: number; m: number; r: number; g: number; b: number; k: 'torch' | 'candle' } | null;
  common: string[];
  elite: { base: string; names: string[]; title: string; fem: boolean; look: Omit<EliteDef, 'name' | 'title' | 'fem'> };
  /** poids des éléments principaux : trésor, gardien, leviers */
  weights: [number, number, number];
}
const THEMES: Record<FloorTheme, ThemeDef> = {
  catacombes: {
    wall: 0x6e6a5e, wallM: M.STONE, floor: 0x4e4a42, floorM: M.COBBLE, h: 3.8, light: { c: 0xffe0a0, m: M.GLOW, r: 1.3, g: 1.1, b: 0.7, k: 'candle' },
    common: ['squelette', 'squelette', 'spectre'],
    elite: { base: 'squelette', names: ['Ossian', 'Morvarch', 'Ysembert', 'Calixte'], title: 'seigneur des ossuaires', fem: false, look: { scale: 1.25, crown: true, cape: 0x3a2a4a, eyes: 0x80e0ff } },
    weights: [0.25, 0.4, 0.35],
  },
  cachots: {
    wall: 0x5e5a52, wallM: M.STONE, floor: 0x3e3a34, floorM: M.COBBLE, h: 4.4, light: { c: 0xffa030, m: M.FIRE, r: 1.5, g: 0.8, b: 0.4, k: 'torch' },
    common: ['squelette', 'spectre', 'spectre'],
    elite: { base: 'spectre', names: ['Mélisende', 'Aldegonde', 'Ermessinde'], title: 'geôlière des cachots', fem: true, look: { scale: 1.2, tint: 0x7a90a8, eyes: 0xa0f0ff } },
    weights: [0.2, 0.3, 0.5],
  },
  galeries: {
    wall: 0x5a5046, wallM: M.ROCK, floor: 0x463a2e, floorM: M.DIRT, h: 3.4, light: { c: 0xffa030, m: M.FIRE, r: 1.5, g: 0.85, b: 0.4, k: 'torch' },
    common: ['gobelin', 'gobelin', 'araignée', 'chauve-souris'],
    elite: { base: 'chef gobelin', names: ['Grizzak', 'Murg', 'Snagrot', 'Brakka'], title: 'contremaître des galeries', fem: false, look: { scale: 1.15, tint: 0x6a4a1a } },
    weights: [0.4, 0.3, 0.3],
  },
  'salles inondées': {
    wall: 0x4e5450, wallM: M.ROCK, floor: 0x3a3e3a, floorM: M.MUD, h: 4.0, light: { c: 0x80ffb0, m: M.GLOW, r: 0.6, g: 1.3, b: 0.8, k: 'candle' },
    common: ['araignée', 'chauve-souris', 'squelette'],
    elite: { base: 'araignée', names: ['Mère-Velours', 'Noirebrume', 'Tisse-Nuit'], title: 'reine des eaux noires', fem: true, look: { scale: 1.45, tint: 0x1e2a2e, eyes: 0x60ffb0 } },
    weights: [0.35, 0.45, 0.2],
  },
  'grottes profondes': {
    wall: 0x504a44, wallM: M.ROCK, floor: 0x3c3630, floorM: M.DIRT, h: 5.0, light: { c: 0x70d0ff, m: M.GLOW, r: 0.6, g: 1.0, b: 1.5, k: 'candle' },
    common: ['gobelin', 'araignée', 'chauve-souris', 'ours des cavernes'],
    elite: { base: 'troll', names: ['Gorm', 'Bruk', 'Hargne'], title: 'troll des profondeurs', fem: false, look: { scale: 1.1, tint: 0x4a5a4a } },
    weights: [0.4, 0.4, 0.2],
  },
};

const G = 5, CELLS = 20;

/** Étage n (≥ 2) d'un donjon : déterministe (flux « étages », id, n), sans rien tirer du flux du niveau 1. */
export function generateFloor(seed: WorldSeed, d: Dungeon, level: number, floors: number): FloorLayout {
  const rng = seed.stream('étages', d.id, level);
  const { ox, oz } = floorOrigin(d.id, level);
  const theme = themeOf(d.kind, level), T = THEMES[theme];
  const want = Math.min(13, 6 + level + Math.round(d.depth));
  const grid = new Map<number, number>();
  const rooms: DRoom[] = [], links: DLink[] = [];
  const key = (gx: number, gy: number) => gy * G + gx;
  const addRoom = (gx: number, gy: number): DRoom => {
    const r: DRoom = { id: rooms.length, gx, gy, x: ox + gx * CELLS, z: oz + gy * CELLS, w: rng.float(9, 14), d: rng.float(9, 14), role: 'salle' };
    rooms.push(r); grid.set(key(gx, gy), r.id);
    return r;
  };
  const linkOf = (a: DRoom, b: DRoom): DLink => ({ a: a.id, b: b.id, locked: false, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, horizontal: a.gy === b.gy });
  // arrivée sur la rangée du bas (mur sud plein : l'escalier qui remonte s'y adosse)
  const start = addRoom(rng.int(0, G - 1), G - 1);
  start.role = 'entrée';
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let guard = 0;
  while (rooms.length < want && guard++ < 600) {
    const from = rooms[rng.int(0, rooms.length - 1)];
    const [dx, dy] = rng.pick(dirs);
    const gx = from.gx + dx, gy = from.gy + dy;
    if (gx < 0 || gy < 0 || gx >= G || gy >= G || grid.has(key(gx, gy))) continue;
    links.push(linkOf(from, addRoom(gx, gy)));
  }
  let loops = 0;
  for (const a of rooms) for (const [dx, dy] of dirs) {
    if (loops >= 3) break;
    const bId = grid.get(key(a.gx + dx, a.gy + dy));
    if (bId === undefined || bId < a.id) continue;
    if (links.some((l) => (l.a === a.id && l.b === bId) || (l.a === bId && l.b === a.id))) continue;
    if (rng.chance(0.35)) { links.push(linkOf(a, rooms[bId])); loops++; }
  }
  const adj = (id: number) => links.filter((l) => l.a === id || l.b === id).map((l) => (l.a === id ? l.b : l.a));
  const dist = new Array(rooms.length).fill(-1), prev = new Array(rooms.length).fill(-1);
  dist[0] = 0; const q = [0];
  while (q.length) { const c = q.shift()!; for (const n of adj(c)) if (dist[n] < 0) { dist[n] = dist[c] + 1; prev[n] = c; q.push(n); } }

  // élément principal (et un second au dernier étage), pièges en plus parfois
  const r0 = rng.next(), [wT, wG] = T.weights;
  let main: FloorFeature = r0 < wT ? 'trésor' : r0 < wT + wG ? 'gardien' : 'leviers';
  const deepest = level === floors;
  if (deepest && main !== 'gardien' && floors >= 3) main = 'gardien';
  const features: FloorFeature[] = [main];
  // dernier étage d'un grand donjon : le gardien, et soit sa salle derrière une herse à leviers, soit une salle au trésor de plus
  if (deepest && floors >= 3) features.push(rng.chance(0.5) ? 'leviers' : 'trésor');
  const gated = features.includes('leviers');
  if (rng.chance(0.45)) features.push('pièges');

  // salle de l'élément principal : la plus éloignée (aucun chemin ne passe par elle) ; escalier suivant : la plus éloignée ensuite
  const far = (skip: Set<number>) => { let b = -1; rooms.forEach((r, i) => { if (!skip.has(i) && i !== 0 && (b < 0 || dist[i] > dist[b])) b = i; }); return b; };
  const featId = far(new Set());
  const feat = rooms[featId];
  const downId = level < floors ? far(new Set([featId])) : -1;
  let gateLink: DLink | null = null;
  if (main === 'gardien') { feat.role = 'boss'; feat.w = 16; feat.d = 16; }
  else { feat.role = 'trésor'; feat.w = main === 'trésor' ? 14 : 12; feat.d = feat.w; }
  if (gated) {
    // un seul passage vers la salle de l'élément principal, fermé par une herse
    const from = prev[featId];
    for (let i = links.length - 1; i >= 0; i--) {
      const l = links[i];
      if ((l.a === featId || l.b === featId) && !((l.a === from && l.b === featId) || (l.b === from && l.a === featId))) links.splice(i, 1);
    }
    gateLink = links.find((l) => (l.a === from && l.b === featId) || (l.b === from && l.a === featId)) ?? null;
  }
  // salle secondaire (dernier étage) : trésor ou leviers dans la salle la plus éloignée suivante (sans herse : un coffre de plus)
  const second = features[1] === 'trésor' ? far(new Set([featId, downId])) : -1;
  if (second >= 0 && rooms[second].role === 'salle') rooms[second].role = 'trésor';
  for (const r of rooms) if (r.role === 'salle' && r.id !== downId && rng.chance(0.25)) r.role = 'clé';   // « clé » : petite réserve (coffre ordinaire)

  const pre = `dj${d.id}.${level}`;
  const spawns: USpawn[] = [], chests: UnderChest[] = [], traps: FloorLayout['traps'] = [];
  const down = downId >= 0 ? { x: rooms[downId].x, z: rooms[downId].z + 0.5, key: `${pre}:descendre` } : null;
  const nearStairs = (x: number, z: number) => !!down && Math.abs(x - down.x) < 2.6 && z > down.z - 3.4 && z < down.z + 2.6;
  const spot = (r: DRoom) => {
    let x = r.x + rng.float(-r.w / 3, r.w / 3), z = r.z + rng.float(-r.d / 3, r.d / 3);
    if (nearStairs(x, z)) { x = r.x + (x < r.x ? -1 : 1) * (r.w / 2 - 1.6); z = r.z - r.d / 4; }
    return { x, z };
  };
  const chest = (x: number, z: number, tier: number) => chests.push({ x, z, key: `${pre}:c${chests.length}`, tier, hasKey: false });
  const eliteName = rng.pick(T.elite.names);
  let guardian: string | null = null;
  for (const r of rooms) {
    if (r.role === 'entrée') continue;
    const north = r.z - r.d / 2 + 1.2;
    if (r.id === featId && main === 'gardien') {
      const elite: EliteDef = { name: eliteName, title: T.elite.title, fem: T.elite.fem, ...T.elite.look };
      guardian = `${eliteName}, ${T.elite.title}`;
      spawns.push({ x: r.x, z: r.z - 2, type: T.elite.base, boss: true, room: r.id, bonus: 2, elite, territory: 12 });
      spawns.push({ x: r.x - 3, z: r.z + 2, type: rng.pick(T.common), boss: false, room: r.id, bonus: 1 });
      chest(r.x, north + 0.3, 4);
      continue;
    }
    if (r.id === featId) {
      // trésor gardé (ou derrière la herse) : deux coffres, des gardes plus forts
      const guards = main === 'trésor' ? rng.int(3, 4) : rng.int(1, 2);
      for (let i = 0; i < guards; i++) { const s = spot(r); spawns.push({ ...s, type: rng.pick(T.common), boss: false, room: r.id, bonus: 1 }); }
      chest(r.x - 2.4, north, main === 'trésor' ? 3 : 4); chest(r.x + 2.4, north, 3);
      continue;
    }
    const n = Math.min(4, 1 + Math.floor(rng.next() * (1 + d.depth * 0.5 + level * 0.4)));
    for (let i = 0; i < n; i++) { const s = spot(r); spawns.push({ ...s, type: rng.pick(T.common), boss: false, room: r.id }); }
    if (r.role === 'trésor') chest(r.x + rng.float(-2, 2), north, 3);
    else if (r.role === 'clé') chest(r.x + rng.float(-2, 2), north, 2);
  }
  const trapped = features.includes('pièges');
  for (const l of links) if (l !== gateLink && rng.chance(trapped ? 0.6 : 0.2)) traps.push({ x: l.x, z: l.z, key: `${pre}:t${traps.length}` });
  if (trapped) for (const k of [-1, 1]) traps.push({ x: feat.x + k * 1.4, z: feat.z - feat.d / 2 + 3.2, key: `${pre}:t${traps.length}` });

  // leviers : 2 (3 au troisième étage) dans des salles distinctes atteignables sans passer la herse, contre le mur est
  const levers: FloorLayout['levers'] = [];
  let gate: FloorLayout['gate'] = null;
  if (gateLink) {
    const cand = rooms.filter((r) => r.id !== featId && r.id !== 0);
    const need = Math.min(cand.length, level >= 3 ? 3 : 2);
    for (let i = 0; i < need; i++) {
      const r = cand.splice(rng.int(0, cand.length - 1), 1)[0];
      levers.push({ x: r.x + r.w / 2 - 0.55, z: r.z - r.d / 4, key: `${pre}:levier${i}` });
    }
    const from = rooms[gateLink.a === featId ? gateLink.b : gateLink.a], dx = from.x - gateLink.x, dz = from.z - gateLink.z, dl = Math.hypot(dx, dz) || 1;
    gate = { x: gateLink.x, z: gateLink.z, horizontal: gateLink.horizontal, key: `${pre}:herse`, px: gateLink.x + (dx / dl) * 0.9, pz: gateLink.z + (dz / dl) * 0.9 };
  }
  // bassins des salles inondées (décor : on y patauge)
  const pools: FloorLayout['pools'] = [];
  if (theme === 'salles inondées') for (const r of rooms) if (r.id !== 0 && r.id !== downId && rng.chance(0.6)) pools.push({ x: r.x + rng.float(-1.5, 1.5), z: r.z + rng.float(0, 1.5), w: r.w * rng.float(0.4, 0.7), d: r.d * rng.float(0.3, 0.5) });

  const base = d.name;
  return {
    id: d.id, kind: d.kind, name: `${base} · niveau ${level}`, base, level, floors, theme, ox, oz, rooms, links,
    entrance: { x: start.x, z: start.z + start.d / 2 - 2.5, heading: 0 },
    up: { x: start.x, z: start.z + start.d / 2 - 0.8, key: `${pre}:monter` },
    down, levers, gate, features, pools, guardian,
    traps, chests, spawns, lockedDoor: null, keyItem: '',
  };
}

/** Où l'on se tient en arrivant d'en dessous : au bord d'une cage d'escalier (côté −z de son repère), dos au vide. */
export function besideStairs(s: { x: number; z: number; yaw?: number }): { x: number; z: number; heading: number } {
  const yaw = s.yaw ?? 0, f = frameOf(s.x, s.z, yaw);
  return { x: f.wx(0, -3.2), z: f.wz(0, -3.2), heading: Math.atan2(-Math.sin(yaw), Math.cos(yaw)) };
}

/** Ouvertures d'une salle (côtés reliés à une autre salle). */
function openings(L: { rooms: DRoom[]; links: DLink[] }, r: DRoom) {
  const o = { n: false, s: false, e: false, w: false };
  for (const l of L.links) {
    if (l.a !== r.id && l.b !== r.id) continue;
    const other = L.rooms[l.a === r.id ? l.b : l.a];
    if (other.gx > r.gx) o.e = true; else if (other.gx < r.gx) o.w = true; else if (other.gy > r.gy) o.s = true; else o.n = true;
  }
  return o;
}

/**
 * Escalier du niveau 1 vers le niveau 2 : dans la salle libre la plus reculée (sans franchir la porte verrouillée), à un endroit
 * dégagé (coffres, sarcophages, étais, rochers, torches, passages, créatures, sortie), dans l'une des quatre orientations. Aucun
 * tirage : le plan reste intact. Si rien ne convient, les contraintes se relâchent (créatures, puis marges) : il y a toujours une place.
 */
export function levelOneDescent(L: DungeonLayout): { x: number; z: number; yaw: number; key: string; room: number } {
  const adj = (id: number) => L.links.filter((l) => !l.locked && (l.a === id || l.b === id)).map((l) => (l.a === id ? l.b : l.a));
  const dist = new Array(L.rooms.length).fill(-1); dist[0] = 0;
  const q = [0];
  while (q.length) { const c = q.shift()!; for (const n of adj(c)) if (dist[n] < 0) { dist[n] = dist[c] + 1; q.push(n); } }
  const order = L.rooms.filter((r) => dist[r.id] >= 0 && r.role !== 'boss').sort((a, b) => (dist[b.id] - dist[a.id]) || (a.id - b.id));
  // la salle d'entrée en dernier recours
  order.sort((a, b) => (a.role === 'entrée' ? 1 : 0) - (b.role === 'entrée' ? 1 : 0));
  const key = `dj${L.id}:descendre`;
  for (let relax = 0; relax < 3; relax++) for (const r of order) {
    const hw = r.w / 2, hd = r.d / 2, o = openings(L, r), door = relax < 2 ? 2.6 : 2.0;
    const obs: [number, number, number][] = [];
    for (const c of L.chests) if (Math.abs(c.x - r.x) < hw + 1 && Math.abs(c.z - r.z) < hd + 1) obs.push([c.x, c.z, 1.1]);
    if (relax < 1) for (const s of L.spawns) if (s.room === r.id) obs.push([s.x, s.z, 0.9]);
    for (const k of [-1, 1]) obs.push([r.x + k * (hw - 0.5), r.z, 0.6]);
    if (L.kind === 'crypte' || L.kind === 'forteresse') for (const k of [-3, 3]) { obs.push([r.x + k, r.z - hd + 1.5, 1.0]); obs.push([r.x + k, r.z - hd + 2.6, 1.0]); }
    if (L.kind === 'mine') for (const k of [-1, 1]) obs.push([r.x + k * (hw - 1.2), r.z, 0.5]);
    if (L.kind === 'grotte') for (let i = 0; i < 3; i++) obs.push([r.x + Math.sin(i * 2.1 + r.id) * hw * 0.6, r.z + Math.cos(i * 1.7 + r.id) * hd * 0.6, 1.4]);
    if (r.role === 'entrée') obs.push([L.exit.x, L.exit.z + 0.4, 2.2], [L.entrance.x, L.entrance.z, 1.2]);
    if (o.n) obs.push([r.x, r.z - hd, door]);
    if (o.s) obs.push([r.x, r.z + hd, door]);
    if (o.w) obs.push([r.x - hw, r.z, door]);
    if (o.e) obs.push([r.x + hw, r.z, door]);
    // emprise (repère de la cage) : ±1,5 en travers, de −3,2 (la place devant) à +1,9 (le fond), tournée d'un quart de tour à la fois
    let best: { x: number; z: number; yaw: number } | null = null, bs = Infinity;
    for (let qt = 0; qt < 4; qt++) {
      const yaw = (qt * Math.PI) / 2, c = Math.round(Math.cos(yaw)), sn = Math.round(Math.sin(yaw));
      // coins locaux → monde (axes alignés à un quart de tour près)
      const ex = [-1.5, 1.5].flatMap((lx) => [-3.2, 1.9].map((lz) => lx * c + lz * sn)), ez = [-1.5, 1.5].flatMap((lx) => [-3.2, 1.9].map((lz) => -lx * sn + lz * c));
      const rx0 = Math.min(...ex), rx1 = Math.max(...ex), rz0 = Math.min(...ez), rz1 = Math.max(...ez);
      for (let x = r.x - hw + 0.4 - rx0; x <= r.x + hw - 0.4 - rx1 + 1e-9; x += 0.5) for (let z = r.z - hd + 0.4 - rz0; z <= r.z + hd - 0.4 - rz1 + 1e-9; z += 0.5) {
        let ok = true;
        for (const [cx, cz, cr] of obs) {
          const dx = Math.max(x + rx0 - cx, 0, cx - (x + rx1)), dz = Math.max(z + rz0 - cz, 0, cz - (z + rz1));
          if (Math.hypot(dx, dz) < cr + (relax < 2 ? 0.15 : 0)) { ok = false; break; }
        }
        if (!ok) continue;
        const sc = Math.abs(x - r.x) + Math.abs(z - (r.z + hd * 0.3)) + qt * 0.01;
        if (sc < bs - 1e-9) { bs = sc; best = { x, z, yaw }; }
      }
    }
    if (best) return { x: Math.round(best.x * 100) / 100, z: Math.round(best.z * 100) / 100, yaw: best.yaw, key, room: r.id };
  }
  // jamais atteint en pratique : au centre de la salle d'entrée, tourné vers le nord
  const r0 = L.rooms[0];
  return { x: r0.x, z: r0.z - 0.5, yaw: 0, key, room: 0 };
}

/** Décor ajouté au niveau 1 (maillage et objets à part) : la cage d'escalier qui descend au niveau 2. */
export function buildDescent(L: DungeonLayout, at: { x: number; z: number; yaw: number; key: string }): { mesh: MeshData; data: ChunkData } {
  const mb = new MeshBuilder(512);
  mb.sky = 0;
  const data = new ChunkData(-1, -1);
  const stone = L.kind === 'mine' || L.kind === 'grotte' ? 0x5e574c : 0x7a7468;
  stairsDown(mb, data, at.x, at.z, at.key, stone, L.id, false, at.yaw);
  return { mesh: mb.finish(), data };
}

/** Géométrie, collisions et objets d'un étage (un seul maillage, « chunk » virtuel). */
export function buildFloor(F: FloorLayout): { mesh: MeshData; data: ChunkData } {
  const T = THEMES[F.theme];
  const mb = new MeshBuilder(8192);
  mb.sky = 0;
  const data = new ChunkData(-1, -1);
  const H = T.h, TH = 0.6, CW = 3.2;
  const wall = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.1) return;
    mb.box((ax + bx) / 2, 0, (az + bz) / 2, Math.abs(bx - ax) > 0.01 ? len : TH, H, Math.abs(bz - az) > 0.01 ? len : TH, 0, T.wall, T.wallM);
    data.segs.push({ ax, az, bx, bz, r: TH / 2, bottom: -1, top: H });
  };
  const down = F.down;
  for (const r of F.rooms) {
    const hw = r.w / 2, hd = r.d / 2;
    // sol (percé sous la cage de l'escalier qui descend)
    if (down && Math.abs(down.x - r.x) < hw && Math.abs(down.z - r.z) < hd) {
      const hx0 = down.x - 1.2, hx1 = down.x + 1.2, hz0 = down.z - 1.6, hz1 = down.z + 1.6, x0 = r.x - hw, x1 = r.x + hw, z0 = r.z - hd, z1 = r.z + hd;
      mb.box((x0 + hx0) / 2, -0.3, r.z, hx0 - x0, 0.3, r.d, 0, T.floor, T.floorM);
      mb.box((hx1 + x1) / 2, -0.3, r.z, x1 - hx1, 0.3, r.d, 0, T.floor, T.floorM);
      mb.box(down.x, -0.3, (z0 + hz0) / 2, 2.4, 0.3, hz0 - z0, 0, T.floor, T.floorM);
      mb.box(down.x, -0.3, (hz1 + z1) / 2, 2.4, 0.3, z1 - hz1, 0, T.floor, T.floorM);
    } else mb.box(r.x, -0.3, r.z, r.w, 0.3, r.d, 0, T.floor, T.floorM);
    mb.box(r.x, H, r.z, r.w, 0.4, r.d, 0, T.wall, T.wallM);
    data.platforms.push({ cx: r.x, cz: r.z, hw, hd, yaw: 0, top: 0 });
    const o = openings(F, r);
    const side = (x0: number, z0: number, x1: number, z1: number, open: boolean) => {
      if (!open) { wall(x0, z0, x1, z1); return; }
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, horiz = Math.abs(z1 - z0) < 0.01;
      if (horiz) { wall(x0, z0, mx - CW / 2, z0); wall(mx + CW / 2, z0, x1, z1); }
      else { wall(x0, z0, x0, mz - CW / 2); wall(x0, mz + CW / 2, x1, z1); }
    };
    side(r.x - hw, r.z - hd, r.x + hw, r.z - hd, o.n);
    side(r.x - hw, r.z + hd, r.x + hw, r.z + hd, o.s);
    side(r.x - hw, r.z - hd, r.x - hw, r.z + hd, o.w);
    side(r.x + hw, r.z - hd, r.x + hw, r.z + hd, o.e);
    const L = T.light;
    if (L) for (const k of [-1, 1]) {
      mb.box(r.x + k * (hw - 0.5), 2.0, r.z, 0.25, 0.35, 0.25, 0, L.c, L.m);
      data.lights.push({ x: r.x + k * (hw - 0.5) * 0.85, y: 2.2, z: r.z, radius: 12, r: L.r, g: L.g, b: L.b, kind: L.k });
    }
    decorRoom(mb, data, F, r, T);
  }
  for (const l of F.links) {
    const a = F.rooms[l.a], b = F.rooms[l.b];
    if (l.horizontal) {
      const [left, right] = a.x < b.x ? [a, b] : [b, a];
      const x0 = left.x + left.w / 2, x1 = right.x - right.w / 2, z = a.z;
      mb.box((x0 + x1) / 2, -0.3, z, x1 - x0, 0.3, CW, 0, T.floor, T.floorM);
      mb.box((x0 + x1) / 2, H - 0.6, z, x1 - x0, 1, CW + 1, 0, T.wall, T.wallM);
      wall(x0, z - CW / 2, x1, z - CW / 2); wall(x0, z + CW / 2, x1, z + CW / 2);
      data.platforms.push({ cx: (x0 + x1) / 2, cz: z, hw: (x1 - x0) / 2 + 0.5, hd: CW / 2, yaw: 0, top: 0 });
    } else {
      const [top, bot] = a.z < b.z ? [a, b] : [b, a];
      const z0 = top.z + top.d / 2, z1 = bot.z - bot.d / 2, x = a.x;
      mb.box(x, -0.3, (z0 + z1) / 2, CW, 0.3, z1 - z0, 0, T.floor, T.floorM);
      mb.box(x, H - 0.6, (z0 + z1) / 2, CW + 1, 1, z1 - z0, 0, T.wall, T.wallM);
      wall(x - CW / 2, z0, x - CW / 2, z1); wall(x + CW / 2, z0, x + CW / 2, z1);
      data.platforms.push({ cx: x, cz: (z0 + z1) / 2, hw: CW / 2, hd: (z1 - z0) / 2 + 0.5, yaw: 0, top: 0 });
    }
  }
  const stone = T.wallM === M.STONE ? 0x7a7468 : 0x5e574c;
  stairsUp(mb, data, F.up.x, F.up.z, F.up.key, stone, F.id);
  if (down) stairsDown(mb, data, down.x, down.z, down.key, stone, F.id, true);
  for (const c of F.chests) {
    mb.box(c.x, 0, c.z, 1.0, 0.6, 0.65, 0, c.tier >= 3 ? 0x8a6a20 : 0x5a3a20, M.WOOD);
    mb.box(c.x, 0.32, c.z, 1.05, 0.07, 0.7, 0, c.tier >= 4 ? 0xd8b040 : 0x9a9a8a, M.METAL);
    data.props.push({ key: c.key, kind: 'coffre', x: c.x, y: 0, z: c.z, sid: -1, bid: -1, dungeonId: F.id });
  }
  for (const t of F.traps) {
    mb.box(t.x, 0, t.z, 1.6, 0.05, 1.6, 0, 0x4a4640, M.METAL);
    data.props.push({ key: t.key, kind: 'piège', x: t.x, y: 0, z: t.z, sid: -1, bid: -1, dungeonId: F.id });
  }
  // leviers : plaque scellée au mur (la poignée, mobile, est dessinée par le jeu)
  for (const lv of F.levers) {
    mb.box(lv.x + 0.15, 0.9, lv.z, 0.12, 0.7, 0.5, 0, 0x5a5650, M.METAL);
    data.props.push({ key: lv.key, kind: 'levier', x: lv.x - 0.35, y: 0, z: lv.z, sid: -1, bid: -1, dungeonId: F.id });
  }
  // herse : montants de pierre (les barreaux, mobiles, sont dessinés par le jeu)
  if (F.gate) {
    const g = F.gate;
    for (const k of [-1, 1]) mb.box(g.x + (g.horizontal ? 0 : k * 1.9), 0, g.z + (g.horizontal ? k * 1.9 : 0), g.horizontal ? 0.6 : 0.5, H - 0.6, g.horizontal ? 0.5 : 0.6, 0, stone, M.STONE);
    data.props.push({ key: g.key, kind: 'herse', x: g.px, y: 0, z: g.pz, sid: -1, bid: -1, dungeonId: F.id });
  }
  for (const p of F.pools) mb.box(p.x, 0.02, p.z, p.w, 0.06, p.d, 0, 0x2a4a50, M.WATER);
  return { mesh: mb.finish(), data };
}

/** Décor d'une salle selon le thème (sans tirage : positions dérivées de la salle). */
function decorRoom(mb: MeshBuilder, data: ChunkData, F: FloorLayout, r: DRoom, T: ThemeDef): void {
  const hw = r.w / 2, hd = r.d / 2, H = T.h, o = openings(F, r), dn = F.down;
  const stairsHere = !!dn && Math.abs(dn.x - r.x) < hw && Math.abs(dn.z - r.z) < hd;
  // place libre : ni la cage d'escalier (et le palier devant), ni un coffre, un levier ou l'escalier qui remonte
  const clear = (x: number, z: number, rad: number) => !(dn && Math.abs(x - dn.x) < 1.6 + rad && z > dn.z - 3.4 - rad && z < dn.z + 2 + rad)
    && !F.chests.some((c) => Math.hypot(c.x - x, c.z - z) < 1.2 + rad) && !F.levers.some((l) => Math.hypot(l.x - x, l.z - z) < 1.2 + rad)
    && Math.hypot(F.up.x - x, F.up.z + 0.6 - z) > 2 + rad;
  switch (F.theme) {
    case 'catacombes':
      // niches d'ossuaire le long des murs nord et sud (crânes et tibias empilés)
      for (const zs of [-1, 1]) for (const k of [-0.3, 0.3]) {
        const x = r.x + k * r.w, z = r.z + zs * (hd - 0.45);
        mb.box(x, 0.3, z, 1.6, 0.9, 0.4, 0, 0x2a2622, T.wallM);
        mb.box(x, 0.35, z, 1.4, 0.25, 0.3, 0, 0xd8d0b8, M.BONE);
        mb.box(x, 0.65, z, 1.3, 0.22, 0.3, 0, 0xc8c0a8, M.BONE);
      }
      break;
    case 'cachots':
      // cellule grillagée contre le mur ouest
      if (o.w) break;   // le passage de l'ouest resterait barré
      for (let i = 0; i < 5; i++) mb.box(r.x - hw + 2.2, 0, r.z - 2 + i, 0.08, 2.4, 0.08, 0, 0x6a6a70, M.METAL);
      mb.box(r.x - hw + 2.2, 2.4, r.z, 0.12, 0.12, 4.2, 0, 0x6a6a70, M.METAL);
      data.segs.push({ ax: r.x - hw + 2.2, az: r.z - 2.1, bx: r.x - hw + 2.2, bz: r.z + 2.1, r: 0.1, bottom: -1, top: 2.5 });
      mb.box(r.x - hw + 1.1, 0, r.z + 1.2, 0.9, 0.12, 0.5, 0, 0x6a5a40, M.CLOTH);
      break;
    case 'galeries':
      // étais de bois et rails
      for (const k of [-1, 1]) mb.box(r.x + k * (hw - 1.2), 0, r.z - 1.5, 0.35, H, 0.35, 0, 0x5a4028, M.WOOD);
      mb.box(r.x, H - 0.5, r.z - 1.5, r.w - 2, 0.35, 0.35, 0, 0x5a4028, M.WOOD);
      if (!stairsHere) for (const k of [-0.45, 0.45]) mb.box(r.x + k, 0.01, r.z + 1, 0.07, 0.05, r.d * 0.6, 0, 0x7a7a80, M.METAL);
      break;
    case 'salles inondées':
      // champignons pâles qui luisent au pied des murs
      for (const k of [-1, 1]) {
        const x = r.x + k * (hw - 0.9), z = r.z + hd * 0.5;
        if (!clear(x, z, 0.3)) continue;
        mb.cylinder(x, 0, z, 0.08, 0.35, 5, 0xc8c8b0, M.BONE);
        mb.cone(x, 0.3, z, 0.3, 0.18, 6, 0x80ffb0, M.GLOW);
      }
      break;
    case 'grottes profondes':
      for (let i = 0; i < 3; i++) {
        const x = r.x + Math.sin(i * 2.4 + r.id) * hw * 0.65, z = r.z + Math.cos(i * 1.3 + r.id) * hd * 0.65;
        if (clear(x, z, 1.0)) mb.blob(x, 0, z, 1.0, 1.4, 1.0, 0x5e5a50, M.ROCK, 5, 3);
      }
      for (let i = 0; i < 4; i++) mb.cone(r.x + Math.sin(i * 1.9 + r.id) * hw * 0.5, H, r.z + Math.cos(i * 2.7 + r.id) * hd * 0.5, 0.35, -1.2, 5, 0x6a645a, M.ROCK);
      break;
  }
}
