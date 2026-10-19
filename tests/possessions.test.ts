import { describe, it, expect } from 'vitest';
import { WorldSeed } from '@ascii-fort/core/Seed';
import { GameTime, MIN_PER_DAY } from '@ascii-fort/core/Time';
import { EventBus } from '@ascii-fort/core/Events';
import { World } from '@ascii-fort/worldgen/World';
import { Player } from '@ascii-fort/sim/entities/Player';
import { EntityManager } from '@ascii-fort/sim/entities/EntityManager';
import type { NPCData } from '@ascii-fort/sim/entities/NPC';
import { Character } from '@ascii-fort/sim/gameplay/Character';
import { WorldState } from '@ascii-fort/sim/gameplay/WorldState';
import { Reputation } from '@ascii-fort/sim/gameplay/Reputation';
import { hitEntity } from '@ascii-fort/sim/gameplay/Combat';
import { doorOutside, rectOf, insideRect } from '@ascii-fort/sim/gameplay/Estate';
import { CONTRACT_MIN, MOUNT, mercPrice } from '@ascii-fort/sim/gameplay/Companions';
import { Possessions } from '../src/game/Possessions';
import type { Game } from '../src/game/Game';

const world = new World(new WorldSeed('TEST-001'), null);

/** Un Game minimal (sans rendu ni DOM) : tout ce que Possessions lit. */
function makeGame() {
  const player = new Player(), events = new EventBus(), time = new GameTime(), character = new Character();
  character.inv.gold = 5000;
  const msgs: string[] = [];
  events.on('message', (m) => msgs.push(m.text));
  const noop = new Proxy({}, { get: () => () => {} });
  const g: Record<string, unknown> = {
    world, player, events, time, character, seed: world.seed, state: new WorldState(), audio: noop, particles: noop, coop: null, ui: null, dungeon: null, banner: null, elapsed: 0,
    inDungeon: () => false, rain: () => 0, night: () => 0, fog: () => 0,
  };
  g.combat = { player, events, onPlayerDeath() { player.dead = true; }, playerArmor: () => 0 };
  g.entities = new EntityManager(g as never);
  g.rep = new Reputation(world.civ, events, g.entities as EntityManager);
  g.poss = new Possessions(g as unknown as Game);
  return { g: g as unknown as Game & { elapsed: number; dungeon: unknown }, poss: g.poss as Possessions, em: g.entities as EntityManager, player, character, msgs, events };
}

/** Un lieu qui a une maison à vendre, son aubergiste et le fermier d'un hameau. */
function findInn(em: EntityManager) {
  for (const s of world.civ.settlements) {
    if (em.saleHouse(s.id) === null) continue;
    const n = em.npcsOf(s.id).find((x) => x.profession === 'aubergiste' && x.alive);
    if (n) return { s, n, L: world.civWorld.layouts.find((l) => l.sid === s.id)! };
  }
  throw new Error('pas de lieu éligible');
}
function findFarmer(em: EntityManager): NPCData | null {
  for (const s of world.civ.settlements) {
    const L = world.civWorld.layouts.find((l) => l.sid === s.id);
    if (!L || L.buildings.some((b) => b.kind === 'auberge')) continue;
    const n = em.npcsOf(s.id).find((x) => x.profession === 'fermier');
    if (n) return n;
  }
  return null;
}
const placeAt = (g: ReturnType<typeof makeGame>, x: number, z: number) => { g.player.x = x; g.player.z = z; world.chunks.update(x, z, -1); g.player.y = world.heightAt(x, z); };
const keys = (...k: string[]) => ({ key: (c: string) => k.includes(c) }) as never;

