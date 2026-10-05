import { MinHeap } from '../../core/Heap';
import { MACRO, CELL, NEIGH8 } from '../constants';
import { Noise2D } from '../../core/Noise';
import type { RNG } from '../../core/RNG';

// Hydrologie sur la grille macro :
// 1. priority-flood (Barnes 2014) depuis la mer → surface comblée + arbre d'écoulement
// 2. accumulation du débit
// 3. lacs (dépressions comblées) ; rivières (débit > seuil) tracées de la source à l'embouchure
// 4. creusement des lits et des vallées
// 5. polylignes lissées avec méandres + index spatial pour les requêtes des chunks

export const W_NONE = 0, W_SEA = 1, W_LAKE = 2, W_RIVER = 3;

export interface RiverPoint { x: number; z: number; level: number; width: number }
export interface River {
  id: number;
  name: string;
  cells: number[];
  points: RiverPoint[];
  mouth: 'mer' | 'lac' | 'rivière';
  joins: number;      // id de la rivière rejointe, -1 sinon
  maxFlow: number;
}

export interface HydroResult {
  filled: Float32Array;
  flowTo: Int32Array;
  flow: Float32Array;
  water: Uint8Array;
  lakeLevel: Float32Array;
  lakeId: Int32Array;
  rivers: River[];
  riverCell: Int32Array; // id de rivière par cellule, -1
}

const N = MACRO;
export const RIVER_MIN_FLOW = 55;

export function riverWidth(flow: number): number { return Math.min(26, 3 + Math.sqrt(flow) * 0.55); }
export function riverDepth(width: number): number { return 0.9 + width * 0.07; }

