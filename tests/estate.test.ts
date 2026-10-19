import { describe, it, expect } from 'vitest';
import { WorldSeed } from '@ascii-fort/core/Seed';
import { World } from '@ascii-fort/worldgen/World';
import { generateNPCs } from '@ascii-fort/sim/entities/NPC';
import { Inventory } from '@ascii-fort/sim/gameplay/Items';
import {
  HOUSE_TYPES, MIN_HOUSES, CHEST_MAX_STACKS, CHEST_MAX_QTY, housePrice, houseForSale, rehomeHouses, insideRect, rectOf, footprints, doorOutside,
  depositable, moveItem, moveGold, sanitizeEstate,
} from '@ascii-fort/sim/gameplay/Estate';

describe('prix de la maison', () => {
  it('toujours entre 1500 et 3000 or, 0 pour un lieu sans maison à vendre, la capitale coûte plus que le village', () => {
    for (const t of HOUSE_TYPES) for (let area = 30; area <= 70; area += 5) {
      const p = housePrice(t, area, 1);
      expect(p).toBeGreaterThanOrEqual(1500); expect(p).toBeLessThanOrEqual(3000); expect(p % 10).toBe(0);
    }
    expect(housePrice('hameau', 7, 7)).toBe(0); expect(housePrice('château', 7, 7)).toBe(0);
    expect(housePrice('capitale', 7, 7)).toBeGreaterThan(housePrice('village', 7, 7));
    expect(housePrice('ville', 8, 8)).toBeGreaterThan(housePrice('ville', 6, 6));
  });
});

describe('maison à vendre : choix et libération (monde de test)', () => {
  for (const seedText of ['TEST-001', 'FORT-42']) {
    const world = new World(new WorldSeed(seedText), null), civ = world.civ;
    it(`${seedText} : déterministe, libérée proprement, idempotente, génération intacte`, () => {
      let eligible = 0, evicted = 0;
      for (const s of civ.settlements) {
        if (s.abandoned || s.type === 'camp') continue;
        const L = world.civWorld.layouts.find((l) => l.sid === s.id)!;
        const npcs = generateNPCs(civ, s, L), fresh = generateNPCs(civ, s, L);
        const sale = houseForSale(s.id, s.type, L.buildings, npcs);
        expect(houseForSale(s.id, s.type, L.buildings, fresh)).toBe(sale);
        const maisons = L.buildings.filter((b) => b.kind === 'maison' && !b.ruined);
        if (sale === null) { expect(!HOUSE_TYPES.includes(s.type) || maisons.length < MIN_HOUSES || !npcs.some((n) => n.profession === 'aubergiste')).toBe(true); continue; }
        eligible++;
        const b = L.buildings[sale];
        expect(b.kind).toBe('maison'); expect(b.ruined).toBe(false);
        expect(npcs.some((n) => n.home === sale && n.profession === 'guérisseuse')).toBe(false);
        expect(b.furniture.some((f) => f.kind === 'coffre')).toBe(true); expect(b.furniture.some((f) => f.kind === 'lit')).toBe(true);
        const before = npcs.filter((n) => n.home === sale).map((n) => n.id);
        const moved = rehomeHouses(L.buildings, npcs, [sale]);
        expect(moved).toBe(before.length); evicted += moved;
        expect(npcs.some((n) => n.home === sale)).toBe(false);
        expect(npcs.length).toBe(fresh.length);
        const dests = new Set(npcs.filter((n) => before.includes(n.id)).map((n) => n.home));
        expect(dests.size).toBeLessThanOrEqual(1);
        for (const d of dests) expect(L.buildings[d].kind).toBe('maison');
        for (const n of npcs) expect(L.buildings[n.home]).toBeDefined();
        // seul `home` a changé
        npcs.forEach((n, i) => expect({ ...n, home: 0 }).toEqual({ ...fresh[i], home: 0 }));
        expect(rehomeHouses(L.buildings, npcs, [sale])).toBe(0);
        expect(houseForSale(s.id, s.type, L.buildings, npcs)).toBe(sale);
      }
      expect(eligible).toBeGreaterThanOrEqual(10);
      expect(evicted).toBeGreaterThan(0);
    });
  }

  it('une maison achetée en plus de celle à vendre est libérée aussi', () => {
    const world = new World(new WorldSeed('TEST-001'), null), civ = world.civ;
    const s = civ.settlements.find((x) => x.type === 'capitale')!, L = world.civWorld.layouts.find((l) => l.sid === s.id)!;
    const npcs = generateNPCs(civ, s, L), sale = houseForSale(s.id, s.type, L.buildings, npcs)!;
    const other = L.buildings.find((b) => b.kind === 'maison' && b.id !== sale && npcs.some((n) => n.home === b.id))!.id;
    rehomeHouses(L.buildings, npcs, [sale, other]);
    expect(npcs.some((n) => n.home === sale || n.home === other)).toBe(false);
  });
});

