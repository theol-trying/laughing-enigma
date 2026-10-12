import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Character } from '@ascii-fort/sim/gameplay/Character';
import { Inventory } from '@ascii-fort/sim/gameplay/Items';
import {
  TALENTS, TREES, FX_META, ROW_REQ, TALENT_BY_ID, talentPointsTotal, canLearn, refusalText, sanitizeTalents, findTalent, respecCost, type FxKey,
} from '@ascii-fort/sim/gameplay/Talents';
import { RECIPES, qualityChance, craft } from '@ascii-fort/sim/gameplay/Crafting';
import { sellCap } from '@ascii-fort/sim/gameplay/Economy';
import { playerNoise } from '@ascii-fort/sim/ai/Perception';
import { PlayerCombat } from '@ascii-fort/sim/gameplay/PlayerCombat';
import { hitPlayer } from '@ascii-fort/sim/gameplay/Combat';
import { Player } from '@ascii-fort/sim/entities/Player';
import { EventBus } from '@ascii-fort/core/Events';

const KEYS = Object.keys(FX_META) as FxKey[];
/** personnage de ce niveau avec ces talents (sans les payer) */
const lvl = (n: number, t: Record<string, number> = {}) => { const c = new Character(); c.level = n; c.talents = { ...t }; return c; };

describe('talents : données', () => {
  it('ids uniques, arbres complets, rangs cohérents', () => {
    expect(new Set(TALENTS.map((t) => t.id)).size).toBe(TALENTS.length);
    expect(TREES.map((t) => t.id)).toEqual(['guerrier', 'rodeur', 'mage', 'artisan']);
    expect(ROW_REQ).toEqual([0, 2, 4]);
    for (const tr of TREES) {
      const list = TALENTS.filter((t) => t.tree === tr.id);
      expect(list.length, tr.id).toBeGreaterThanOrEqual(6);
      expect(list.length, tr.id).toBeLessThanOrEqual(8);
      for (const row of [1, 2, 3]) expect(list.some((t) => t.row === row), `${tr.id} rangée ${row}`).toBe(true);
      // la rangée 3 doit être atteignable : 4 rangs au moins dans les rangées 1 et 2
      expect(list.filter((t) => t.row < 3).reduce((a, t) => a + t.max, 0), tr.id).toBeGreaterThanOrEqual(4);
    }
    for (const t of TALENTS) {
      expect(t.id).toMatch(/^[a-z]+$/);
      expect(t.max).toBeGreaterThanOrEqual(1);
      expect(t.max).toBeLessThanOrEqual(3);
      expect(t.name.length, t.name).toBeLessThanOrEqual(16);
      expect(t.desc.length, t.id).toBeGreaterThan(10);
      expect(t.desc.length, t.id).toBeLessThanOrEqual(120);
      const keys = Object.keys(t.fx) as FxKey[];
      expect(keys.length, t.id).toBeGreaterThan(0);
      for (const k of keys) { expect(FX_META[k], k).toBeTruthy(); expect(t.fx[k]!, `${t.id}/${k}`).toBeGreaterThan(0); }
    }
  });
  it('chaque effet est porté par au moins un talent', () => {
    for (const k of KEYS) expect(TALENTS.some((t) => k in t.fx), k).toBe(true);
  });
});

describe('talents : points', () => {
  it('un point tous les 3 niveaux', () => {
    expect([0, 1, 2, 3, 5, 6, 12, 30].map(talentPointsTotal)).toEqual([0, 0, 0, 1, 1, 2, 4, 10]);
  });
  it('rétroactif : un niveau 9 sans talent a 3 points', () => {
    const c = lvl(9);
    expect(c.talentPoints()).toBe(3);
    expect(c.learnTalent('lame')).toBe(true);
    expect(c.talentPoints()).toBe(2);
    expect(c.talentSpent()).toBe(1);
  });
  it('l’expérience qui franchit le niveau 3 donne le point', () => {
    const c = new Character();
    expect(c.talentPoints()).toBe(0);
    c.gainXp(383); // 100 + 283 : niveau 3 pile
    expect(c.level).toBe(3);
    expect(c.talentPoints()).toBe(1);
  });
  it('jamais négatif, refus sans point', () => {
    expect(lvl(3, { lame: 3, souffle: 3 }).talentPoints()).toBe(0);
    const c = lvl(3);
    expect(c.learnTalent('lame')).toBe(true);
    expect(c.canLearnTalent('souffle')).toEqual({ ok: false, why: 'points' });
    expect(c.learnTalent('souffle')).toBe(false);
    expect(c.talentRank('souffle')).toBe(0);
  });
});

