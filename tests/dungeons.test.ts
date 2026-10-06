import { describe, it, expect } from 'vitest';
import { WorldSeed } from '../src/core/Seed';
import { MacroWorld } from '../src/world/MacroWorld';
import { Civilization } from '../src/world/civilization/Civilization';
import { generateDungeon, buildDungeon } from '../src/world/dungeons/DungeonGenerator';

describe('donjons', () => {
  const seed = new WorldSeed('TEST-001');
  const civ = Civilization.generate(MacroWorld.generate(seed));

  it('structure logique : tout est accessible, le boss est derrière la porte, la clé est avant', () => {
    expect(civ.dungeons.length).toBeGreaterThan(1);
    for (const d of civ.dungeons) {
      const L = generateDungeon(seed, d);
      expect(JSON.stringify(generateDungeon(seed, d))).toBe(JSON.stringify(L));
      const reach = (allowLocked: boolean) => {
        const seen = new Set([0]); const q = [0];
        while (q.length) { const c = q.pop()!; for (const l of L.links) { if (l.locked && !allowLocked) continue; const n = l.a === c ? l.b : l.b === c ? l.a : -1; if (n >= 0 && !seen.has(n)) { seen.add(n); q.push(n); } } }
        return seen;
      };
      expect(reach(true).size).toBe(L.rooms.length);
      const boss = L.rooms.find((r) => r.role === 'boss')!;
      const free = reach(false);
      expect(free.has(boss.id)).toBe(false);
      const keyChest = L.chests.find((c) => c.hasKey);
      if (keyChest) {
        const keyRoom = L.rooms.find((r) => r.role === 'clé')!;
        expect(free.has(keyRoom.id)).toBe(true);
      }
      expect(L.spawns.some((s) => s.boss)).toBe(true);
      const built = buildDungeon(L);
      expect(built.mesh.indexCount).toBeGreaterThan(100);
      expect(built.data.props.some((p) => p.kind === 'sortie')).toBe(true);
    }
  });
});
