import { describe, it, expect } from 'vitest';
import { WorldSeed } from '@ascii-fort/core/Seed';
import {
  HORSE_GRADES, COATS, MOUNT, MERC, CONTRACT_MIN, horsePrice, horseOffer, mercLevel, mercPrice, mercStats, mercOffer, renewContract, canRenew,
  tickContract, contractLabel, gaitOf, tickHorse, newAlly, allyTargetable, worldOf, sanitizeHorse, sanitizeMerc, sanitizeMountWire, sanitizeMercWire,
  mercCode, type HorseGradeId, type MercArch,
} from '@ascii-fort/sim/gameplay/Companions';
import { horseModel, mercModel, creatureModel } from '@ascii-fort/sim/entities/Models';
import { Player } from '@ascii-fort/sim/entities/Player';
import { insideRect } from '@ascii-fort/sim/gameplay/Estate';
import { Entity } from '@ascii-fort/sim/entities/Entity';
import { makeMonster } from '@ascii-fort/sim/entities/Monster';
import { Character } from '@ascii-fort/sim/gameplay/Character';
import { PlayerCombat } from '@ascii-fort/sim/gameplay/PlayerCombat';
import { EventBus } from '@ascii-fort/core/Events';

const GRADES: HorseGradeId[] = ['bidet', 'palefroi', 'destrier'];
const ARCHS: MercArch[] = ['lame', 'lancier', 'hache'];

describe('cheval : prix, offres, endurance', () => {
  it('le prix reste entre 400 et 600 or, croît avec le grade', () => {
    for (const g of GRADES) for (const cm of [0.6, 1, 1.235, 1.25]) for (const nf of [0.8, 1, 1.5]) {
      const p = horsePrice(g, cm, nf);
      expect(p).toBeGreaterThanOrEqual(400); expect(p).toBeLessThanOrEqual(600); expect(p % 5).toBe(0);
    }
    expect(horsePrice('palefroi', 1.25, 1)).toBe(500);
    expect(horsePrice('bidet', 1.25, 1)).toBeLessThanOrEqual(horsePrice('palefroi', 1.25, 1));
    expect(horsePrice('palefroi', 1.25, 1)).toBeLessThanOrEqual(horsePrice('destrier', 1.25, 1));
  });

  it('l’offre d’un vendeur est déterministe ; le fermier ne vend que des bidets ; les capitales pas de bidet', () => {
    const seed = new WorldSeed('TEST-001');
    const a = horseOffer(seed, 3, 'ville', 5, 'n3:4', false, 1.2, 1), b = horseOffer(seed, 3, 'ville', 5, 'n3:4', false, 1.2, 1);
    expect(b).toEqual(a);
    expect(a.coat).toBeGreaterThanOrEqual(0); expect(a.coat).toBeLessThan(COATS.length);
    for (let w = 0; w < 30; w++) {
      expect(horseOffer(seed, 3, 'hameau', w, 'n3:1', true, 1, 1).grade).toBe('bidet');
      expect(horseOffer(seed, 3, 'capitale', w, 'n3:2', false, 1, 1).grade).not.toBe('bidet');
      expect(horseOffer(seed, 3, 'village', w, 'n3:3', false, 1, 1).grade).not.toBe('destrier');
    }
    expect(new Set(Array.from({ length: 30 }, (_, w) => horseOffer(seed, 3, 'ville', w, 'n3:4', false, 1, 1).name)).size).toBeGreaterThan(2);
  });

  it('galop : l’endurance se vide, essoufflé jusqu’à 30 %, le trot et l’arrêt la rendent', () => {
    const g = HORSE_GRADES.palefroi, h = { stamina: g.stamina, maxStamina: g.stamina, winded: false };
    let t = 0;
    while (!h.winded && t < 60) { tickHorse(h, g, 0.1, 'galop'); t += 0.1; }
    expect(t).toBeCloseTo(g.stamina / g.drain, 0);
    expect(h.stamina).toBe(0);
    tickHorse(h, g, 1, 'trot');
    expect(h.stamina).toBeCloseTo(MOUNT.trotRegen, 5); expect(h.winded).toBe(true);
    for (let i = 0; i < 40; i++) tickHorse(h, g, 0.1, 'trot');         // 5 + 20 = 25 sur 100 : 25 % < 30 %
    expect(h.winded).toBe(true);
    for (let i = 0; i < 10; i++) tickHorse(h, g, 0.1, 'trot');
    expect(h.winded).toBe(false);
    tickHorse(h, g, 100, 'arret');
    expect(h.stamina).toBe(g.stamina);
    expect(gaitOf(0.2, true)).toBe('arret'); expect(gaitOf(3, false)).toBe('trot'); expect(gaitOf(9, true)).toBe('galop');
  });
});