describe('talents : prérequis de rangée', () => {
  it('rangée 2 : 2 points dans l’arbre', () => {
    const c = lvl(30);
    expect(c.canLearnTalent('garde')).toEqual({ ok: false, why: 'rangee', need: 2, have: 0 });
    c.learnTalent('lame');
    expect(c.canLearnTalent('garde')).toMatchObject({ ok: false, why: 'rangee', need: 2, have: 1 });
    c.learnTalent('souffle'); // le point peut aller à un autre talent du même arbre
    expect(c.canLearnTalent('garde').ok).toBe(true);
    expect(c.canLearnTalent('source')).toMatchObject({ why: 'rangee', have: 0 }); // les points d’un autre arbre ne comptent pas
    expect(c.canLearnTalent('arcane').ok).toBe(true);
  });
  it('rangée 3 : 4 points dans l’arbre', () => {
    const c = lvl(30);
    for (const id of ['lame', 'lame', 'souffle']) c.learnTalent(id);
    expect(c.canLearnTalent('enchainement')).toMatchObject({ ok: false, why: 'rangee', need: 4, have: 3 });
    c.learnTalent('garde');
    expect(c.canLearnTalent('enchainement').ok).toBe(true);
    expect(c.learnTalent('enchainement')).toBe(true);
  });
  it('rang maximal et textes de refus', () => {
    const c = lvl(30);
    for (let i = 0; i < 3; i++) expect(c.learnTalent('lame')).toBe(true);
    expect(c.canLearnTalent('lame')).toEqual({ ok: false, why: 'max' });
    expect(c.talentRank('lame')).toBe(3);
    expect(canLearn({}, 30, 'nimportequoi').why).toBe('inconnu');
    expect(refusalText(canLearn({}, 30, 'garde'), TALENT_BY_ID.get('garde'))).toBe('Rangée verrouillée : 2 points requis dans l’arbre Guerrier (vous en avez 0).');
  });
});

