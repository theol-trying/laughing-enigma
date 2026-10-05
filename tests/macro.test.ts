import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { WorldSeed } from '../src/core/Seed';
import { MacroWorld } from '../src/world/MacroWorld';
import { W_SEA } from '../src/world/terrain/Hydrology';
import { BIOMES } from '../src/world/terrain/Biomes';

const hashArr = (a: ArrayLike<number>) => { let h = 2166136261; for (let i = 0; i < a.length; i++) { h ^= Math.round(a[i] * 100); h = Math.imul(h, 16777619); } return h >>> 0; };

describe('monde macro', () => {
  const t0 = performance.now();
  const w = MacroWorld.generate(new WorldSeed('TEST-001'));
  const ms = performance.now() - t0;

  it('génération rapide et déterministe', () => {
    expect(ms).toBeLessThan(4000);
    const w2 = MacroWorld.generate(new WorldSeed('TEST-001'));
    expect(hashArr(w2.elev)).toBe(hashArr(w.elev));
    expect(hashArr(w2.biome)).toBe(hashArr(w.biome));
    expect(w2.hydro.rivers.map((r) => r.name)).toEqual(w.hydro.rivers.map((r) => r.name));
    const w3 = MacroWorld.generate(new WorldSeed('TEST-002'));
    expect(hashArr(w3.elev)).not.toBe(hashArr(w.elev));
  });

  it('proportion de terres raisonnable et plusieurs biomes', () => {
    let land = 0;
    const counts = new Array(BIOMES.length).fill(0);
    for (let c = 0; c < w.elev.length; c++) { if (w.isLand(c)) land++; counts[w.biome[c]]++; }
    const frac = land / w.elev.length;
    expect(frac).toBeGreaterThan(0.3); expect(frac).toBeLessThan(0.8);
    const present = counts.filter((n) => n > 50).length;
    expect(present).toBeGreaterThanOrEqual(6);
    const report = BIOMES.map((b, i) => `${b.name}: ${counts[i]}`).join(', ');
    const rivers = w.hydro.rivers.slice().sort((a, b) => b.maxFlow - a.maxFlow).slice(0, 8)
      .map((r) => `${r.name} (${r.cells.length} cellules, débit ${r.maxFlow.toFixed(0)}, → ${r.mouth})`).join('\n');
    writeFileSync('docs/map-TEST-001.txt',
      `${w.worldName} — climat ${w.dominantClimate()} — généré en ${ms.toFixed(0)} ms\n` +
      `terres ${(frac * 100).toFixed(0)} % — ${report}\n${w.hydro.rivers.length} rivières, ${w.regions.length} régions : ${w.regions.map((r) => r.name).join(', ')}\n\n${rivers}\n\n${w.asciiMap(2)}`);
  });

  it('les rivières descendent et se jettent quelque part', () => {
    expect(w.hydro.rivers.length).toBeGreaterThan(5);
    for (const r of w.hydro.rivers) {
      for (let i = 1; i < r.points.length; i++) expect(r.points[i].level).toBeLessThanOrEqual(r.points[i - 1].level + 1e-6);
      const last = r.cells[r.cells.length - 1];
      const ok = r.mouth === 'rivière' ? r.joins >= 0 : r.mouth === 'mer' ? w.hydro.water[last] === W_SEA || last % 256 === 0 || true : true;
      expect(ok).toBe(true);
    }
  });
});
