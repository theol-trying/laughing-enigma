import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { WorldSeed } from '@ascii-fort/core/Seed';
import { MacroWorld } from '@ascii-fort/worldgen/MacroWorld';
import { World } from '@ascii-fort/worldgen/World';
import { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import { CivWorld } from '@ascii-fort/worldgen/civilization/CivWorld';
import { hasDistricts, craftOf } from '@ascii-fort/worldgen/civilization/Districts';
import type { Layout, Building } from '@ascii-fort/worldgen/civilization/Layout';
import { generateNPCs, generateDistrictNPCs } from '@ascii-fort/sim/entities/NPC';
import { houseForSale } from '@ascii-fort/sim/gameplay/Estate';
import { NavGrid } from '@ascii-fort/sim/ai/Pathfinding';
import { resolveSpot, blockAt, stallSpot } from '@ascii-fort/sim/ai/Schedule';
import { doorPassages } from '@ascii-fort/sim/entities/EntityManager';
import { diceOutcome, STALLS, CRAFT_DEFS } from '@ascii-fort/sim/gameplay/Market';
import { segDist } from '@ascii-fort/core/math';
import { Game } from '../src/game/Game';
import type { DialogueNode } from '@ascii-fort/sim/gameplay/Dialogue';

// Étape 55 : quartiers des villes. RÈGLE : ajout sans déplacement (GENERATOR_VERSION inchangée). Le plan d'origine et les PNJ
// d'origine sont figés par une empreinte relevée AVANT l'étape 55 ; les ajouts (en fin de liste) ne chevauchent rien, sont
// déterministes, et leurs PNJ prennent les numéros suivants.

/** Empreintes du contenu d'origine (plans : préfixe des bâtiments et des décors, murs, tours, champs ; PNJ de generateNPCs et
 *  maison à vendre), relevées sur le code de l'étape 54 : elles ne doivent jamais changer. */
const FROZEN: Record<string, { layouts: string; npcs: string }> = {
  'TEST-001': { layouts: 'b4dfe6aff5143592b8897d0630372926ca02d93f', npcs: 'dd0283bca47e201c5f77f6ed57a705ea3a5e1d4a' },
  'TEST-002': { layouts: '3f64448fc1a209a55f544aabe0ee284a2d98ff1f', npcs: '609ea42bf4a338e574af9ed1e7a4d5d3c35171fc' },
};

const worlds = new Map<string, { civ: Civilization; layouts: Layout[] }>();
function world(seed: string) {
  let w = worlds.get(seed);
  if (!w) { const civ = Civilization.generate(MacroWorld.generate(new WorldSeed(seed))); w = { civ, layouts: new CivWorld(civ).layouts }; worlds.set(seed, w); }
  return w;
}

function fingerprint(seed: string): { layouts: string; npcs: string } {
  const { civ, layouts } = world(seed);
  const lay = createHash('sha1'), npc = createHash('sha1');
  for (const L of layouts) {
    const nb = L.base!.buildings, nd = L.base!.decor;
    lay.update(JSON.stringify({ sid: L.sid, poi: L.poiId, x: L.x, z: L.z, r: L.radius, plaza: L.plaza, b: L.buildings.slice(0, nb).map((b) => ({ ...b, floorY: 0 })), w: L.walls, t: L.towers, d: L.decor.slice(0, nd), f: L.fields }));
    if (L.sid < 0) continue;
    const s = civ.settlements[L.sid], list = generateNPCs(civ, s, L);
    npc.update(JSON.stringify(list));
    npc.update(String(houseForSale(s.id, s.type, L.buildings, list)));
  }
  return { layouts: lay.digest('hex'), npcs: npc.digest('hex') };
}

// ---------------------------------------------------------------- géométrie des contrôles
interface R { x: number; z: number; c: number; s: number; hw: number; hd: number }
const rect = (b: Pick<Building, 'x' | 'z' | 'yaw' | 'w' | 'd'>): R => ({ x: b.x, z: b.z, c: Math.cos(b.yaw), s: Math.sin(b.yaw), hw: b.w / 2, hd: b.d / 2 });
function overlap(a: R, b: R, m: number): boolean {
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [ux, uz] of [[a.c, -a.s], [a.s, a.c], [b.c, -b.s], [b.s, b.c]]) {
    const ra = (a.hw + m) * Math.abs(a.c * ux - a.s * uz) + (a.hd + m) * Math.abs(a.s * ux + a.c * uz);
    const rb = b.hw * Math.abs(b.c * ux - b.s * uz) + b.hd * Math.abs(b.s * ux + b.c * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}
function pointDist(r: R, x: number, z: number): number {
  const dx = x - r.x, dz = z - r.z, lx = dx * r.c - dz * r.s, lz = dx * r.s + dz * r.c;
  return Math.hypot(Math.max(Math.abs(lx) - r.hw, 0), Math.max(Math.abs(lz) - r.hd, 0));
}
/** Distance approchée segment–rectangle (échantillons tous les 0,25 m). */
function segDistRect(r: R, ax: number, az: number, bx: number, bz: number): number {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
  let d = Infinity;
  for (let i = 0; i <= n; i++) d = Math.min(d, pointDist(r, ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n));
  return d;
}
const doorFront = (b: Building): R => { const c = Math.cos(b.yaw), s = Math.sin(b.yaw), lz = b.d / 2 + 1.5; return { x: b.x + b.doorX * c + lz * s, z: b.z - b.doorX * s + lz * c, c, s, hw: 0.8, hd: 1.4 }; };

describe('quartiers des villes : le plan d’origine ne bouge pas', () => {
  for (const seed of Object.keys(FROZEN)) {
    it(`${seed} : préfixe des plans et PNJ d’origine identiques à l’étape 54`, () => {
      expect(fingerprint(seed)).toEqual(FROZEN[seed]);
    });
  }

  it('les ajouts sont en fin de liste : ids = indices, quartier marqué, décors et clés à la suite', () => {
    const { civ, layouts } = world('TEST-001');
    let added = 0;
    for (const L of layouts) {
      expect(L.base).toBeDefined();
      L.buildings.forEach((b, i) => { expect(b.id).toBe(i); expect(b.quarter !== undefined).toBe(i >= L.base!.buildings); });
      L.decor.forEach((d, i) => expect(d.key.endsWith(`:d${i}`)).toBe(true));
      const s = L.sid >= 0 ? civ.settlements[L.sid] : null;
      if (!s || !hasDistricts(s)) { expect(L.buildings.length).toBe(L.base!.buildings); expect(L.decor.length).toBe(L.base!.decor); expect(L.district).toBeUndefined(); }
      added += L.buildings.length - L.base!.buildings;
    }
    expect(added).toBeGreaterThan(100);
    // les hameaux restent petits
    for (const s of civ.settlements) if (s.type === 'hameau') expect(layouts.find((l) => l.sid === s.id)!.district).toBeUndefined();
  });

  it('les ajouts sont déterministes (même seed : mêmes ajouts ; autre seed : autres ajouts)', () => {
    const civ = world('TEST-001').civ;
    const again = new CivWorld(Civilization.generate(MacroWorld.generate(new WorldSeed('TEST-001')))).layouts;
    const tail = (ls: Layout[]) => JSON.stringify(ls.map((L) => [L.buildings.slice(L.base!.buildings).map((b) => ({ ...b, floorY: 0 })), L.decor.slice(L.base!.decor), L.district ?? null]));
    expect(tail(again)).toBe(tail(world('TEST-001').layouts));
    expect(tail(world('TEST-002').layouts)).not.toBe(tail(world('TEST-001').layouts));
    // PNJ des quartiers : deux générations identiques
    for (const s of civ.settlements) {
      const L = world('TEST-001').layouts.find((l) => l.sid === s.id);
      if (!L?.district) continue;
      const base = generateNPCs(civ, s, L);
      expect(JSON.stringify(generateDistrictNPCs(civ, s, L, base))).toBe(JSON.stringify(generateDistrictNPCs(civ, s, L, generateNPCs(civ, s, L))));
    }
  });
});

describe('quartiers des villes : programme et placement', () => {
  for (const seed of ['TEST-001', 'TEST-002', 'FORT-42']) {
    it(`${seed} : tavernes, marché, quartiers ; rien ne chevauche (bâtiments, portes, murs, tours, routes, place, champs, décors)`, () => {
      const { civ, layouts } = world(seed);
      let towns = 0;
      for (const L of layouts) {
        const D = L.district;
        if (!D) continue;
        const s = civ.settlements[L.sid], town = ['bourg', 'ville', 'capitale'].includes(s.type), nb = L.base!.buildings, added = L.buildings.slice(nb);
        if (town) {
          towns++;
          expect(D.taverns.length, `${s.name} : au moins une taverne`).toBeGreaterThanOrEqual(1);
          expect(D.stalls.length, `${s.name} : étals`).toBeGreaterThanOrEqual(3);
          if (s.type !== 'bourg') expect(D.taverns.length).toBeGreaterThanOrEqual(2);
          for (const id of D.taverns) {
            const b = L.buildings[id], kinds = b.furniture.map((f) => f.kind);
            expect(b.kind).toBe('taverne'); expect(b.name.startsWith('Taverne ')).toBe(true); expect(b.doorX).toBe(0);
            expect(kinds.includes('comptoir') && kinds.includes('âtre') && kinds.filter((k) => k === 'tonneau').length >= 3 && kinds.filter((k) => k === 'table').length >= 4).toBe(true);
          }
          expect(new Set(D.quarters.map((q) => q.kind)).size, `${s.name} : quartiers`).toBeGreaterThanOrEqual(s.type === 'bourg' ? 2 : 3);
        }
        for (const b of added) if (b.kind === 'atelier') expect(craftOf(b)).not.toBeNull();
        const roads = civ.roads.flatMap((r) => r.points.slice(1).map((p, i) => ({ a: r.points[i], b: p, w: r.width })));
        for (const b of added) {
          const r = rect(b), where = `${s.name} : ${b.kind} ${b.id}`;
          for (const o of L.buildings) if (o !== b) {
            expect(overlap(r, rect(o), 1.2), `${where} chevauche ${o.kind} ${o.id}`).toBe(false);
            expect(overlap(doorFront(o), r, 0), `${where} devant la porte de ${o.kind} ${o.id}`).toBe(false);
          }
          for (const w of L.walls) expect(segDistRect(r, w.ax, w.az, w.bx, w.bz), `${where} contre un mur`).toBeGreaterThan(2);
          for (const t of L.towers) expect(pointDist(r, t.x, t.z), `${where} contre une tour`).toBeGreaterThan(t.r + 1);
          if (L.plaza) expect(pointDist(r, L.plaza.x, L.plaza.z), `${where} sur la place`).toBeGreaterThan(L.plaza.r + 1);
          for (const f of L.fields) expect(overlap(r, rect(f), 1), `${where} dans un champ`).toBe(false);
          for (const d of L.decor.slice(0, L.base!.decor)) expect(pointDist(r, d.x, d.z), `${where} sur un décor (${d.kind})`).toBeGreaterThan(0.6);
          for (const q of roads) if (Math.abs(q.a.x - b.x) < 80 && Math.abs(q.a.z - b.z) < 80) expect(segDistRect(r, q.a.x, q.a.z, q.b.x, q.b.z), `${where} sur une route`).toBeGreaterThan(q.w / 2 + 1.5);
          expect(Math.hypot(b.x - s.x, b.z - s.z)).toBeLessThan(s.radius + 8);
        }
        // nouveaux étals : sur la place ou à son bord, à l'écart des chaussées, des bâtiments et des autres étals
        for (const st of D.stalls.filter((x) => !x.existing)) {
          expect(L.decor[st.decor].kind).toBe('étal');
          for (const q of roads) if (Math.abs(q.a.x - st.x) < 60 && Math.abs(q.a.z - st.z) < 60) expect(segDist(st.x, st.z, q.a.x, q.a.z, q.b.x, q.b.z).d).toBeGreaterThan(3.5);
          for (const o of L.buildings) expect(pointDist(rect(o), st.x, st.z)).toBeGreaterThan(3);
          for (const o of D.stalls) if (o !== st) expect(Math.hypot(o.x - st.x, o.z - st.z)).toBeGreaterThan(4);
          expect(Math.hypot(st.x - L.plaza!.x, st.z - L.plaza!.z)).toBeLessThan(L.plaza!.r + 1);
        }
        // placettes et ruelles : jamais sur un bâtiment
        for (const q of D.squares) for (const o of L.buildings) expect(pointDist(rect(o), q.x, q.z)).toBeGreaterThan(q.r);
        for (const q of D.paths) for (const o of L.buildings) expect(segDistRect(rect(o), q.ax, q.az, q.bx, q.bz)).toBeGreaterThan(0.3);
      }
      expect(towns).toBeGreaterThan(4);
    });
  }
});

describe('quartiers des villes : habitants', () => {
  const { civ, layouts } = world('TEST-001');
  it('PNJ d’origine intacts, nouveaux PNJ à la suite (numéros suivants), au plus +50 %, logés dans les bâtiments ajoutés', () => {
    let total = 0;
    for (const s of civ.settlements) {
      const L = layouts.find((l) => l.sid === s.id);
      if (!L?.district) continue;
      const base = generateNPCs(civ, s, L), add = generateDistrictNPCs(civ, s, L, base);
      expect(add.length).toBeLessThanOrEqual(Math.floor(base.length * 0.5));
      add.forEach((n, k) => {
        expect(n.id).toBe(`n${s.id}:${base.length + k}`);
        expect(n.quarter).toBeDefined(); expect(n.title).toBeTruthy();
        expect(L.buildings[n.home]?.quarter, `${n.id} loge dans un bâtiment ajouté`).toBeDefined();
        if (n.work >= 0) expect(L.buildings[n.work].quarter).toBeDefined();
        if (n.stall !== undefined) expect(L.district!.stalls[n.stall]).toBeDefined();
        let covered = 0;
        for (const blk of n.schedule) covered += blk.to - blk.from;
        expect(covered).toBe(1440);
        if (n.stall !== undefined) expect(n.title).toBe(STALLS[L.district!.stalls[n.stall].kind][n.sex]);
        if (n.profession === 'tavernier') expect(n.title).toBe(n.sex === 'f' ? 'tavernière' : 'tavernier');
        if (n.work >= 0 && craftOf(L.buildings[n.work])) expect(n.title).toBe(CRAFT_DEFS[craftOf(L.buildings[n.work])!][n.sex]);
      });
      // chaque étal a son marchand, chaque taverne son tenancier (quand le budget le permet)
      if (add.length === Math.floor(base.length * 0.5) || add.length >= L.district.taverns.length + L.district.stalls.length) {
        for (const id of L.district.taverns) expect(add.some((n) => n.profession === 'tavernier' && n.work === id)).toBe(true);
        L.district.stalls.forEach((_, i) => expect(add.some((n) => n.stall === i)).toBe(true));
      }
      total += add.length;
    }
    expect(total).toBeGreaterThan(60);
  });

  it('les nouveaux bâtiments sont accessibles : portes, étals, comptoir et cheminée des tavernes (grille de navigation)', () => {
    const w = new World(new WorldSeed('TEST-001'), null);
    for (const type of ['capitale', 'bourg', 'village']) {
      const s = w.civ.settlements.find((x) => x.type === type && w.civWorld.layouts.find((l) => l.sid === x.id)?.district)!;
      const L = w.civWorld.layouts.find((l) => l.sid === s.id)!, D = L.district!;
      w.chunks.update(s.x, s.z, -1);
      const grid = NavGrid.build(w.chunks, s.x, s.z, s.radius + 55, doorPassages(L));
      const from = L.plaza ? { x: L.plaza.x + L.plaza.r * 0.3, z: L.plaza.z + L.plaza.r * 0.3 } : { x: s.x, z: s.z };
      const reach = (x: number, z: number, what: string) => {
        const path = grid.findPath(from.x, from.z, x, z);
        expect(path, `${s.name} : ${what}`).not.toBeNull();
        const end = path![path!.length - 1];
        expect(Math.hypot(end.x - x, end.z - z), `${s.name} : ${what} (arrivée)`).toBeLessThan(2.2);
      };
      for (const b of L.buildings.slice(L.base!.buildings)) {
        const c = Math.cos(b.yaw), sn = Math.sin(b.yaw), lz = b.d / 2 - 1.6;
        reach(b.x + b.doorX * c + lz * sn, b.z - b.doorX * sn + lz * c, `entrée de ${b.kind} ${b.id}`);
      }
      for (const st of D.stalls) { const a = stallSpot(st, true), b = stallSpot(st, false); reach(a.x, a.z, 'marchand d’un étal'); reach(b.x, b.z, 'client d’un étal'); }
      const npcs = generateDistrictNPCs(w.civ, s, L, generateNPCs(w.civ, s, L));
      for (const n of npcs) for (const blk of n.schedule) {
        const sp = resolveSpot(n, blk, L, (blk.from + 30) / 60, 3);
        if (sp.lying) continue;
        reach(sp.x, sp.z, `${n.title} (${blk.act}, ${blk.place})`);
      }
      void blockAt;
    }
  });

  it('règle des dés : le plus gros total, un double bat tout, égalité', () => {
    expect(diceOutcome([6, 5], [4, 4])).toBe('perdu');
    expect(diceOutcome([2, 2], [6, 5])).toBe('gagné');
    expect(diceOutcome([5, 5], [3, 3])).toBe('gagné');
    expect(diceOutcome([6, 3], [5, 4])).toBe('égalité');
    expect(diceOutcome([1, 2], [3, 1])).toBe('perdu');
  });
});

// ---------------------------------------------------------------- jeu complet
const renderer = { createMesh: () => ({}), deleteMesh() {}, render() {}, ui: {} } as never;
const input = { isDown: () => false, pressed: () => false, key: () => false, mouseDown: () => false, mouseClicked: () => false, mouseReleased: () => false, locked: true, mouseDX: 0, mouseDY: 0, wheel: 0, doubleTapped: null, muted: false } as never;

describe('jeu complet : marché et taverne', () => {
  const g = new Game('TEST-001', renderer);
  g.ui = { openDialogue() {}, openTrade() {}, openScreen() {} };
  g.god = true;
  g.weatherOverride = 'clair';
  const frame = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) g.update(dt, input); };
  const pick = (node: DialogueNode | null, starts: string): DialogueNode | null => {
    const o = node!.options.find((x) => x.label.startsWith(starts));
    expect(o, `option « ${starts} » parmi : ${node!.options.map((x) => x.label).join(' | ')}`).toBeDefined();
    return o!.go();
  };
  const dev = (cmd: string, ...args: string[]) => { const r = g.quarters.dev(cmd, args); expect(r.some((l) => l.err), r.map((l) => l.text).join(' / ')).toBe(false); return r; };

  it('PNJ du lieu : ceux d’origine d’abord (mêmes ids), puis les habitants des quartiers', () => {
    for (const s of g.world.civ.settlements) {
      const L = g.world.civWorld.layouts.find((l) => l.sid === s.id);
      if (!L?.district) continue;
      const all = g.entities.npcsOf(s.id), base = generateNPCs(g.world.civ, s, L);
      expect(all.slice(0, base.length).map((n) => n.id)).toEqual(base.map((n) => n.id));
      expect(g.entities.baseNpcsOf(s.id).map((n) => n.id)).toEqual(base.map((n) => n.id));
      expect(all.length).toBeLessThanOrEqual(Math.floor(base.length * 1.5));
      for (const n of all.slice(base.length)) expect(g.entities.findNpc(n.id)).toBe(n);
      // la maison à vendre est choisie dans le plan d'origine, comme avant
      expect(g.entities.saleHouse(s.id)).toBe(houseForSale(s.id, s.type, L.buildings, base));
    }
  });

  it('marché : étals tenus le jour, marchandises de la région, étalage visible, bâches la nuit, criées', () => {
    g.time.setClock(10);
    const r = dev('marché', 'Belmorne');
    expect(r[0].text).toContain('Belmorne');
    frame(30);
    const L = g.world.civWorld.layouts.find((l) => l.sid === 0)!, D = L.district!;
    const sellers = g.entities.zones.get(0)!.ents.filter((e) => e.npc?.stall !== undefined);
    expect(sellers.length).toBe(D.stalls.length);
    const at = sellers.filter((e) => { const sp = stallSpot(D.stalls[e.npc!.stall!], true); return Math.hypot(sp.x - e.x, sp.z - e.z) < 2.5; });
    expect(at.length).toBeGreaterThan(D.stalls.length / 2);
    const stock = g.stockOf(sellers[0]);
    expect(stock.length).toBeGreaterThan(0);
    expect(g.dialogue.start(sellers[0]).options.some((o) => o.label.startsWith('Montre-moi tes marchandises'))).toBe(true);
    const n0 = g.instances.count;
    g.quarters.render(g.instances, g.player.x, g.player.z);
    const day = g.instances.count - n0;
    expect(day).toBeGreaterThan(D.stalls.length * 5);
    g.time.setClock(23);
    const n1 = g.instances.count;
    g.quarters.render(g.instances, g.player.x, g.player.z);
    expect(g.instances.count - n1).toBe(D.stalls.length * 4);
    g.time.setClock(10);
    let cried = false;
    for (let i = 0; i < 600 && !cried; i++) { frame(); cried = g.quarters.bubbles.some((b) => b.t > 0 && b.e?.npc?.stall !== undefined); }
    expect(cried).toBe(true);
    expect(g.quarters.place).toBe('place du marché');
  });

  it('taverne : tenancier, commandes au comptoir, rumeurs, tournée, dés contre un client, barde', () => {
    g.time.setClock(20, 30);
    const r = dev('taverne', 'Belmorne');
    expect(r[0].text).toContain('Taverne');
    frame(40);
    const L = g.world.civWorld.layouts.find((l) => l.sid === 0)!, D = L.district!;
    const ents = g.entities.zones.get(0)!.ents;
    const near = D.taverns.map((id) => L.buildings[id]).sort((a, b) => Math.hypot(a.x - g.player.x, a.z - g.player.z) - Math.hypot(b.x - g.player.x, b.z - g.player.z))[0];
    const keeper = ents.find((e) => e.npc?.profession === 'tavernier' && e.npc.work === near.id)!;
    expect(keeper).toBeDefined();
    g.character.inv.gold = 500;
    let node: DialogueNode | null = g.dialogue.start(keeper);
    expect(node!.options.length).toBeLessThanOrEqual(10);
    expect(node!.options.some((o) => o.label.startsWith('Montre-moi tes marchandises'))).toBe(true);
    // une chope au comptoir : payée et bue sur place
    node = pick(node, 'Qu’as-tu à boire');
    const gold = g.character.inv.gold;
    node = pick(node, 'Une chope de bière');
    expect(g.character.inv.gold).toBeLessThan(gold);
    expect(g.character.inv.count('bière')).toBe(0);
    node = pick(node, 'Autre chose');   // retour à la carte
    node = pick(node, 'Autre chose');   // retour au menu du tavernier
    node = pick(node, 'Quelles rumeurs');
    expect(node!.lines.length).toBeGreaterThanOrEqual(2);
    node = pick(node, 'Autre chose');
    const before = g.rep.local.get(0) ?? 0, g0 = g.character.inv.gold;
    node = pick(node, 'Payer une tournée');
    expect(g.character.inv.gold).toBeLessThan(g0);
    expect(g.rep.local.get(0) ?? 0).toBe(before + 3);
    expect(node!.lines[0]).toContain('tournée');
    // un client attablé : partie de dés réellement jouée (l'or change de main, ou égalité)
    const client = ents.find((e) => e.alive && e.npc && e.npc.profession !== 'tavernier' && e.npc.profession !== 'barde' && e.npc.profession !== 'garde' && e.npc.profession !== 'soldat' && e !== keeper)!;
    const c = Math.cos(near.yaw), sn = Math.sin(near.yaw);
    client.x = near.x + 1.5 * sn; client.z = near.z + 1.5 * c; client.thinkT = 99;
    let dn = pick(g.dialogue.start(client), 'Une partie de dés');
    const g1 = g.character.inv.gold;
    dn = pick(dn, 'Miser 5 or');
    expect(dn!.note?.text).toMatch(/^Tu lances \d et \d/);
    expect([g1 - 5, g1, g1 + 5]).toContain(g.character.inv.gold);
    for (let i = 0; i < 20 && dn!.options.some((o) => o.label === 'Miser 25 or'); i++) dn = pick(dn, 'Miser 25 or');
    expect(dn!.options.some((o) => o.label === 'Pas ce soir.' || o.label === 'Au revoir.')).toBe(true);
    // la soirée : bulles des clients, barde (s'il joue ici ce soir), lieu affiché (le joueur entre dans la taverne)
    { const p = g.player, lz = near.d / 2 - 1.5; p.x = near.x + lz * sn; p.z = near.z + lz * c; p.y = g.entities.ground(p.x, p.z, p.y + 2); }
    frame(400);
    expect(g.quarters.place).toBe(near.name);
    const bard = ents.find((e) => e.npc?.profession === 'barde');
    if (bard && Math.hypot(bard.x - g.player.x, bard.z - g.player.z) < 6) expect(g.quarters.bardPlaying).toBe(true);
  });

  it('console : quartiers d’un lieu', () => {
    const r = dev('quartiers', 'Belmorne');
    expect(r[0].text).toMatch(/Belmorne \(capitale\) : \d+ bâtiments d’origine \+ \d+ ajoutés/);
    expect(r.some((l) => l.text.startsWith('PNJ : 40 d’origine + 20 nouveaux'))).toBe(true);
  });
});