describe('achats chez l’aubergiste et le fermier', () => {
  it('l’aubergiste propose cheval, mercenaire et maison ; les autres métiers rien ; le fermier d’un lieu sans auberge un cheval', () => {
    const t = makeGame(), { s, n } = findInn(t.em);
    const o = t.poss.offers(n);
    expect(o.map((x) => x.id)).toEqual(['cheval', 'mercenaire', 'maison']);
    const [horse, merc, house] = o;
    expect(horse.price).toBeGreaterThanOrEqual(400); expect(horse.price).toBeLessThanOrEqual(600);
    expect(merc.price).toBe(mercPrice(1)); expect(house.price).toBeGreaterThanOrEqual(1500); expect(house.price).toBeLessThanOrEqual(3000);
    expect(o.every((x) => !x.locked && x.info.length > 10)).toBe(true);
    const other = t.em.npcsOf(s.id).find((x) => x.profession === 'forgeron');
    if (other) expect(t.poss.offers(other)).toEqual([]);
    const farmer = findFarmer(t.em);
    if (farmer) expect(t.poss.offers(farmer).map((x) => x.id)).toEqual(['cheval']);
    expect(t.poss.offers({ ...n, profession: 'fermier' }).length).toBe(0);      // un fermier dans un lieu qui a une auberge ne vend rien
  });

  it('acheter le cheval : or déduit, cheval devant l’auberge, plus d’offre, une seule fois par semaine et par vendeur', () => {
    const t = makeGame(), { n, L } = findInn(t.em);
    const [horse] = t.poss.offers(n), gold = t.character.inv.gold;
    placeAt(t, L.x, L.z);
    const reply = t.poss.buy(n, 'cheval');
    expect(t.character.inv.gold).toBe(gold - horse.price); expect(reply).toContain('devant l’auberge');
    const h = t.em.horse!, inn = L.buildings[n.work], door = doorOutside(inn);
    expect(h.alive).toBe(true); expect(Math.hypot(h.x - door.x, h.z - door.z)).toBeLessThan(0.01);
    expect(t.poss.offers(n)[0].locked).toBe(true); expect(t.poss.offers(n)[0].info).toContain('Tu as déjà');
    expect(t.msgs.some((m) => m.startsWith('Vous achetez'))).toBe(true);
    t.em.removeAlly('horse');
    expect(t.poss.offers(n)[0].info).toContain('vide cette semaine');
    t.g.time.minutes += 7 * MIN_PER_DAY;
    expect(t.poss.offers(n)[0].locked).toBeUndefined();
  });

  it('refus faute d’or, et aux hors-la-loi pour la maison', () => {
    const t = makeGame(), { s, n } = findInn(t.em);
    t.character.inv.gold = 100;
    expect(t.poss.buy(n, 'cheval')).toContain('de quoi payer'); expect(t.character.inv.gold).toBe(100); expect(t.em.horse).toBeNull();
    t.character.inv.gold = 9999;
    t.g.rep.bounty.set(s.id, 60);
    expect(t.poss.buy(n, 'maison')).toContain('hors-la-loi'); expect(t.poss.estate.house).toBeNull(); expect(t.character.inv.gold).toBe(9999);
    expect(t.poss.buy(n, 'maison')).not.toContain('Voilà les clés');
  });

  it('engager et prolonger le mercenaire ; le contrat s’use et prend fin', () => {
    const t = makeGame(), { n } = findInn(t.em);
    t.player.x = 100; t.player.z = 100;
    expect(t.poss.buy(n, 'mercenaire')).toContain('sept jours');
    const m = t.em.merc!;
    expect(m.alive).toBe(true); expect(m.ally!.left).toBe(CONTRACT_MIN); expect(t.character.inv.gold).toBe(5000 - mercPrice(1));
    expect(t.poss.offers(n).map((x) => x.id)).toEqual(['cheval', 'renouveler', 'maison']);
    t.poss.buy(n, 'renouveler');
    expect(m.ally!.left).toBe(2 * CONTRACT_MIN);
    expect(t.poss.offers(n).find((x) => x.id === 'renouveler')!.locked).toBe(true);
    t.poss.elapse(MIN_PER_DAY * 13 + 300);
    expect(t.msgs.some((x) => x.includes('se termine demain'))).toBe(true); expect(t.em.merc).toBe(m);
    t.poss.elapse(MIN_PER_DAY);
    expect(t.msgs.some((x) => x.includes('rompt son contrat'))).toBe(true); expect(t.em.merc).toBeNull();
  });

  it('acheter la maison : à vous, lit et coffre, habitants déjà partis, marqueur sur la carte', () => {
    const t = makeGame(), { s, n, L } = findInn(t.em);
    const sale = t.poss.sale(s.id)!, gold = t.character.inv.gold;
    expect(t.em.npcsOf(s.id).some((x) => x.home === sale.bid)).toBe(false);
    expect(t.poss.buy(n, 'maison')).toContain('Voilà les clés');
    expect(t.character.inv.gold).toBe(gold - sale.price); expect(t.poss.estate.house).toEqual({ sid: s.id, bid: sale.bid });
    const mine = { key: 'x', kind: 'coffre', x: 0, y: 0, z: 0, sid: s.id, bid: sale.bid, dungeonId: -1 }, other = { ...mine, bid: sale.bid + 1 };
    expect(t.poss.isMine(mine)).toBe(true); expect(t.poss.isMine(other)).toBe(false); expect(t.poss.isMine({ ...mine, sid: s.id + 1 })).toBe(false);
    expect(t.poss.markers()).toEqual([expect.objectContaining({ glyph: '♥', x: L.buildings[sale.bid].x, z: L.buildings[sale.bid].z })]);
    expect(t.poss.offers(n).find((x) => x.id === 'maison')!.locked).toBe(true);
    expect(t.poss.journalLines()[0].text).toContain('Maison');
    // chez soi
    const b = L.buildings[sale.bid];
    placeAt(t, b.x, b.z); t.poss.afterMove(); expect(t.poss.atHome).toBe(true); expect(t.msgs).toContain('Vous rentrez chez vous.');
    const d = t.poss.onDeath()!;
    expect(insideRect(rectOf(b), d.x, d.z)).toBe(false); expect(Math.hypot(d.x - b.x, d.z - b.z)).toBeLessThan(b.d / 2 + 6);
  });
});

