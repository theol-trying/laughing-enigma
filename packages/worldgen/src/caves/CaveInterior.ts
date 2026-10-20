import { MeshBuilder, type MeshData } from '@ascii-fort/ascii-engine/Mesh';
import { M } from '@ascii-fort/ascii-engine/Materials';
import type { WorldSeed } from '@ascii-fort/core/Seed';
import { hash2i } from '@ascii-fort/core/RNG';
import { ChunkData, type HarvestNode } from '../Chunk';
import { type UnderLayout, type USpawn, type UnderChest, caveOrigin, frameOf } from '../dungeons/Under';
import type { CaveNet } from './Caves';

// Étape 55 (passe 2) : intérieur d'un réseau de grottes, généré à l'entrée (flux « grottes », « intérieur », réseau). Quadrillage de
// cases de 2 m : remplissage aléatoire lissé par automate cellulaire (galeries irrégulières), salles naturelles creusées et reliées
// par des boyaux sinueux à chaque issue (une par entrée de surface), puis seul le réseau relié à la première issue est gardé.
// Contenu : créatures par salle, filons (fer, charbon, or, gemmes), cristaux et champignons luminescents, champignons à cueillir,
// stalagmites (obstacles) et stalactites, parfois un lac souterrain, un trésor caché au fond du cul-de-sac le plus reculé.

export const CAVE_CELL = 2;
/** Cases : 0 roche, 1 sol, 2 eau (lac). */
export const ROCK = 0, OPEN = 1, WATER = 2;

export interface CaveExit {
  /** rang de l'entrée de surface correspondante ; clé de l'objet « issue » */
  k: number; key: string;
  /** pied de l'escalier qui remonte, orientation (repère local : +z vers la sortie) */
  x: number; z: number; yaw: number;
  /** où l'on arrive en entrant par cette entrée (dos à l'escalier) */
  arrive: { x: number; z: number; heading: number };
}
export interface CaveGlow { x: number; y: number; z: number; kind: 'cristal' | 'champignon'; color: number; yaw: number }
export interface CaveLayout extends UnderLayout {
  danger: number;
  ox: number; oz: number; W: number; H: number;
  cells: Uint8Array;
  /** distance à la roche (cases), pour les plafonds et le placement */
  dist: Uint8Array;
  exits: CaveExit[];
  chambers: { x: number; z: number; r: number; lake: boolean }[];
  veins: HarvestNode[];
  glows: CaveGlow[];
  /** champignons à cueillir (objets « champignons ») */
  patches: { key: string; x: number; z: number }[];
  /** stalagmites (obstacles) et stalactites (décor) */
  mites: { x: number; z: number; r: number; h: number }[];
  tites: { x: number; z: number; r: number; h: number }[];
  lake: { x: number; z: number; r: number } | null;
}

/** Hauteur du plafond au-dessus d'une case (sans tirage : bruit haché + salles plus hautes). */
export function ceilAt(C: Pick<CaveLayout, 'W' | 'H' | 'dist' | 'id'>, i: number, j: number): number {
  const d = C.dist[Math.max(0, Math.min(C.H - 1, j)) * C.W + Math.max(0, Math.min(C.W - 1, i))];
  return 3.1 + (hash2i(C.id * 7919 + 13, i >> 1, j >> 1) / 4294967296) * 1.1 + Math.min(3.2, d * 0.5);
}