describe('géométrie des bâtiments', () => {
  const b = { x: 100, z: 200, yaw: 0.7, w: 6, d: 8, doorX: 0.5, ruined: false };
  it('empreinte orientée, ruines ignorées, point devant la porte hors du bâtiment', () => {
    const r = rectOf(b);
    expect(insideRect(r, 100, 200)).toBe(true); expect(insideRect(r, 110, 200)).toBe(false);
    // un coin local (2.9, 3.9) est dedans, (3.2, 0) dehors, quel que soit le cap
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw), at = (lx: number, lz: number) => [b.x + lx * c + lz * s, b.z - lx * s + lz * c] as const;
    expect(insideRect(r, ...at(2.9, 3.9))).toBe(true); expect(insideRect(r, ...at(3.2, 0))).toBe(false); expect(insideRect(r, ...at(0, 4.2))).toBe(false);
    const L = { x: 100, z: 200, radius: 40, buildings: [{ ...b, id: 0 }, { ...b, id: 1, ruined: true }] } as never;
    expect(footprints([L], 100, 200).length).toBe(1);
    expect(footprints([L], 100, 5000).length).toBe(0);
    expect(footprints([L], 100 + 40 + 70, 200).length).toBe(1);   // fermes et granges : jusqu'à radius + 52 m du centre
    const d = doorOutside(b, 3.5);
    expect(insideRect(r, d.x, d.z)).toBe(false);
    expect(Math.hypot(d.x - at(b.doorX, b.d / 2)[0], d.z - at(b.doorX, b.d / 2)[1])).toBeCloseTo(3.5, 5);
    expect(Math.hypot(Math.sin(d.heading) * 1 - (b.x - d.x) / Math.hypot(b.x - d.x, b.z - d.z), 0)).toBeLessThan(1e-9);
  });
});

