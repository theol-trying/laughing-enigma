import { MinHeap } from '@ascii-fort/core/Heap';
import { MACRO, CELL, NEIGH8 } from '../constants';
import type { MacroWorld } from '../MacroWorld';
import { B } from '../terrain/Biomes';
import { W_LAKE, W_RIVER, W_SEA } from '../terrain/Hydrology';
import type { Road, RoadPoint, Bridge, Settlement } from './types';

const N = MACRO;

/**
 * A* sur la grille macro. Les routes préfèrent les terrains praticables, les vallées et les
 * faibles pentes, évitent l'eau profonde et réutilisent les routes existantes (elles fusionnent).
 */
export function findPath(m: MacroWorld, from: number, to: number, roadCells: Uint8Array): number[] | null {
  const g = new Float32Array(N * N).fill(Infinity);
  const prev = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  const heap = new MinHeap(4096);
  const ti = to % N, tj = (to / N) | 0;
  g[from] = 0;
  heap.push(0, from);
  while (heap.size) {
    const c = heap.pop();
    if (c === to) break;
    if (closed[c]) continue;
    closed[c] = 1;
    const ci = c % N, cj = (c / N) | 0;
    for (const [dx, dz] of NEIGH8) {
      const ni = ci + dx, nj = cj + dz;
      if (ni < 1 || nj < 1 || ni >= N - 1 || nj >= N - 1) continue;
      const n = nj * N + ni;
      if (closed[n]) continue;
      const w = m.hydro.water[n];
      if (w === W_SEA || w === W_LAKE) continue;
      const b = m.biome[n];
      const dh = Math.abs(m.elev[n] - m.elev[c]) / CELL;
      let cost = (dx && dz ? 1.414 : 1) * (1 + dh * 14 + dh * dh * 60);
      if (b === B.MOUNTAIN) cost *= 2.2; else if (b === B.SNOW) cost *= 5; else if (b === B.SWAMP) cost *= 2.5; else if (b === B.FOREST || b === B.TAIGA) cost *= 1.25;
      if (w === W_RIVER) cost += m.hydro.flow[n] > 1500 ? 14 : 6;     // un pont coûte cher
      if (roadCells[n]) cost *= 0.45;
      const ng = g[c] + cost;
      if (ng < g[n]) {
        g[n] = ng; prev[n] = c;
        heap.push(ng + Math.hypot(ni - ti, nj - tj) * 0.45, n);
      }
    }
  }
  if (prev[to] < 0 && to !== from) return null;
  const path: number[] = [];
  for (let c = to; c >= 0; c = prev[c]) { path.push(c); if (c === from) break; }
  return path.reverse();
}

/** Polyligne lissée + profil en long adouci (la route ne colle pas au moindre relief). */
export function roadPolyline(m: MacroWorld, cells: number[]): RoadPoint[] {
  let pts = cells.map((c) => ({ x: ((c % N) + 0.5) * CELL, z: (((c / N) | 0) + 0.5) * CELL, y: 0 }));
  for (let it = 0; it < 3; it++) {
    if (pts.length < 3) break;
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25, y: 0 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75, y: 0 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  const raw = pts.map((p) => Math.max(0.6, m.elevAt(p.x, p.z)));
  for (let i = 0; i < pts.length; i++) {
    let s = 0, n = 0;
    for (let k = -4; k <= 4; k++) { const j = i + k; if (j >= 0 && j < pts.length) { s += raw[j]; n++; } }
    pts[i].y = s / n;
  }
  return pts;
}

/** Ponts : là où la route croise une rivière. */
export function findBridges(m: MacroWorld, road: Road): Bridge[] {
  const out: Bridge[] = [];
  const pts = road.points;
  let lastRiver = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const r = m.riverIndex.nearest(p.x, p.z);
    if (!r || r.d > r.width / 2 + 1) { lastRiver = -1; continue; }
    if (r.river === lastRiver) continue;
    lastRiver = r.river;
    // point le plus proche de l'axe de la rivière sur les voisins
    let best = i, bd = r.d;
    for (let k = i + 1; k < Math.min(pts.length, i + 6); k++) {
      const rk = m.riverIndex.nearest(pts[k].x, pts[k].z);
      if (rk && rk.river === r.river && rk.d < bd) { bd = rk.d; best = k; }
    }
    const a = pts[Math.max(0, best - 2)], b = pts[Math.min(pts.length - 1, best + 2)];
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const c = pts[best];
    out.push({ x: c.x, z: c.z, y: r.level + 1.6, yaw, length: r.width + 8, width: road.width + 1, roadId: road.id });
  }
  return out;
}