export function computeHydrology(elev: Float32Array, rng: RNG): HydroResult {
  const size = N * N;
  const filled = new Float32Array(size);
  const flowTo = new Int32Array(size).fill(-1);
  const order = new Int32Array(size);
  const done = new Uint8Array(size);
  const heap = new MinHeap(size);
  const water = new Uint8Array(size);

  // mer : cellules sous le niveau 0 reliées au bord de la carte
  const q: number[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if ((i === 0 || j === 0 || i === N - 1 || j === N - 1) && elev[j * N + i] < 0) { water[j * N + i] = W_SEA; q.push(j * N + i); }
  }
  for (let h = 0; h < q.length; h++) {
    const c = q[h], ci = c % N, cj = (c / N) | 0;
    for (const [dx, dz] of NEIGH8) {
      const ni = ci + dx, nj = cj + dz;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const n = nj * N + ni;
      if (!water[n] && elev[n] < 0) { water[n] = W_SEA; q.push(n); }
    }
  }
  // graines du remplissage : mer et bords
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = j * N + i;
    if (water[c] === W_SEA || i === 0 || j === 0 || i === N - 1 || j === N - 1) {
      filled[c] = water[c] === W_SEA ? Math.min(elev[c], 0) : elev[c];
      done[c] = 1;
      heap.push(filled[c], c);
    }
  }
  let k = 0;
  const EPS = 0.02;
  while (heap.size) {
    const c = heap.pop();
    order[k++] = c;
    const ci = c % N, cj = (c / N) | 0;
    for (const [dx, dz] of NEIGH8) {
      const ni = ci + dx, nj = cj + dz;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const n = nj * N + ni;
      if (done[n]) continue;
      done[n] = 1;
      filled[n] = Math.max(elev[n], filled[c] + EPS);
      flowTo[n] = c;
      heap.push(filled[n], n);
    }
  }

  // accumulation : de l'amont vers l'aval (ordre inverse du remplissage)
  const flow = new Float32Array(size).fill(1);
  for (let i = size - 1; i >= 0; i--) {
    const c = order[i], t = flowTo[c];
    if (t >= 0 && water[c] !== W_SEA) flow[t] += flow[c];
  }

  // lacs : seules les dépressions profondes et étendues deviennent des lacs (budget global) ;
  // les autres sont comblées (cuvettes alluviales → plaines)
  const lakeLevel = new Float32Array(size).fill(NaN);
  const lakeId = new Int32Array(size).fill(-1);
  const comp = new Int32Array(size).fill(-1);
  const comps: { members: number[]; depth: number; level: number }[] = [];
  let landCells = 0;
  for (let c = 0; c < size; c++) if (water[c] !== W_SEA) landCells++;
  for (let c = 0; c < size; c++) {
    if (water[c] || comp[c] >= 0 || filled[c] - elev[c] < 0.5) continue;
    const stack = [c], members: number[] = [];
    comp[c] = comps.length;
    let depth = 0, level = 0;
    while (stack.length) {
      const m = stack.pop()!;
      members.push(m); depth = Math.max(depth, filled[m] - elev[m]); level = Math.max(level, filled[m]);
      const mi = m % N, mj = (m / N) | 0;
      for (const [dx, dz] of NEIGH8) {
        const ni = mi + dx, nj = mj + dz;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const n = nj * N + ni;
        if (comp[n] >= 0 || water[n] || filled[n] - elev[n] < 0.5) continue;
        comp[n] = comps.length; stack.push(n);
      }
    }
    comps.push({ members, depth, level });
  }
  const order2 = comps.map((_, i) => i).filter((i) => comps[i].depth >= 4 && comps[i].members.length >= 4)
    .sort((a, b) => comps[b].members.length * comps[b].depth - comps[a].members.length * comps[a].depth || a - b);
  let budget = landCells * 0.025, lakes = 0;
  const keep = new Uint8Array(comps.length);
  for (const i of order2) {
    if (comps[i].members.length > budget) continue;
    budget -= comps[i].members.length; keep[i] = 1;
  }
  comps.forEach((cp, i) => {
    if (keep[i]) {
      for (const m of cp.members) { water[m] = W_LAKE; lakeLevel[m] = cp.level - 0.4; lakeId[m] = lakes; }
      lakes++;
    } else for (const m of cp.members) elev[m] = filled[m] - 0.25;
  });

  // rivières
  const riverCell = new Int32Array(size).fill(-1);
  const isRiver = (c: number) => flow[c] >= RIVER_MIN_FLOW && water[c] === W_NONE;
  const upstreamRiver = new Uint8Array(size);
  for (let c = 0; c < size; c++) if (isRiver(c) && flowTo[c] >= 0) upstreamRiver[flowTo[c]] = 1;
  const sources: number[] = [];
  for (let c = 0; c < size; c++) if (isRiver(c) && !upstreamRiver[c]) sources.push(c);
  // les plus grands débits d'abord : le tronc principal garde son nom jusqu'à la mer
  const sortKey = (c: number) => { let t = c, f = 0; while (t >= 0 && isRiver(t)) { f = flow[t]; t = flowTo[t]; } return f; };
  const keyed = sources.map((c) => [c, sortKey(c), filled[c]] as const);
  keyed.sort((a, b) => b[1] - a[1] || b[2] - a[2] || a[0] - b[0]);

  const rivers: River[] = [];
  for (const [src] of keyed) {
    const cells: number[] = [];
    let c = src, joins = -1;
    let mouth: River['mouth'] = 'mer';
    while (c >= 0) {
      if (riverCell[c] >= 0) { joins = riverCell[c]; mouth = 'rivière'; cells.push(c); break; }
      if (water[c] === W_SEA) { mouth = 'mer'; cells.push(c); break; }
      if (water[c] === W_LAKE) { mouth = 'lac'; cells.push(c); break; }
      cells.push(c);
      riverCell[c] = rivers.length;
      c = flowTo[c];
    }
    if (cells.length < 4) { for (const x of cells) if (riverCell[x] === rivers.length) riverCell[x] = -1; continue; }
    let maxFlow = 0;
    for (const x of cells) maxFlow = Math.max(maxFlow, flow[x]);
    rivers.push({ id: rivers.length, name: '', cells, points: [], mouth, joins, maxFlow });
  }
  for (let c = 0; c < size; c++) if (riverCell[c] >= 0) water[c] = W_RIVER;

  // creusement : lit des rivières puis vallées (distance à la rivière la plus proche)
  const nearLevel = new Float32Array(size).fill(Infinity);
  const dist = new Float32Array(size).fill(Infinity);
  const reach = new Float32Array(size);
  const dheap = new MinHeap(4096);
  for (let c = 0; c < size; c++) {
    if (riverCell[c] < 0) continue;
    const w = riverWidth(flow[c]);
    const level = filled[c] - 0.6;
    elev[c] = Math.min(elev[c], level + 0.4); // fond de vallée ; le lit est creusé au niveau détail
    nearLevel[c] = level; dist[c] = 0; reach[c] = 2 + Math.min(5, Math.sqrt(flow[c]) / 7);
    dheap.push(0, c);
  }
  while (dheap.size) {
    const d0 = dheap.peekPriority();
    const c = dheap.pop();
    if (d0 > dist[c]) continue;
    const ci = c % N, cj = (c / N) | 0;
    for (const [dx, dz] of NEIGH8) {
      const ni = ci + dx, nj = cj + dz;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const n = nj * N + ni;
      const nd = d0 + (dx && dz ? 1.414 : 1);
      if (nd >= dist[n] || nd > reach[c]) continue;
      dist[n] = nd; nearLevel[n] = nearLevel[c]; reach[n] = reach[c];
      dheap.push(nd, n);
    }
  }
  for (let c = 0; c < size; c++) {
    if (dist[c] === Infinity || dist[c] === 0 || water[c] === W_SEA || water[c] === W_LAKE) continue;
    const t = dist[c] / reach[c];
    const valleyFloor = nearLevel[c] + 1.2 + dist[c] * CELL * 0.18 * (0.35 + t);
    if (elev[c] > valleyFloor) elev[c] = elev[c] * (0.25 + 0.75 * t * t) + valleyFloor * (1 - (0.25 + 0.75 * t * t));
  }
  for (let c = 0; c < size; c++) if (water[c] === W_LAKE) elev[c] = Math.min(elev[c], lakeLevel[c] - 1.5);

  // polylignes : centres de cellules + méandres, puis lissage de Chaikin
  const meander = new Noise2D(rng.fork('meander'));
  for (const r of rivers) {
    let pts: RiverPoint[] = r.cells.map((c, idx) => {
      const ci = c % N, cj = (c / N) | 0;
      let x = (ci + 0.5) * CELL, z = (cj + 0.5) * CELL;
      if (idx > 0 && idx < r.cells.length - 1) {
        x += meander.noise(ci * 0.37, cj * 0.37) * CELL * 0.28;
        z += meander.noise(ci * 0.37 + 50, cj * 0.37 + 50) * CELL * 0.28;
      }
      const level = water[c] === W_SEA ? 0 : water[c] === W_LAKE ? lakeLevel[c] : filled[c] - 0.6;
      return { x, z, level, width: riverWidth(flow[c]) };
    });
    // niveau monotone vers l'aval
    for (let i = 1; i < pts.length; i++) pts[i].level = Math.min(pts[i].level, pts[i - 1].level);
    for (let it = 0; it < 2; it++) {
      const out: RiverPoint[] = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const mix = (t: number): RiverPoint => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, level: a.level + (b.level - a.level) * t, width: a.width + (b.width - a.width) * t });
        out.push(mix(0.25), mix(0.75));
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    r.points = pts;
  }

  return { filled, flowTo, flow, water, lakeLevel, lakeId, rivers, riverCell };
}