describe('coffre : transferts sans duplication', () => {
  const total = (a: Inventory, b: Inventory, id: string) => a.count(id) + b.count(id);
  it('conserve la somme, borne la quantité, garde l’exemplaire équipé', () => {
    const bag = new Inventory(), chest = new Inventory();
    bag.add('pain', 5); bag.add('épée courte', 1);
    expect(moveItem(bag, chest, 'pain', 3)).toBe(3); expect([bag.count('pain'), chest.count('pain')]).toEqual([2, 3]);
    expect(moveItem(bag, chest, 'pain', 99)).toBe(2); expect(total(bag, chest, 'pain')).toBe(5); expect(bag.items.has('pain')).toBe(false);
    expect(moveItem(bag, chest, 'pain', 1)).toBe(0); expect(moveItem(bag, chest, 'pain', -2)).toBe(0); expect(moveItem(bag, chest, 'pain', NaN)).toBe(0);
    expect(moveItem(bag, chest, 'épée courte', 1, { keep: 1 })).toBe(0);
    expect(moveItem(chest, bag, 'pain', 5)).toBe(5); expect(chest.items.size).toBe(0);
  });
  it('l’usure voyage avec l’id : « épée courte~62 » reste distincte de « épée courte »', () => {
    const bag = new Inventory(), chest = new Inventory();
    bag.add('épée courte~62', 1); bag.add('épée courte', 2);
    moveItem(bag, chest, 'épée courte~62', 1); moveItem(bag, chest, 'épée courte', 1);
    expect(chest.count('épée courte~62')).toBe(1); expect(chest.count('épée courte')).toBe(1); expect(chest.count('épée courte~100')).toBe(0);
    moveItem(chest, bag, 'épée courte~62', 1);
    expect(bag.count('épée courte~62')).toBe(1);
  });
  it('plafond de piles (120) et de quantité (9999)', () => {
    const bag = new Inventory(), chest = new Inventory();
    for (let i = 0; i < CHEST_MAX_STACKS; i++) chest.add(`épée courte~${i}`, 1);
    bag.add('pain', 3); bag.add('épée courte~7', 1); bag.add('os', 20000);
    expect(moveItem(bag, chest, 'pain', 1, { maxStacks: CHEST_MAX_STACKS })).toBe(0);      // nouvelle pile refusée
    expect(moveItem(bag, chest, 'épée courte~7', 1, { maxStacks: CHEST_MAX_STACKS })).toBe(1);   // pile existante acceptée
    expect(moveItem(bag, chest, 'os', 20000, { maxQty: CHEST_MAX_QTY, maxStacks: 999 })).toBe(CHEST_MAX_QTY);
    expect(moveItem(bag, chest, 'os', 20000, { maxQty: CHEST_MAX_QTY, maxStacks: 999 })).toBe(0);
    expect(total(bag, chest, 'os')).toBe(20000);
  });
  it('ni quête ni clé ; l’or se déplace sans création', () => {
    expect(depositable('pain')).toBe(true); expect(depositable('épée courte~40')).toBe(true);
    expect(depositable('quête:relique:3')).toBe(false); expect(depositable('clé:donjon:1')).toBe(false);
    const a = { gold: 100 }, b = { gold: 5 };
    expect(moveGold(a, b, 30)).toBe(30); expect([a.gold, b.gold]).toEqual([70, 35]);
    expect(moveGold(a, b, 1000)).toBe(70); expect([a.gold, b.gold]).toEqual([0, 105]);
    expect(moveGold(a, b, 5)).toBe(0); expect(moveGold(b, a, -3)).toBe(0); expect(moveGold(b, a, 1.9)).toBe(1);
  });
});

describe('sauvegarde de la propriété', () => {
  it('champ absent ou invalide = rien possédé', () => {
    for (const bad of [undefined, null, 3, 'x', [], {}]) expect(sanitizeEstate(bad)).toEqual({});
    expect(sanitizeEstate({ house: { sid: -1, bid: 2 } }).house).toBeUndefined(); expect(sanitizeEstate({ house: { sid: 1.5, bid: 2 } }).house).toBeUndefined();
  });
  it('assainit : ids connus nettoyés, doublons fusionnés, quêtes et clés écartées, plafonds', () => {
    const chest: unknown[] = [['pain', 2], ['pain', 3], ['épée courte~100', 1], ['épée courte~62', 1], ['objet inventé', 4], ['quête:relique:3', 1], ['clé:donjon:1', 1], ['os', -2], ['os', NaN], 'junk', ['os', 99999]];
    const e = sanitizeEstate({ house: { sid: 3, bid: 9 }, chest, gold: 1234.9, horse: { grade: 'bidet', x: 1, z: 2 } });
    expect(e.house).toEqual({ sid: 3, bid: 9 }); expect(e.gold).toBe(1234);
    const m = new Map(e.chest);
    expect(m.get('pain')).toBe(5); expect(m.get('épée courte')).toBe(1); expect(m.get('épée courte~62')).toBe(1); expect(m.get('os')).toBe(CHEST_MAX_QTY);
    expect(m.has('objet inventé') || m.has('quête:relique:3') || m.has('clé:donjon:1')).toBe(false);
    expect(e.horse?.grade).toBe('bidet');
    const many = Array.from({ length: 300 }, (_, i) => [`épée courte~${i % 100}`, 1]).concat(Array.from({ length: 300 }, (_, i) => [`pain`, i + 1]));
    expect(sanitizeEstate({ chest: many }).chest!.length).toBeLessThanOrEqual(CHEST_MAX_STACKS);
    expect(JSON.stringify(sanitizeEstate({ chest: many }).chest).length).toBeLessThan(5000);
  });
});