/** Réseau : arbre couvrant minimal + quelques boucles, routes principales tracées d'abord. */
export function buildRoadNetwork(m: MacroWorld, settlements: Settlement[]): Road[] {
  const nodes = settlements.filter((s) => !s.abandoned && s.type !== 'camp');
  const tier = (s: Settlement) => (s.type === 'capitale' ? 4 : s.type === 'ville' ? 3 : s.type === 'bourg' || s.type === 'port' ? 2 : s.type === 'hameau' || s.type === 'monastère' || s.type === 'château' ? 0 : 1);
  const edges: [number, number, number][] = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    edges.push([Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z), i, j]);
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const chosen: [number, number][] = [];
  for (const [, i, j] of edges) {
    const a = find(i), b = find(j);
    if (a !== b) { parent[a] = b; chosen.push([i, j]); }
  }
  // boucles : chaque ville/capitale/bourg rejoint aussi son 2e voisin important s'il est proche
  for (let i = 0; i < nodes.length; i++) {
    if (tier(nodes[i]) < 2) continue;
    const near = nodes.map((n, j) => [Math.hypot(n.x - nodes[i].x, n.z - nodes[i].z), j] as [number, number])
      .filter(([, j]) => j !== i && tier(nodes[j]) >= 1).sort((a, b) => a[0] - b[0]);
    for (const [d, j] of near.slice(0, 2)) {
      if (d < 2600 && !chosen.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) chosen.push([i, j]);
    }
  }
  chosen.sort((e1, e2) => (tier(nodes[e2[0]]) + tier(nodes[e2[1]])) - (tier(nodes[e1[0]]) + tier(nodes[e1[1]])) || e1[0] - e2[0] || e1[1] - e2[1]);
  const roadCells = new Uint8Array(N * N);
  const roads: Road[] = [];
  for (const [i, j] of chosen) {
    const a = nodes[i], b = nodes[j];
    const cells = findPath(m, a.cj * N + a.ci, b.cj * N + b.ci, roadCells);
    if (!cells || cells.length < 2) continue;
    for (const c of cells) roadCells[c] = 1;
    const kind: 1 | 2 = tier(a) >= 1 && tier(b) >= 1 ? 2 : 1;
    const road: Road = { id: roads.length, a: a.id, b: b.id, kind, cells, points: roadPolyline(m, cells), width: kind === 2 ? 5 : 3, bridges: [], trade: (tier(a) + tier(b)) / 8 };
    road.bridges = findBridges(m, road);
    roads.push(road);
  }
  return roads;
}

/** Index spatial des segments de route (par cellule macro). */
export class RoadIndex {
  private buckets = new Map<number, number[]>();
  constructor(readonly roads: Road[]) {
    for (const r of roads) for (let s = 0; s < r.points.length - 1; s++) {
      const a = r.points[s], b = r.points[s + 1], pad = r.width + 8;
      const i0 = Math.floor((Math.min(a.x, b.x) - pad) / CELL), i1 = Math.floor((Math.max(a.x, b.x) + pad) / CELL);
      const j0 = Math.floor((Math.min(a.z, b.z) - pad) / CELL), j1 = Math.floor((Math.max(a.z, b.z) + pad) / CELL);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const k = j * N + i;
        let l = this.buckets.get(k);
        if (!l) this.buckets.set(k, (l = []));
        l.push(r.id, s);
      }
    }
  }

  nearest(x: number, z: number): { d: number; y: number; road: Road; t: number; seg: number } | null {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return null;
    const l = this.buckets.get(j * N + i);
    if (!l) return null;
    let best: { d: number; y: number; road: Road; t: number; seg: number } | null = null;
    for (let k = 0; k < l.length; k += 2) {
      const r = this.roads[l[k]], a = r.points[l[k + 1]], b = r.points[l[k + 1] + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t) - r.width / 2;
      if (!best || d < best.d) best = { d, y: a.y + (b.y - a.y) * t, road: r, t, seg: l[k + 1] };
    }
    return best;
  }
}
