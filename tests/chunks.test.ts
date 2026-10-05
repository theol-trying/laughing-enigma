import { describe, it, expect } from 'vitest';
import { WorldSeed } from '../src/core/Seed';
import { World } from '../src/world/World';
import { buildChunk } from '../src/world/Chunk';

describe('chunks', () => {
  const world = new World(new WorldSeed('TEST-001'), null);
  const sp = world.fallbackSpawn();
  const cx = Math.floor(sp.x / 64), cz = Math.floor(sp.z / 64);

  it('un chunk détruit puis régénéré est identique', () => {
    const a = buildChunk(world.sampler, cx, cz), b = buildChunk(world.sampler, cx, cz);
    expect(Array.from(b.heights)).toEqual(Array.from(a.heights));
    expect(b.circles.length).toBe(a.circles.length);
    expect(b.mesh!.vertexCount).toBe(a.mesh!.vertexCount);
  });

  it('continuité aux bords entre chunks voisins', () => {
    const a = buildChunk(world.sampler, cx, cz), b = buildChunk(world.sampler, cx + 1, cz);
    for (let j = 0; j <= 32; j++) expect(b.heights[j * 33]).toBeCloseTo(a.heights[j * 33 + 32], 5);
  });

  it('génération assez rapide', () => {
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) buildChunk(world.sampler, cx + k, cz + 2);
    expect((performance.now() - t0) / 10).toBeLessThan(40);
  });
});
