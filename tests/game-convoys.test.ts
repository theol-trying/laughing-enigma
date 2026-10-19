import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/Game';
import { hitEntity } from '@ascii-fort/sim/gameplay/Combat';
import { item } from '@ascii-fort/sim/gameplay/Items';
import type { DialogueNode } from '@ascii-fort/sim/gameplay/Dialogue';
import type { Entity } from '@ascii-fort/sim/entities/Entity';
import type { SaveData } from '../src/game/SaveManager';

// Étape 53 de bout en bout, sans écran : convoi incarné près du joueur, commerce, embuscade (aide et récompense, pillage
// et épave), course de messager, patrouille et délit, souterrain, sauvegarde et chargement.

const renderer = { createMesh: () => ({}), deleteMesh() {}, render() {}, ui: {} } as never;
const input = { isDown: () => false, pressed: () => false, key: () => false, mouseDown: () => false, mouseClicked: () => false, mouseReleased: () => false, locked: true, mouseDX: 0, mouseDY: 0, wheel: 0, doubleTapped: null, muted: false } as never;

describe('jeu complet : convois des routes', () => {
  const g = new Game('TEST-001', renderer);
  g.ui = { openDialogue() {}, openTrade() {}, openScreen() {} };
  g.god = true;
  g.time.setClock(9);
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
  const dev = (cmd: string, ...args: string[]) => { const r = g.convoys.dev(cmd, args); expect(r.some((l) => l.err), r.map((l) => l.text).join(' / ')).toBe(false); return r; };
  /** convoi de la console : il passe ici, il est incarné au contrôle suivant */
  const spawn = (kind: string): { zone: string; members: Entity[] } => {
    const before = new Set(g.convoys.live.keys());
    dev('convoi', kind);
    frame(25);
    const zone = [...g.convoys.live.keys()].find((z) => !before.has(z) && g.convoys.live.get(z)!.plan.id.startsWith('d'))!;
    expect(zone, `convoi ${kind} incarné`).toBeDefined();
    return { zone, members: (g.entities.convoys.get(zone) ?? []).filter((e) => e.convoy) };
  };
  const start = g.world.spawn();
  goTo(start.x, start.z);

  it('un convoi proche est incarné : chariot, bête de trait, membres avec leur rôle ; le rendu passe', () => {
    const { zone, members } = spawn('caravane');
    const L = g.convoys.live.get(zone)!;
    expect(L.plan.kind).toBe('caravane');
    expect(members.length).toBeGreaterThanOrEqual(2);
    expect(members[0].npc?.title).toMatch(/^marchand/);
    expect(members[0].label).toContain('marchand');
    expect(members.every((e) => e.npc?.road?.convoy === L.plan.id && e.zoneKey === zone)).toBe(true);
    // le chariot avance sur la route et ses membres le suivent
    const x0 = L.x, z0 = L.z;
    frame(80);
    expect(Math.hypot(L.x - x0, L.z - z0)).toBeGreaterThan(1.5);
    for (const e of members) expect(Math.hypot(e.x - L.x, e.z - L.z), e.label).toBeLessThan(14);
    expect(Math.abs(L.y - g.world.heightAt(L.x, L.z))).toBeLessThan(1.5);   // ni en l'air, ni enterré
    expect(() => g.render()).not.toThrow();
    expect(g.entities.dynamic.length).toBeGreaterThan(0);   // le chariot est un obstacle
  });

  it('le marchand de caravane vend les biens de sa ville à prix bas et donne des nouvelles de sa route', () => {
    const L = [...g.convoys.live.values()].find((x) => x.plan.kind === 'caravane')!;
    const m = (g.entities.convoys.get(L.zone) ?? []).find((e) => e.convoy?.role === 'marchand')!;
    const stock = g.stockOf(m);
    expect(stock.length).toBeGreaterThan(0);
    const goods = new Set([...g.world.civ.settlements[L.plan.from].produces, L.plan.cargo]);
    expect(stock.every((s) => goods.has(item(s.id).good!))).toBe(true);
    expect(g.rep.lasting(m.npc!)).toBeCloseTo(0.85);
    let node = g.dialogue.start(m);
    expect(node.sub).toContain('en route vers');
    expect(node.options.some((o) => o.label.startsWith('Montre-moi tes marchandises'))).toBe(true);
    node = pick(node, 'Des nouvelles de la route')!;
    expect(node.lines.length).toBeGreaterThan(0);
  });

  it('embuscade : le joueur aide, le convoi survit, le marchand récompense (or, remise durable, réputation)', () => {
    const L = [...g.convoys.live.values()].find((x) => x.plan.kind === 'caravane')!;
    dev('embuscade', '3', L.plan.id);
    frame(25);
    const bandits = (g.entities.convoys.get(L.zone) ?? []).filter((e) => e.mon && e.alive);
    expect(bandits.length).toBe(3);
    expect(bandits.every((b) => b.type === 'bandit' && b.mon!.alerted && !!b.mon!.targetId)).toBe(true);
    expect(g.convoys.live.get(L.zone)!.st.mode).toBe('embuscade');
    const gold = g.character.inv.gold, fid = g.ownerOf(L.plan.from), rep = g.rep.faction[fid] ?? 0;
    for (const b of bandits) hitEntity(g.combat, b, 9999, 'player');
    frame(3);
    expect(g.convoys.outcome(L.plan.id)?.k).toBe('s');
    expect(g.character.inv.gold).toBeGreaterThan(gold);
    expect(g.convoys.remises.get(`m${L.plan.from}:${L.plan.house}`)).toBeCloseTo(0.85);
    if (g.world.civ.factions[fid]) expect(g.rep.faction[fid]).toBeGreaterThan(rep);
    expect(g.banner?.text).toBe('CARAVANE SAUVÉE');
    const m = (g.entities.convoys.get(L.zone) ?? []).find((e) => e.convoy?.role === 'marchand')!;
    expect(g.rep.lasting(m.npc!)).toBeCloseTo(0.85 * 0.85);
    // la boutique de sa ville accorde la même remise
    const shop = g.entities.npcsOf(L.plan.from).find((n) => n.profession === 'marchand');
    if (shop) expect(g.rep.lasting(shop)).toBeCloseTo(0.85);
    expect(g.convoys.journalLines().some((l) => l.text.startsWith('Prix d’ami'))).toBe(true);
    // le convoi repart après la reprise
    frame(60, 0.1);
    expect(['route', 'halte', 'arrivée']).toContain(g.convoys.live.get(L.zone)?.st.mode);
  });

  it('sans défenseurs, les brigands pillent : épave à fouiller, prix en hausse à destination, rumeur', () => {
    const { zone } = spawn('pèlerins');
    const L = g.convoys.live.get(zone)!;
    dev('embuscade', '2', L.plan.id);
    frame(25);
    for (const e of (g.entities.convoys.get(zone) ?? []).filter((x) => x.convoy)) hitEntity(g.combat, e, 9999, 'bandit');
    frame(3);
    expect(g.convoys.outcome(L.plan.id)?.k).toBe('p');
    expect(L.st.mode).toBe('épave');
    expect(g.rumors.list.some((r) => r.tag === 'convoi:' + L.plan.id && r.text.includes('pèlerins'))).toBe(true);
    // fouiller l'épave : devant elle, à deux pas
    const p = g.player;
    p.x = L.x + 2; p.z = L.z; p.y = L.y; p.heading = Math.atan2(L.x - p.x, -(L.z - p.z));
    const f = g.convoys.focus();
    expect(f?.f.label).toContain('Fouiller l’épave');
    const gold = g.character.inv.gold;
    if (f?.f.t === 'action') f.f.go();
    expect(g.character.inv.gold).toBeGreaterThan(gold);
    expect(g.convoys.focus()).toBeNull();   // une seule fois
    goTo(start.x, start.z);
  });

  it('le messager confie un pli à porter ; le destinataire le reçoit et paie', () => {
    const { zone, members } = spawn('messager');
    const L = g.convoys.live.get(zone)!;
    L.plan.letter = true;
    const msg = members[0];
    let node = g.dialogue.start(msg);
    node = pick(node, 'As-tu un pli à confier')!;
    node = pick(node, 'Accepter')!;
    const q = g.quests.quests.find((x) => x.kind === 'course' && x.status === 'active')!;
    expect(q).toBeDefined();
    expect(g.character.inv.count(q.data.item!)).toBe(1);
    expect(g.quests.trackedQuest()).toBe(q);
    // la même course n'est pas proposée deux fois
    node = pick(g.dialogue.start(msg), 'As-tu un pli à confier')!;
    expect(node.lines[0]).toContain('déjà confié');
    // remise au destinataire
    const n = g.entities.findNpc(q.giver)!, s = g.world.civ.settlements[n.sid];
    goTo(s.x + 3, s.z + 3);
    frame(25);
    const r = g.entities.entities.find((e) => e.id === n.id)!;
    expect(r).toBeDefined();
    const gold = g.character.inv.gold;
    pick(g.dialogue.start(r), `À propos de « ${q.title} »… c'est réglé`);
    expect(q.status).toBe('terminée');
    expect(g.character.inv.gold).toBeGreaterThan(gold);
    expect(g.character.inv.count(q.data.item!)).toBe(0);
    goTo(start.x, start.z);
    frame(25);
  });

  it('une patrouille témoin d’un délit s’en mêle : soldats hostiles, amende à son lieu d’attache', () => {
    const { zone, members } = spawn('patrouille');
    const L = g.convoys.live.get(zone)!;
    const fine = g.rep.bounty.get(L.plan.from) ?? 0;
    g.events.emit('player:crime', { type: 'vol', settlementId: L.plan.to, witnesses: [members[0].id], value: 10 });
    expect(members.every((e) => e.hostile)).toBe(true);
    expect(g.rep.bounty.get(L.plan.from)).toBe(fine + 30);
    const node = g.dialogue.start(members[0]);
    expect(node.options.some((o) => o.label.startsWith('Payer l\'amende'))).toBe(true);
    g.payFine(L.plan.from);
    expect(members.every((e) => !e.hostile)).toBe(true);
  });

  it('souterrain : les convois quittent la simulation, puis reviennent', () => {
    expect(g.entities.convoys.size).toBeGreaterThan(0);
    const d = g.world.civ.dungeons[0];
    g.enterDungeon(d.id);
    frame(2);
    expect(g.entities.convoys.size).toBe(0);
    expect(g.convoys.live.size).toBe(0);
    g.exitDungeon();
    goTo(start.x, start.z);
    dev('convoi', 'caravane');
    frame(25);
    expect(g.convoys.live.size).toBeGreaterThan(0);
  });

  it('sauvegarde et chargement : issues observées, remises et courses en cours survivent ; sauvegarde ancienne sans convois', () => {
    const L = [...g.convoys.live.values()].find((x) => x.plan.kind === 'caravane')!;
    // une course en cours
    const { members } = spawn('messager');
    g.convoys.live.get(members[0].zoneKey)!.plan.letter = true;
    pick(pick(g.dialogue.start(members[0]), 'As-tu un pli à confier'), 'Accepter');
    const remises = [...g.convoys.remises];
    const data = JSON.parse(JSON.stringify(g.toSave('test'))) as SaveData;
    expect(data.convois?.remises?.length).toBe(1);
    expect(data.convois?.courses?.length).toBe(1);
    expect(data.quests.some((q) => q.id.startsWith('course:'))).toBe(false);
    g.applySave(data);
    frame(2);
    expect([...g.convoys.remises]).toEqual(remises);
    const q = g.quests.quests.filter((x) => x.kind === 'course' && x.status === 'active');
    expect(q).toHaveLength(1);
    expect(g.character.inv.count(q[0].data.item!)).toBe(1);
    void L;
    // une sauvegarde d'avant l'étape 53 (pas de champ « convois ») : rien en cours, rien ne casse
    const old = JSON.parse(JSON.stringify(data)) as SaveData;
    delete old.convois;
    g.applySave(old);
    frame(25);
    expect(g.convoys.remises.size).toBe(0);
    expect(g.quests.quests.some((x) => x.kind === 'course')).toBe(false);
  });
});