describe('monter, descendre, siffler', () => {
  function withHorse() {
    const t = makeGame(), { n, L } = findInn(t.em);
    const out = L.x + L.radius + 120, oz = L.z;                  // en rase campagne
    placeAt(t, out, oz);
    t.em.spawnHorse({ grade: 'palefroi', coat: 2, name: 'Braise', hp: 90, x: out + 2, z: oz, heading: 0 });
    return { ...t, n, L, out, oz };
  }
  it('G : monte à moins de 3,5 m, redescend, refuse trop loin, sans cheval, dans l’eau', () => {
    const t = withHorse();
    t.poss.beforeMove(keys('g'));
    expect(t.player.mounted).toBe(true); expect(t.poss.riding).toBe(true); expect(t.msgs).toContain('Vous montez Braise.');
    expect(t.em.horse!.x).toBe(t.player.x);
    t.poss.beforeMove(keys('g'));
    expect(t.player.mounted).toBe(false); expect(t.em.horse!.ally!.mounted).toBe(false);
    expect(Math.hypot(t.player.x - t.em.horse!.x, t.player.z - t.em.horse!.z)).toBeCloseTo(1.3, 1);
    t.player.x += 20; t.poss.beforeMove(keys('g'));
    expect(t.player.mounted).toBe(false); expect(t.msgs.some((m) => m.includes('trop loin'))).toBe(true);
    const none = makeGame(); none.poss.beforeMove(keys('g')); expect(none.msgs).toContain('Vous n’avez pas de cheval.');
  });
  it('pas de monte dans un bâtiment ni dans un donjon ; l’entrée d’un donjon fait descendre', () => {
    const t = makeGame(), { L } = findInn(t.em), b = L.buildings.find((x) => x.kind === 'maison')!;
    placeAt(t, b.x, b.z);
    t.em.spawnHorse({ grade: 'bidet', coat: 0, name: 'Gris', hp: 70, x: b.x + 1, z: b.z, heading: 0 });
    t.poss.toggleMount(); expect(t.msgs).toContain('On ne monte pas à cheval dans une maison.'); expect(t.poss.riding).toBe(false);
    const t2 = withHorse(); t2.g.dungeon = {} as never; t2.poss.toggleMount(); expect(t2.msgs).toContain('Pas de cheval là-dedans.');
    const t3 = withHorse(); t3.poss.toggleMount(); expect(t3.poss.riding).toBe(true);
    t3.poss.dismount('Pas de cheval là-dedans : vous mettez pied à terre.'); expect(t3.poss.riding).toBe(false); expect(t3.msgs.at(-1)).toContain('pied à terre');
  });
  it('monté : bâtiments fermés (keepOut), allures du grade, boiterie sous 25 % de PV, chute si le cheval meurt', () => {
    const t = withHorse();
    t.poss.toggleMount(); t.poss.beforeMove(keys());
    expect(t.player.mountTrot).toBe(8); expect(t.player.mountGallop).toBe(12.5); expect(t.player.keepOut).not.toBeNull();
    const h = t.em.horse!;
    h.hp = 20; t.poss.beforeMove(keys());   // 22 % : boite (le désarçonnement est à 15 %)
    expect(t.player.mountGallop).toBeCloseTo(12.5 * MOUNT.limpMul, 5); t.poss.afterMove(); expect(t.msgs.some((m) => m.includes('boite'))).toBe(true);
    const hp = t.player.hp;
    hitEntity(t.g.combat, h, 999, 'loup');
    t.poss.beforeMove(keys());
    expect(t.player.mounted).toBe(false); expect(t.player.hp).toBe(hp - MOUNT.fallDamage); expect(t.msgs.some((m) => m.includes('vous roulez à terre'))).toBe(true);
  });
  it('un cheval blessé à 15 % désarçonne et fuit ; à la nage on met pied à terre', () => {
    const t = withHorse();
    t.poss.toggleMount(); t.poss.beforeMove(keys());
    t.em.horse!.hp = 5; t.poss.afterMove();
    expect(t.player.mounted).toBe(false); expect(t.em.horse!.ally!.mode).toBe('fuite'); expect(t.msgs.some((m) => m.includes('désarçonne'))).toBe(true);
    const t2 = withHorse(); t2.poss.toggleMount(); t2.poss.beforeMove(keys()); t2.player.swimming = true; t2.poss.afterMove();
    expect(t2.player.mounted).toBe(false); expect(t2.msgs.some((m) => m.includes('perdez pied'))).toBe(true);
  });
  it('les coups reçus par le cavalier blessent aussi le cheval (30 %), pas s’ils sont parés', () => {
    const t = withHorse();
    t.poss.toggleMount(); t.poss.beforeMove(keys());
    const h = t.em.horse!, hp = h.hp;
    t.poss.shareHit(20, true); expect(h.hp).toBe(hp);
    t.poss.shareHit(20, false); expect(h.hp).toBeLessThan(hp); expect(hp - h.hp).toBe(Math.round(6 * (1 - 1 / 13)));
  });
  it('Y : portée de 120 m, message de direction au-delà, cheval qui accourt en deçà', () => {
    const t = withHorse();
    t.poss.whistle(); expect(t.em.horse!.ally!.mode).toBe('siffle');
    t.em.horse!.ally!.mode = 'attendre'; t.em.horse!.x += 150;
    t.poss.whistle(); expect(t.em.horse!.ally!.mode).toBe('attendre'); expect(t.msgs.at(-1)).toContain('reste sans réponse');
    t.g.dungeon = {} as never; t.poss.whistle(); expect(t.msgs.at(-1)).toContain('se perd sous la terre');
  });
});