describe('talents : effets branchés (valeurs du personnage)', () => {
  const base = () => lvl(30);
  it('mêlée +8 % par rang, arc, sorts', () => {
    expect(lvl(30, { lame: 3 }).meleeMult()).toBeCloseTo(base().meleeMult() * 1.24, 6);
    expect(lvl(30, { tireur: 2, lynx: 1 }).bowMult()).toBeCloseTo(base().bowMult() * 1.36, 6);
    expect(lvl(30, { arcane: 3, archimage: 2 }).spellMult()).toBeCloseTo(base().spellMult() * 1.48, 6);
  });
  it('charge portée et mana maximal', () => {
    expect(base().carryMax()).toBe(90);
    expect(lvl(30, { portefaix: 3 }).carryMax()).toBe(120);
    expect(lvl(30, { reserve: 3, sagesse: 1 }).maxMana).toBe(base().maxMana + 44);
  });
  it('armure portée +20 % par rang (arrondie)', () => {
    const c = lvl(30, { cuirasse: 2 });
    c.equip.corps = 'cotte de mailles'; c.equip.tête = 'casque de fer'; // 9 + 3
    expect(c.armor).toBe(17); // 12 × 1,4 = 16,8
    expect(lvl(30).armor).toBe(0);
  });
  it('prix : achat plus bas, vente plus haute', () => {
    const c = lvl(30, { marchandage: 3, negociant: 3, magnat: 1 });
    expect(c.priceMult(true)).toBeCloseTo(base().priceMult(true) - 0.18, 6);
    expect(c.priceMult(false)).toBeCloseTo(base().priceMult(false) + 0.18, 6);
    expect(base().priceMult(true)).toBeCloseTo(1.235, 6);
  });
  it('usure réduite', () => {
    const wearOnce = (t: Record<string, number>) => { const c = lvl(30, t); c.inv.add('épée courte'); c.equip.arme = 'épée courte'; return c.wear('arme', 100, () => 0)!.id; };
    expect(wearOnce({})).toBe('épée courte~50');
    expect(wearOnce({ entretien: 3 })).toBe('épée courte~65');
    expect(wearOnce({ entretien: 3, maitre: 2 })).toBe('épée courte~75');
  });
  it('qualité : le bonus ne joue que sur les recettes de qualité, 90 % au plus', () => {
    const r = RECIPES.find((x) => x.id === 'épée courte')!;
    expect(qualityChance(r, 40, 0.24)).toBeCloseTo(Math.min(0.9, qualityChance(r, 40) + 0.24), 6);
    expect(qualityChance(r, 100, 0.5)).toBe(0.9);
    expect(qualityChance(RECIPES.find((x) => !x.quality)!, 100, 0.5)).toBe(0);
    const stock = () => { const inv = new Inventory(); inv.add('lingot de fer', 2); inv.add('cuir', 1); return inv; };
    expect(craft(stock(), r, 1, 100, () => 0.7)!.good).toBe(0); // 0,6 au plus sans talent
    expect(craft(stock(), r, 1, 100, () => 0.7, lvl(30, { orfevre: 3 }).qualityBonus())!.good).toBe(1);
  });
  it('bruit, discrétion, sournois, vol à la tire', () => {
    const walk = { sprinting: false, moving: true, crouch: false };
    expect(playerNoise(walk)).toBe(0.35);
    const v = lvl(30, { velours: 3 });
    expect(v.noiseMul()).toBeCloseTo(0.55, 6);
    expect(playerNoise({ ...walk, noiseMul: v.noiseMul() })).toBeCloseTo(0.1925, 6);
    expect(lvl(30, { ombre: 2 }).stealth()).toBeCloseTo(base().stealth() + 0.14, 6);
    expect(lvl(30, { sournois: 2 }).sneakBonus()).toBe(1);
    expect(lvl(30, { baladeuse: 2 }).pickpocketChance()).toBeCloseTo(base().pickpocketChance() + 0.24, 6);
  });
  it('parade, endurance, cadence, flèches', () => {
    expect(base().guard()).toBeCloseTo(0.35, 6);
    expect(lvl(30, { garde: 1 }).guard()).toBeCloseTo(0.315, 6);
    expect(lvl(30, { garde: 3 }).blockCost()).toBeCloseTo(1.2 * 0.76, 6);
    expect(lvl(30, { souffle: 3 }).staCostMult()).toBeCloseTo(0.76, 6);
    expect(lvl(30, { ecrasante: 2 }).heavyMult()).toBeCloseTo(2.2, 6);
    expect(lvl(30, { enchainement: 2 }).atkSpeedMult()).toBeCloseTo(1.2, 6);
    expect(lvl(30, { grace: 2 }).executeMult()).toBeCloseTo(1.4, 6);
    expect(lvl(30, { inebranlable: 1 }).staRegenMult()).toBeCloseTo(1.3, 6);
    expect(base().bowDrawTime()).toBeCloseTo(0.8, 6);
    expect(lvl(30, { cadence: 3 }).bowDrawTime()).toBeCloseTo(0.8 / 1.3, 6);
    expect(lvl(30, { cadence: 3 }).bowCooldown()).toBeCloseTo(0.35 / 1.3, 6);
    expect(lvl(30, { carquois: 3 }).arrowRecover()).toBeCloseTo(0.45, 6);
  });
  it('sorts : coût, régénération, durée, soin', () => {
    expect([1, 2, 3].map((n) => lvl(30, { econome: n }).manaCost(15))).toEqual([14, 13, 11]);
    expect(lvl(30, { econome: 3, archimage: 2 }).manaCost(100)).toBe(56);
    expect(lvl(30, { econome: 3, archimage: 2 }).manaCost(1)).toBe(1);
    expect(lvl(30, { source: 3 }).manaRegen()).toBeCloseTo(1.5 * 1.75, 6);
    expect([0, 1, 2].map((n) => lvl(30, { aura: n }).spellTime(20))).toEqual([20, 26, 32]);
    expect(lvl(30, { guerisseur: 2 }).healAmount()).toBeCloseTo(base().healAmount() * 1.5, 6);
  });
  it('crochetage', () => {
    expect(base().lockOpts()).toEqual({ width: 0, breakChance: 0.5 });
    const o = lvl(30, { crochetage: 3 }).lockOpts();
    expect(o.width).toBe(3);
    expect(o.breakChance).toBeCloseTo(0.2, 6);
  });
  it('aperçu « et si » : ne modifie pas le personnage', () => {
    const c = lvl(30, { lame: 1 }), p = c.previewTalent('lame', 3);
    expect(p.meleeMult()).toBeGreaterThan(c.meleeMult());
    expect(c.talentRank('lame')).toBe(1);
    expect(p.talentRank('lame')).toBe(3);
  });
  it('remise à zéro payante', () => {
    const c = lvl(9, { lame: 1 });
    c.inv.gold = respecCost(9) - 1;
    expect(c.respecTalents()).toBe(false);
    expect(c.talents).toEqual({ lame: 1 });
    c.inv.gold = respecCost(9) + 5;
    expect(c.respecTalents()).toBe(true);
    expect(c.inv.gold).toBe(5);
    expect(c.talentPoints()).toBe(3);
  });
});