export function generateCave(seed: WorldSeed, net: CaveNet, danger: number): CaveLayout {
  const rng = seed.stream('grottes', 'intérieur', net.id);
  const n = net.entrances.length;
  const W = n === 1 ? 60 : n === 2 ? 80 : 92, H = n === 1 ? 56 : n === 2 ? 68 : 76;
  const org = caveOrigin(net.id), ox = org.x - W, oz = org.z - H;
  const cells = new Uint8Array(W * H), tmp = new Uint8Array(W * H);
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= W || j >= H ? ROCK : cells[j * W + i]);
  // 1. remplissage aléatoire, puis automate cellulaire (roche si au moins 5 voisins de roche sur 8)
  for (let j = 2; j < H - 2; j++) for (let i = 2; i < W - 2; i++) cells[j * W + i] = rng.next() < 0.47 ? OPEN : ROCK;
  for (let it = 0; it < 4; it++) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let rock = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && at(i + di, j + dj) === ROCK) rock++;
      tmp[j * W + i] = i < 2 || j < 2 || i >= W - 2 || j >= H - 2 ? ROCK : rock >= 5 ? ROCK : OPEN;
    }
    cells.set(tmp);
  }
  const carve = (ci: number, cj: number, r: number, rough = 0) => {
    for (let j = Math.floor(cj - r - 1); j <= Math.ceil(cj + r + 1); j++) for (let i = Math.floor(ci - r - 1); i <= Math.ceil(ci + r + 1); i++) {
      if (i < 2 || j < 2 || i >= W - 2 || j >= H - 2) continue;
      if (Math.hypot(i - ci, j - cj) <= r + (rough ? (rng.next() - 0.5) * rough : 0)) cells[j * W + i] = OPEN;
    }
  };
  // 2. issues : une par entrée de surface, disposées comme les entrées l'une par rapport à l'autre
  const exitsC: { i: number; j: number; oi: number; oj: number }[] = [];
  const mx = net.entrances.reduce((a, e) => a + e.ax, 0) / n, mz = net.entrances.reduce((a, e) => a + e.az, 0) / n;
  for (let k = 0; k < n; k++) {
    const e = net.entrances[k];
    let ux = e.ax - mx, uz = e.az - mz;
    if (n === 1) { const s = rng.int(0, 3); ux = [0, 1, 0, -1][s]; uz = [1, 0, -1, 0][s]; }
    const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
    const place = (vx: number, vz: number) => {
      const horiz = Math.abs(vx) * (H / 2 - 7) > Math.abs(vz) * (W / 2 - 7);
      const s = horiz ? (W / 2 - 7) / Math.abs(vx) : (H / 2 - 7) / Math.abs(vz);
      return { i: Math.max(7, Math.min(W - 8, Math.round(W / 2 + vx * s))), j: Math.max(7, Math.min(H - 8, Math.round(H / 2 + vz * s))), oi: horiz ? Math.sign(vx) : 0, oj: horiz ? 0 : Math.sign(vz) };
    };
    // pas deux issues côte à côte : on tourne d'un quart de tour
    let pos = place(ux, uz);
    for (let t = 0; t < 3 && exitsC.some((x) => Math.hypot(x.i - pos.i, x.j - pos.j) < 16); t++) { const a = ux; ux = -uz; uz = a; pos = place(ux, uz); }
    exitsC.push(pos);
  }
  // 3. salles naturelles
  const rooms: { i: number; j: number; r: number }[] = [];
  const want = Math.min(8, 3 + n + rng.int(0, 2));
  for (let t = 0; t < 80 && rooms.length < want; t++) {
    const i = rng.int(9, W - 10), j = rng.int(9, H - 10), r = rng.int(3, 6);
    if (rooms.some((q) => Math.hypot(q.i - i, q.j - j) < q.r + r + 6) || exitsC.some((x) => Math.hypot(x.i - i, x.j - j) < r + 8)) continue;
    rooms.push({ i, j, r });
    carve(i, j, r, 1.6);
  }
  // 4. boyaux sinueux : chaque salle et chaque issue reliée à la plus proche déjà reliée (en partant de la première issue)
  const worm = (ai: number, aj: number, bi: number, bj: number) => {
    let i = ai, j = aj;
    for (let step = 0; step < 900 && (Math.abs(bi - i) > 0 || Math.abs(bj - j) > 0); step++) {
      const di = bi - i, dj = bj - j;
      if (rng.next() < 0.68) { if (Math.abs(di) >= Math.abs(dj)) i += Math.sign(di); else j += Math.sign(dj); }
      else if (Math.abs(di) >= Math.abs(dj)) j += rng.sign(); else i += rng.sign();
      i = Math.max(3, Math.min(W - 4, i)); j = Math.max(3, Math.min(H - 4, j));
      carve(i, j, rng.chance(0.3) ? 1.6 : 1.05);
    }
  };
  const nodes = [...exitsC.map((x) => ({ i: x.i - x.oi * 3, j: x.j - x.oj * 3 })), ...rooms.map((r) => ({ i: r.i, j: r.j }))];
  const linked = [0];
  while (linked.length < nodes.length) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let a = 0; a < nodes.length; a++) {
      if (linked.includes(a)) continue;
      for (const b of linked) { const d = Math.hypot(nodes[a].i - nodes[b].i, nodes[a].j - nodes[b].j); if (d < bd) { bd = d; bi = a; bj = b; } }
    }
    worm(nodes[bi].i, nodes[bi].j, nodes[bj].i, nodes[bj].j);
    linked.push(bi);
  }
  if (rooms.length >= 3 && rng.chance(0.6)) { const a = rooms[rng.int(0, rooms.length - 1)], b = rooms[rng.int(0, rooms.length - 1)]; if (a !== b) worm(a.i, a.j, b.i, b.j); }
  // vestibules des issues (l'escalier s'adosse à la roche, vers l'extérieur)
  for (const x of exitsC) {
    // de 4 cases en dedans à 2 cases au-dehors (les marches), puis la roche
    for (let d = -4; d <= 2; d++) carve(x.i + x.oi * d, x.j + x.oj * d, 1.6);
    for (let d = 3; d <= 6; d++) { const i = x.i + x.oi * d, j = x.j + x.oj * d; for (let s = -3; s <= 3; s++) { const a = i + (x.oj ? s : 0), b = j + (x.oi ? s : 0); if (a >= 0 && b >= 0 && a < W && b < H) cells[b * W + a] = ROCK; } }
  }
  for (let i = 0; i < W; i++) { cells[i] = ROCK; cells[(H - 1) * W + i] = ROCK; }
  for (let j = 0; j < H; j++) { cells[j * W] = ROCK; cells[j * W + W - 1] = ROCK; }
  // 5. on ne garde que ce qui est relié à la première issue
  const reach = (from: number, pass: (c: number) => boolean): Uint8Array => {
    const seen = new Uint8Array(W * H), q = [from];
    seen[from] = 1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], i = c % W, j = (c / W) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= W || b >= H) continue;
        const k = b * W + a;
        if (!seen[k] && pass(cells[k])) { seen[k] = 1; q.push(k); }
      }
    }
    return seen;
  };
  const e0 = exitsC[0].j * W + exitsC[0].i;
  { const seen = reach(e0, (v) => v === OPEN); for (let c = 0; c < W * H; c++) if (cells[c] === OPEN && !seen[c]) cells[c] = ROCK; }
  // 6. distance à la roche (8 voisins)
  const dist = new Uint8Array(W * H);
  {
    const q: number[] = [];
    for (let c = 0; c < W * H; c++) if (cells[c] === ROCK) q.push(c); else dist[c] = 255;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], i = c % W, j = (c / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj;
        if ((!di && !dj) || a < 0 || b < 0 || a >= W || b >= H) continue;
        const k = b * W + a;
        if (dist[k] > dist[c] + 1) { dist[k] = dist[c] + 1; q.push(k); }
      }
    }
  }
  const wx = (i: number) => ox + (i + 0.5) * CAVE_CELL, wz = (j: number) => oz + (j + 0.5) * CAVE_CELL;
  const chambers = rooms.map((r) => ({ x: wx(r.i), z: wz(r.j), r: Math.max(2, dist[r.j * W + r.i]) * CAVE_CELL, lake: false, i: r.i, j: r.j }));
  // 7. lac souterrain (si tout reste relié sans lui)
  let lake: CaveLayout['lake'] = null;
  {
    const cand = chambers.filter((c) => dist[c.j * W + c.i] >= 4).sort((a, b) => dist[b.j * W + b.i] - dist[a.j * W + a.i]);
    if (cand.length && rng.chance(0.55)) {
      const c = cand[0], rl = dist[c.j * W + c.i] - 2.2, set: number[] = [];
      for (let j = c.j - 8; j <= c.j + 8; j++) for (let i = c.i - 8; i <= c.i + 8; i++) {
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const k = j * W + i;
        if (cells[k] === OPEN && Math.hypot(i - c.i, j - c.j) <= rl + (hash2i(net.id, i, j) / 4294967296 - 0.5) * 1.4) set.push(k);
      }
      for (const k of set) cells[k] = WATER;
      const seen = reach(e0, (v) => v === OPEN);
      let ok = exitsC.every((x) => seen[x.j * W + x.i]);
      for (let k = 0; k < W * H && ok; k++) if (cells[k] === OPEN && !seen[k]) ok = false;
      if (ok) { c.lake = true; lake = { x: c.x, z: c.z, r: rl * CAVE_CELL }; }
      else for (const k of set) cells[k] = OPEN;
    }
  }
  const open = (k: number) => cells[k] === OPEN;
  const exits: CaveExit[] = exitsC.map((x, k) => {
    const yaw = Math.atan2(x.oi, x.oj), f = frameOf(wx(x.i), wz(x.j), yaw);
    // l'escalier monte vers +z local (la sortie) ; on arrive 4 m devant, dos à lui
    return { k, key: `gr${net.id}:s${k}`, x: wx(x.i), z: wz(x.j), yaw, arrive: { x: f.wx(0, -4.2), z: f.wz(0, -4.2), heading: Math.atan2(-Math.sin(yaw), Math.cos(yaw)) } };
  });
  // 8. contenu (cases occupées : pas deux choses au même endroit)
  const taken = new Uint8Array(W * H);
  const take = (i: number, j: number, r: number) => { for (let b = j - r; b <= j + r; b++) for (let a = i - r; a <= i + r; a++) if (a >= 0 && b >= 0 && a < W && b < H) taken[b * W + a] = 1; };
  for (const x of exitsC) for (let d = -5; d <= 2; d++) take(x.i + x.oi * d, x.j + x.oj * d, 2);
  // trésor caché : la case la plus éloignée (à pied) de toutes les issues
  const far = new Int32Array(W * H).fill(-1);
  {
    const q: number[] = [];
    for (const x of exitsC) { const k = x.j * W + x.i; far[k] = 0; q.push(k); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], i = c % W, j = (c / W) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = (j + dj) * W + i + di;
        if (open(k) && far[k] < 0) { far[k] = far[c] + 1; q.push(k); }
      }
    }
  }
  let tk = -1;
  for (let k = 0; k < W * H; k++) if (open(k) && dist[k] >= 2 && !taken[k] && (tk < 0 || far[k] > far[tk])) tk = k;
  const chests: UnderChest[] = [];
  if (tk >= 0) { const i = tk % W, j = (tk / W) | 0; chests.push({ x: wx(i), z: wz(j), key: `gr${net.id}:c0`, tier: Math.min(4, 2 + (danger >= 5 ? 1 : 0) + (n >= 3 ? 1 : 0)), hasKey: false }); take(i, j, 2); }
  // créatures par salle
  const spawns: USpawn[] = [];
  const pool = ['chauve-souris', 'araignée', ...(danger >= 3 ? ['ours des cavernes'] : []), 'chauve-souris'];
  const cellIn = (c: { i: number; j: number; r: number }, minD: number): [number, number] | null => {
    for (let t = 0; t < 30; t++) {
      const i = c.i + rng.int(-c.r, c.r), j = c.j + rng.int(-c.r, c.r), k = j * W + i;
      if (i > 0 && j > 0 && i < W - 1 && j < H - 1 && open(k) && dist[k] >= minD && !taken[k]) return [i, j];
    }
    return null;
  };
  const biggest = chambers.reduce<typeof chambers[number] | null>((a, b) => (!a || b.r > a.r ? b : a), null);
  chambers.forEach((c, ci) => {
    if (c === biggest && danger >= 5 && rng.chance(0.6)) {
      const p = cellIn({ i: c.i, j: c.j, r: Math.max(2, (c.r / CAVE_CELL) | 0) }, 2);
      if (p) { spawns.push({ x: wx(p[0]), z: wz(p[1]), type: 'troll', boss: false, room: ci, territory: 18 }); return; }
    }
    const type = rng.pick(pool), k = type === 'chauve-souris' ? rng.int(2, 4) : type === 'ours des cavernes' ? 1 : rng.int(1, 2 + (danger >= 6 ? 1 : 0));
    for (let s = 0; s < k; s++) {
      const p = cellIn({ i: c.i, j: c.j, r: Math.max(2, (c.r / CAVE_CELL) | 0) }, 1);
      if (p) spawns.push({ x: wx(p[0]) + rng.float(-0.4, 0.4), z: wz(p[1]) + rng.float(-0.4, 0.4), type, boss: false, room: ci, territory: 16 });
    }
  });
  // filons sur les parois (fer, charbon, or, gemmes), espacés
  const veins: HarvestNode[] = [];
  const wallCells: [number, number, number, number][] = [];
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    if (!open(j * W + i) || taken[j * W + i]) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (cells[(j + dj) * W + i + di] === ROCK) { wallCells.push([i, j, di, dj]); break; }
  }
  const nv = Math.min(wallCells.length, 8 + 4 * n + rng.int(0, 4));
  for (let t = 0; t < nv * 6 && veins.length < nv; t++) {
    const [i, j, di, dj] = wallCells[rng.int(0, wallCells.length - 1)];
    const x = wx(i) + di * 0.75, z = wz(j) + dj * 0.75;
    if (veins.some((v) => Math.hypot(v.x - x, v.z - z) < 7)) continue;
    const r = rng.next() - Math.min(0.12, danger * 0.01);
    const ore = r < 0.4 ? 'fer' : r < 0.68 ? 'charbon' : r < 0.86 ? 'or' : 'gemme';
    veins.push({ id: `gr${net.id}:f${veins.length}`, kind: 'filon', x, y: 0, z, size: 1.2, ore });
  }
  // lueurs : cristaux contre les parois des salles, champignons le long des boyaux
  const glows: CaveGlow[] = [];
  for (const c of chambers) for (let s = 0; s < 2; s++) {
    for (let t = 0; t < 20; t++) {
      const [i, j, di, dj] = wallCells[rng.int(0, wallCells.length - 1)];
      if (Math.hypot(wx(i) - c.x, wz(j) - c.z) > c.r + 6) continue;
      const x = wx(i) + di * 0.6, z = wz(j) + dj * 0.6;
      if (glows.some((g) => Math.hypot(g.x - x, g.z - z) < 5) || veins.some((v) => Math.hypot(v.x - x, v.z - z) < 2)) continue;
      glows.push({ x, y: 0, z, kind: 'cristal', color: rng.pick([0x60d8ff, 0x9a70ff, 0x70ffd0]), yaw: Math.atan2(di, dj) });
      break;
    }
  }
  for (let t = 0; t < 80 && glows.length < 14 + n * 6; t++) {
    const [i, j, di, dj] = wallCells[rng.int(0, wallCells.length - 1)];
    const x = wx(i) + di * 0.5, z = wz(j) + dj * 0.5;
    if (glows.some((g) => Math.hypot(g.x - x, g.z - z) < 9) || veins.some((v) => Math.hypot(v.x - x, v.z - z) < 2)) continue;
    glows.push({ x, y: 0, z, kind: 'champignon', color: rng.pick([0x80ff90, 0x60e0b0, 0xb0ff70]), yaw: Math.atan2(di, dj) });
  }
  // champignons à cueillir (ingrédients d'alchimie), au pied des parois des salles
  const patches: CaveLayout['patches'] = [];
  for (let t = 0; t < 60 && patches.length < 3 + n; t++) {
    const [i, j, di, dj] = wallCells[rng.int(0, wallCells.length - 1)];
    const x = wx(i) + di * 0.2, z = wz(j) + dj * 0.2;
    if (taken[j * W + i] || patches.some((p) => Math.hypot(p.x - x, p.z - z) < 10) || veins.some((v) => Math.hypot(v.x - x, v.z - z) < 3) || glows.some((g) => Math.hypot(g.x - x, g.z - z) < 1.5)) continue;
    patches.push({ key: `gr${net.id}:p${patches.length}`, x, z });
    take(i, j, 1);
  }
  // stalagmites (au large des passages) et stalactites (décor)
  const mites: CaveLayout['mites'] = [], tites: CaveLayout['tites'] = [];
  for (const c of chambers) {
    const k = rng.int(2, 5);
    for (let s = 0; s < k; s++) {
      const p = cellIn({ i: c.i, j: c.j, r: Math.max(2, (c.r / CAVE_CELL) | 0) + 1 }, 3);
      if (!p) continue;
      const x = wx(p[0]) + rng.float(-0.5, 0.5), z = wz(p[1]) + rng.float(-0.5, 0.5);
      if (spawns.some((q) => Math.hypot(q.x - x, q.z - z) < 2) || mites.some((m) => Math.hypot(m.x - x, m.z - z) < 2.5)) continue;
      mites.push({ x, z, r: rng.float(0.3, 0.6), h: rng.float(0.9, 2.3) });
      take(p[0], p[1], 0);
    }
    for (let s = 0; s < 6; s++) {
      const i = c.i + rng.int(-4, 4), j = c.j + rng.int(-4, 4);
      if (i < 1 || j < 1 || i >= W - 1 || j >= H - 1 || cells[j * W + i] === ROCK) continue;
      tites.push({ x: wx(i) + rng.float(-0.6, 0.6), z: wz(j) + rng.float(-0.6, 0.6), r: rng.float(0.15, 0.4), h: rng.float(0.5, 1.4) });
    }
  }
  return {
    id: net.id, kind: 'grotte', name: net.name, danger, ox, oz, W, H, cells, dist,
    entrance: exits[0].arrive, exits, chambers: chambers.map((c) => ({ x: c.x, z: c.z, r: c.r, lake: c.lake })),
    veins, glows, patches, mites, tites, lake, traps: [], chests, spawns, lockedDoor: null, keyItem: '',
    rooms: chambers.map((c, id) => ({ id, gx: 0, gy: 0, x: c.x, z: c.z, w: c.r * 2, d: c.r * 2, role: 'salle' as const })), links: [],
  };
}

