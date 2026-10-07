import { MeshBuilder, type MeshData } from '@ascii-fort/ascii-engine/Mesh';
import { M } from '@ascii-fort/ascii-engine/Materials';
import { CHUNK, CHUNK_RES, STEP } from './constants';
import { TerrainSampler, mixColor, shade, type Sample } from './terrain/TerrainSampler';
import { B, BIOMES } from './terrain/Biomes';
import { RNG } from '@ascii-fort/core/RNG';
import { Noise2D } from '@ascii-fort/core/Noise';

// Un chunk = 64 × 64 m généré à la demande, régénérable à l'identique.

export interface CircleCollider { x: number; z: number; r: number; bottom: number; top: number; /** obstacle mobile (créature, joueur) : on ne se tient pas dessus */ dyn?: boolean }
/** Mur : segment épais (bâtiments, palissades) — ajouté par la civilisation. */
export interface SegCollider { ax: number; az: number; bx: number; bz: number; r: number; bottom: number; top: number }
/** Plateforme praticable (sol de bâtiment, pont, escalier). */
export interface Platform { cx: number; cz: number; hw: number; hd: number; yaw: number; top: number }

/** Objet interactif (coffre, lit, enclume, entrée de donjon…). */
export interface Prop { key: string; kind: string; x: number; y: number; z: number; sid: number; bid: number; dungeonId: number }

/** Contenu humain injecté dans un chunk par la civilisation (étape 5). */
export interface ChunkExtras {
  build(cx: number, cz: number, mb: MeshBuilder, chunk: ChunkData): void;
}

const V = CHUNK_RES + 1;

/** Arbre ou rocher que l'on peut abattre / miner ; id stable : « cx:cz:gx:gz » (case de végétation). */
export interface HarvestNode { id: string; kind: 'arbre' | 'rocher'; x: number; y: number; z: number; size: number }

export class ChunkData {
  readonly x0: number; readonly z0: number;
  heights = new Float32Array(V * V);
  water = new Float32Array(V * V);
  circles: CircleCollider[] = [];
  segs: SegCollider[] = [];
  platforms: Platform[] = [];
  props: Prop[] = [];
  nodes: HarvestNode[] = [];
  lights: { x: number; y: number; z: number; radius: number; r: number; g: number; b: number; kind: 'torch' | 'fire' | 'window' | 'candle' }[] = [];
  mesh: MeshData | null = null;
  buildMs = 0;
  constructor(readonly cx: number, readonly cz: number) { this.x0 = cx * CHUNK; this.z0 = cz * CHUNK; }

  /** Hauteur exacte du maillage (interpolation par triangle, même diagonale que le rendu). */
  heightAt(x: number, z: number): number {
    const fx = (x - this.x0) / STEP, fz = (z - this.z0) / STEP;
    const i = Math.min(CHUNK_RES - 1, Math.max(0, Math.floor(fx))), j = Math.min(CHUNK_RES - 1, Math.max(0, Math.floor(fz)));
    const tx = fx - i, tz = fz - j, H = this.heights;
    const a = H[j * V + i], b = H[(j + 1) * V + i], c = H[(j + 1) * V + i + 1], d = H[j * V + i + 1];
    return tz > tx ? a + (c - b) * tx + (b - a) * tz : a + (d - a) * tx + (c - d) * tz;
  }
  waterAt(x: number, z: number): number {
    const i = Math.round((x - this.x0) / STEP), j = Math.round((z - this.z0) / STEP);
    return this.water[Math.min(CHUNK_RES, Math.max(0, j)) * V + Math.min(CHUNK_RES, Math.max(0, i))];
  }
}

let vegNoise: Noise2D | null = null;
let vegNoiseKey = '';