/** Index spatial des segments de rivière (par cellule macro). */
export class RiverIndex {
  private buckets = new Map<number, number[]>(); // cellule → [riverId, segIdx, …]
  constructor(private rivers: River[]) {
    for (const r of rivers) {
      for (let s = 0; s < r.points.length - 1; s++) {
        const a = r.points[s], b = r.points[s + 1];
        const pad = Math.max(a.width, b.width) / 2 + 14;
        const i0 = Math.floor((Math.min(a.x, b.x) - pad) / CELL), i1 = Math.floor((Math.max(a.x, b.x) + pad) / CELL);
        const j0 = Math.floor((Math.min(a.z, b.z) - pad) / CELL), j1 = Math.floor((Math.max(a.z, b.z) + pad) / CELL);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          const key = j * N + i;
          let l = this.buckets.get(key);
          if (!l) this.buckets.set(key, (l = []));
          l.push(r.id, s);
        }
      }
    }
  }

  /** Segment de rivière le plus proche de (x, z) : distance, niveau d'eau, largeur. */
  nearest(x: number, z: number): { d: number; level: number; width: number; river: number } | null {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return null;
    const l = this.buckets.get(j * N + i);
    if (!l) return null;
    let best: { d: number; level: number; width: number; river: number } | null = null;
    for (let k = 0; k < l.length; k += 2) {
      const r = this.rivers[l[k]], a = r.points[l[k + 1]], b = r.points[l[k + 1] + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
      const width = a.width + (b.width - a.width) * t;
      // rivière la plus « englobante » : distance relative à la demi-largeur
      if (!best || d - width / 2 < best.d - best.width / 2) best = { d, level: a.level + (b.level - a.level) * t, width, river: r.id };
    }
    return best;
  }
}