const ROCK_C = [0x5a564e, 0x544f47, 0x625c52], FLOOR_C = [0x4a443c, 0x423d36, 0x50483e];

/** Géométrie (roche brute), collisions, lumières et objets d'une grotte. */
export function buildCave(C: CaveLayout): { mesh: MeshData; data: ChunkData } {
  const { W, H, cells, ox, oz } = C;
  const mb = new MeshBuilder(32768);
  mb.sky = 0;
  const data = new ChunkData(-1, -1);
  const cell = (i: number, j: number) => (i < 0 || j < 0 || i >= W || j >= H ? ROCK : cells[j * W + i]);
  const h01 = (a: number, b: number, s: number) => hash2i(C.id * 31 + s, a, b) / 4294967296;
  // sommets partagés du sol et du plafond (coins des cases), créés à la demande
  const VW = W + 1;
  const floorV = new Int32Array(VW * (H + 1)).fill(-1), ceilV = new Int32Array(VW * (H + 1)).fill(-1);
  const ceilH = (vi: number, vj: number) => {
    let s = 0, k = 0;
    for (const [a, b] of [[vi - 1, vj - 1], [vi, vj - 1], [vi - 1, vj], [vi, vj]]) if (cell(a, b) !== ROCK) { s += ceilAt(C, a, b); k++; }
    return k ? s / k : 3.2;
  };
  const fv = (vi: number, vj: number) => {
    const k = vj * VW + vi;
    if (floorV[k] < 0) floorV[k] = mb.vertex(ox + vi * 2, (h01(vi, vj, 1) - 0.5) * 0.12, oz + vj * 2, 0, 1, 0, FLOOR_C[(h01(vi, vj, 2) * 3) | 0], M.DIRT);
    return floorV[k];
  };
  const cv = (vi: number, vj: number) => {
    const k = vj * VW + vi;
    if (ceilV[k] < 0) ceilV[k] = mb.vertex(ox + vi * 2, ceilH(vi, vj), oz + vj * 2, 0, -1, 0, 0x3a3630, M.ROCK);
    return ceilV[k];
  };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const v = cells[j * W + i];
    if (v === ROCK) continue;
    if (v === OPEN) mb.quad(fv(i, j), fv(i, j + 1), fv(i + 1, j + 1), fv(i + 1, j));
    else {
      // lac : surface et fond sombre
      mb.box(ox + i * 2 + 1, -0.42, oz + j * 2 + 1, 2, 0.04, 2, 0, 0x24404a, M.WATER);
      mb.box(ox + i * 2 + 1, -1.7, oz + j * 2 + 1, 2, 0.1, 2, 0, 0x101614, M.MUD);
    }
    mb.quad(cv(i, j), cv(i + 1, j), cv(i + 1, j + 1), cv(i, j + 1));
  }
  // parois : un pan par arête sol|roche (ou sol|eau : la berge), renflé à mi-hauteur (point haché propre à chaque coin, partagé)
  const mid = (vi: number, vj: number): [number, number, number] => [ox + vi * 2 + (h01(vi, vj, 3) - 0.5) * 0.9, 1.1 + h01(vi, vj, 4) * 0.9, oz + vj * 2 + (h01(vi, vj, 5) - 0.5) * 0.9];
  const wallCol = (vi: number, vj: number) => ROCK_C[(h01(vi, vj, 6) * 3) | 0];
  const pan = (ai: number, aj: number, bi: number, bj: number, low: number) => {
    const fa: [number, number, number] = [ox + ai * 2, low, oz + aj * 2], fb: [number, number, number] = [ox + bi * 2, low, oz + bj * 2];
    const ma = mid(ai, aj), mbp = mid(bi, bj);
    const ta: [number, number, number] = [ox + ai * 2, ceilH(ai, aj) + 0.05, oz + aj * 2], tb: [number, number, number] = [ox + bi * 2, ceilH(bi, bj) + 0.05, oz + bj * 2];
    const c = wallCol(ai, aj);
    mb.face([fa, fb, mbp, ma], c, M.ROCK);
    mb.face([ma, mbp, tb, ta], c, M.ROCK);
  };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const v = cells[j * W + i];
    if (v === ROCK) continue;
    // nord, sud, ouest, est (sommets ordonnés pour que la face regarde vers la case ouverte)
    if (cell(i, j - 1) === ROCK) pan(i, j, i + 1, j, v === WATER ? -1.7 : -0.1);
    if (cell(i, j + 1) === ROCK) pan(i + 1, j + 1, i, j + 1, v === WATER ? -1.7 : -0.1);
    if (cell(i - 1, j) === ROCK) pan(i, j + 1, i, j, v === WATER ? -1.7 : -0.1);
    if (cell(i + 1, j) === ROCK) pan(i + 1, j, i + 1, j + 1, v === WATER ? -1.7 : -0.1);
    if (v === OPEN) {
      // berge : du sol au fond du lac
      const bank = (ai: number, aj: number, bi: number, bj: number) => mb.face([[ox + ai * 2, -1.7, oz + aj * 2], [ox + bi * 2, -1.7, oz + bj * 2], [ox + bi * 2, 0, oz + bj * 2], [ox + ai * 2, 0, oz + aj * 2]], 0x3a3630, M.ROCK);
      if (cell(i, j - 1) === WATER) bank(i + 1, j, i, j);
      if (cell(i, j + 1) === WATER) bank(i, j + 1, i + 1, j + 1);
      if (cell(i - 1, j) === WATER) bank(i, j, i, j + 1);
      if (cell(i + 1, j) === WATER) bank(i + 1, j + 1, i + 1, j);
    }
  }
  // collisions : arêtes sol|(roche ou eau), fusionnées en segments le long des rangées et des colonnes
  const blocked = (i: number, j: number) => cell(i, j) !== OPEN;
  const seg = (ax: number, az: number, bx: number, bz: number) => data.segs.push({ ax, az, bx, bz, r: 0.25, bottom: -3, top: 8 });
  for (let j = 0; j <= H; j++) {
    // arête horizontale entre (i, j−1) et (i, j) : un mur si un seul des deux côtés est du sol
    let start = -1, side = 0;
    for (let i = 0; i <= W; i++) {
      const s = i < W ? (cell(i, j - 1) === OPEN && blocked(i, j) ? 1 : cell(i, j) === OPEN && blocked(i, j - 1) ? 2 : 0) : 0;
      if (s !== side) { if (side) seg(ox + start * 2, oz + j * 2, ox + i * 2, oz + j * 2); start = i; side = s; }
    }
  }
  for (let i = 0; i <= W; i++) {
    let start = -1, side = 0;
    for (let j = 0; j <= H; j++) {
      const s = j < H ? (cell(i - 1, j) === OPEN && blocked(i, j) ? 1 : cell(i, j) === OPEN && blocked(i - 1, j) ? 2 : 0) : 0;
      if (s !== side) { if (side) seg(ox + i * 2, oz + start * 2, ox + i * 2, oz + j * 2); start = j; side = s; }
    }
  }
  data.platforms.push({ cx: ox + W, cz: oz + H, hw: W, hd: H, yaw: 0, top: 0 });
  // filons récoltables (ChunkManager.nodesNear lit aussi les superpositions ; un filon épuisé est écarté par son id)
  data.nodes.push(...C.veins);
  // stalagmites (obstacles) et stalactites
  for (const m of C.mites) {
    mb.cone(m.x, -0.1, m.z, m.r, m.h + 0.1, 6, 0x6a645a, M.ROCK);
    mb.blob(m.x, 0, m.z, m.r * 1.4, 0.25, m.r * 1.4, 0x5e584e, M.ROCK, 5, 2);
    data.circles.push({ x: m.x, z: m.z, r: m.r * 0.9, bottom: -1, top: m.h });
  }
  for (const t of C.tites) {
    const i = Math.floor((t.x - ox) / 2), j = Math.floor((t.z - oz) / 2), top = ceilAt(C, i, j);
    const len = Math.min(t.h, top - 2.3);
    if (len > 0.2) mb.cone(t.x, top + 0.05, t.z, t.r, -len, 5, 0x625c52, M.ROCK);
  }
  // cristaux et champignons luminescents (lumières)
  for (const g of C.glows) {
    const f = frameOf(g.x, g.z, g.yaw);
    if (g.kind === 'cristal') {
      for (let s = 0; s < 4; s++) {
        const lx = (s - 1.5) * 0.28, h = 0.5 + ((s * 37 + C.id) % 5) * 0.18;
        mb.box(f.wx(lx, 0.1), 0, f.wz(lx, 0.1), 0.16, h, 0.16, g.yaw + s * 0.5, g.color, M.GLOW);
      }
      data.lights.push({ x: f.wx(0, -0.6), y: 0.9, z: f.wz(0, -0.6), radius: 9, r: ((g.color >> 16) & 255) / 170, g: ((g.color >> 8) & 255) / 170, b: (g.color & 255) / 170, kind: 'candle' });
    } else {
      for (let s = 0; s < 3; s++) {
        const lx = (s - 1) * 0.35, lz = -0.15 * (s % 2), x = f.wx(lx, lz), z = f.wz(lx, lz), hh = 0.18 + (s % 2) * 0.14;
        mb.cylinder(x, 0, z, 0.05, hh, 5, 0xc8c8b0, M.BONE);
        mb.cone(x, hh - 0.04, z, 0.17, 0.1, 6, g.color, M.GLOW);
      }
      data.lights.push({ x: f.wx(0, -0.5), y: 0.6, z: f.wz(0, -0.5), radius: 6, r: ((g.color >> 16) & 255) / 220, g: ((g.color >> 8) & 255) / 220, b: (g.color & 255) / 220, kind: 'candle' });
    }
  }
  // champignons à cueillir : touffes de chapeaux bruns, légère lueur
  for (const p of C.patches) {
    for (let s = 0; s < 5; s++) {
      const a = s * 1.26 + C.id, x = p.x + Math.cos(a) * 0.35, z = p.z + Math.sin(a) * 0.35, hh = 0.12 + (s % 3) * 0.06;
      mb.cylinder(x, 0, z, 0.04, hh, 4, 0xd8d0b8, M.BONE);
      mb.cone(x, hh - 0.03, z, 0.13, 0.08, 6, 0x8a5a30, M.WOOD);
    }
    data.props.push({ key: p.key, kind: 'champignons', x: p.x, y: 0, z: p.z, sid: -1, bid: -1, dungeonId: -1 });
  }
  // issues : escalier taillé dans la roche vers la lumière du jour
  for (const e of C.exits) {
    const f = frameOf(e.x, e.z, e.yaw);
    for (let s = 0; s < 4; s++) mb.box(f.wx(0, 0.4 + s * 0.7), s * 0.35, f.wz(0, 0.4 + s * 0.7), 2.6, 0.35, 0.8, e.yaw, 0x5e584e, M.ROCK);
    const sky = mb.sky;
    mb.sky = 0.6;
    mb.box(f.wx(0, 3.2), 1.2, f.wz(0, 3.2), 2.4, 2.6, 0.2, e.yaw, 0xd0dcf0, M.GLOW);
    mb.sky = sky;
    data.lights.push({ x: f.wx(0, 1.5), y: 2.2, z: f.wz(0, 1.5), radius: 13, r: 0.9, g: 1.0, b: 1.15, kind: 'window' });
    data.props.push({ key: e.key, kind: 'issue', x: e.x, y: 0, z: e.z, sid: -1, bid: -1, dungeonId: -1 });
    // on ne grimpe pas l'escalier : la sortie se prend avec [E]
    const L = (lx: number, lz: number) => [f.wx(lx, lz), f.wz(lx, lz)] as const;
    const [ax, az] = L(-1.4, 0.4), [bx, bz] = L(1.4, 0.4), [cx, cz] = L(-1.4, 5), [dx, dz] = L(1.4, 5);
    data.segs.push({ ax, az, bx, bz, r: 0.25, bottom: -1, top: 4 }, { ax, az, bx: cx, bz: cz, r: 0.25, bottom: -1, top: 4 }, { ax: bx, az: bz, bx: dx, bz: dz, r: 0.25, bottom: -1, top: 4 });
  }
  for (const c of C.chests) {
    mb.box(c.x, 0, c.z, 1.0, 0.6, 0.65, 0.3, c.tier >= 3 ? 0x8a6a20 : 0x5a3a20, M.WOOD);
    mb.box(c.x, 0.32, c.z, 1.05, 0.07, 0.7, 0.3, 0x9a9a8a, M.METAL);
    // les restes d'un aventurier qui n'est jamais ressorti
    mb.box(c.x + 1.1, 0, c.z + 0.6, 0.7, 0.12, 0.12, 1.1, 0xd8d0b8, M.BONE);
    mb.box(c.x + 1.3, 0, c.z + 0.3, 0.25, 0.22, 0.25, 0.4, 0xd8d0b8, M.BONE);
    data.props.push({ key: c.key, kind: 'coffre', x: c.x, y: 0, z: c.z, sid: -1, bid: -1, dungeonId: -1 });
  }
  return { mesh: mb.finish(), data };
}

const ORE: Record<string, number> = { fer: 0xb06a40, charbon: 0x1e1c1a, or: 0xf0c040, gemme: 0x70e0ff };
/** Filons encore en place (maillage à part, refait quand l'un d'eux est épuisé). */
export function buildVeins(C: CaveLayout, gone: (id: string) => boolean): MeshData {
  const mb = new MeshBuilder(1024);
  mb.sky = 0;
  for (const v of C.veins) {
    if (gone(v.id)) continue;
    const s = hash2i(C.id, Math.round(v.x * 10), Math.round(v.z * 10));
    mb.blob(v.x, 0.9, v.z, 0.75, 0.85, 0.75, 0x6a645a, M.ROCK, 6, 3);
    for (let k = 0; k < 5; k++) {
      const a = ((s >>> (k * 3)) & 7) * 0.8, y = 0.45 + ((s >>> (k * 2 + 5)) & 3) * 0.32;
      mb.box(v.x + Math.cos(a) * 0.62, y, v.z + Math.sin(a) * 0.62, 0.22, 0.2, 0.22, a, ORE[v.ore ?? 'fer'], v.ore === 'gemme' || v.ore === 'or' ? M.GLOW : M.METAL);
    }
  }
  return mb.finish();
}
