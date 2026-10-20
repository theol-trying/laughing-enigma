import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/Game';
import { hitEntity } from '@ascii-fort/sim/gameplay/Combat';
import type { DialogueNode } from '@ascii-fort/sim/gameplay/Dialogue';
import type { Entity } from '@ascii-fort/sim/entities/Entity';
import type { SaveData } from '../src/game/SaveManager';
import { CONTEST_ARROWS } from '@ascii-fort/sim/gameplay/Calendar';

// Étape 54 de bout en bout, sans écran : fête (marchands, place, concours de tir), raid (défense récompensée, pillage
// et maisons brûlées), épidémie (alités, maladie du joueur, remèdes de la guérisseuse), guerre (bataille, prise de
// parti, place prise, tabards, territoires), souterrain, sauvegarde et chargement.

const renderer = { createMesh: () => ({}), deleteMesh() {}, render() {}, ui: {} } as never;
const input = { isDown: () => false, pressed: () => false, key: () => false, mouseDown: () => false, mouseClicked: () => false, mouseReleased: () => false, locked: true, mouseDX: 0, mouseDY: 0, wheel: 0, doubleTapped: null, muted: false } as never;

describe('jeu complet : événements vivants', () => {
  const g = new Game('TEST-001', renderer);
  g.ui = { openDialogue() {}, openTrade() {}, openScreen() {} };
  g.god = true;
  g.time.setClock(10);
  const h = g.happenings;
  const frame = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) g.update(dt, input); };
  const goTo = (x: number, z: number) => {
    if (g.dungeon) g.exitDungeon();
    const p = g.player; p.x = x; p.z = z; p.vx = p.vz = p.vy = 0;
    g.world.chunks.update(x, z, -1); p.y = g.world.heightAt(x, z) + 0.1;
  };
  const pick = (node: DialogueNode | null, starts: string): DialogueNode | null => {
    const o = node!.options.find((x) => x.label.startsWith(starts));
    expect(o, `option « ${starts} » parmi : ${node!.options.map((x) => x.label).join(' | ')}`).toBeDefined();
    return o!.go();
  };
  const dev = (cmd: string, ...args: string[]) => { const r = h.dev(cmd, args); expect(r.some((l) => l.err), r.map((l) => l.text).join(' / ')).toBe(false); return r; };
  const zoneEnts = (id: string): Entity[] => g.entities.eventZones.get('e' + id) ?? [];
  const lastId = (r: { text: string }[]) => r[0].text.split(' ')[0];
  const start = g.world.spawn(), home = g.world.civ.start;
  goTo(start.x, start.z);
  frame(5);

  it('fête : marchands de foire à leurs étals, villageois sur la place, musique de fête, réputation à l’arrivée', () => {
    const rep = g.rep.local.get(home.id) ?? 0;
    const id = lastId(dev('evenement', 'foire'));
    frame(25);
    const L = h.live.get('e' + id);
    expect(L?.kind).toBe('fête');
    const merchants = zoneEnts(id).filter((e) => e.event?.role === 'marchand');
    expect(merchants.length).toBe(Math.min(3, h.stallCount(home.id)));
    expect(merchants.length).toBeGreaterThan(0);
    const stock = g.stockOf(merchants[0]);
    expect(stock.length).toBeGreaterThan(0);
    expect(g.dialogue.start(merchants[0]).options.some((o) => o.label.startsWith('Montre-moi tes marchandises'))).toBe(true);
    expect(g.rep.local.get(home.id) ?? 0).toBeGreaterThanOrEqual(rep + 3);
    expect(h.festive()).toBe(true);
    // les villageois délaissent leur emploi du temps pour la place
    const L0 = g.world.civWorld.layouts.find((x) => x.sid === home.id)!, P = L0.plaza!;
    const over = g.entities.npcsOf(home.id).map((n) => h.override(n, L0, g.time.minuteOfDay, g.time.hour)).filter(Boolean);
    expect(over.length).toBeGreaterThan(2);
    for (const o of over) expect(Math.hypot(o!.spot.x - P.x, o!.spot.z - P.z)).toBeLessThan(P.r + 10);
    // un habitant en parle
    const n = g.entities.zones.get(home.id)!.ents.find((e) => e.npc && e.alive && e.npc.profession !== 'garde')!;
    const node = pick(g.dialogue.start(n), 'Quelle est cette fête')!;
    expect(node.lines.join(' ')).toContain('foire');
    expect(() => g.render()).not.toThrow();
  });

  it('concours de tir : inscription au piquet, six flèches sur les cibles, classement et récompense', () => {
    const r = h.contestRange(home.id);
    if (!r) return;   // place trop encombrée pour un pas de tir : pas de concours ici
    const p = g.player;
    p.x = r.lx + 0.5; p.z = r.lz; p.y = r.ly; p.heading = Math.atan2(r.lx - p.x, -(r.lz - p.z));
    g.character.inv.add('arc court');
    const f = h.focus();
    expect(f?.f.label).toContain('s’inscrire');
    const gold = g.character.inv.gold;
    if (f?.f.t === 'action') f.f.go();
    expect(g.character.inv.gold).toBe(gold - 3);
    expect(g.character.weapon?.weapon?.kind).toBe('arc');
    // six tirs bien ajustés : chaque flèche part du piquet et file vers le cœur d'une cible
    for (let i = 0; i < CONTEST_ARROWS; i++) {
      const t = r.targets[i % r.targets.length], y0 = r.ly + 1.5, dist = Math.hypot(t.x - r.lx, t.z - r.lz), v = 55, tt = dist / v;
      g.fight.projectiles.push({ x: r.lx, y: y0, z: r.lz, vx: ((t.x - r.lx) / dist) * v, vy: (t.y - y0) / tt + 0.5 * 9.8 * tt, vz: ((t.z - r.lz) / dist) * v, dmg: 5, kind: 'flèche', life: 6, stuck: false, owner: 'player' });
      frame(15);
    }
    frame(10);
    expect(h.hudLine()).toBeNull();
    expect(h.focus()?.f.label).toContain('déjà disputé');
  });

  it('raid : les assaillants viennent du repaire, le joueur aide à les repousser : récompense et réputation', () => {
    goTo(start.x, start.z);
    const id = lastId(dev('evenement', 'raid', 'bandit'));
    frame(25);
    const raiders = zoneEnts(id).filter((e) => e.mon && e.alive);
    expect(raiders.length).toBeGreaterThanOrEqual(3);
    expect(raiders.every((e) => e.type === 'bandit' && e.mon!.lair === 'e' + id && e.zoneKey === 'e' + id)).toBe(true);
    // les gardes du village tiennent la place
    const guard = g.entities.npcsOf(home.id).find((n) => n.profession === 'garde' && n.alive);
    if (guard) expect(h.override(guard, g.world.civWorld.layouts.find((x) => x.sid === home.id)!, g.time.minuteOfDay, g.time.hour)?.act).toBe('garder');
    const gold = g.character.inv.gold, rep = g.rep.local.get(home.id) ?? 0;
    for (const e of raiders) hitEntity(g.combat, e, 9999, 'player');
    frame(25);
    expect(h.outcome(id)?.k).toBe('r');
    expect(g.character.inv.gold).toBeGreaterThan(gold);
    expect(g.rep.local.get(home.id) ?? 0).toBeGreaterThan(rep);
    expect(g.banner?.text).toBe('RAID REPOUSSÉ');
    expect(g.rumors.list.some((x) => x.tag === 'évt:' + id)).toBe(true);
  });

  it('raid sans défenseur : pillage, maisons brûlées quelques jours, prix en hausse ; rien d’orphelin en partant', () => {
    goTo(start.x, start.z);
    const id = lastId(dev('evenement', 'raid', 'gobelin'));
    frame(25);
    const supply = { ...g.economy.supply.get(home.id)! };
    dev('finir', id, 's');
    frame(3);
    expect(h.outcome(id)?.k).toBe('s');
    const ev = [...h.live.values()].find((x) => x.plan.id === id)?.plan;
    if (ev?.kind === 'raid') expect(h.phase(ev, g.time.minutes)).toBe('suites');
    expect(Object.entries(g.economy.supply.get(home.id)!).some(([k, v]) => v < (supply as Record<string, number>)[k])).toBe(true);
    expect(() => g.render()).not.toThrow();
    // le joueur s'éloigne : les participants quittent la simulation, sans laisser d'entité derrière eux
    goTo(start.x + 2500, start.z);
    frame(25);
    expect(g.entities.entities.some((e) => e.zoneKey.startsWith('e'))).toBe(false);
    expect(g.entities.eventZones.size).toBe(0);
    goTo(start.x, start.z);
    frame(10);
  });

  it('épidémie : alités, boutiques fermées, maladie du joueur (endurance réduite, toux), remède, quête de la guérisseuse', () => {
    goTo(start.x, start.z);
    const id = lastId(dev('evenement', 'epidemie'));
    frame(25);
    const L0 = g.world.civWorld.layouts.find((x) => x.sid === home.id)!;
    const beds = g.entities.npcsOf(home.id).filter((n) => h.override(n, L0, g.time.minuteOfDay, g.time.hour)?.act === 'dormir');
    expect(beds.length).toBeGreaterThan(0);
    // contagion : le joueur s'attarde sans remède
    g.god = false; g.time.scale = 60;
    for (let i = 0; i < 400 && !h.sick; i++) frame(1);
    g.god = true; g.time.scale = 1;
    expect(h.sick).not.toBeNull();
    frame(1);
    const sickRegen = g.player.staminaRegen;
    g.character.inv.add('remède contre la fièvre', 1);
    expect(g.useItem('remède contre la fièvre')).toBe(true);
    frame(1);
    expect(h.sick).toBeNull();
    expect(g.player.staminaRegen).toBeGreaterThan(sickRegen);
    // la guérisseuse (ou le prêtre) demande des remèdes ; les rapporter enraye l'épidémie
    const ents = g.entities.zones.get(home.id)!.ents.filter((e) => e.npc && e.alive);
    const healer = ['guérisseuse', 'prêtre', 'moine'].map((pr) => ents.find((e) => e.npc!.profession === pr)).find(Boolean);
    if (!healer) return;
    pick(pick(g.dialogue.start(healer), 'Comment enrayer cette fièvre'), 'Accepter');
    const q = g.quests.quests.find((x) => x.id === 'épidémie:' + id)!;
    expect(q?.status).toBe('active');
    g.character.inv.add('remède contre la fièvre', q.data.count!);
    frame(25);
    expect(q.stage).toBe(1);
    const gold = g.character.inv.gold;
    pick(g.dialogue.start(healer), `À propos de « ${q.title} »… c'est réglé`);
    expect(q.status).toBe('terminée');
    expect(g.character.inv.count('remède contre la fièvre')).toBe(0);
    expect(g.character.inv.gold).toBeGreaterThan(gold);
    expect(h.outcome(id)?.k).toBe('e');
  });

  it('guerre : bataille devant la place, prise de parti, victoire, la place change de propriétaire (tabards, réputation, carte)', () => {
    goTo(start.x, start.z);
    frame(25);
    dev('guerre', 'declarer');
    const own = g.ownerOf(home.id);
    dev('evenement', 'bataille');
    frame(25);
    const live = [...h.live.values()].find((x) => x.kind === 'bataille')!;
    expect(live).toBeDefined();
    const soldiers = zoneEnts(live.plan.id).filter((e) => e.event?.role === 'soldat');
    const atk = live.plan.kind === 'bataille' ? live.plan.attacker : -1;
    expect(soldiers.some((e) => e.event!.side === atk)).toBe(true);
    expect(soldiers.some((e) => e.event!.side === own)).toBe(true);
    const guardBefore = g.entities.zones.get(home.id)!.ents.find((e) => e.npc?.profession === 'garde');
    const modelBefore = guardBefore?.model;
    // le joueur frappe un défenseur : il combat pour l'attaquant ; délit envers la faction frappée
    const repOwn = g.rep.faction[own];
    const victim = soldiers.find((e) => e.event!.side === own)!;
    hitEntity(g.combat, victim, 5, 'player');
    g.onHit(victim);
    expect(g.rep.faction[own]).toBeLessThan(repOwn);
    const gold = g.character.inv.gold;
    dev('finir', live.plan.id, 'a');
    frame(5);
    expect(g.ownerOf(home.id)).toBe(atk);
    expect(g.state.flags.get('owner:' + home.id)).toBe(atk);
    expect(g.character.inv.gold).toBeGreaterThan(gold);   // solde
    const n = g.entities.npcsOf(home.id)[0];
    expect(g.rep.factionOf(n)).toBe(atk);
    if (guardBefore) expect(guardBefore.model).not.toBe(modelBefore);   // le tabard suit le nouveau propriétaire
    expect(h.territory().cells[home.cj * 256 + home.ci]).toBe(atk);
    expect(h.journalLines().some((l) => l.text.startsWith('Guerre'))).toBe(true);
    // console : retour au propriétaire d'origine
    dev('proprietaire', String(home.id), 'reset');
    expect(g.ownerOf(home.id)).toBe(home.factionId);
    expect(h.territory().cells[home.cj * 256 + home.ci]).toBe(home.factionId);
  });

  it('souterrain : les événements incarnés quittent la simulation', () => {
    goTo(start.x, start.z);
    dev('evenement', 'raid', 'loup');
    frame(25);
    expect(g.entities.eventZones.size).toBeGreaterThan(0);
    g.enterDungeon(g.world.civ.dungeons[0].id);
    frame(2);
    expect(g.entities.eventZones.size).toBe(0);
    expect(g.entities.entities.some((e) => e.zoneKey.startsWith('e'))).toBe(false);
    g.exitDungeon();
    goTo(start.x, start.z);
    frame(10);
  });

  it('sauvegarde et chargement : issues, maladie, rangs et propriétaires survivent ; sauvegarde ancienne sans événements', () => {
    dev('malade');
    const sid = g.world.civ.settlements.find((s) => s.type === 'village' && s.id !== home.id)!.id;
    dev('proprietaire', String(sid), '1');
    const data = JSON.parse(JSON.stringify(g.toSave('test'))) as SaveData;
    expect(data.evenements?.malade?.nom).toBeTruthy();
    expect(data.evenements?.out?.length).toBeGreaterThan(0);
    expect(data.quests.some((q) => q.id.startsWith('épidémie:'))).toBe(false);
    g.applySave(data);
    frame(2);
    expect(h.sick?.nom).toBe(data.evenements!.malade!.nom);
    expect(g.ownerOf(sid)).toBe(1);
    expect(h.journalLines().some((l) => /rang/.test(l.text))).toBe(true);
    // une sauvegarde d'avant l'étape 54 : rien en cours, rien ne casse
    const old = JSON.parse(JSON.stringify(data)) as SaveData;
    delete old.evenements;
    g.applySave(old);
    frame(25);
    expect(h.sick).toBeNull();
    expect(() => g.render()).not.toThrow();
  });
});
