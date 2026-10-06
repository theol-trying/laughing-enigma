import { WorldSeed } from '../core/Seed';
import { Noise2D } from '../core/Noise';
import { MinHeap } from '../core/Heap';
import { clamp, smoothstep } from '../core/math';
import { MACRO, CELL, NEIGH8, NEIGH4 } from './constants';
import { computeHydrology, RiverIndex, W_NONE, W_SEA, W_LAKE, W_RIVER, type HydroResult } from './terrain/Hydrology';
import { B, BIOMES } from './terrain/Biomes';
import { NameGen } from './civilization/Names';

// Le monde « macro » : tout ce qui est global et doit être connu avant de générer un chunk.

const N = MACRO;

export interface Region {
  id: number;
  name: string;
  ci: number; cj: number;      // cellule centrale
  biome: number;               // biome dominant
  cells: number;
  factionId: number;           // affecté par la civilisation
}

export class MacroWorld {
  readonly elev = new Float32Array(N * N);
  readonly temp = new Float32Array(N * N);
  readonly moist = new Float32Array(N * N);
  readonly slope = new Float32Array(N * N);
  readonly biome = new Uint8Array(N * N);
  readonly region = new Uint8Array(N * N).fill(255);
  readonly waterDist = new Float32Array(N * N);
  hydro!: HydroResult;
  riverIndex!: RiverIndex;
  regions: Region[] = [];
  worldName = '';
  readonly names: NameGen;

  private constructor(readonly seed: WorldSeed) {
    this.names = new NameGen(seed.stream('names'));
  }

  static generate(seed: WorldSeed): MacroWorld {
    const w = new MacroWorld(seed);
    w.genElevation();
    w.hydro = computeHydrology(w.elev, seed.stream('hydrology'));
    w.computeSlope();
    w.genClimate();
    w.genBiomes();
    w.genRegions();
    w.nameThings();
    w.riverIndex = new RiverIndex(w.hydro.rivers);
    return w;
  }

  idx(i: number, j: number): number { return j * N + i; }
  inside(i: number, j: number): boolean { return i >= 0 && j >= 0 && i < N && j < N; }
  cellOf(x: number, z: number): number {
    const i = clamp(Math.floor(x / CELL), 0, N - 1), j = clamp(Math.floor(z / CELL), 0, N - 1);
    return j * N + i;
  }
  water(c: number): number { return this.hydro.water[c]; }
  isLand(c: number): boolean { const w = this.hydro.water[c]; return w !== W_SEA && w !== W_LAKE; }