describe('mercenaire : ordres et dialogue', () => {
  it('N bascule suivre / attendre ; le dialogue donne les mêmes ordres, renouvelle, congédie, soigne', () => {
    const t = makeGame(), { n } = findInn(t.em);
    t.player.x = 300; t.player.z = 300;
    t.poss.buy(n, 'mercenaire');
    const m = t.em.merc!;
    t.poss.beforeMove(keys('n')); expect(m.ally!.mode).toBe('attendre'); expect(m.ally!.post).not.toBeNull();
    t.poss.beforeMove(keys('n')); expect(m.ally!.mode).toBe('suivre');
    let node = t.poss.mercDialogue(m);
    expect(node.sub).toContain('mercenaire'); expect(node.options.map((o) => o.label)[0]).toBe('Attends ici.');
    expect(node.options[0].go()).toBeNull(); expect(m.ally!.mode).toBe('attendre');
    node = t.poss.mercDialogue(m); expect(node.options[0].label).toBe('Suis-moi.');
    const renew = node.options.find((o) => o.label.startsWith('Prolonger'))!;
    renew.go(); expect(m.ally!.left).toBe(2 * CONTRACT_MIN);
    expect(t.poss.mercDialogue(m).options.some((o) => o.label.startsWith('Prolonger'))).toBe(false);
    // à terre : une potion le relève
    t.character.inv.add('potion de soin', 1);
    hitEntity(t.g.combat, m, 9999, 'troll');
    node = t.poss.mercDialogue(m);
    expect(node.options[0].label).toContain('potion'); node.options[0].go();
    expect(m.ally!.ko).toBe(0); expect(m.hp).toBeGreaterThan(m.maxHp * 0.5); expect(t.character.inv.count('potion de soin')).toBe(0);
    // congédier
    node = t.poss.mercDialogue(m);
    const fire = node.options.find((o) => o.label.startsWith('Je te libère'))!.go()!;
    fire.options[0].go(); expect(t.em.merc).toBeNull();
  });
  it('le niveau suit le joueur et le contrat s’use avec le temps de jeu', () => {
    const t = makeGame(), { n } = findInn(t.em);
    t.poss.buy(n, 'mercenaire');
    const m = t.em.merc!;
    t.character.level = 6; t.poss.tick(0.016);
    expect(m.ally!.level).toBe(5);
    const left = m.ally!.left;
    t.poss.tick(60);                       // 60 s de jeu à l'échelle 1 = 60 minutes
    expect(m.ally!.left).toBeCloseTo(left - 60, 3);
  });
});

