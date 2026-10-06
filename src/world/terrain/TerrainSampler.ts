import { Noise2D } from '../../core/Noise';
import { clamp, smoothstep, lerp } from '../../core/math';
import { MACRO, CELL } from '../constants';
import { MacroWorld } from '../MacroWorld';
import { B, BIOMES } from './Biomes';
import { riverDepth, W_LAKE, W_SEA } from './Hydrology';
import { M } from '../../rendering/Materials';

// Fonction pure du relief détaillé : h(x, z), matière, couleur et niveau d'eau en tout point.
// Les éléments humains (routes, places, fondations) s'y greffent via des « features ».

export interface Sample {
  h: number;
  water: number;      // niveau d'eau ou NaN
  biome: number;
  mat: number;
  color: number;
  occupied: boolean;  // pas de végétation (route, bâtiment…)
  road: number;       // 0 non, 1 chemin, 2 route, 3 pavés
  field: number;      // 0 non, 1 blé, 2 potager
}

/** Modification locale du terrain par la civilisation (route, place, fondation…). */
export interface TerrainFeature {
  minX: number; minZ: number; maxX: number; maxZ: number;
  /** modifie l'échantillon (hauteur, matière, occupation) */
  apply(x: number, z: number, s: Sample): void;
}

const N = MACRO;

export function mixColor(a: number, b: number, t: number): number {
  const r = lerp((a >> 16) & 255, (b >> 16) & 255, t), g = lerp((a >> 8) & 255, (b >> 8) & 255, t), bl = lerp(a & 255, b & 255, t);
  return (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(bl), 0, 255);
}
export function shade(c: number, k: number): number {
  return (clamp(Math.round(((c >> 16) & 255) * k), 0, 255) << 16) | (clamp(Math.round(((c >> 8) & 255) * k), 0, 255) << 8) | clamp(Math.round((c & 255) * k), 0, 255);
}

export class TerrainSampler {
  private detail: Noise2D;
  private warp: Noise2D;
  private rough: Float32Array;
  private features = new Map<number, TerrainFeature[]>();

  constructor(readonly macro: MacroWorld) {
    this.detail = new Noise2D(macro.seed.stream('terrain', 'detail'));
    this.warp = new Noise2D(macro.seed.stream('terrain', 'warp'));
    this.rough = new Float32Array(N * N);
    for (let c = 0; c < N * N; c++) this.rough[c] = BIOMES[macro.biome[c]].rough;
  }

  addFeature(f: TerrainFeature): void {
    const i0 = Math.max(0, Math.floor(f.minX / CELL)), i1 = Math.min(N - 1, Math.floor(f.maxX / CELL));
    const j0 = Math.max(0, Math.floor(f.minZ / CELL)), j1 = Math.min(N - 1, Math.floor(f.maxZ / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * N + i;
      let l = this.features.get(k);
      if (!l) this.features.set(k, (l = []));
      l.push(f);
    }
  }

  /** Biome au point, frontières irrégulières (coordonnées perturbées). */
  biomeAt(x: number, z: number): number {
    const bx = x + this.warp.noise(x / 70, z / 70) * 26, bz = z + this.warp.noise(x / 70 + 31, z / 70 - 17) * 26;
    return this.macro.biome[this.macro.cellOf(bx, bz)];
  }

  /** Niveau des lacs et de la mer autour du point (NaN si aucun). */
  private standingWater(x: number, z: number): number {
    const m = this.macro;
    const i = clamp(Math.floor(x / CELL), 0, N - 1), j = clamp(Math.floor(z / CELL), 0, N - 1);
    let level = NaN;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const c = jj * N + ii, w = m.hydro.water[c];
      if (w === W_LAKE) level = Number.isNaN(level) ? m.hydro.lakeLevel[c] : Math.max(level, m.hydro.lakeLevel[c]);
      else if (w === W_SEA && Number.isNaN(level)) level = 0;
    }
    return level;
  }

  /** Échantillon complet (relief + eau + civilisation). */
  sample(x: number, z: number, out: Sample = { h: 0, water: NaN, biome: 0, mat: 0, color: 0, occupied: false, road: 0, field: 0 }): Sample {
    const m = this.macro;
    let h = m.elevAt(x, z);
    const rough = m.sample(this.rough, x, z);
    const dn = this.detail;
    h += dn.fbm(x / 95, z / 95, 4) * rough + dn.noise(x / 13, z / 13) * rough * 0.12;
    if (rough > 4) h += (dn.ridged(x / 170, z / 170, 4) - 0.45) * rough * 4.5;
    out.water = this.standingWater(x, z);
    out.road = 0; out.occupied = false; out.field = 0;

    // rivières : lit creusé, berges juste au-dessus de l'eau
    const r = m.riverIndex.nearest(x, z);
    let bank = false;
    if (r) {
      const hw = r.width / 2, bw = 5 + r.width * 0.45;
      if (r.d < hw) {
        const t = r.d / hw;
        const bed = r.level - riverDepth(r.width);
        h = Math.min(h, lerp(bed, r.level - 0.35, t * t));
        out.water = r.level;
      } else if (r.d < hw + bw) {
        const t = (r.d - hw) / bw;
        const hb = r.level + 0.3 + (r.d - hw) * 0.12;
        h = lerp(hb, Math.max(h, hb - 0.2), smoothstep(0, 1, t));
        bank = t < 0.5;
      }
    }
    out.h = h;
    out.biome = this.biomeAt(x, z);

    // civilisation
    const fl = this.features.get(m.cellOf(x, z));
    if (fl) for (const f of fl) if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) f.apply(x, z, out);

    // matière et couleur
    const bd = BIOMES[out.biome];
    const v = dn.noise(x / 9, z / 9);
    let mat = bd.ground, col = mixColor(bd.color, bd.color2, clamp(0.5 + dn.noise(x / 40, z / 40) * 0.7, 0, 1));
    if (bank && out.biome !== B.BEACH) { mat = M.MUD; col = 0x6a5a3a; }
    if (out.biome !== B.OCEAN && h < 1.8 && !Number.isNaN(out.water) && out.water === 0) { mat = M.SAND; col = 0xc8b47a; }
    if (h > 380 + dn.noise(x / 200, z / 200) * 60) { mat = M.SNOW; col = 0xe8eef4; }
    if (out.road) {
      mat = out.road === 3 ? M.COBBLE : M.ROAD;
      col = out.road === 3 ? 0x8a867a : out.road === 2 ? 0x8a7454 : 0x7a6a4a;
    } else if (out.field) {
      mat = out.field === 1 ? M.CROP : M.FIELD;
      col = out.field === 1 ? mixColor(0xc8b45a, 0x9aa04a, clamp(0.5 + v, 0, 1)) : 0x5a7a34;
    }
    out.mat = mat;
    out.color = shade(col, 0.92 + v * 0.08);
    return out;
  }

  /** Hauteur seule (collisions, placement). */
  height(x: number, z: number): number { return this.sample(x, z).h; }

  /** Ajuste matière/couleur selon la pente (appelé par le constructeur de chunk). */
  slopeMaterial(s: Sample, slope: number): void {
    if (s.road) return;
    if (slope > 0.95 && s.mat !== M.SNOW) { s.mat = M.ROCK; s.color = 0x7a766c; }
    else if (slope > 0.75 && s.mat === M.SNOW) { s.mat = M.ROCK; s.color = 0x8a8680; }
    else if (slope > 0.65 && (s.mat === M.GRASS || s.mat === M.HEATH)) { s.mat = M.DIRT; s.color = mixColor(s.color, 0x6a5a40, 0.5); }
  }
}