export function buildChunk(sampler: TerrainSampler, cx: number, cz: number, extras?: ChunkExtras, removed?: (id: string) => boolean): ChunkData {
  const t0 = performance.now();
  const ch = new ChunkData(cx, cz);
  const seed = sampler.macro.seed;
  if (vegNoiseKey !== seed.text) { vegNoise = new Noise2D(seed.stream('vegetation', 'clump')); vegNoiseKey = seed.text; }

  // échantillons avec une bordure d'un sommet (normales continues entre chunks)
  const E = V + 2;
  const S: Sample[] = new Array(E * E);
  for (let j = 0; j < E; j++) for (let i = 0; i < E; i++) {
    S[j * E + i] = sampler.sample(ch.x0 + (i - 1) * STEP, ch.z0 + (j - 1) * STEP);
  }
  const mb = new MeshBuilder(V * V * 2);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const s = S[(j + 1) * E + i + 1];
    const hl = S[(j + 1) * E + i].h, hr = S[(j + 1) * E + i + 2].h, hu = S[j * E + i + 1].h, hd = S[(j + 2) * E + i + 1].h;
    const nx = hl - hr, nz = hu - hd, ny = 2 * STEP, l = Math.hypot(nx, ny, nz);
    const slope = Math.hypot(nx, nz) / ny;
    sampler.slopeMaterial(s, slope);
    ch.heights[j * V + i] = s.h;
    ch.water[j * V + i] = s.water;
    mb.vertex(ch.x0 + i * STEP, s.h, ch.z0 + j * STEP, nx / l, ny / l, nz / l, s.color, s.mat);
  }
  for (let j = 0; j < CHUNK_RES; j++) for (let i = 0; i < CHUNK_RES; i++) {
    const a = j * V + i;
    mb.quad(a, a + V, a + V + 1, a + 1);
  }

  // eau
  for (let j = 0; j < CHUNK_RES; j++) for (let i = 0; i < CHUNK_RES; i++) {
    const ids = [j * V + i, (j + 1) * V + i, (j + 1) * V + i + 1, j * V + i + 1];
    let lvl = -Infinity, minH = Infinity;
    for (const k of ids) { if (!Number.isNaN(ch.water[k])) lvl = Math.max(lvl, ch.water[k]); minH = Math.min(minH, ch.heights[k]); }
    if (lvl === -Infinity || minH >= lvl) continue;
    const depth = lvl - minH;
    const col = lvl <= 0.01 ? mixColor(0x3a7aa0, 0x183a62, Math.min(1, depth / 12)) : mixColor(0x4a8aa8, 0x24507a, Math.min(1, depth / 4));
    const vs = ids.map((k) => {
      const w = Number.isNaN(ch.water[k]) ? lvl : ch.water[k];
      const ii = k % V, jj = Math.floor(k / V);
      return mb.vertex(ch.x0 + ii * STEP, w, ch.z0 + jj * STEP, 0, 1, 0, col, M.WATER);
    });
    mb.quad(vs[0], vs[1], vs[2], vs[3]);
  }

  // végétation et rochers (grille 4 m perturbée)
  const rng = seed.stream('vegetation', cx, cz);
  const G = 4;
  for (let gz = 0; gz < CHUNK / G; gz++) for (let gx = 0; gx < CHUNK / G; gx++) {
    const r1 = rng.next(), r2 = rng.next(), r3 = rng.next(), r4 = rng.next(), r5 = rng.next();
    const x = ch.x0 + (gx + r1) * G, z = ch.z0 + (gz + r2) * G;
    const vi = Math.round((x - ch.x0) / STEP), vj = Math.round((z - ch.z0) / STEP);
    const s = S[(vj + 1) * E + vi + 1];
    if (s.occupied || s.road || !Number.isNaN(s.water) && s.water > s.h - 0.3) continue;
    const y = ch.heightAt(x, z);
    const bd = BIOMES[s.biome];
    const clump = 0.35 + 0.65 * Math.max(0, vegNoise!.fbm(x / 70, z / 70, 3) + 0.35);
    const hl = ch.heights[vj * V + Math.max(0, vi - 1)], hr = ch.heights[vj * V + Math.min(CHUNK_RES, vi + 1)];
    const steep = Math.abs(hr - hl) / (2 * STEP);
    if (steep > 0.9) continue;
    const id = `${cx}:${cz}:${gx}:${gz}`;
    if (r3 < bd.trees * 0.3 * clump) {
      if (removed?.(id)) {
        // abattu : il reste une souche (les tirages de l'arbre sont consommés pour ne rien décaler)
        addTree(new MeshBuilder(64), rng, x, y, z, r4 < bd.pine, s.biome);
        mb.cylinder(x, y - 0.1, z, 0.34, 0.55, 7, 0x6a4a2e, M.TRUNK);
        ch.circles.push({ x, z, r: 0.38, bottom: y - 1, top: y + 0.45 });
      } else {
        addTree(mb, rng, x, y, z, r4 < bd.pine, s.biome);
        ch.circles.push({ x, z, r: 0.45, bottom: y - 1, top: y + 6 });
        ch.nodes.push({ id, kind: 'arbre', x, y, z, size: 1 });
      }
    } else if (r3 < bd.trees * 0.3 * clump + bd.bushes * 0.12) {
      mb.vflags = 1;
      const bc = shade(mixColor(0x3e6a2c, 0x5a7a34, r5), 0.9 + r4 * 0.2);
      mb.blob(x, y + 0.35, z, 0.7 + r4 * 0.6, 0.5 + r5 * 0.4, 0.7 + r5 * 0.5, bc, M.BUSH, 5, 3);
      mb.vflags = 0;
    } else if (r3 > 1 - bd.rocks * 0.06) {
      const sz = 0.5 + r4 * r4 * 2.5;
      const rc = s.biome === B.SNOW ? 0x9a9aa0 : shade(0x7a766c, 0.85 + r5 * 0.3);
      if (removed?.(id)) {
        // brisé : quelques gravats au sol
        mb.blob(x, y + 0.04, z, sz * 0.55, 0.14, sz * 0.5, shade(rc, 0.85), M.RUBBLE, 5, 2);
      } else {
        mb.blob(x, y + sz * 0.2, z, sz, sz * (0.5 + r5 * 0.4), sz * (0.8 + r4 * 0.4), rc, M.ROCK, 5, 3);
        if (sz > 0.9) ch.circles.push({ x, z, r: sz * 0.8, bottom: y - 1, top: y + sz * 0.9 });
        if (sz > 0.7) ch.nodes.push({ id, kind: 'rocher', x, y, z, size: sz });
      }
    }
  }

  extras?.build(cx, cz, mb, ch);
  ch.mesh = mb.finish();
  ch.buildMs = performance.now() - t0;
  return ch;
}