describe('talents : câblage du combat', () => {
  const world = (ch: Character, p: Player) => ({ player: p, character: ch, events: new EventBus(), combat: {} as any, entities: [], heightAt: () => 0, onHit: () => {} });
  const idle = { key: () => false, doubleTapped: null, locked: false } as any;
  it('le coût en mana d’un sort tient compte des talents', () => {
    const p = new Player(), f = new PlayerCombat();
    p.mana = 12;
    f.castSpell('trait de feu', world(lvl(30), p)); // 15 mana : refusé
    expect(f.projectiles.length).toBe(0);
    expect(p.mana).toBe(12);
    f.castSpell('trait de feu', world(lvl(30, { econome: 3 }), p)); // 11 mana
    expect(f.projectiles.length).toBe(1);
    expect(p.mana).toBe(1);
  });
  it('le soin tient compte des talents', () => {
    const heal = (t: Record<string, number>) => { const p = new Player(); p.hp = 10; p.mana = 50; new PlayerCombat().castSpell('soin', world(lvl(30, t), p)); return p.hp - 10; };
    expect(heal({ guerisseur: 2 })).toBeCloseTo(heal({}) * 1.5, 6);
  });
  it('la parade et son coût sont posés à chaque image', () => {
    const p = new Player(), f = new PlayerCombat();
    f.update(0.016, idle, world(lvl(30, { garde: 3 }), p));
    expect(p.guard).toBeCloseTo(0.35 * 0.7, 6);
    expect(p.blockCost).toBeCloseTo(1.2 * 0.76, 6);
    f.update(0.016, idle, world(lvl(30), p));
    expect(p.guard).toBeCloseTo(0.35, 6);
    expect(p.blockCost).toBeCloseTo(1.2, 6);
  });
  it('le mana se régénère plus vite', () => {
    const regen = (t: Record<string, number>) => { const p = new Player(); p.maxMana = 100; p.mana = 0; new PlayerCombat().update(1, idle, world(lvl(30, t), p)); return p.mana; };
    expect(regen({})).toBeCloseTo(1.5, 6);
    expect(regen({ source: 3 })).toBeCloseTo(2.625, 6);
  });
  it('hitPlayer lit le coût de parade du joueur', () => {
    const p = new Player();
    p.blocking = true; p.stamina = 100; p.blockCost = 0.912;
    const host = { player: p, events: new EventBus(), onPlayerDeath() {}, playerArmor: () => 0 };
    hitPlayer(host as any, 10, { x: 0, z: -5 } as any); // cap 0 : l’attaquant est devant
    expect(p.stamina).toBeCloseTo(100 - 10 * 0.912, 6);
  });
});

