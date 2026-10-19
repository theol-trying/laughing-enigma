import { describe, it, expect } from 'vitest';
import { WorldSeed } from '@ascii-fort/core/Seed';
import { MacroWorld } from '@ascii-fort/worldgen/MacroWorld';
import { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import { CivWorld } from '@ascii-fort/worldgen/civilization/CivWorld';
import {
  Traffic, activeAt, timeOfActive, inWindow, routeAt, sanitizeConvoySave, parseOutcome, outcomeValue, TRAVEL, AMBUSH_WINDOW, WRECK_DAYS, PREP,
  type ConvoyPlan,
} from '@ascii-fort/sim/gameplay/Caravans';

// Étape 53 : trafic des routes, logique pure (sans jeu ni rendu).

const seed = new WorldSeed('TEST-001');
const macro = MacroWorld.generate(seed);
const civ = Civilization.generate(macro);
const layouts = new CivWorld(civ).layouts;
const traffic = (active = true) => new Traffic(civ, seed, layouts, () => active);
const DAY = 1440;

describe('temps de route', () => {
  it('on ne voyage que de jour, et timeOfActive inverse activeAt', () => {
    const span = TRAVEL.to - TRAVEL.from;
    expect(activeAt(3 * DAY)).toBe(3 * span);
    expect(activeAt(3 * DAY + 12 * 60) - activeAt(3 * DAY + 11 * 60)).toBe(60);
    expect(activeAt(3 * DAY + 23 * 60)).toBe(activeAt(4 * DAY + 5 * 60));   // la nuit ne compte pas
    for (const t of [2 * DAY + 7 * 60, 5 * DAY + 19 * 60 + 59, 9 * DAY + 13 * 60 + 17]) expect(timeOfActive(activeAt(t))).toBeCloseTo(t, 6);
    expect(inWindow(DAY + 12 * 60)).toBe(true);
    expect(inWindow(DAY + 21 * 60)).toBe(false);
  });
});

describe('itinéraires', () => {
  const tr = traffic();
  it('chaque route a un itinéraire praticable qui part et arrive au bord des implantations', () => {
    let usable = 0;
    for (const r of civ.roads) {
      const route = tr.route(r.id);
      if (!route) continue;
      usable++;
      expect(route.s1 - route.s0).toBeGreaterThan(60);
      const a = civ.settlements[r.a], b = civ.settlements[r.b], p = { x: 0, z: 0, dx: 0, dz: 0 };
      routeAt(route, route.s0, p);
      expect(Math.hypot(p.x - a.x, p.z - a.z)).toBeGreaterThanOrEqual(6.5);
      expect(Math.hypot(p.x - a.x, p.z - a.z)).toBeLessThan(a.radius + 60);
      routeAt(route, route.s1, p);
      expect(Math.hypot(p.x - b.x, p.z - b.z)).toBeLessThan(b.radius + 60);
    }
    expect(usable).toBeGreaterThan(civ.roads.length * 0.8);
  });

  it('le chariot ne traverse aucun bâtiment, mur ni tour (marge d’un mètre)', () => {
    let checked = 0;
    for (const r of civ.roads) {
      const route = tr.route(r.id);
      if (!route) continue;
      const p = { x: 0, z: 0, dx: 0, dz: 0 };
      for (let s = route.s0; s <= route.s1; s += 1.5) {
        routeAt(route, s, p);
        for (const L of layouts) {
          if (Math.abs(L.x - p.x) > L.radius + 60 || Math.abs(L.z - p.z) > L.radius + 60) continue;
          for (const b of L.buildings) {
            const c = Math.cos(b.yaw), sn = Math.sin(b.yaw), dx = p.x - b.x, dz = p.z - b.z;
            const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
            expect(Math.abs(lx) < b.w / 2 + 1 && Math.abs(lz) < b.d / 2 + 1, `route ${r.id} dans ${b.kind} de ${L.sid}`).toBe(false);
          }
          for (const t of L.towers) expect(Math.hypot(t.x - p.x, t.z - p.z), `route ${r.id} dans une tour`).toBeGreaterThan(t.r + 0.9);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('l’itinéraire suit la route (détours de quelques mètres autour d’un obstacle bâti sur la chaussée)', () => {
    const p = { x: 0, z: 0, dx: 0, dz: 0 };
    for (const r of civ.roads) {
      const route = tr.route(r.id);
      if (!route) continue;
      let off = 0, n = 0, worst = 0;
      for (let s = route.s0; s <= route.s1; s += 10) {
        routeAt(route, s, p);
        const near = civ.roadIndex.nearest(p.x, p.z);
        n++;
        if (!near || near.d > 1.5) off++;
        worst = Math.max(worst, near ? near.d : 99);
      }
      expect(off / n, `route ${r.id}`).toBeLessThan(0.15);
      expect(worst, `route ${r.id}`).toBeLessThan(10);
    }
  });
});

describe('convois', () => {
  const tr = traffic(), tr2 = traffic();
  const all: ConvoyPlan[] = [];
  for (let d = 2; d < 40; d++) for (const r of civ.roads) all.push(...tr.plans(r.id, d));

  it('départs déterministes : deux simulations indépendantes donnent les mêmes convois', () => {
    for (const r of civ.roads) for (const d of [3, 11, 27]) expect(tr2.plans(r.id, d)).toEqual(tr.plans(r.id, d));
    const p = all[17], s1 = tr.stateAt(p, p.depart + 300, undefined), s2 = tr2.stateAt(tr2.plan(p.id)!, p.depart + 300, undefined);
    expect(s2).toEqual(s1);
    expect(tr.plan(p.id)).toBe(p);
    expect(tr.members(p).map((m) => m.npc.first)).toEqual(tr2.members(p).map((m) => m.npc.first));
  });

  it('densité : régulière sur les grandes routes, rare sur les petites ; toutes les sortes de convois existent', () => {
    const per = (kind: 1 | 2) => { const roads = civ.roads.filter((r) => r.kind === kind && tr.route(r.id)); return all.filter((p) => civ.roads[p.road].kind === kind).length / (roads.length * 38); };
    expect(per(2)).toBeGreaterThan(1);
    expect(per(1)).toBeLessThan(0.6);
    for (const k of ['caravane', 'pèlerins', 'colporteur', 'messager', 'patrouille']) expect(all.some((p) => p.kind === k), k).toBe(true);
    const crew = all.filter((p) => p.kind === 'caravane').map((p) => tr.members(p));
    expect(crew.every((m) => m.length >= 2 && m.length <= 4 && m[0].role === 'marchand' && m[1].role === 'charretier')).toBe(true);
  });

  it('position : avance le jour, s’arrête la nuit, part et arrive au bord du village', () => {
    const p = all.find((x) => x.kind === 'caravane' && !x.ambush && x.len > 900)!;
    expect(tr.stateAt(p, p.depart - PREP - 1, undefined).mode).toBe('absent');
    expect(tr.stateAt(p, p.depart - 5, undefined).mode).toBe('départ');
    let last = -1, nights = 0;
    const route = tr.route(p.road)!, q = { x: 0, z: 0, dx: 0, dz: 0 };
    for (let t = p.depart; t < p.depart + 6 * DAY; t += 37) {
      const st = tr.stateAt(p, t, undefined);
      if (st.mode === 'absent') break;
      expect(st.u).toBeGreaterThanOrEqual(last);
      if (st.mode === 'halte' || st.mode === 'auberge') { nights++; expect(inWindow(t)).toBe(false); }
      if (st.mode === 'route') expect(inWindow(t)).toBe(true);
      routeAt(route, p.fwd ? route.s0 + st.u : route.s1 - st.u, q);
      expect(Math.hypot(q.x - st.x, q.z - st.z)).toBeLessThan(0.01);
      last = st.u;
    }
    expect(last).toBe(p.len);
    if (p.len / p.speed > TRAVEL.to - TRAVEL.from) expect(nights).toBeGreaterThan(0);
    // la nuit, il ne bouge plus
    const night = Math.floor(p.depart / DAY) * DAY + 22 * 60, a = tr.stateAt(p, night, undefined), b = tr.stateAt(p, night + 6 * 60, undefined);
    if (a.mode === 'halte') expect(b.u).toBe(a.u);
  });

  it('près des voyageurs : near() ne rend que les convois proches et présents', () => {
    const p = all.find((x) => x.kind === 'caravane')!, t = p.depart + 200, st = tr.stateAt(p, t, undefined);
    const list = tr.near(st.x, st.z, t, 50, () => undefined);
    expect(list.some((n) => n.plan === p)).toBe(true);
    expect(list.every((n) => n.d <= 50 && n.st.mode !== 'absent' && n.st.mode !== 'auberge')).toBe(true);
  });
});

describe('embuscades', () => {
  const campPoi = civ.pois.find((p) => p.kind === 'camp de bandits' && p.roadId >= 0)!;

  it('près d’un camp de bandits debout : les convois de sa route sont souvent attaqués près du camp ; plus après son démantèlement', () => {
    const on = traffic(true), off = traffic(false);
    const near: number[] = [];
    let total = 0, offAmbush = 0;
    for (let d = 2; d < 60; d++) for (const p of on.plans(campPoi.roadId, d)) {
      if (p.kind !== 'caravane' && p.kind !== 'pèlerins' && p.kind !== 'colporteur') continue;
      total++;
      if (p.ambush?.camp === campPoi.settlementId) {
        const pt = { x: 0, z: 0, h: 0 };
        on.at(p, p.ambush.u, pt);
        near.push(Math.hypot(pt.x - campPoi.x, pt.z - campPoi.z));
      }
      const q = off.plans(campPoi.roadId, d).find((x) => x.id === p.id)!;
      if (q.ambush?.camp === campPoi.settlementId) offAmbush++;
      expect(q.kind).toBe(p.kind);   // l'état du camp ne décale aucun autre tirage
      expect(q.depart).toBe(p.depart);
    }
    expect(total).toBeGreaterThan(5);
    expect(near.length / total).toBeGreaterThan(0.3);
    expect(Math.max(...near)).toBeLessThan(250);
    expect(offAmbush).toBe(0);
  });

  it('les routes dangereuses sont plus souvent attaquées ; ni les patrouilles ni les messagers ne le sont', () => {
    const tr = traffic(false), rate = (pred: (g: number) => boolean) => {
      let n = 0, a = 0;
      for (const r of civ.roads) {
        if (!tr.route(r.id) || !pred(tr.danger(r.id))) continue;
        for (let d = 2; d < 80; d++) for (const p of tr.plans(r.id, d)) {
          if (p.kind === 'patrouille' || p.kind === 'messager') { expect(p.ambush).toBeNull(); continue; }
          n++; if (p.ambush) a++;
        }
      }
      return a / Math.max(1, n);
    };
    const low = rate((g) => g <= 3), high = rate((g) => g >= 5);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(0.05);
  });

  it('issue sans témoin : pillé (épave quelques jours) ou repoussée (le convoi repart) ; une issue observée l’emporte', () => {
    const tr = traffic(true), all: ConvoyPlan[] = [];
    for (let d = 2; d < 80; d++) for (const r of civ.roads) all.push(...tr.plans(r.id, d).filter((p) => p.ambush));
    const lost = all.find((p) => p.ambush!.loses)!, won = all.find((p) => !p.ambush!.loses)!;
    expect(lost && won).toBeTruthy();
    const am = lost.ambush!;
    expect(tr.stateAt(lost, am.t + 1, undefined).mode).toBe('embuscade');
    expect(tr.stateAt(lost, am.t + AMBUSH_WINDOW + 1, undefined).mode).toBe('épave');
    expect(tr.stateAt(lost, am.t + AMBUSH_WINDOW + WRECK_DAYS * DAY + 1, undefined).mode).toBe('absent');
    const w = won.ambush!, after = tr.stateAt(won, w.t + AMBUSH_WINDOW + 120, undefined);
    expect(['route', 'halte', 'auberge', 'arrivée', 'absent']).toContain(after.mode);
    if (after.mode !== 'absent') expect(after.u).toBeGreaterThanOrEqual(w.u);
    // sauvé par le joueur : le convoi pillé « d'office » repart à l'heure dite
    const saved = tr.stateAt(lost, am.t + 30, { k: 's', t: am.t + 20 });
    expect(saved.mode === 'route' || saved.mode === 'halte').toBe(true);
    expect(saved.u).toBeGreaterThanOrEqual(am.u);
    expect(tr.stateAt(lost, am.t + 10, { k: 's', t: am.t + 20 }).mode).toBe('embuscade');
    expect(tr.stateAt(won, w.t + 5, { k: 'p', t: w.t + 3 }).mode).toBe('épave');
    // les pillages du jour sont retrouvés partout (prix, rumeurs)
    const day = Math.floor((am.t + AMBUSH_WINDOW) / DAY);
    expect(tr.pillagedOn(day, () => undefined).some((x) => x.plan === lost)).toBe(true);
    expect(tr.pillagedOn(day, (id) => (id === lost.id ? { k: 's', t: am.t + 10 } : undefined)).some((x) => x.plan === lost)).toBe(false);
  });

  it('convoi et embuscade de la console', () => {
    const tr = traffic(true), r = civ.roads[0], pt = r.points[r.points.length >> 1], t = 5 * DAY + 10 * 60;
    const p = tr.spawnDev(pt.x, pt.z, t, 'caravane')!;
    expect(p.kind).toBe('caravane');
    const st = tr.stateAt(p, t, undefined);
    expect(st.mode).toBe('route');
    expect(Math.hypot(st.x - pt.x, st.z - pt.z)).toBeLessThan(45);
    tr.forceAmbush(p, t, st.u, 4);
    expect(tr.stateAt(p, t + 1, undefined).mode).toBe('embuscade');
    expect(p.ambush!.bandits).toBe(4);
  });
});

describe('sauvegarde des convois', () => {
  it('issues, membres tués, courses et remises survivent à un aller-retour ; les valeurs invalides sont écartées', () => {
    const save = {
      out: [['12.3.1', 'p17400'], ['12.4.0', 's17460'], ['x', 'zz'], ['12.3.1', 's1']],
      dead: ['v12.3.1:2', 'n4:1', 42],
      courses: [{ id: 'course:5:12.3.1', item: 'quête:lettre:12.3.1:Rochecourt', from: 1, to: 5, npc: 'n5:3', due: 14, gold: 40, xp: 60 }, { id: 'bad' }],
      remises: [['m3:1', 0.85], ['m3:1', 0.5], ['x', 0.1], ['m2:0', 0.1]],
      jour: 12, vus: ['12.3.1', 7],
    };
    const s = sanitizeConvoySave(JSON.parse(JSON.stringify(save)));
    expect(s.out).toEqual([['12.3.1', 'p17400'], ['12.4.0', 's17460']]);
    expect(s.dead).toEqual(['v12.3.1:2']);
    expect(s.courses).toHaveLength(1);
    expect(s.remises).toEqual([['m3:1', 0.85], ['m2:0', 0.6]]);
    expect(s.jour).toBe(12);
    expect(s.vus).toEqual(['12.3.1']);
    const empty = sanitizeConvoySave(undefined);
    expect(empty.out).toEqual([]); expect(empty.courses).toEqual([]); expect(empty.jour).toBe(-1);
    expect(parseOutcome(outcomeValue({ k: 's', t: 1234.6 }))).toEqual({ k: 's', t: 1235 });
    expect(parseOutcome('q12')).toBeNull();
  });
});