  private genElevation() {
    const n = new Noise2D(this.seed.stream('terrain'));
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N, v = (j + 0.5) / N;
      const wu = u + n.fbm(u * 2.5 + 11, v * 2.5 + 3, 3) * 0.12 - 0.5;
      const wv = v + n.fbm(u * 2.5 - 7, v * 2.5 + 19, 3) * 0.12 - 0.5;
      const d = Math.sqrt(wu * wu + wv * wv) * 2;
      const cont = 0.6 + n.fbm(u * 2.0, v * 2.0, 4) * 0.55 - Math.pow(d, 2.2) * 1.05;
      let h: number;
      if (cont > 0) {
        const landT = smoothstep(0, 0.3, cont);
        const hills = n.fbm(u * 10 + 5, v * 10 - 5, 4);
        const mMask = smoothstep(0.08, 0.42, n.fbm(u * 1.7 + 40, v * 1.7 - 20, 3));
        const ridge = n.ridged(u * 6 + 3, v * 6 + 7, 5);
        h = 3 + landT * 55 + hills * 20 * landT + mMask * Math.pow(ridge, 1.6) * 600 * landT;
      } else h = cont * 160 - 1;
      this.elev[j * N + i] = h;
    }
  }

  private computeSlope() {
    const e = this.elev;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const l = e[this.idx(Math.max(0, i - 1), j)], r = e[this.idx(Math.min(N - 1, i + 1), j)];
      const u = e[this.idx(i, Math.max(0, j - 1))], d = e[this.idx(i, Math.min(N - 1, j + 1))];
      this.slope[j * N + i] = Math.hypot(r - l, d - u) / (2 * CELL);
    }
  }

  private genClimate() {
    const n = new Noise2D(this.seed.stream('climate'));
    const water = this.hydro.water;
    // distance à l'eau (BFS, en cellules)
    const wd = this.waterDist.fill(99);
    const q: number[] = [];
    for (let c = 0; c < N * N; c++) if (water[c] !== W_NONE) { wd[c] = 0; q.push(c); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], ci = c % N, cj = (c / N) | 0;
      if (wd[c] >= 12) continue;
      for (const [dx, dz] of NEIGH4) {
        const ni = ci + dx, nj = cj + dz;
        if (!this.inside(ni, nj)) continue;
        const k = nj * N + ni;
        if (wd[k] > wd[c] + 1) { wd[k] = wd[c] + 1; q.push(k); }
      }
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = j * N + i, u = i / N, v = j / N, h = Math.max(0, this.elev[c]);
      this.temp[c] = clamp(0.32 + 0.55 * v + n.fbm(u * 3, v * 3, 3) * 0.14 - h / 650, 0, 1);
      const prox = Math.max(0, 1 - wd[c] / 10) * 0.22;
      this.moist[c] = clamp(0.5 + n.fbm(u * 3.5 + 9, v * 3.5 - 4, 4) * 0.42 + prox + Math.min(0.1, h / 3000), 0, 1);
    }
  }

  private genBiomes() {
    const { water } = this.hydro;
    for (let c = 0; c < N * N; c++) {
      const e = this.elev[c], t = this.temp[c], m = this.moist[c], s = this.slope[c];
      let b: number;
      if (water[c] === W_SEA) b = B.OCEAN;
      else if (water[c] === W_LAKE) b = B.LAKE;
      else if (e < 4.5 && this.waterDist[c] <= 1 && this.nearSea(c)) b = B.BEACH;
      else if (e > 440 || (t < 0.16 && e > 160)) b = B.SNOW;
      else if (e > 250 || s > 0.42) b = B.MOUNTAIN;
      else if (m > 0.74 && e < 70 && s < 0.09) b = B.SWAMP;
      else if (m > 0.55) b = t < 0.4 ? B.TAIGA : B.FOREST;
      else if (m < 0.33 && e > 60) b = B.HEATH;
      else b = B.PLAINS;
      this.biome[c] = b;
    }
  }

  private nearSea(c: number): boolean {
    const ci = c % N, cj = (c / N) | 0;
    for (const [dx, dz] of NEIGH8) {
      const ni = ci + dx * 2, nj = cj + dz * 2;
      if (this.inside(ni, nj) && this.hydro.water[nj * N + ni] === W_SEA) return true;
    }
    return false;
  }

  /** Régions : graines espacées, expansion par Dijkstra (les reliefs et rivières font frontière). */
  private genRegions() {
    const rng = this.seed.stream('regions');
    const land: number[] = [];
    for (let c = 0; c < N * N; c++) if (this.isLand(c)) land.push(c);
    rng.shuffle(land);
    const seeds: number[] = [];
    for (const c of land) {
      if (seeds.length >= 14) break;
      const ci = c % N, cj = (c / N) | 0;
      if (seeds.every((s) => Math.hypot((s % N) - ci, ((s / N) | 0) - cj) > 38)) seeds.push(c);
    }
    const cost = new Float64Array(N * N).fill(Infinity);
    const heap = new MinHeap(8192);
    seeds.forEach((s, k) => { cost[s] = 0; this.region[s] = k; heap.push(0, s); });
    while (heap.size) {
      const p = heap.peekPriority(); const c = heap.pop();
      if (p > cost[c]) continue;
      const ci = c % N, cj = (c / N) | 0;
      for (const [dx, dz] of NEIGH4) {
        const ni = ci + dx, nj = cj + dz;
        if (!this.inside(ni, nj)) continue;
        const n = nj * N + ni;
        if (!this.isLand(n)) continue;
        const step = 1 + Math.abs(this.elev[n] - this.elev[c]) / 12 + (this.hydro.water[n] === W_RIVER ? 4 : 0);
        if (p + step < cost[n]) { cost[n] = p + step; this.region[n] = this.region[c]; heap.push(p + step, n); }
      }
    }
    this.regions = seeds.map((s, k) => {
      const counts = new Array(BIOMES.length).fill(0);
      let cells = 0;
      for (let c = 0; c < N * N; c++) if (this.region[c] === k) { counts[this.biome[c]]++; cells++; }
      let biome: number = B.PLAINS, best = -1;
      counts.forEach((v, b) => { if (v > best) { best = v; biome = b; } });
      return { id: k, name: '', ci: s % N, cj: (s / N) | 0, biome, cells, factionId: -1 };
    });
  }

  private nameThings() {
    const rn = this.names.fork('rivers');
    const byFlow = [...this.hydro.rivers].sort((a, b) => b.maxFlow - a.maxFlow || a.id - b.id);
    for (const r of byFlow) r.name = rn.river();
    const gn = this.names.fork('regions');
    for (const reg of this.regions) {
      const b = reg.biome;
      const kind = b === B.MOUNTAIN || b === B.SNOW ? 'hautes' : b === B.FOREST || b === B.TAIGA ? 'forêt'
        : b === B.SWAMP ? 'marais' : this.hydro.water[this.idx(reg.ci, reg.cj)] === W_RIVER || this.waterDist[this.idx(reg.ci, reg.cj)] < 3 ? 'val'
        : reg.id % 2 ? 'comté' : 'marches';
      reg.name = gn.region(kind);
    }
    this.worldName = `Terres de ${this.names.fork('world').place()}`;
  }

  /** Altitude interpolée (Catmull-Rom bicubique) — base continue du relief détaillé. */
  elevAt(x: number, z: number): number {
    const fx = x / CELL - 0.5, fz = z / CELL - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const e = this.elev;
    const row = (jj: number) => {
      const r = clamp(jj, 0, N - 1) * N;
      const p0 = e[r + clamp(i - 1, 0, N - 1)], p1 = e[r + clamp(i, 0, N - 1)], p2 = e[r + clamp(i + 1, 0, N - 1)], p3 = e[r + clamp(i + 2, 0, N - 1)];
      return cr(p0, p1, p2, p3, tx);
    };
    return cr(row(j - 1), row(j), row(j + 1), row(j + 2), tz);
  }

  /** Valeur bilinéaire d'un champ macro. */
  sample(field: Float32Array, x: number, z: number): number {
    const fx = clamp(x / CELL - 0.5, 0, N - 1.001), fz = clamp(z / CELL - 0.5, 0, N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = field[j * N + i], b = field[j * N + i + 1], c = field[(j + 1) * N + i], d = field[(j + 1) * N + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  dominantClimate(): string {
    let t = 0, m = 0, n = 0;
    for (let c = 0; c < N * N; c++) if (this.isLand(c)) { t += this.temp[c]; m += this.moist[c]; n++; }
    t /= n; m /= n;
    const ts = t < 0.38 ? 'froid' : t < 0.6 ? 'tempéré' : 'doux';
    const ms = m < 0.42 ? 'sec' : m < 0.58 ? 'modéré' : 'humide';
    return `${ts} et ${ms}`;
  }

  /** Carte ASCII (débogage / aperçu) — 1 caractère par cellule macro échantillonnée. */
  asciiMap(step = 4): string {
    const sym = ['≈', '~', '.', '"', '♣', '^', '%', ',', '▲', '*'];
    let out = '';
    for (let j = 0; j < N; j += step * 2) {
      for (let i = 0; i < N; i += step) {
        const c = j * N + i;
        out += this.hydro.water[c] === W_RIVER ? '~' : sym[this.biome[c]];
      }
      out += '\n';
    }
    return out;
  }
}

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
