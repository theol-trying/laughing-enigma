import { CHUNK, CHUNKS } from './constants';
import { ChunkData, buildChunk, type ChunkExtras, type CircleCollider, type SegCollider, type Platform } from './Chunk';
import type { TerrainSampler } from './terrain/TerrainSampler';
import type { MeshData } from '../rendering/Mesh';

/** Interface vers le GPU (absente dans les tests). */
export interface GpuBridge<T> { upload(m: MeshData): T; release(t: T): void }

interface Loaded<T> { data: ChunkData; gpu: T | null }

/** Chargement des chunks autour du joueur, nearest-first, avec budget de temps par image. */
export class ChunkManager<T = unknown> {
  readonly chunks = new Map<number, Loaded<T>>();
  radius = 6;
  extras?: ChunkExtras;
  lastLoadMs = 0;

  constructor(private sampler: TerrainSampler, private gpu: GpuBridge<T> | null) {}

  key(cx: number, cz: number): number { return cz * CHUNKS + cx; }
  get clipRadius(): number { return this.radius * CHUNK - 24; }

  private load(cx: number, cz: number): Loaded<T> {
    const data = buildChunk(this.sampler, cx, cz, this.extras);
    const l: Loaded<T> = { data, gpu: this.gpu && data.mesh ? this.gpu.upload(data.mesh) : null };
    data.mesh = this.gpu ? null : data.mesh; // libère la mémoire CPU une fois envoyé au GPU
    this.chunks.set(this.key(cx, cz), l);
    this.lastLoadMs = data.buildMs;
    return l;
  }

  /** Charge/décharge autour de (x, z). budgetMs < 0 : tout charger immédiatement. */
  update(x: number, z: number, budgetMs = 4): number {
    const pcx = Math.floor(x / CHUNK), pcz = Math.floor(z / CHUNK), R = this.radius;
    const todo: [number, number, number][] = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const cx = pcx + dx, cz = pcz + dz;
      if (cx < 0 || cz < 0 || cx >= CHUNKS || cz >= CHUNKS) continue;
      const d = Math.hypot(dx, dz);
      if (d > R + 0.5 || this.chunks.has(this.key(cx, cz))) continue;
      todo.push([d, cx, cz]);
    }
    todo.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now();
    let n = 0;
    for (const [, cx, cz] of todo) {
      if (budgetMs >= 0 && n > 0 && performance.now() - t0 > budgetMs) break;
      this.load(cx, cz); n++;
    }
    for (const [k, l] of this.chunks) {
      if (Math.hypot(l.data.cx - pcx, l.data.cz - pcz) > R + 2) {
        if (l.gpu && this.gpu) this.gpu.release(l.gpu);
        this.chunks.delete(k);
      }
    }
    return todo.length - n;
  }

  chunkAt(x: number, z: number): ChunkData | null {
    const l = this.chunks.get(this.key(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    return l ? l.data : null;
  }

  heightAt(x: number, z: number): number {
    const c = this.chunkAt(x, z);
    return c ? c.heightAt(x, z) : this.sampler.height(x, z);
  }

  waterAt(x: number, z: number): number {
    const c = this.chunkAt(x, z);
    return c ? c.waterAt(x, z) : this.sampler.sample(x, z).water;
  }

  /** Collisions proches (chunks voisins inclus). */
  collidersNear(x: number, z: number, circles: CircleCollider[], segs: SegCollider[], plats: Platform[]): void {
    circles.length = 0; segs.length = 0; plats.length = 0;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const l = this.chunks.get(this.key(cx + dx, cz + dz));
      if (!l) continue;
      for (const c of l.data.circles) if (Math.abs(c.x - x) < 8 && Math.abs(c.z - z) < 8) circles.push(c);
      for (const s of l.data.segs) if (Math.min(s.ax, s.bx) - 8 < x && Math.max(s.ax, s.bx) + 8 > x && Math.min(s.az, s.bz) - 8 < z && Math.max(s.az, s.bz) + 8 > z) segs.push(s);
      for (const p of l.data.platforms) if (Math.abs(p.cx - x) < p.hw + p.hd + 4 && Math.abs(p.cz - z) < p.hw + p.hd + 4) plats.push(p);
    }
  }

  gpuMeshes(): T[] {
    const out: T[] = [];
    for (const l of this.chunks.values()) if (l.gpu) out.push(l.gpu);
    return out;
  }

  clear(): void {
    for (const l of this.chunks.values()) if (l.gpu && this.gpu) this.gpu.release(l.gpu);
    this.chunks.clear();
  }
}