describe('mercenaire : prix, niveau, contrat', () => {
  it('150 or au niveau 1, plafonné, niveau = joueur − 1', () => {
    expect(mercPrice(1)).toBe(150); expect(mercPrice(100)).toBe(MERC.maxPrice);
    for (let l = 1; l < 40; l++) expect(mercPrice(l + 1)).toBeGreaterThanOrEqual(mercPrice(l));
    expect(mercLevel(1)).toBe(1); expect(mercLevel(10)).toBe(9);
  });
  it('statistiques croissantes, hache plus forte et plus lente, paliers 4 et 8', () => {
    for (const a of ARCHS) for (let l = 1; l < 30; l++) {
      const s0 = mercStats(l, a), s1 = mercStats(l + 1, a);
      expect(s1.hp).toBeGreaterThan(s0.hp); expect(s1.damage).toBeGreaterThanOrEqual(s0.damage); expect(s1.armor).toBeGreaterThanOrEqual(s0.armor);
    }
    expect(mercStats(5, 'hache').damage).toBeGreaterThan(mercStats(5, 'lame').damage);
    expect(mercStats(5, 'hache').atkCd).toBeGreaterThan(mercStats(5, 'lame').atkCd);
    expect([1, 3, 4, 7, 8, 20].map((l) => mercStats(l, 'lame').tier)).toEqual([0, 0, 1, 1, 2, 2]);
  });
  it('l’offre est déterministe pour un (lieu, semaine, auberge) et varie d’une semaine à l’autre', () => {
    const seed = new WorldSeed('TEST-001');
    const a = mercOffer(seed, 2, 'Belmorne', 4, 'n2:9', 6), b = mercOffer(seed, 2, 'Belmorne', 4, 'n2:9', 6);
    expect(b).toEqual(a);
    expect(a.level).toBe(5); expect(a.price).toBe(mercPrice(6)); expect(a.look).toBeGreaterThanOrEqual(0); expect(a.look).toBeLessThan(256);
    const names = new Set(Array.from({ length: 10 }, (_, w) => { const o = mercOffer(seed, 2, 'Belmorne', w, 'n2:9', 6); return `${o.first} ${o.last}`; }));
    expect(names.size).toBeGreaterThan(1);
  });
  it('contrat : 7 jours, renouvelable jusqu’à 14, ne descend jamais sous 0', () => {
    expect(renewContract(0)).toBe(7 * 1440); expect(renewContract(10 * 1440)).toBe(14 * 1440);
    expect(canRenew(7 * 1440)).toBe(true); expect(canRenew(7 * 1440 + 1)).toBe(false);
    expect(tickContract(100, 30)).toBe(70); expect(tickContract(10, 30)).toBe(0); expect(tickContract(100, -5)).toBe(100);
    expect(CONTRACT_MIN).toBe(10080);
    expect(contractLabel(5 * 1440 + 200)).toBe('5 j 3 h'); expect(contractLabel(150)).toBe('2 h'); expect(contractLabel(30)).toBe('moins d’une heure');
  });
});