describe('sauvegarde des biens', () => {
  it('aller-retour complet (maison, coffre avec usure, or du coffre, cheval monté, mercenaire qui attend) ; rien de possédé = champ absent', () => {
    const t = makeGame(), { s, n, L } = findInn(t.em);
    expect(t.poss.toSave()).toBeUndefined();
    t.character.inv.gold = 9000;
    t.poss.buy(n, 'maison'); t.poss.buy(n, 'cheval'); t.player.x = 900; t.player.z = 900; t.poss.buy(n, 'mercenaire');
    t.poss.estate.chest.add('épée courte~62', 1); t.poss.estate.chest.add('pain', 7); t.poss.estate.chest.gold = 321;
    t.em.merc!.ally!.mode = 'attendre'; t.em.merc!.ally!.post = { x: t.em.merc!.x, z: t.em.merc!.z };
    t.em.horse!.hp = 44;
    const save = JSON.parse(JSON.stringify(t.poss.toSave()));
    expect(save.house.sid).toBe(s.id); expect(save.chest).toContainEqual(['épée courte~62', 1]); expect(save.gold).toBe(321); expect(save.horse.hp).toBe(44); expect(save.merc.mode).toBe('attendre');
    expect(JSON.stringify(save).length).toBeLessThan(1500);

    const u = makeGame(); u.character.level = 1;
    u.poss.load(save);
    expect(JSON.parse(JSON.stringify(u.poss.toSave()))).toEqual(save);
    expect(u.poss.estate.chest.count('épée courte~62')).toBe(1); expect(u.em.horse!.hp).toBe(44); expect(u.em.merc!.ally!.mode).toBe('attendre');
    expect(u.em.npcsOf(s.id).some((x) => x.home === save.house.bid)).toBe(false);
    // champ absent : tout est remis à zéro (le Game est réutilisé quand la seed est la même)
    u.poss.load(undefined);
    expect(u.poss.toSave()).toBeUndefined(); expect(u.em.horse).toBeNull(); expect(u.em.merc).toBeNull(); expect(u.poss.estate.house).toBeNull();
    // contenu invalide : ignoré sans exception
    u.poss.load({ house: 'x', chest: 'y', horse: { grade: 1 }, merc: [] });
    expect(u.poss.toSave()).toBeUndefined();
    void L;
  });
  it('une maison qui ne désigne plus une maison debout n’est pas restaurée (le coffre reste)', () => {
    const t = makeGame(), { s, L } = findInn(t.em);
    const inn = L.buildings.findIndex((b) => b.kind === 'auberge');
    t.poss.load({ house: { sid: s.id, bid: inn }, chest: [['pain', 2]] });
    expect(t.poss.estate.house).toBeNull(); expect(t.poss.estate.chest.count('pain')).toBe(2);
    t.poss.load({ house: { sid: s.id, bid: 99999 } });
    expect(t.poss.estate.house).toBeNull();
  });
  it('monté au moment de la sauvegarde : remonté au chargement ; à terre dans un donjon', () => {
    const t = makeGame(), { L } = findInn(t.em), x = L.x + L.radius + 150;
    placeAt(t, x, L.z);
    t.em.spawnHorse({ grade: 'destrier', coat: 1, name: 'Orage', hp: 120, x: x + 1, z: L.z, heading: 0 });
    t.poss.toggleMount();
    const save = JSON.parse(JSON.stringify(t.poss.toSave()));
    expect(save.horse.mounted).toBe(true);
    const u = makeGame(); placeAt(u, x, L.z); u.poss.load(save);
    expect(u.player.mounted).toBe(true); expect(u.poss.riding).toBe(true);
    const v = makeGame(); v.g.dungeon = {} as never; v.poss.load(save);
    expect(v.player.mounted).toBe(false); expect(v.em.horse!.ally!.mounted).toBe(false);
  });
});
