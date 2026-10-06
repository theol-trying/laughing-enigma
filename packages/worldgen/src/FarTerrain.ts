import { MeshBuilder, type MeshData } from '@ascii-fort/ascii-engine/Mesh';
import { M } from '@ascii-fort/ascii-engine/Materials';
import { MACRO, CELL } from './constants';
import type { MacroWorld } from './MacroWorld';
import { B, BIOMES } from './terrain/Biomes';
import { W_LAKE, W_RIVER, W_SEA } from './terrain/Hydrology';
import { shade } from './terrain/TerrainSampler';

/**
 * Terrain lointain : la grille macro entière en un maillage (≈130 k triangles), dessiné
 * seulement au-delà du rayon des chunks. Les forêts y sont surélevées (canopée) pour se lire
 * de loin ; les landmarks (châteaux, villages) sont ajoutés par la civilisation.
 */
export function buildFarTerrain(m: MacroWorld, landmarks?: (mb: MeshBuilder) => void): MeshData {
  const N = MACRO;
  const mb = new MeshBuilder(N * N + 1024);
  const hAt = (i: number, j: number) => {
    const c = j * N + i, w = m.hydro.water[c];
    if (w === W_SEA) return 0;
    if (w === W_LAKE) return m.hydro.lakeLevel[c];
    const b = m.biome[c];
    return m.elev[c] + (b === B.FOREST || b === B.TAIGA ? 7 : b === B.SWAMP ? 2 : 0);
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = j * N + i, w = m.hydro.water[c], b = m.biome[c];
    const h = hAt(i, j);
    const hl = hAt(Math.max(0, i - 1), j), hr = hAt(Math.min(N - 1, i + 1), j), hu = hAt(i, Math.max(0, j - 1)), hd = hAt(i, Math.min(N - 1, j + 1));
    const nx = hl - hr, nz = hu - hd, ny = 2 * CELL, l = Math.hypot(nx, ny, nz);
    let mat: number = BIOMES[b].ground, col = BIOMES[b].color;
    if (w === W_SEA || w === W_LAKE) { mat = M.WATER; col = w === W_SEA ? 0x1e4a72 : 0x2a5a80; }
    else if (w === W_RIVER) { mat = M.WATER; col = 0x3a7090; }
    else if (b === B.FOREST) { mat = M.FOLIAGE; col = 0x2e5a26; }
    else if (b === B.TAIGA) { mat = M.PINE; col = 0x24482c; }
    else if (h > 380) { mat = M.SNOW; col = 0xe0e8f0; }
    else if (Math.hypot(nx, nz) / ny > 0.8) { mat = M.ROCK; col = 0x7a766c; }
    mb.vertex((i + 0.5) * CELL, w === W_RIVER ? m.elev[c] + 0.6 : h, (j + 0.5) * CELL, nx / l, ny / l, nz / l, shade(col, 0.95), mat);
  }
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i;
    mb.quad(a, a + N, a + N + 1, a + 1);
  }
  landmarks?.(mb);
  return mb.finish();
}
