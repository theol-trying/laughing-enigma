import { WorldSeed } from '@ascii-fort/core/Seed';
import { MacroWorld } from './MacroWorld';
import { TerrainSampler } from './terrain/TerrainSampler';
import { ChunkManager, type GpuBridge } from './ChunkManager';
import { MACRO, CELL } from './constants';
import { B } from './terrain/Biomes';
import { W_NONE } from './terrain/Hydrology';
import { Civilization } from './civilization/Civilization';
import { CivWorld } from './civilization/CivWorld';
import { CaveAtlas } from './caves/Caves';

/** Façade du monde : macro + relief détaillé + chunks chargés. */
export class World<T = unknown> {
  readonly macro: MacroWorld;
  readonly sampler: TerrainSampler;
  readonly chunks: ChunkManager<T>;
  readonly civ: Civilization;
  readonly civWorld: CivWorld;

  constructor(readonly seed: WorldSeed, gpu: GpuBridge<T> | null, macro?: MacroWorld, civ?: Civilization) {
    this.macro = macro && macro.seed.text === seed.text ? macro : MacroWorld.generate(seed);
    this.civ = civ && civ.macro === this.macro ? civ : Civilization.generate(this.macro);
    this.civWorld = new CivWorld(this.civ);
    this.sampler = new TerrainSampler(this.macro);
    this.sampler.addFeature(this.civWorld.feature());
    this.chunks = new ChunkManager<T>(this.sampler, gpu);
    // civilisation, puis entrées des grottes (étape 55) : un ajout construit après tout le reste, qui ne déplace rien
    const civEx = this.civWorld.extras(this.sampler);
    this.chunks.extras = { build: (cx, cz, mb, ch) => { civEx.build(cx, cz, mb, ch); this.caves.build(cx, cz, mb, ch); } };
  }

  private caveAtlas: CaveAtlas | null = null;
  /** Réseaux de grottes (choisis une fois, au premier besoin : premier chunk construit, carte, souterrain). */
  get caves(): CaveAtlas { return this.caveAtlas ??= new CaveAtlas(this.civ, this.sampler, this.seed); }

  heightAt(x: number, z: number): number { return this.chunks.heightAt(x, z); }
  waterAt(x: number, z: number): number { return this.chunks.waterAt(x, z); }

  /** Départ : devant l'auberge du village de départ. */
  spawn(): { x: number; z: number; heading: number } { return this.civWorld.spawn(this.sampler); }

  /** Repli (monde sans village). */
  fallbackSpawn(): { x: number; z: number } {
    const m = this.macro, N = MACRO;
    let best = -1, bestScore = -Infinity;
    for (let c = 0; c < N * N; c++) {
      if (m.hydro.water[c] !== W_NONE) continue;
      const b = m.biome[c];
      if (b !== B.PLAINS && b !== B.FOREST) continue;
      const i = c % N, j = (c / N) | 0;
      const score = -Math.hypot(i - N / 2, j - N / 2) * 0.05 - Math.abs(m.waterDist[c] - 2) - m.slope[c] * 20;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return { x: ((best % N) + 0.5) * CELL, z: (((best / N) | 0) + 0.5) * CELL };
  }
}
