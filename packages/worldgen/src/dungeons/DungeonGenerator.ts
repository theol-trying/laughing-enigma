import { MeshBuilder, type MeshData } from '@ascii-fort/ascii-engine/Mesh';
import { M } from '@ascii-fort/ascii-engine/Materials';
import { DUNGEON_ORIGIN_X } from '../constants';
import { ChunkData } from '../Chunk';
import type { WorldSeed } from '@ascii-fort/core/Seed';
import type { Dungeon } from '../civilization/types';

// Donjons : graphe de salles sur une grille (arbre couvrant + boucles), salle du boss au plus
// loin de l'entrée, porte verrouillée sur le chemin du boss et clé dans une salle annexe,
// pièges dans les couloirs, butin et monstres selon le type. Espace séparé (x ≥ 20000).

export interface DRoom { id: number; gx: number; gy: number; x: number; z: number; w: number; d: number; role: 'entrée' | 'salle' | 'trésor' | 'clé' | 'boss' }
export interface DLink { a: number; b: number; locked: boolean; x: number; z: number; horizontal: boolean }
export interface DSpawn { x: number; z: number; type: string; boss: boolean; room: number }
export interface DungeonLayout {
  id: number; kind: Dungeon['kind']; name: string;
  ox: number; oz: number;
  rooms: DRoom[]; links: DLink[];
  entrance: { x: number; z: number; heading: number };
  exit: { x: number; z: number };
  traps: { x: number; z: number; key: string }[];
  chests: { x: number; z: number; key: string; tier: number; hasKey: boolean }[];
  spawns: DSpawn[];
  lockedDoor: { x: number; z: number; horizontal: boolean; key: string } | null;
  keyItem: string;
}

const G = 5, CELLS = 20;

const MONSTERS: Record<Dungeon['kind'], { common: string[]; boss: string }> = {
  crypte: { common: ['squelette'], boss: 'gardien des tombes' },
  forteresse: { common: ['squelette', 'squelette', 'spectre'], boss: 'roi-squelette' },
  mine: { common: ['gobelin', 'gobelin', 'araignée'], boss: 'chef gobelin' },
  grotte: { common: ['gobelin', 'gobelin', 'loup'], boss: 'chef gobelin' },
};