describe('états, sauvegarde et réseau', () => {
  it('un compagnon à terre, monté ou gelé n’est plus une cible', () => {
    const a = newAlly('merc');
    expect(allyTargetable(a)).toBe(true);
    expect(allyTargetable({ ...a, ko: 3 })).toBe(false); expect(allyTargetable({ ...a, dormant: true })).toBe(false); expect(allyTargetable({ ...a, mounted: true })).toBe(false);
  });
  it('mondes : surface = −1, donjons par pas de 220 m', () => {
    expect([worldOf(100), worldOf(19899.9), worldOf(20000), worldOf(20000 + 100), worldOf(20000 + 220 * 3 + 80)]).toEqual([-1, -1, 0, 0, 3]);
    // les salles de la colonne 0 débordent à gauche de l'origine : même monde que le reste du donjon
    expect([worldOf(19992), worldOf(20000 + 220 - 8), worldOf(20000 + 220 * 2 - 8)]).toEqual([0, 1, 2]);
  });
  it('sanitizeHorse / sanitizeMerc : champ absent ou invalide = rien, valeurs bornées', () => {
    for (const bad of [undefined, null, 5, 'x', {}, { grade: 'licorne', x: 1, z: 1 }, { grade: 'bidet', x: NaN, z: 1 }, { grade: 'bidet', x: 1 }]) expect(sanitizeHorse(bad)).toBeNull();
    const h = sanitizeHorse({ grade: 'destrier', coat: -1, name: 'x'.repeat(99), hp: 9999, x: 10, z: 20, heading: 'a', stamina: -4, mounted: 1 })!;
    expect(h.coat).toBe(COATS.length - 1); expect(h.name.length).toBe(24); expect(h.hp).toBe(HORSE_GRADES.destrier.hp); expect(h.heading).toBe(0); expect(h.stamina).toBe(0); expect(h.mounted).toBe(false);
    for (const bad of [undefined, null, {}, { arch: 'arc' }, { arch: 'lame', left: 0 }, { arch: 'lame', left: -5 }]) expect(sanitizeMerc(bad)).toBeNull();
    const m = sanitizeMerc({ first: 'Aldric', last: 'Roche', sex: 'f', arch: 'lancier', look: 999, hp: 0, left: 1e9, mode: 'danse', x: 1, z: 'a' })!;
    expect(m.look).toBe(255); expect(m.hp).toBe(1); expect(m.left).toBe(14 * 1440); expect(m.mode).toBe('suivre'); expect(m.x).toBeUndefined(); expect(m.sex).toBe('f');
  });
  it('codes réseau : monture et mercenaire aller-retour, valeurs invalides ignorées', () => {
    expect([undefined, 0, 7, -2, NaN, 'a', 1, 6].map(sanitizeMountWire)).toEqual([0, 0, 0, 0, 0, 0, 1, 6]);
    for (const arch of ARCHS) for (const tier of [0, 1, 2] as const) for (const sex of ['m', 'f'] as const) {
      const w = sanitizeMercWire([1.5, 2.5, 0.3, mercCode(200, arch, tier, sex), 1])!;
      expect(w).toMatchObject({ x: 1.5, z: 2.5, h: 0.3, look: 200, arch, tier, sex, ko: true });
    }
    expect(sanitizeMercWire(undefined)).toBeNull(); expect(sanitizeMercWire([1, 2, 3])).toBeNull(); expect(sanitizeMercWire([1, 2, 3, NaN, 0])).toBeNull(); expect(sanitizeMercWire([1, 2, 3, 3 << 10, 0])).toBeNull();
  });
});

