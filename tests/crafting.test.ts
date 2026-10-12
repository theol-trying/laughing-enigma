import { describe, it, expect } from 'vitest';
import { ITEMS, item, QUALITY, QUALITY_BASES, withDur, durOf, baseId, plainId, cleanId, wearable, wearOf, Inventory } from '@ascii-fort/sim/gameplay/Items';
import { Character } from '@ascii-fort/sim/gameplay/Character';
import { RECIPES, WORKSHOP_TABS, SOURCES, recipesFor, maxBatch, craft, outQty, repairNeed, repairAt } from '@ascii-fort/sim/gameplay/Crafting';
import { bushLoot } from '@ascii-fort/sim/gameplay/Loot';
import { B } from '@ascii-fort/worldgen/terrain/Biomes';

const rec = (id: string) => RECIPES.find((r) => r.id === id)!;

describe('artisanat', () => {
  it('recettes cohérentes', () => {
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    for (const r of RECIPES) {
      expect(ITEMS.has(r.out), r.out).toBe(true);
      if (r.quality) expect(ITEMS.has(r.out + QUALITY), r.out + QUALITY).toBe(true);
      const seen = new Set<string>();
      for (const g of r.ins) {
        if (g.ids.length > 1) expect(g.label, r.id).toBeTruthy();
        for (const id of g.ids) {
          expect(ITEMS.has(id), `${r.id} : ${id}`).toBe(true);
          expect(wearable(item(id)), id).toBe(false);
          expect(SOURCES[id], `source de ${id}`).toBeTruthy();
          expect(seen.has(id), `${r.id} : ${id} répété`).toBe(false);
          seen.add(id);
        }
      }
    }
    for (const tabs of Object.values(WORKSHOP_TABS)) for (const t of tabs) if (t !== 'Réparer') expect(recipesFor(t).length, t).toBeGreaterThan(0);
    expect(RECIPES.filter((r) => r.quality).map((r) => r.out).sort()).toEqual([...QUALITY_BASES].sort());
  });

  it('fabrication en lot', () => {
    const inv = new Inventory();
    inv.add('lingot de fer', 5); inv.add('cuir', 3);
    expect(maxBatch(inv, rec('épée courte'), 10)).toBe(2);
    const res = craft(inv, rec('épée courte'), 5, 10, () => 1)!;
    expect(res.made).toBe(2);
    expect(inv.count('lingot de fer')).toBe(1);
    expect(inv.count('cuir')).toBe(1);
    expect(inv.count('épée courte')).toBe(2);
    expect(maxBatch(inv, rec('épée longue'), 5)).toBe(0);
    expect(craft(inv, rec('épée longue'), 1, 5)).toBeNull();
  });

  it('flèches et qualité', () => {
    expect(outQty(rec('flèche'), 37)).toBe(11);
    const inv = new Inventory();
    inv.add('branche', 1); inv.add('bois', 1); inv.add('lingot de fer', 3);
    craft(inv, rec('flèche'), 1, 37);
    expect(inv.count('flèche')).toBe(11);
    expect(inv.count('branche')).toBe(0);
    expect(inv.count('bois')).toBe(1);
    inv.add('cuir');
    const res = craft(inv, rec('épée courte'), 1, 50, () => 0)!;
    expect(res.good).toBe(1);
    expect(inv.count('épée courte de qualité')).toBe(1);
    expect(item('épée courte de qualité').weapon!.damage).toBe(13);
  });

  it('état d’usure dans l’id', () => {
    expect(withDur('épée courte', 100)).toBe('épée courte');
    expect(withDur('épée courte', 40)).toBe('épée courte~40');
    expect(withDur('épée courte~40', -5)).toBe('épée courte~0');
    expect(durOf('épée courte')).toBe(100);
    expect(durOf('épée courte~40')).toBe(40);
    expect(durOf('épée courte~abc')).toBe(100);
    expect(baseId('épée courte de qualité~40')).toBe('épée courte de qualité');
    expect(plainId('épée courte de qualité~40')).toBe('épée courte');
    const w = item('épée courte~40');
    expect(item('épée courte~40')).toBe(w);
    expect(w.name).toBe('Épée courte (40 %)');
    expect(w.weapon!.damage).toBe(9);
    expect(w.value).toBeLessThan(item('épée courte').value);
    expect(item('épée courte~0').name).toBe('Épée courte (hors d’usage)');
    expect(item('cotte de mailles~20').armor!.value).toBe(6);
    expect(cleanId('pain~50')).toBe('pain');
    expect(cleanId('épée courte~100')).toBe('épée courte');
    expect(wearOf(item('cotte de mailles de qualité'))).toBe(300);
  });

  it('usure, casse et réparation', () => {
    const ch = new Character();
    ch.inv.add('épée courte');
    ch.equipItem('épée courte');
    expect(ch.wear('arme', 60, () => 1)).toEqual({ slot: 'arme', id: 'épée courte~70', from: 100, to: 70 });
    expect(ch.inv.count('épée courte')).toBe(0);
    expect(ch.wear('arme', 1, () => 0.9)).toBeNull();
    ch.wear('arme', 1000, () => 1);
    expect(ch.equip.arme).toBe('épée courte~0');
    expect(ch.weapon).toBeNull();
    ch.inv.add('lingot de fer', 2);
    expect(repairNeed('épée courte~0')).toEqual({ mat: 'lingot de fer', n: 1, skill: 0 });
    expect(repairAt(ch, ['épée courte~0']).fixed).toEqual(['épée courte']);
    expect(ch.equip.arme).toBe('épée courte');
    expect(ch.inv.count('lingot de fer')).toBe(1);
  });

  it('armure usée et piles distinctes', () => {
    const ch = new Character();
    ch.inv.add('cotte de mailles~20');
    ch.equipItem('cotte de mailles~20');
    expect(ch.armor).toBe(6);
    const c2 = new Character();
    c2.inv.add('épée courte', 2);
    c2.equipItem('épée courte');
    c2.wear('arme', 2, () => 1);
    expect(c2.equip.arme).toBe('épée courte~99');
    expect(c2.inv.count('épée courte')).toBe(1);
    expect(c2.isEquipped('épée courte')).toBe(false);
  });

  it('cueillette', () => {
    expect(bushLoot(B.FOREST, () => 0).map((l) => l.id)).toEqual(['baies', 'champignon', 'herbe médicinale']);
    expect(bushLoot(B.SNOW, () => 0.99)).toEqual([{ id: 'baies', qty: 1 }]);
  });
});
