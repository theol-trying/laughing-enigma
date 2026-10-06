import { describe, it, expect } from 'vitest';
import { WorldSeed } from '@ascii-fort/core/Seed';
import { World } from '@ascii-fort/worldgen/World';
import { generateNPCs } from '@ascii-fort/sim/entities/NPC';
import { NavGrid } from '@ascii-fort/sim/ai/Pathfinding';
import { blockAt, resolveSpot } from '@ascii-fort/sim/ai/Schedule';
import { doorPassages } from '@ascii-fort/sim/entities/EntityManager';

describe('PNJ', () => {
  const world = new World(new WorldSeed('TEST-001'), null);
  const st = world.civ.start;
  const L = world.civWorld.layouts.find((l) => l.sid === st.id)!;

  it('génération déterministe et métiers attendus', () => {
    const a = generateNPCs(world.civ, st, L), b = generateNPCs(world.civ, st, L);
    expect(b.map((n) => `${n.first} ${n.last} ${n.profession}`)).toEqual(a.map((n) => `${n.first} ${n.last} ${n.profession}`));
    const profs = new Set(a.map((n) => n.profession));
    for (const p of ['aubergiste', 'forgeron', 'marchand', 'garde', 'prêtre', 'voyageur'] as const) expect(profs.has(p)).toBe(true);
    for (const n of a) {
      let covered = 0;
      for (const blk of n.schedule) covered += blk.to - blk.from;
      expect(covered).toBe(1440);
      expect(n.knowledge.length).toBeGreaterThan(0);
    }
  });

  it('les PNJ trouvent leur chemin dans le village (portes comprises)', () => {
    world.chunks.update(st.x, st.z, -1);
    const grid = NavGrid.build(world.chunks, st.x, st.z, st.radius + 55, doorPassages(L));
    const npcs = generateNPCs(world.civ, st, L);
    const smith = npcs.find((n) => n.profession === 'forgeron')!;
    const work = resolveSpot(smith, { from: 0, to: 1, act: 'travailler', place: 'work' }, L, 9);
    const sleep = resolveSpot(smith, blockAt(smith, 60), L, 1);
    const path = grid.findPath(sleep.x, sleep.z, work.x, work.z);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
  });
});
