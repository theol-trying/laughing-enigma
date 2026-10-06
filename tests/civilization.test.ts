import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { WorldSeed } from '../src/core/Seed';
import { MacroWorld } from '../src/world/MacroWorld';
import { Civilization } from '../src/world/civilization/Civilization';

describe('civilisation', () => {
  const t0 = performance.now();
  const macro = MacroWorld.generate(new WorldSeed('TEST-001'));
  const civ = Civilization.generate(macro);
  const ms = performance.now() - t0;

  it('déterministe', () => {
    const civ2 = Civilization.generate(MacroWorld.generate(new WorldSeed('TEST-001')));
    expect(civ2.settlements.map((s) => `${s.name}@${s.ci},${s.cj}:${s.type}`)).toEqual(civ.settlements.map((s) => `${s.name}@${s.ci},${s.cj}:${s.type}`));
    expect(civ2.roads.map((r) => r.cells.length)).toEqual(civ.roads.map((r) => r.cells.length));
    expect(civ2.events.map((e) => e.title)).toEqual(civ.events.map((e) => e.title));
    expect(civ2.startId).toBe(civ.startId);
  });

  it('implantations, routes et village de départ cohérents', () => {
    const alive = civ.settlements.filter((s) => !s.abandoned && s.type !== 'camp');
    expect(alive.length).toBeGreaterThan(20);
    expect(civ.settlements.some((s) => s.type === 'capitale')).toBe(true);
    // connexité du réseau routier
    const adj = new Map<number, number[]>();
    for (const r of civ.roads) { adj.set(r.a, [...(adj.get(r.a) ?? []), r.b]); adj.set(r.b, [...(adj.get(r.b) ?? []), r.a]); }
    const seen = new Set([civ.startId]); const q = [civ.startId];
    while (q.length) for (const n of adj.get(q.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
    const linked = alive.filter((s) => seen.has(s.id) || civ.roads.some((r) => r.cells.some((c) => c === s.cj * 256 + s.ci))).length;
    expect(linked / alive.length).toBeGreaterThan(0.8);
    // un camp de bandits menace une route du village de départ
    const startRoads = civ.roads.filter((r) => r.a === civ.startId || r.b === civ.startId).map((r) => r.id);
    expect(civ.pois.some((p) => p.kind === 'camp de bandits' && startRoads.includes(p.roadId))).toBe(true);
    // l'histoire est chronologique et laisse des traces
    for (let i = 1; i < civ.events.length; i++) expect(civ.events[i].year).toBeGreaterThanOrEqual(civ.events[i - 1].year);
    expect(civ.settlements.some((s) => s.abandoned)).toBe(true);
    expect(civ.dungeons.length).toBeGreaterThan(1);
  });

  it('rapport', () => {
    const st = civ.start;
    const lines = [
      `${macro.worldName} — an ${civ.presentYear} — civilisation générée en ${ms.toFixed(0)} ms (macro compris)`,
      `Départ : ${st.name} (${st.type}, ${st.population} hab.) — ${st.reasons.join(' ; ')}`,
      '', 'FACTIONS', ...civ.factions.map((f) => `- ${f.name} [${f.kind}] ${f.notes.join(' ; ')}`),
      '', 'IMPLANTATIONS', ...civ.settlements.map((s) => `- ${s.name} : ${s.type}${s.abandoned ? ' (abandonné)' : ''}, ${s.population} hab., ${civ.factions[s.factionId]?.name ?? '—'} · produit ${s.produces.join(', ')} · ${s.reasons.join(' ; ')}`),
      '', 'HISTOIRE', ...civ.events.map((e) => `- ${e.year} : ${e.title} — ${e.text}`),
      '', 'POINTS D\'INTÉRÊT', ...civ.pois.filter((p) => p.kind !== 'pont').map((p) => `- ${p.name} [${p.kind}] — ${p.why}${p.dungeonId >= 0 ? ' · donjon : ' + civ.dungeons[p.dungeonId].name : ''}`),
      `- ${civ.pois.filter((p) => p.kind === 'pont').length} ponts`,
      '', `ROUTES : ${civ.roads.length} (${civ.roads.filter((r) => r.kind === 2).length} routes, ${civ.roads.filter((r) => r.kind === 1).length} chemins)`,
    ];
    writeFileSync('docs/civ-TEST-001.txt', lines.join('\n'));
    expect(ms).toBeLessThan(8000);
  });
});