export function generateDungeon(seed: WorldSeed, d: Dungeon): DungeonLayout {
  const rng = seed.stream('dungeon', d.id);
  const ox = DUNGEON_ORIGIN_X + d.id * 220, oz = 1000;
  const want = Math.min(12, 6 + Math.round(d.depth * 1.3));
  const grid = new Map<number, number>();
  const rooms: DRoom[] = [];
  const links: DLink[] = [];
  const key = (gx: number, gy: number) => gy * G + gx;
  const addRoom = (gx: number, gy: number): DRoom => {
    const r: DRoom = { id: rooms.length, gx, gy, x: ox + gx * CELLS, z: oz + gy * CELLS, w: rng.float(9, 14), d: rng.float(9, 14), role: 'salle' };
    rooms.push(r); grid.set(key(gx, gy), r.id);
    return r;
  };
  const linkOf = (a: DRoom, b: DRoom): DLink => ({ a: a.id, b: b.id, locked: false, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, horizontal: a.gy === b.gy });
  const start = addRoom(2, G - 1);
  start.role = 'entrée';
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let guard = 0;
  while (rooms.length < want && guard++ < 500) {
    const from = rooms[rng.int(0, rooms.length - 1)];
    const [dx, dy] = rng.pick(dirs);
    const gx = from.gx + dx, gy = from.gy + dy;
    if (gx < 0 || gy < 0 || gx >= G || gy >= G || grid.has(key(gx, gy))) continue;
    links.push(linkOf(from, addRoom(gx, gy)));
  }
  // boucles (raccourcis)
  let loops = 0;
  for (const a of rooms) for (const [dx, dy] of dirs) {
    if (loops >= 2) break;
    const bId = grid.get(key(a.gx + dx, a.gy + dy));
    if (bId === undefined || bId < a.id) continue;
    if (links.some((l) => (l.a === a.id && l.b === bId) || (l.a === bId && l.b === a.id))) continue;
    if (rng.chance(0.35)) { links.push(linkOf(a, rooms[bId])); loops++; }
  }
  // distances depuis l'entrée (BFS)
  const adj = (id: number) => links.filter((l) => l.a === id || l.b === id).map((l) => (l.a === id ? l.b : l.a));
  const dist = new Array(rooms.length).fill(-1), prev = new Array(rooms.length).fill(-1);
  dist[0] = 0; const q = [0];
  while (q.length) { const c = q.shift()!; for (const n of adj(c)) if (dist[n] < 0) { dist[n] = dist[c] + 1; prev[n] = c; q.push(n); } }
  let boss = 0;
  rooms.forEach((r, i) => { if (dist[i] > dist[boss]) boss = i; });
  const bossRoom = rooms[boss];
  bossRoom.role = 'boss'; bossRoom.w = 16; bossRoom.d = 16;
  // porte verrouillée : seul passage vers la salle du boss (les autres liens vers elle sont retirés)
  const lockFrom = prev[boss];
  for (let i = links.length - 1; i >= 0; i--) {
    const l = links[i];
    if ((l.a === boss || l.b === boss) && !((l.a === lockFrom && l.b === boss) || (l.b === lockFrom && l.a === boss))) links.splice(i, 1);
  }
  const lockLink = links.find((l) => (l.a === lockFrom && l.b === boss) || (l.b === lockFrom && l.a === boss));
  if (lockLink) lockLink.locked = true;
  // clé : salle la plus éloignée qui n'est pas sur le chemin du boss
  const onPath = new Set<number>();
  for (let c = boss; c >= 0; c = prev[c]) onPath.add(c);
  const candidates = rooms.filter((r) => !onPath.has(r.id) && r.role === 'salle');
  const keyRoom = candidates.length ? candidates.reduce((a, b) => (dist[b.id] > dist[a.id] ? b : a)) : rooms.find((r) => r.role === 'salle' && r.id !== boss) ?? start;
  if (keyRoom !== start) keyRoom.role = 'clé';
  for (const r of rooms) if (r.role === 'salle' && rng.chance(0.3)) r.role = 'trésor';

  const keyItem = `clé:${d.id}`;
  const spawns: DSpawn[] = [];
  const chests: DungeonLayout['chests'] = [];
  const traps: DungeonLayout['traps'] = [];
  const mons = MONSTERS[d.kind];
  for (const r of rooms) {
    if (r.role === 'entrée') continue;
    if (r.role === 'boss') {
      spawns.push({ x: r.x, z: r.z - 3, type: mons.boss, boss: true, room: r.id });
      chests.push({ x: r.x, z: r.z - r.d / 2 + 1.5, key: `dj${d.id}:c${chests.length}`, tier: 3, hasKey: false });
      continue;
    }
    const n = Math.min(4, 1 + Math.floor(rng.next() * (1 + d.depth * 0.6)));
    for (let i = 0; i < n; i++) spawns.push({ x: r.x + rng.float(-r.w / 3, r.w / 3), z: r.z + rng.float(-r.d / 3, r.d / 3), type: rng.pick(mons.common), boss: false, room: r.id });
    if (r.role === 'clé' || r.role === 'trésor') chests.push({ x: r.x + rng.float(-2, 2), z: r.z - r.d / 2 + 1.2, key: `dj${d.id}:c${chests.length}`, tier: r.role === 'trésor' ? 2 : 1, hasKey: r.role === 'clé' });
  }
  for (const l of links) if (!l.locked && rng.chance(0.3)) traps.push({ x: l.x, z: l.z, key: `dj${d.id}:t${traps.length}` });
  return {
    id: d.id, kind: d.kind, name: d.name, ox, oz, rooms, links,
    entrance: { x: start.x, z: start.z + start.d / 2 - 2.5, heading: 0 },
    exit: { x: start.x, z: start.z + start.d / 2 - 0.8 },
    traps, chests, spawns,
    lockedDoor: lockLink ? { x: lockLink.x, z: lockLink.z, horizontal: lockLink.horizontal, key: `dj${d.id}:porte` } : null,
    keyItem,
  };
}