describe('talents : commerce', () => {
  it('sellCap plafonne la revente à 90 % du prix d’achat', () => {
    expect(sellCap(10, 100)).toBe(10);
    expect(sellCap(95, 100)).toBe(90);
    expect(sellCap(5, 1)).toBe(1);
  });
  it('avec tous les talents de commerce, acheter puis revendre ne rapporte jamais', () => {
    const c = lvl(30, { marchandage: 3, negociant: 3, magnat: 1 });
    c.skills.commerce = 100; c.stats.PER = 10;
    const bad: string[] = [];
    for (const f of [0.8, 1, 1.5]) for (let v = 1; v <= 200; v++) {
      const buy = Math.max(1, Math.round(v * c.priceMult(true) * f)), sell = Math.max(1, Math.round(v * c.priceMult(false) * (2 - f)));
      if (sellCap(sell, buy) > buy) bad.push(`${f}/${v}`);
    }
    expect(bad).toEqual([]);
    // sans le plafond, le gain existerait (objet de 100 or, marchand neutre)
    expect(Math.round(100 * c.priceMult(false))).toBeGreaterThan(Math.round(100 * c.priceMult(true)));
  });
});

describe('talents : sauvegarde', () => {
  it('ids inconnus ignorés, rangs bornés, données invalides', () => {
    expect(sanitizeTalents({ lame: 5, inconnu: 2, tireur: 'x', garde: -1, arcane: 2.7, ombre: NaN })).toEqual({ lame: 3, arcane: 2 });
    for (const bad of [null, undefined, [], 'lame', 42]) expect(sanitizeTalents(bad)).toEqual({});
    expect(sanitizeTalents(JSON.parse('{"__proto__":{"lame":3},"lame":1}'))).toEqual({ lame: 1 });
  });
  it('ancienne sauvegarde sans talents : aucun talent, points rétroactifs', () => {
    expect(new Character().talents).toEqual({});
    const c = lvl(9, { lame: 2 });
    c.setTalents(undefined);
    expect(c.talents).toEqual({});
    expect(c.talentPoints()).toBe(3);
    c.setTalents(JSON.parse(JSON.stringify({ lame: 2, souffle: 1 })));
    expect(c.talentPoints()).toBe(0);
  });
  it('recherche par id ou par nom, accents tolérés', () => {
    expect(findTalent('Maîtrise').map((t) => t.id)).toEqual(['lame']);
    expect(findTalent('maitrise d\'armes').map((t) => t.id)).toEqual(['lame']);
    expect(findTalent('ombre').map((t) => t.id)).toEqual(['ombre']); // l’id exact l’emporte sur « Coup d’ombre »
    expect(findTalent('œil').map((t) => t.id)).toEqual(['lynx']);
    expect(findTalent('zzz')).toEqual([]);
    expect(findTalent('')).toEqual([]);
  });
});