function addTree(mb: MeshBuilder, rng: RNG, x: number, y: number, z: number, pine: boolean, biome: number) {
  const k = rng.next(), k2 = rng.next();
  if (biome === B.SWAMP && k < 0.3) {         // arbre mort
    mb.cylinder(x, y - 0.3, z, 0.22, 4 + k2 * 3, 5, 0x4a4030, M.TRUNK, true, 0.1);
    return;
  }
  if (pine) {
    const h = 7 + k * 6, trunkH = 1.6 + k2;
    mb.cylinder(x, y - 0.3, z, 0.28, trunkH + 0.3, 5, 0x5a4230, M.TRUNK, false);
    const col = shade(mixColor(0x24502e, 0x2e5a3a, k2), biome === B.SNOW ? 1.15 : 0.95 + k * 0.1);
    mb.vflags = 1;
    const tiers = 3;
    for (let t = 0; t < tiers; t++) {
      const base = y + trunkH + t * (h - trunkH) * 0.28, r = (2.3 + k * 0.8) * (1 - t * 0.27);
      mb.cone(x, base, z, r, (h - trunkH) * 0.45, 7, col, M.PINE);
    }
    mb.vflags = 0;
  } else {
    const trunkH = 2.4 + k * 1.6;
    mb.cylinder(x, y - 0.3, z, 0.3, trunkH + 0.8, 5, 0x5e4630, M.TRUNK, false, 0.22);
    const col = shade(mixColor(0x3a7a30, 0x5a8a34, k2), 0.9 + k * 0.2);
    const r = 2 + k2 * 1.6;
    mb.vflags = 1;
    mb.blob(x, y + trunkH + r * 0.7, z, r, r * (0.8 + k * 0.3), r * (0.9 + k2 * 0.2), col, M.FOLIAGE, 7, 4);
    mb.vflags = 0;
  }
}