describe('modèles', () => {
  it('le cheval est plus grand que le cerf, une robe par modèle (modulo), moins de 64 os', () => {
    for (let c = 0; c < COATS.length; c++) { const m = horseModel(c); expect(m.height).toBeGreaterThan(creatureModel('cerf').height * 1.3); expect(m.bones.length).toBeLessThanOrEqual(64); expect(m.quad).toBe(true); }
    expect(horseModel(1)).toBe(horseModel(1 + COATS.length)); expect(horseModel(0)).not.toBe(horseModel(1));
    expect(horseModel(0).parts.some((p) => p.color === COATS[0].body)).toBe(true); expect(horseModel(4).parts.some((p) => p.color === COATS[4].mane)).toBe(true);
  });
  it('le mercenaire se construit pour toutes les combinaisons', () => {
    for (const arch of ARCHS) for (const tier of [0, 1, 2] as const) for (const sex of ['m', 'f'] as const) for (const look of [0, 77, 255]) {
      const m = mercModel(look, arch, tier, sex);
      expect(m.bones.length).toBeLessThanOrEqual(64); expect(m.letter).toBe('M');
    }
    expect(mercModel(5, 'lame', 1, 'm')).toBe(mercModel(5, 'lame', 1, 'm')); expect(mercModel(5, 'lame', 1, 'm')).not.toBe(mercModel(5, 'lame', 2, 'm'));
  });
});

describe('joueur à cheval', () => {
  const flat = { chunks: { collidersNear() {} }, heightAt: () => 0, waterAt: () => NaN } as never;
  const input = (keys: string[]) => ({ isDown: (c: string) => keys.includes(c), pressed: () => false, key: () => false, locked: true, mouseDX: 0, mouseDY: 0 }) as never;
  const run = (p: Player, keys: string[], secs: number) => { for (let i = 0; i < secs * 60; i++) p.update(1 / 60, input(keys), flat); };

  it('trot et galop plus rapides que la marche et la course ; marche arrière lente', () => {
    const walk = new Player(); run(walk, ['KeyW'], 3);
    const trot = new Player(); trot.mounted = true; trot.mountTrot = 8; run(trot, ['KeyW'], 3);
    const gal = new Player(); gal.mounted = true; gal.mountGallop = 12.5; run(gal, ['KeyW', 'ShiftLeft'], 3);
    const back = new Player(); back.mounted = true; back.mountTrot = 8; run(back, ['KeyS'], 3);
    expect(Math.hypot(walk.vx, walk.vz)).toBeCloseTo(4.2, 0);
    expect(Math.hypot(trot.vx, trot.vz)).toBeGreaterThan(7.5);
    expect(gal.sprinting).toBe(true); expect(Math.hypot(gal.vx, gal.vz)).toBeGreaterThan(12);
    expect(Math.hypot(back.vx, back.vz)).toBeLessThan(0.45 * 8 + 0.1);
  });
  it('cheval essoufflé : pas de galop ; l’endurance du joueur ne baisse pas', () => {
    const p = new Player(); p.mounted = true; p.mountTired = true; run(p, ['KeyW', 'ShiftLeft'], 2);
    expect(p.sprinting).toBe(false);
    const q = new Player(); q.mounted = true; q.stamina = 50; run(q, ['KeyW', 'ShiftLeft'], 1); q.tickStatus(1);
    expect(q.stamina).toBeGreaterThanOrEqual(50);
  });
  it('un bâtiment est fermé au cheval (on glisse le long) ; l’œil monte avec la selle', () => {
    const p = new Player(); p.mounted = true; p.x = 100; p.z = 100; p.mountLift = MOUNT.lift;
    p.keepOut = [{ cx: 100, cz: 90, hw: 4, hd: 4, yaw: 0 }];
    expect(insideRect(p.keepOut[0], 100, 90)).toBe(true);
    run(p, ['KeyW'], 2);                          // cap 0 : vers −z, droit dans le bâtiment (z de 100 à 94 : bord à 94)
    expect(p.blockedBuilding).toBe(true); expect(p.z).toBeGreaterThan(94 - 0.01);
    expect(p.eyeY).toBeCloseTo(p.y + 1.65 + 0.6, 5);
  });
  it('l’eau profonde est refusée', () => {
    const lake = { chunks: { collidersNear() {} }, heightAt: (x: number) => (x > 105 ? -3 : 0), waterAt: (x: number) => (x > 105 ? 0 : NaN) } as never;
    const p = new Player(); p.mounted = true; p.x = 100; p.z = 100; p.heading = Math.PI / 2;
    for (let i = 0; i < 240; i++) p.update(1 / 60, input(['KeyW']), lake);
    expect(p.blockedWater).toBe(true); expect(p.x).toBeLessThan(106);
  });
  it('un pont au-dessus de l’eau profonde se franchit à cheval (profondeur mesurée depuis le tablier)', () => {
    const deck = { cx: 112, cz: 100, hw: 10, hd: 3, yaw: 0, top: 0.5 };   // tablier : x de 102 à 122, z de 97 à 103
    const lake = {
      chunks: { collidersNear(_x: number, _z: number, _c: unknown[], _s: unknown[], plats: unknown[]) { plats.push(deck); } },
      heightAt: (x: number) => (x > 105 ? -3 : 0), waterAt: (x: number) => (x > 105 ? 0 : NaN),
    } as never;
    const p = new Player(); p.mounted = true; p.x = 100; p.z = 100; p.heading = Math.PI / 2;
    for (let i = 0; i < 110; i++) p.update(1 / 60, input(['KeyW']), lake);
    expect(p.blockedWater).toBe(false); expect(p.x).toBeGreaterThan(108);
  });
});