describe('talents : aucun effet décoratif', () => {
  const fresh = () => { const c = lvl(99); c.equip.corps = 'cotte de mailles'; return c; };
  const OBSERVE: Record<FxKey, (c: Character) => number> = {
    melee: (c) => c.meleeMult(), staCost: (c) => c.staCostMult(), armorPct: (c) => c.armor, guard: (c) => c.guard(), blockSta: (c) => c.blockCost(),
    heavy: (c) => c.heavyMult(), atkSpeed: (c) => c.atkSpeedMult(), execute: (c) => c.executeMult(), staRegen: (c) => c.staRegenMult(),
    bow: (c) => c.bowMult(), bowRate: (c) => c.bowDrawTime(), noise: (c) => c.noiseMul(), arrowRecover: (c) => c.arrowRecover(),
    sneak: (c) => c.sneakBonus(), steal: (c) => c.pickpocketChance(), stealth: (c) => c.stealth(),
    spell: (c) => c.spellMult(), manaCost: (c) => c.manaCost(100), manaMax: (c) => c.maxMana, manaRegen: (c) => c.manaRegen(),
    spellTime: (c) => c.spellTime(100), heal: (c) => c.healAmount(),
    quality: (c) => c.qualityBonus(), wear: (c) => c.wearMult(), carry: (c) => c.carryMax(), buy: (c) => c.priceMult(true), sell: (c) => c.priceMult(false),
    lockW: (c) => c.lockOpts().width, lockBreak: (c) => c.lockOpts().breakChance,
  };
  it('chaque effet de chaque talent change une valeur du personnage', () => {
    for (const t of TALENTS) for (const k of Object.keys(t.fx) as FxKey[]) {
      const c = fresh(); c.talents = { [t.id]: t.max };
      expect(OBSERVE[k](c), `${t.id} / ${k}`).not.toBe(OBSERVE[k](fresh()));
    }
  });

  // ... et cette valeur est lue là où l'effet agit (fichier, extrait de code)
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = new Map<string, string>();
  for (const dir of ['src', 'packages/sim/src']) for (const f of readdirSync(join(root, dir), { recursive: true }) as string[]) if (f.endsWith('.ts')) files.set(`${dir}/${f}`.replace(/\\/g, '/'), readFileSync(join(root, dir, f), 'utf8'));
  const WIRING: Record<FxKey, [string, string]> = {
    melee: ['ch.meleeMult()', 'PlayerCombat.ts'], staCost: ['ch.staCostMult()', 'PlayerCombat.ts'], armorPct: ['character.armor', 'Game.ts'],
    guard: ['ch.guard()', 'PlayerCombat.ts'], blockSta: ['ch.blockCost()', 'PlayerCombat.ts'], heavy: ['ch.heavyMult()', 'PlayerCombat.ts'],
    atkSpeed: ['ch.atkSpeedMult()', 'PlayerCombat.ts'], execute: ['ch.executeMult()', 'PlayerCombat.ts'], staRegen: ['staRegenMult()', 'Game.ts'],
    bow: ['ch.bowMult()', 'PlayerCombat.ts'], bowRate: ['ch.bowCooldown()', 'PlayerCombat.ts'], noise: ['ch.noiseMul()', 'Game.ts'],
    arrowRecover: ['ch.arrowRecover()', 'PlayerCombat.ts'], sneak: ['sneakBonus()', 'Game.ts'], steal: ['pickpocketChance()', 'Game.ts'],
    stealth: ['talentFx(\'stealth\')', 'Game.ts'], spell: ['ch.spellMult()', 'PlayerCombat.ts'], manaCost: ['ch.manaCost(', 'PlayerCombat.ts'],
    manaMax: ['ch.maxMana', 'Game.ts'], manaRegen: ['ch.manaRegen()', 'PlayerCombat.ts'], spellTime: ['spellTime(', 'Game.ts'],
    heal: ['ch.healAmount()', 'PlayerCombat.ts'], quality: ['qualityBonus()', 'Game.ts'], wear: ['this.wearMult()', 'Character.ts'],
    carry: ['carryMax()', 'Game.ts'], buy: ['priceMult(true)', 'DialogueScreen.ts'], sell: ['priceMult(false)', 'DialogueScreen.ts'],
    lockW: ['lockOpts()', 'Game.ts'], lockBreak: ['lockOpts()', 'Game.ts'],
  };
  it('chaque effet est appelé là où il agit', () => {
    for (const k of KEYS) {
      const [needle, file] = WIRING[k];
      const src = [...files].find(([p]) => p.endsWith('/' + file))?.[1] ?? '';
      expect(src.includes(needle), `${k} : « ${needle} » absent de ${file}`).toBe(true);
    }
  });
});