const STYLE: Record<Dungeon['kind'], { wall: number; wallM: number; floor: number; floorM: number; h: number }> = {
  crypte: { wall: 0x7a7468, wallM: M.STONE, floor: 0x5a564e, floorM: M.COBBLE, h: 4.2 },
  forteresse: { wall: 0x6e6a60, wallM: M.STONE, floor: 0x4e4a42, floorM: M.COBBLE, h: 5 },
  mine: { wall: 0x5e574c, wallM: M.ROCK, floor: 0x4a3e30, floorM: M.DIRT, h: 3.6 },
  grotte: { wall: 0x56524a, wallM: M.ROCK, floor: 0x403a32, floorM: M.DIRT, h: 4.6 },
};

/** Géométrie + collisions + objets du donjon (un seul maillage, « chunk » virtuel). */
export function buildDungeon(L: DungeonLayout): { mesh: MeshData; data: ChunkData } {
  const st = STYLE[L.kind];
  const mb = new MeshBuilder(8192);
  mb.sky = 0;
  const data = new ChunkData(-1, -1);
  const H = st.h, T = 0.6, CW = 3.2;
  const seg = (ax: number, az: number, bx: number, bz: number) => data.segs.push({ ax, az, bx, bz, r: T / 2, bottom: -1, top: H });
  const wall = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.1) return;
    mb.box((ax + bx) / 2, 0, (az + bz) / 2, Math.abs(bx - ax) > 0.01 ? len : T, H, Math.abs(bz - az) > 0.01 ? len : T, 0, st.wall, st.wallM);
    seg(ax, az, bx, bz);
  };
  const openings = (r: DRoom) => {
    const o = { n: false, s: false, e: false, w: false };
    for (const l of L.links) {
      if (l.a !== r.id && l.b !== r.id) continue;
      const other = L.rooms[l.a === r.id ? l.b : l.a];
      if (other.gx > r.gx) o.e = true; else if (other.gx < r.gx) o.w = true; else if (other.gy > r.gy) o.s = true; else o.n = true;
    }
    return o;
  };
  for (const r of L.rooms) {
    const hw = r.w / 2, hd = r.d / 2;
    mb.box(r.x, -0.3, r.z, r.w, 0.3, r.d, 0, st.floor, st.floorM);
    mb.box(r.x, H, r.z, r.w, 0.4, r.d, 0, st.wall, st.wallM);
    data.platforms.push({ cx: r.x, cz: r.z, hw, hd, yaw: 0, top: 0 });
    const o = openings(r);
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
    // éclairage
    const light = L.kind === 'crypte' ? { c: 0xffe0a0, m: M.GLOW, r: 1.4, g: 1.15, b: 0.7, rad: 12, k: 'candle' as const } : { c: 0xffa030, m: M.FIRE, r: 1.6, g: 0.85, b: 0.4, rad: 12, k: 'torch' as const };
    for (const [lx, lz] of [[-hw + 0.5, 0], [hw - 0.5, 0]]) {
      mb.box(r.x + lx, 2.0, r.z + lz, 0.25, 0.35, 0.25, 0, light.c, light.m);
      data.lights.push({ x: r.x + lx * 0.85, y: 2.2, z: r.z + lz, radius: light.rad, r: light.r, g: light.g, b: light.b, kind: light.k });
    }
    // décor selon le type
    if (L.kind === 'crypte' || L.kind === 'forteresse') for (let i = 0; i < 2; i++) mb.box(r.x + (i ? 3 : -3), 0, r.z - hd + 2, 1, 0.8, 2.2, 0, 0x8a8478, M.STONE);
    if (L.kind === 'mine') for (const k of [-1, 1]) mb.box(r.x + k * (hw - 1.2), 0, r.z, 0.4, H, 0.4, 0, 0x5a4028, M.WOOD);
    if (L.kind === 'grotte') for (let i = 0; i < 3; i++) mb.blob(r.x + Math.sin(i * 2.1 + r.id) * hw * 0.6, 0, r.z + Math.cos(i * 1.7 + r.id) * hd * 0.6, 1.2, 1.6, 1.2, 0x5e5a50, M.ROCK, 5, 3);
  }
  for (const l of L.links) {
    const a = L.rooms[l.a], b = L.rooms[l.b];
    if (l.horizontal) {
      const [left, right] = a.x < b.x ? [a, b] : [b, a];
      const x0 = left.x + left.w / 2, x1 = right.x - right.w / 2, z = a.z;
      mb.box((x0 + x1) / 2, -0.3, z, x1 - x0, 0.3, CW, 0, st.floor, st.floorM);
      mb.box((x0 + x1) / 2, H - 0.6, z, x1 - x0, 1, CW + 1, 0, st.wall, st.wallM);
      wall(x0, z - CW / 2, x1, z - CW / 2); wall(x0, z + CW / 2, x1, z + CW / 2);
      data.platforms.push({ cx: (x0 + x1) / 2, cz: z, hw: (x1 - x0) / 2 + 0.5, hd: CW / 2, yaw: 0, top: 0 });
    } else {
      const [top, bot] = a.z < b.z ? [a, b] : [b, a];
      const z0 = top.z + top.d / 2, z1 = bot.z - bot.d / 2, x = a.x;
      mb.box(x, -0.3, (z0 + z1) / 2, CW, 0.3, z1 - z0, 0, st.floor, st.floorM);
      mb.box(x, H - 0.6, (z0 + z1) / 2, CW + 1, 1, z1 - z0, 0, st.wall, st.wallM);
      wall(x - CW / 2, z0, x - CW / 2, z1); wall(x + CW / 2, z0, x + CW / 2, z1);
      data.platforms.push({ cx: x, cz: (z0 + z1) / 2, hw: CW / 2, hd: (z1 - z0) / 2 + 0.5, yaw: 0, top: 0 });
    }
  }
  // sortie (escalier vers la surface), coffres, pièges
  mb.box(L.exit.x, 0, L.exit.z, 2.4, 0.4, 0.8, 0, 0x6e6a60, M.STONE);
  mb.box(L.exit.x, 0.4, L.exit.z + 0.6, 2.4, 0.4, 0.8, 0, 0x6e6a60, M.STONE);
  mb.box(L.exit.x, 0.8, L.exit.z + 1.2, 2.4, 0.4, 0.8, 0, 0x6e6a60, M.STONE);
  mb.sky = 0.5;
  mb.box(L.exit.x, 1.2, L.exit.z + 1.9, 2.2, 2.4, 0.2, 0, 0xc8d8f0, M.GLOW);
  mb.sky = 0;
  data.props.push({ key: `dj${L.id}:sortie`, kind: 'sortie', x: L.exit.x, y: 0, z: L.exit.z, sid: -1, bid: -1, dungeonId: L.id });
  for (const c of L.chests) {
    mb.box(c.x, 0, c.z, 1.0, 0.6, 0.65, 0, c.tier >= 3 ? 0x8a6a20 : 0x5a3a20, M.WOOD);
    mb.box(c.x, 0.32, c.z, 1.05, 0.07, 0.7, 0, 0x9a9a8a, M.METAL);
    data.props.push({ key: c.key, kind: 'coffre', x: c.x, y: 0, z: c.z, sid: -1, bid: -1, dungeonId: L.id });
  }
  for (const t of L.traps) {
    mb.box(t.x, 0, t.z, 1.6, 0.05, 1.6, 0, 0x4a4640, M.METAL);
    data.props.push({ key: t.key, kind: 'piège', x: t.x, y: 0, z: t.z, sid: -1, bid: -1, dungeonId: L.id });
  }
  if (L.lockedDoor) data.props.push({ key: L.lockedDoor.key, kind: 'porte verrouillée', x: L.lockedDoor.x, y: 0, z: L.lockedDoor.z, sid: -1, bid: -1, dungeonId: L.id });
  return { mesh: mb.finish(), data };
}
