import { describe, it, expect } from 'vitest';
import { WorldSeed } from '@ascii-fort/core/Seed';
import { MacroWorld } from '@ascii-fort/worldgen/MacroWorld';
import { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import { CivWorld } from '@ascii-fort/worldgen/civilization/CivWorld';
import { buildLairs, buildHerds } from '@ascii-fort/sim/entities/Monster';
import { generateNPCs } from '@ascii-fort/sim/entities/NPC';
import {
  Calendar, DAY, SLOT_DAYS, RAID_RECOVER_DAYS, BATTLE_WINDOW, CAPTURABLE, PEACE_LOSSES, seasonOf, livingPlace,
  parseOutcome, outcomeValue, raidResult, battleResult, epidemicEnd, feastEnd, raidVerdict, battleVerdict, peaceDay, pickVictims, bedridden,
  ringScore, contestRank, sanitizeEventSave, rankOf, hostilePairs,
  type SlotPlan, type BattleResult, type WarPlan,
} from '@ascii-fort/sim/gameplay/Calendar';

// Étape 54 : calendrier des événements vivants, logique pure (sans jeu ni rendu).

const seed = new WorldSeed('TEST-001');
const macro = MacroWorld.generate(seed);
const civ = Civilization.generate(macro);
const layouts = new CivWorld(civ).layouts;
const lairs = [...buildLairs(civ, seed), ...buildHerds(civ, seed)];
const make = () => new Calendar({ civ, seed, layouts, lairs });
const living = civ.settlements.filter((s) => livingPlace(s));

describe('calendrier des lieux', () => {
  it('saisons : année de 40 jours, le jour 0 ouvre le printemps', () => {
    expect(seasonOf(0)).toBe('printemps');
    expect(seasonOf(12)).toBe('été');
    expect(seasonOf(25)).toBe('automne');
    expect(seasonOf(39)).toBe('hiver');
    expect(seasonOf(40)).toBe('printemps');
    expect(seasonOf(-1)).toBe('hiver');
  });

  it('déterministe : deux calendriers de la même seed tirent les mêmes événements, les mêmes guerres', () => {
    const a = make(), b = make();
    for (let d = 0; d < 80; d += 3) expect(JSON.stringify(a.eventsOn(d, []))).toBe(JSON.stringify(b.eventsOn(d, [])));
    for (let p = 0; p < 6; p++) expect(a.war(p)).toEqual(b.war(p));
    // l'ordre de consultation ne change rien
    const c = make();
    const late = JSON.stringify(c.eventsOn(60, []));
    c.eventsOn(3, []);
    expect(JSON.stringify(c.eventsOn(60, []))).toBe(late);
    // une autre seed donne un autre calendrier
    expect(JSON.stringify(make().eventsOn(20, []))).not.toBe(JSON.stringify(new Calendar({ civ, seed: new WorldSeed('AUTRE'), layouts, lairs }).eventsOn(20, [])));
  });

  it('jamais deux événements au même endroit en même temps : chacun tient dans son créneau, séquelles comprises', () => {
    const cal = make();
    const kinds = new Set<string>();
    for (const s of living) {
      const list: SlotPlan[] = [];
      for (let k = 0; k < 30; k++) {
        const p = cal.slot(s.id, k);
        if (!p) continue;
        kinds.add(p.kind);
        const { d0 } = cal.slotOf(s.id, Math.floor(p.start / DAY));
        expect(cal.slotOf(s.id, Math.floor(p.start / DAY)).k, p.id).toBe(k);
        expect(cal.busyEnd(p), p.id).toBeLessThanOrEqual((d0 + SLOT_DAYS) * DAY);
        expect(p.end).toBeGreaterThan(p.start);
        list.push(p);
      }
      for (let i = 1; i < list.length; i++) expect(cal.busyEnd(list[i - 1]), `${list[i - 1].id} / ${list[i].id}`).toBeLessThanOrEqual(list[i].start - 60);
    }
    expect(kinds).toEqual(new Set(['raid', 'épidémie', 'fête']));
  });

  it('raids : de nuit, d’un repaire proche, maisons brûlées seulement par des pillards (pas les loups), morts seulement si le raid réussit', () => {
    const cal = make();
    let raids = 0;
    for (const s of living) for (let k = 0; k < 30; k++) {
      const p = cal.slot(s.id, k);
      if (p?.kind !== 'raid') continue;
      raids++;
      const h = (p.start % DAY) / 60;
      expect(h >= 22 || h < 2, p.id).toBe(true);
      expect(Math.hypot(p.lx - s.x, p.lz - s.z)).toBeLessThan(1700);
      expect(['hameau', 'village', 'village minier', 'port', 'bourg']).toContain(s.type);
      if (p.raider === 'loup') expect(p.burn).toEqual([]);
      if (!p.succeeds) expect(p.deaths).toBe(0);
      const L = layouts.find((x) => x.sid === s.id)!;
      for (const b of p.burn) expect(['maison', 'ferme', 'grange', 'cabane']).toContain(L.buildings[b].kind);
      expect(p.count).toBeGreaterThanOrEqual(3);
    }
    expect(raids).toBeGreaterThan(5);
  });

  it('fêtes : sur une place, saint patron le même jour chaque année, rivaux du concours ; épidémies : remèdes demandés', () => {
    const cal = make();
    let feasts = 0, patron = 0, epid = 0;
    for (const s of living) for (let k = 0; k < 30; k++) {
      const p = cal.slot(s.id, k);
      if (p?.kind === 'fête') {
        feasts++;
        expect(layouts.find((x) => x.sid === s.id)?.plaza).toBeTruthy();
        expect(p.rivals).toHaveLength(3);
        expect(p.rivals[0].score).toBeGreaterThanOrEqual(p.rivals[1].score);
        if (p.feast === 'patron') { patron++; expect(Math.floor(p.start / DAY) % 40).toBe(cal.patron(s.id).day); }
        if (p.feast === 'foire') expect(p.merchants).toBe(3);
      }
      if (p?.kind === 'épidémie') { epid++; expect(p.remedies).toBeGreaterThanOrEqual(2); expect(p.disease).toMatch(/^la /); }
    }
    expect(feasts).toBeGreaterThan(5);
    expect(patron).toBeGreaterThan(0);
    expect(epid).toBeGreaterThan(0);
  });
});

describe('règles d’issue', () => {
  it('issue observée prioritaire, sinon tirée ; verdict sur les forces en présence', () => {
    const cal = make();
    let raid = null;
    for (const s of living) for (let k = 0; k < 30 && !raid; k++) { const p = cal.slot(s.id, k); if (p?.kind === 'raid') raid = p; }
    expect(raid).toBeTruthy();
    const r = raid!;
    expect(raidResult(r, undefined)).toEqual({ k: r.succeeds ? 's' : 'r', t: r.end });
    expect(raidResult(r, { k: 'r', t: r.start + 10 })).toEqual({ k: 'r', t: r.start + 10 });
    expect(raidResult(r, { k: 'p', t: 5 }).t).toBe(r.end);   // une issue d'une autre sorte est ignorée
    expect(raidVerdict(0, 0)).toBe('r');
    expect(raidVerdict(5, 1)).toBe('s');
    expect(raidVerdict(3, 4)).toBe('r');
    expect(battleVerdict(3, 1, false)).toBe('a');
    expect(battleVerdict(1, 3, true)).toBe('d');
    expect(battleVerdict(2, 2, true)).toBe('a');
    let epi = null;
    for (const s of living) for (let k = 0; k < 40 && !epi; k++) { const p = cal.slot(s.id, k); if (p?.kind === 'épidémie') epi = p; }
    expect(epidemicEnd(epi!, undefined)).toEqual({ t: epi!.end, stopped: false });
    expect(epidemicEnd(epi!, { k: 'e', t: epi!.start + 100 })).toEqual({ t: epi!.start + 100, stopped: true });
    let feast = null;
    for (const s of living) for (let k = 0; k < 40 && !feast; k++) { const p = cal.slot(s.id, k); if (p?.kind === 'fête') feast = p; }
    expect(feastEnd(feast!, undefined)).toBe(feast!.end);
    expect(feastEnd(feast!, { k: 'f', t: feast!.start + 30 })).toBe(feast!.start + 30);
  });

  it('faits partagés : lecture et écriture des issues (bataille avec site et camp attaquant)', () => {
    for (const o of [{ k: 'r', t: 1234 }, { k: 'a', t: 99999, sid: 16, atk: 0 }, { k: 'p', t: 7, sid: 3, atk: 1 }]) expect(parseOutcome(outcomeValue(o))).toEqual(o);
    expect(parseOutcome('x')).toBeNull();
    expect(parseOutcome(12)).toBeNull();
    expect(parseOutcome('a12:3')).toBeNull();
  });

  it('victimes : déterministes, jamais un commerce ni un épargné ; alités : ni guérisseurs ni gardes', () => {
    const s = civ.settlements[civ.startId], L = layouts.find((x) => x.sid === s.id)!;
    const npcs = generateNPCs(civ, s, L);
    const spare = (n: { id: string }) => n.id === npcs.find((x) => x.profession === 'fermier')?.id;
    const v1 = pickVictims(npcs, 2, seed, 'r25.3', spare), v2 = pickVictims(npcs, 2, seed, 'r25.3', spare);
    expect(v1.map((n) => n.id)).toEqual(v2.map((n) => n.id));
    expect(v1.length).toBeLessThanOrEqual(2);
    for (const n of v1) { expect(['marchand', 'aubergiste', 'forgeron', 'prêtre', 'guérisseuse', 'noble']).not.toContain(n.profession); expect(spare(n)).toBe(false); }
    expect(pickVictims(npcs, 0, seed, 'r25.3', spare)).toEqual([]);
    const epi = { id: 'p25.1', kind: 'épidémie', sid: s.id, start: 0, end: DAY, x: 0, z: 0, disease: 'la suette', severity: 0.9, sick: 0.9, deaths: 2, remedies: 3 } as const;
    for (const n of npcs) if (['guérisseuse', 'prêtre', 'garde'].includes(n.profession)) expect(bedridden(n, epi)).toBe(false);
    expect(npcs.some((n) => bedridden(n, epi))).toBe(true);
  });

  it('concours de tir : points par anneau, il faut battre strictement le meilleur rival', () => {
    expect(ringScore(0.1)).toBe(10);
    expect(ringScore(0.3)).toBe(6);
    expect(ringScore(0.6)).toBe(3);
    expect(ringScore(0.7)).toBe(0);
    const rivals = [{ score: 40 }, { score: 31 }, { score: 22 }];
    expect(contestRank(41, rivals)).toBe(1);
    expect(contestRank(40, rivals)).toBe(2);
    expect(contestRank(10, rivals)).toBe(4);
    expect(rankOf(0, false)).toBe('recrue');
    expect(rankOf(3, false)).toBe('soldat');
    expect(rankOf(7, true)).toBe('sergente');
  });
});

describe('guerres et frontières', () => {
  const pairs = hostilePairs(civ);
  it('deux royaumes en mauvais termes (Guerre des Deux Couronnes) partagent une frontière', () => {
    expect(pairs.some(([a, b]) => (a === 0 && b === 1) || (a === 1 && b === 0))).toBe(true);
    for (const [a, b] of pairs) expect(civ.factions[a].relations[b]).toBeLessThanOrEqual(-0.3);
  });

  it('une campagne par période au plus, déclarée dans la période ; une guerre au moins sur dix périodes', () => {
    const cal = make();
    let wars = 0;
    for (let p = 0; p < 10; p++) {
      const w = cal.war(p);
      if (!w) continue;
      wars++;
      expect(w.start).toBeGreaterThanOrEqual(p * 24 + 3);
      expect(w.end).toBeLessThan((p + 1) * 24);
      expect(pairs.some(([a, b]) => (a === w.a && b === w.b) || (a === w.b && b === w.a))).toBe(true);
      expect(cal.warOn(w.start)).toBe(w);
      expect(cal.warOn(w.end)).toBeNull();
    }
    expect(wars).toBeGreaterThan(0);
  });

  /** Joue une guerre sans témoin : batailles successives, prises appliquées aux propriétaires, paix. */
  function playWar(cal: Calendar, w: WarPlan, owners: Map<number, number>) {
    const owner = (sid: number) => owners.get(sid) ?? civ.settlements[sid].factionId;
    const results: BattleResult[] = [];
    let peace: number | null = null;
    for (let d = w.start + 1; d < w.end && (peace === null || d < peace); d++) {
      const b = cal.battle(w, d, owner, results);
      if (!b) continue;
      // le site : une place du défenseur, reliée par la route à une place de l'attaquant, libre ce jour-là
      expect(owner(b.sid)).toBe(b.defender);
      expect(owner(b.from)).toBe(b.attacker);
      expect(civ.roads.some((r) => (r.a === b.sid && r.b === b.from) || (r.b === b.sid && r.a === b.from))).toBe(true);
      expect(cal.busy(b.sid, d)).toBe(false);
      expect(b.end - b.start).toBe(BATTLE_WINDOW);
      expect(Math.hypot(b.x - civ.settlements[b.sid].x, b.z - civ.settlements[b.sid].z)).toBeGreaterThan(civ.settlements[b.sid].radius);
      const r = battleResult(b, undefined);
      expect(r.capture).toBe(r.win === 'a' && CAPTURABLE.has(civ.settlements[b.sid].type));
      if (r.capture) owners.set(b.sid, b.attacker);
      results.push(r);
      peace = peaceDay(w, results, (x) => Math.floor(x.t / DAY));
    }
    return { results, peace };
  }

  it('les frontières bougent : une place prise change de propriétaire, la paix suit une série de défaites', () => {
    const cal = make();
    const w: WarPlan = { id: 'g99', period: 99, a: 0, b: 1, start: 100, end: 115 };
    const owners = new Map<number, number>();
    const { results, peace } = playWar(cal, w, owners);
    expect(results.length).toBeGreaterThan(0);
    const caps = results.filter((r) => r.capture);
    for (const r of caps) expect(owners.get(r.sid)).toBe(r.atk);
    // déterministe : la même guerre rejouée donne les mêmes batailles
    const again = playWar(make(), w, new Map());
    expect(again.results).toEqual(results);
    // paix anticipée : au plus tard une série de défaites ou deux places perdues
    const lost = new Map<number, number>();
    for (const r of results) { const l = r.win === 'a' ? r.def : r.atk; lost.set(l, (lost.get(l) ?? 0) + 1); }
    if ([...lost.values()].some((n) => n >= PEACE_LOSSES) || caps.length >= 2) expect(peace).not.toBeNull();
    // un site déjà connu (fait partagé) est respecté même si les propriétaires ont changé
    const b0 = cal.battle(w, w.start + 1, (s) => civ.settlements[s].factionId, []);
    if (b0) {
      const forced = cal.battle(w, w.start + 1, () => 5, [], { sid: b0.sid, atk: b0.attacker });
      expect(forced?.sid).toBe(b0.sid);
      expect(forced?.attacker).toBe(b0.attacker);
      expect(forced?.id).toBe(b0.id);
    }
  });

  it('paix : trois défaites d’un même camp, ou deux places prises', () => {
    const w: WarPlan = { id: 'g1', period: 1, a: 0, b: 1, start: 30, end: 42 };
    const r = (k: number, win: 'a' | 'd', atk: number, capture = false): BattleResult => ({ k, sid: 10 + k, atk, def: atk === 0 ? 1 : 0, win, capture, t: (31 + k) * DAY + 600 });
    expect(peaceDay(w, [r(0, 'a', 0), r(1, 'd', 1)], (x) => Math.floor(x.t / DAY))).toBeNull();
    expect(peaceDay(w, [r(0, 'a', 0), r(1, 'd', 1), r(2, 'a', 0)], (x) => Math.floor(x.t / DAY))).toBe(34);
    expect(peaceDay(w, [r(0, 'a', 0, true), r(1, 'a', 0, true)], (x) => Math.floor(x.t / DAY))).toBe(33);
  });
});

describe('sauvegarde', () => {
  it('champ absent ou illisible : état par défaut ; valeurs bornées ; aller-retour', () => {
    const d = sanitizeEventSave(undefined);
    expect(d).toEqual({ out: [], jour: -1, vus: [], fait: [], malade: null, immun: 0, rangs: [], camp: null, remedes: [], journal: [] });
    expect(sanitizeEventSave('n’importe quoi')).toEqual(d);
    const raw = {
      out: [['r25.3', 'r1234'], ['b4.2', 'a99999:16:0'], ['bad', 'zz'], ['r25.3', 's1']],
      jour: 41.7, vus: ['r25.3', 5, 'f3.1', 'f3.1'], fait: ['aide:r25.3', 'ok:p4.2'],
      malade: { nom: 'la toux grise', fin: 70000.5 }, immun: 66000, rangs: [[0, 4], [1, 2000], ['x', 3], [0, 9]],
      camp: ['g4', 0], remedes: [['épidémie:p4.2', 'p4.2', 'n4:3', 30], ['quête', 'p4.2', 'n4:3', 3]], journal: ['Jour 3 : test', 7],
    };
    const s = sanitizeEventSave(JSON.parse(JSON.stringify(raw)));
    expect(s.out).toEqual([['r25.3', 'r1234'], ['b4.2', 'a99999:16:0']]);
    expect(s.jour).toBe(41);
    expect(s.vus).toEqual(['r25.3', 'f3.1']);
    expect(s.malade).toEqual({ nom: 'la toux grise', fin: 70000 });
    expect(s.rangs).toEqual([[0, 4], [1, 999]]);
    expect(s.camp).toEqual(['g4', 0]);
    expect(s.remedes).toEqual([['épidémie:p4.2', 'p4.2', 'n4:3', 9]]);
    expect(s.journal).toEqual(['Jour 3 : test']);
    expect(sanitizeEventSave(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it('les séquelles d’un raid durent quelques jours', () => { expect(RAID_RECOVER_DAYS).toBeGreaterThanOrEqual(2); });
});