describe('combat à cheval et tir ami', () => {
  const setup = (mounted: boolean) => {
    const ch = new Character(), p = new Player(), events = new EventBus(), msgs: string[] = [];
    events.on('message', (m) => msgs.push(m.text));
    ch.inv.add('épée courte'); ch.equipItem('épée courte');
    p.mounted = mounted; p.stamina = 100;
    // un compagnon et un loup côte à côte, juste devant le joueur (cap 0 : vers −z)
    const ally = new Entity('ally:merc', 'monster', 'mercenaire', 'Aldric', mercModel(1, 'lame', 0, 'm'), 50); ally.ally = newAlly('merc', { reach: 2 }); ally.x = 0; ally.z = -1.2;
    const wolf = makeMonster('t:wolf', 'loup', 0.3, -1.4, 0, 0, 10);
    const combat = { player: p, events, onPlayerDeath() {}, playerArmor: () => 0 };
    const w = { player: p, character: ch, events, combat, entities: [ally, wolf], heightAt: () => 0, onHit: () => {} };
    return { ch, p, ally, wolf, w, msgs };
  };
  const click = (keys: string[] = [], released = true) => ({ key: (k: string) => keys.includes(k), doubleTapped: null, locked: true, mouseDown: () => false, mouseReleased: () => released, mouseClicked: () => false, isDown: () => false, pressed: () => false }) as never;

  it('à pied, la mêlée frappe le loup et jamais le compagnon qui est devant', () => {
    const t = setup(false), f = new PlayerCombat();
    f.update(0.016, click(), t.w); f.update(0.5, click(), t.w);
    expect(t.wolf.hp).toBeLessThan(t.wolf.maxHp); expect(t.ally.hp).toBe(50);
  });
  it('à cheval : pas de mêlée (message), pas d’esquive, pas de charge ; les flèches traversent le compagnon', () => {
    const t = setup(true), f = new PlayerCombat();
    f.update(0.016, click(['v']), t.w); f.update(0.5, click(), t.w);
    expect(t.wolf.hp).toBe(t.wolf.maxHp); expect(t.p.dashT).toBe(0); expect(t.p.stamina).toBeGreaterThan(95);
    expect(t.msgs.some((m) => m.includes('du haut d’un cheval'))).toBe(true);
    const bow = setup(true);
    bow.ch.inv.add('arc court'); bow.ch.inv.add('flèche', 5); bow.ch.equipItem('arc court');
    const g = new PlayerCombat();
    g.projectiles.push({ x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: -20, dmg: 10, element: undefined, kind: 'flèche', life: 3, stuck: false, owner: 'player' } as never);
    g.update(0.1, click([], false), bow.w);
    expect(bow.ally.hp).toBe(50); expect(bow.wolf.hp).toBeLessThan(bow.wolf.maxHp);
  });
});
