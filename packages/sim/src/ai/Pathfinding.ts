import { MinHeap } from '@ascii-fort/core/Heap';
import type { ChunkManager } from '@ascii-fort/worldgen/ChunkManager';
import { segDist } from '@ascii-fort/core/math';

// Navigation locale : grille de 1 m autour d'une zone active (village, camp), construite à partir
// des vraies collisions (murs avec leurs portes, mobilier, troncs), de l'eau et des pentes.
// A* 8 directions puis lissage par ligne de vue. Jamais de A* sur le monde entier.

const AGENT_R = 0.3;

export class NavGrid {
  readonly blocked: Uint8Array;
  /** composante connexe de chaque case libre (−1 si bloquée) et composante principale */
  comp = new Int32Array(0);
  main = -1;
  constructor(readonly x0: number, readonly z0: number, readonly w: number, readonly h: number) {
    this.blocked = new Uint8Array(w * h);
  }

  /** doors : passages à rouvrir (de l'intérieur vers l'extérieur des portes). */
  static build(chunks: ChunkManager<any>, cx: number, cz: number, half: number, doors: [number, number, number, number][] = []): NavGrid {
    const x0 = Math.floor(cx - half), z0 = Math.floor(cz - half), n = Math.ceil(half * 2);
    const g = new NavGrid(x0, z0, n, n);
    const { circles: allC, segs: allS } = chunks.collidersInRect(x0 - 8, z0 - 8, x0 + n + 8, z0 + n + 8);
    const B = g.blocked;
    // relief : eau et pentes
    const H = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = x0 + i + 0.5, z = z0 + j + 0.5;
      const hh = chunks.heightAt(x, z);
      H[j * n + i] = hh;
      const w = chunks.waterAt(x, z);
      if (!Number.isNaN(w) && w > hh + 0.4) B[j * n + i] = 1;
    }
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      if (Math.abs(H[k + 1] - H[k - 1]) > 1.6 || Math.abs(H[k + n] - H[k - n]) > 1.6) B[k] = 1;
    }
    // obstacles
    const mark = (ix0: number, iz0: number, ix1: number, iz1: number, test: (x: number, z: number) => boolean) => {
      for (let j = Math.max(0, iz0); j <= Math.min(n - 1, iz1); j++) for (let i = Math.max(0, ix0); i <= Math.min(n - 1, ix1); i++) {
        if (test(x0 + i + 0.5, z0 + j + 0.5)) B[j * n + i] = 1;
      }
    };
    for (const c of allC) {
      const r = c.r + AGENT_R * 0.5;
      mark(Math.floor(c.x - r - x0), Math.floor(c.z - r - z0), Math.ceil(c.x + r - x0), Math.ceil(c.z + r - z0), (x, z) => Math.hypot(x - c.x, z - c.z) < r);
    }
    for (const s of allS) {
      if (s.top - s.bottom < 0.9) continue; // muret franchissable
      const r = s.r + AGENT_R;
      mark(Math.floor(Math.min(s.ax, s.bx) - r - x0), Math.floor(Math.min(s.az, s.bz) - r - z0), Math.ceil(Math.max(s.ax, s.bx) + r - x0), Math.ceil(Math.max(s.az, s.bz) + r - z0),
        (x, z) => segDist(x, z, s.ax, s.az, s.bx, s.bz).d < r);
    }
    // les portes connues sont rouvertes (la grille de 1 m les boucherait)
    for (const [ax, az, bx, bz] of doors) {
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 2);
      for (let k = 0; k <= steps; k++) {
        const kk = g.idx(ax + (bx - ax) * k / steps, az + (bz - az) * k / steps);
        if (kk >= 0) B[kk] = 0;
      }
    }
    g.label();
    return g;
  }

  /** Étiquetage des zones connexes (4-voisinage) ; la plus grande est la zone principale. */
  private label(): void {
    const n = this.w * this.h, comp = new Int32Array(n).fill(-1), sizes: number[] = [];
    const q = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (this.blocked[s] || comp[s] >= 0) continue;
      const id = sizes.length; let head = 0, tail = 0, size = 0;
      q[tail++] = s; comp[s] = id;
      while (head < tail) {
        const c = q[head++]; size++;
        const ci = c % this.w, cj = (c / this.w) | 0;
        if (ci > 0 && !this.blocked[c - 1] && comp[c - 1] < 0) { comp[c - 1] = id; q[tail++] = c - 1; }
        if (ci < this.w - 1 && !this.blocked[c + 1] && comp[c + 1] < 0) { comp[c + 1] = id; q[tail++] = c + 1; }
        if (cj > 0 && !this.blocked[c - this.w] && comp[c - this.w] < 0) { comp[c - this.w] = id; q[tail++] = c - this.w; }
        if (cj < this.h - 1 && !this.blocked[c + this.w] && comp[c + this.w] < 0) { comp[c + this.w] = id; q[tail++] = c + this.w; }
      }
      sizes.push(size);
    }
    this.comp = comp;
    this.main = sizes.length ? sizes.indexOf(Math.max(...sizes)) : -1;
  }

  idx(x: number, z: number): number {
    const i = Math.floor(x - this.x0), j = Math.floor(z - this.z0);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }
  free(x: number, z: number): boolean { const k = this.idx(x, z); return k >= 0 && !this.blocked[k]; }
  inside(x: number, z: number): boolean { return this.idx(x, z) >= 0; }

  /** Case libre la plus proche (spirale). */
  nearestFree(x: number, z: number, maxR = 8): number {
    const k = this.idx(x, z);
    const ok = (c: number) => !this.blocked[c] && (this.main < 0 || this.comp[c] === this.main);
    if (k >= 0 && ok(k)) return k;
    const ci = Math.floor(x - this.x0), cj = Math.floor(z - this.z0);
    for (let r = 1; r <= maxR; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      if (ok(j * this.w + i)) return j * this.w + i;
    }
    return -1;
  }

  private los(a: number, b: number): boolean {
    let x0 = a % this.w, y0 = (a / this.w) | 0;
    const x1 = b % this.w, y1 = (b / this.w) | 0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      if (this.blocked[y0 * this.w + x0]) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  /** Chemin lissé (points en mètres) ou null. maxNodes borne le coût. */
  findPath(sx: number, sz: number, tx: number, tz: number, maxNodes = 120000): { x: number; z: number }[] | null {
    const s = this.nearestFree(sx, sz), t = this.nearestFree(tx, tz);
    if (s < 0 || t < 0) return null;
    const W = this.w, n = this.w * this.h;
    const g = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    const heap = new MinHeap(1024);
    const ti = t % W, tj = (t / W) | 0;
    g[s] = 0; heap.push(0, s);
    let expanded = 0;
    while (heap.size) {
      const c = heap.pop();
      if (c === t) break;
      if (closed[c]) continue;
      closed[c] = 1;
      if (++expanded > maxNodes) return null;
      const ci = c % W, cj = (c / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= W || j >= this.h) continue;
        const k = j * W + i;
        if (this.blocked[k] || closed[k]) continue;
        if (di && dj && (this.blocked[cj * W + i] || this.blocked[j * W + ci])) continue; // pas de coupe d'angle
        const ng = g[c] + (di && dj ? 1.414 : 1);
        if (ng < g[k]) { g[k] = ng; prev[k] = c; heap.push(ng + Math.hypot(i - ti, j - tj), k); }
      }
    }
    if (prev[t] < 0 && s !== t) return null;
    const cells: number[] = [];
    for (let c = t; c >= 0; c = prev[c]) { cells.push(c); if (c === s) break; }
    cells.reverse();
    // lissage : on saute les points intermédiaires visibles
    const out: number[] = [cells[0]];
    let a = 0;
    while (a < cells.length - 1) {
      let b = cells.length - 1;
      while (b > a + 1 && !this.los(cells[a], cells[b])) b--;
      out.push(cells[b]); a = b;
    }
    return out.map((c) => ({ x: this.x0 + (c % W) + 0.5, z: this.z0 + ((c / W) | 0) + 0.5 }));
  }
}
