import { describe, it, expect } from 'vitest';
import { WorldSeed } from '@ascii-fort/core/Seed';
import { World } from '@ascii-fort/worldgen/World';
import { generateNPCs } from '@ascii-fort/sim/entities/NPC';
import { GENERATOR_VERSION } from '../src/version';
import { packBits, unpackBits } from '../src/game/SaveManager';

// Points de contrôle de la seed de référence. Si la génération change volontairement,
// incrémenter GENERATOR_VERSION puis mettre à jour l'instantané : npx vitest run -u
function fingerprint(seed: string) {
  const w = new World(new WorldSeed(seed), null);
  const civ = w.civ, st = civ.start;
  const main = [...w.macro.hydro.rivers].sort((a, b) => b.maxFlow - a.maxFlow)[0];
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const L = w.civWorld.layouts.find((l) => l.sid === st.id)!;
  return {
    generator: GENERATOR_VERSION,
    world: w.macro.worldName,
    startVillage: { name: st.name, type: st.type, x: r1(st.x), z: r1(st.z), inn: L.buildings.find((b) => b.kind === 'auberge')?.name },
    mainRiver: { name: main.name, cells: main.cells.length, mouth: main.mouth },
    firstSettlements: civ.settlements.slice(0, 6).map((s) => `${s.name}:${s.type}`),
    factions: civ.factions.map((f) => f.name),
    heights: [[1000, 1000], [4096, 4096], [5200, 3100], [st.x + 37, st.z - 21]].map(([x, z]) => r1(w.sampler.height(x, z))),
    quests: civ.events.length,
    npcsAtStart: generateNPCs(civ, st, L).slice(0, 5).map((n) => `${n.first} ${n.last} (${n.profession})`),
  };
}

describe('déterminisme', () => {
  it('TEST-001 produit toujours le même monde (instantané)', () => {
    const a = fingerprint('TEST-001');
    expect(fingerprint('TEST-001')).toEqual(a);
    expect(a).toMatchSnapshot();
  });
  it('une autre seed produit un autre monde', () => {
    expect(fingerprint('TEST-002').startVillage).not.toEqual(fingerprint('TEST-001').startVillage);
  });
  it('encodage du brouillard de la carte', () => {
    const a = new Uint8Array(65536);
    for (let i = 0; i < a.length; i += 7) a[i] = 1;
    const b = new Uint8Array(65536);
    unpackBits(packBits(a), b);
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});
