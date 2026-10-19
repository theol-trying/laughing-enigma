import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/Game';
import { ChestScreen } from '../src/ui/ChestScreen';
import { doorOutside, rectOf, insideRect } from '@ascii-fort/sim/gameplay/Estate';
import { MOUNT } from '@ascii-fort/sim/gameplay/Companions';
import type { DialogueNode } from '@ascii-fort/sim/gameplay/Dialogue';

// Le jeu complet sans écran : faux moteur de rendu, fausses entrées. On joue un achat de bout en bout.

const renderer = { createMesh: () => ({}), deleteMesh() {}, render() {}, ui: {} } as never;

/** Entrées simulées : touches enfoncées (codes), touches « raccourci » pressées cette image. */
function fakeInput() {
  const down = new Set<string>(), pressed = new Set<string>();
  const input = {
    isDown: (c: string) => down.has(c), pressed: (c: string) => pressed.has(c), key: (k: string) => pressed.has('key:' + k),
    mouseDown: () => false, mouseClicked: () => false, mouseReleased: () => false, locked: true, mouseDX: 0, mouseDY: 0, wheel: 0, doubleTapped: null, muted: false,
  };
  return { input: input as never, hold: (...c: string[]) => { down.clear(); c.forEach((x) => down.add(x)); }, tap: (...k: string[]) => { pressed.clear(); k.forEach((x) => pressed.add('key:' + x)); }, clear: () => { down.clear(); pressed.clear(); } };
}

describe('jeu complet : cheval, mercenaire, maison, coffre', () => {
  const g = new Game('TEST-001', renderer);
  const screens: unknown[] = [], dialogues: DialogueNode[] = [];
  g.ui = { openDialogue: (n) => dialogues.push(n), openTrade() {}, openScreen: (s) => screens.push(s) };
  const f = fakeInput();
  const frame = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) { g.update(dt, f.input); f.tap(); } };

  // un lieu éligible, son aubergiste, et la porte de l'auberge
  const site = (() => {
    for (const s of g.world.civ.settlements) {
      if (g.entities.saleHouse(s.id) === null) continue;
      const n = g.entities.npcsOf(s.id).find((x) => x.profession === 'aubergiste');
      const L = g.world.civWorld.layouts.find((l) => l.sid === s.id)!;
      if (n) return { s, n, L, inn: L.buildings[n.work] };
    }
    throw new Error('aucun lieu éligible');
  })();
  const door = doorOutside(site.inn, 3.5);

  it('on parle à l’aubergiste, on achète un cheval, un mercenaire et la maison par dialogue', () => {
    const p = g.player;
    p.x = door.x; p.z = door.z; g.world.chunks.update(p.x, p.z, -1); p.y = g.world.heightAt(p.x, p.z) + 0.1;
    g.character.inv.gold = 6000;
    frame(3);
    const e = g.entities.entities.find((x) => x.id === site.n.id);
    expect(e, 'l’aubergiste est incarné (zone active)').toBeDefined();
    const answer = (node: DialogueNode, starts: string): DialogueNode | null => node.options.find((o) => o.label.startsWith(starts))!.go();
    let node = g.dialogue.start(e!);
    expect(node.options.length).toBeLessThanOrEqual(10);
    expect(node.options.some((o) => o.label.startsWith('Que proposes-tu'))).toBe(true);
    node = answer(node, 'Que proposes-tu')!;
    expect(node.lines.length).toBeGreaterThanOrEqual(4);
    expect(node.options.map((o) => o.label).filter((l) => /\(\d+ or\)$/.test(l)).length).toBe(3);
    node = answer(node, 'Acheter ')!;                       // cheval
    expect(node.lines[0]).toContain('devant l’auberge');
    expect(g.entities.horse?.alive).toBe(true);
    node = answer(node, 'Autre chose')!;                    // retour aux services
    node = answer(node, 'Engager ')!;
    expect(g.entities.merc?.alive).toBe(true);
    node = answer(node, 'Autre chose')!;
    const conf = answer(node, 'Acheter la maison')!;        // confirmation
    expect(conf.options.length).toBe(2);
    node = conf.options[0].go()!;
    expect(node.lines[0]).toContain('clés');
    expect(g.poss.estate.house).not.toBeNull();
    expect(g.character.inv.gold).toBeLessThan(6000 - 400 - 150 - 1500);
    expect(g.toSave().estate).toBeDefined();
  });

  it('G monte, ZQSD galope, un bâtiment arrête le cheval, G descend', () => {
    const p = g.player, h = g.entities.horse!;
    p.x = door.x; p.z = door.z; p.vx = p.vz = 0; frame(2);
    expect(Math.hypot(h.x - p.x, h.z - p.z)).toBeLessThan(MOUNT.mountRange + 4);
    h.x = p.x + 2; h.z = p.z; h.ally!.mode = 'attendre';
    f.tap('g'); frame(1);
    expect(p.mounted).toBe(true);
    // droit vers le sud-est, loin de l'auberge : on prend de la vitesse
    p.heading = Math.atan2(p.x - site.inn.x, -(p.z - site.inn.z));   // dos au bâtiment
    f.hold('KeyW', 'ShiftLeft'); frame(30);
    expect(g.player.sprinting).toBe(true);
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(10);
    expect(g.entities.horse!.x).toBe(p.x);
    // retour vers l'auberge : bloqué devant les murs, jamais dedans
    p.heading = Math.atan2(site.inn.x - p.x, -(site.inn.z - p.z));
    f.hold('KeyW'); frame(400);
    expect(insideRect(rectOf(site.inn), p.x, p.z)).toBe(false);
    expect(g.player.mounted).toBe(true);
    f.clear(); f.tap('g'); frame(2);
    expect(p.mounted).toBe(false);
  });

  it('la maison achetée : coffre personnel (écran à deux colonnes), lit gratuit, sans vol', () => {
    const b = site.L.buildings[g.poss.estate.house!.bid], p = g.player;
    p.x = b.x; p.z = b.z; g.world.chunks.update(p.x, p.z, -1); p.y = g.world.heightAt(p.x, p.z) + 0.1;
    frame(3);
    const coffre = g.world.chunks.propsNear(p.x, p.z, 12).find((pr) => pr.kind === 'coffre' && pr.sid === b.sid && pr.bid === b.id)!;
    const lit = g.world.chunks.propsNear(p.x, p.z, 12).find((pr) => pr.kind === 'lit' && pr.bid === b.id)!;
    expect(coffre).toBeDefined(); expect(lit).toBeDefined();
    // devant le coffre
    p.x = coffre.x; p.z = coffre.z + 0.9; p.heading = 0; frame(2);
    expect(g.focus?.t === 'prop' && g.focus.prop.kind, String(g.focus?.label)).toBe('coffre');
    expect(g.focus!.label).toContain('Ouvrir votre coffre'); expect(g.focus!.t === 'prop' && g.focus!.hint).toBeUndefined();
    g.state.opened.add(coffre.key);                      // un autre joueur l'a déjà fouillé chez lui : sans effet sur le coffre personnel
    frame(1); expect(g.focus!.label).toContain('Ouvrir votre coffre');
    const before = screens.length;
    f.tap('e'); frame(1);
    expect(screens.length).toBe(before + 1);
    const chest = screens.at(-1) as ChestScreen;
    expect(chest).toBeInstanceOf(ChestScreen);
    // transfert de l'écran : pain et or vers le coffre, puis retour
    g.character.inv.add('pain', 5); g.character.inv.add('épée courte~62', 1);
    const pains = g.character.inv.count('pain');
    const gold = g.character.inv.gold;
    const ui = (keys: string[]) => ({ input: { key: (k: string) => keys.includes(k), pressed: (k: string) => keys.includes(k), isDown: () => false }, grid: {} as never, renderer: {} as never, mouseCell: { x: -1, y: -1 }, clicked: false, close() {} }) as never;
    const press = (...k: string[]) => chest.input(ui(k));
    // ligne 0 de la colonne de gauche = l'or ; on descend jusqu'au pain
    const rows = (chest as unknown as { rows(): { id: string; qty: number; gold?: boolean }[][] }).rows();
    const painAt = rows[0].findIndex((r) => r.id === 'pain');
    expect(rows[0][0].gold).toBe(true); expect(rows[0].some((r) => r.id === 'quête:x')).toBe(false);
    for (let i = 0; i < painAt; i++) press('ArrowDown');
    press('t'); press('Enter');
    expect(g.character.inv.count('pain')).toBe(0); expect(g.poss.estate.chest.count('pain')).toBe(pains);
    // l'or : première ligne, 10 par 10
    chest.input(ui(['ArrowUp'])); for (let i = 0; i < painAt; i++) press('ArrowUp');
    press('t'); press('Enter');
    expect(g.poss.estate.chest.gold).toBe(gold); expect(g.character.inv.gold).toBe(0);
    // l'épée n'est pas équipée : déposable avec son usure ; l'équipée reste sur soi
    const rows2 = (chest as unknown as { rows(): { id: string }[][] }).rows();
    expect(rows2[0].some((r) => r.id === 'tunique de cuir')).toBe(false);          // équipée : absente de la colonne du sac
    expect(g.toSave().estate!.gold).toBe(gold);
    // lit : gratuit
    { const dx = b.x - lit.x, dz = b.z - lit.z, l = Math.hypot(dx, dz) || 1; p.x = lit.x + (dx / l) * 1.3; p.z = lit.z + (dz / l) * 1.3; p.heading = Math.atan2(lit.x - p.x, -(lit.z - p.z)); }
    p.hp = 10; p.poison = 5; frame(2);
    expect(g.focus!.label).toBe('Dormir chez vous (gratuit)');
    const night = g.time.minutes;
    f.tap('e'); frame(1);
    expect(p.hp).toBe(p.maxHp); expect(p.poison).toBe(0); expect(g.buffs.some((x) => x.name === 'Bien reposé')).toBe(true); expect(g.time.minutes).toBeGreaterThan(night);
  });

  it('sauvegarde et chargement : le jeu réutilisé, puis un nouveau jeu, retrouvent tout ; une ancienne sauvegarde remet tout à zéro', () => {
    const save = JSON.parse(JSON.stringify(g.toSave()));
    expect(save.estate.house).toBeDefined(); expect(save.estate.chest.length).toBeGreaterThan(0);
    const g2 = new Game('TEST-001', renderer);
    g2.applySave(save);
    expect(g2.poss.estate.house).toEqual(save.estate.house); expect(g2.poss.estate.chest.count('pain')).toBe(8); expect(g2.entities.horse?.alive).toBe(true); expect(g2.entities.merc?.alive).toBe(true);
    expect(JSON.parse(JSON.stringify(g2.toSave())).estate).toEqual(save.estate);
    // ancienne sauvegarde (sans estate) appliquée sur un jeu qui possède tout : rien de possédé ensuite
    const old = JSON.parse(JSON.stringify(save)); delete old.estate;
    g.applySave(old);
    expect(g.poss.estate.house).toBeNull(); expect(g.entities.horse).toBeNull(); expect(g.entities.merc).toBeNull(); expect(g.poss.estate.chest.items.size).toBe(0);
    expect(g.toSave().estate).toBeUndefined();
    expect(g.entities.npcsOf(site.s.id).some((n) => n.home === save.estate.house.bid)).toBe(false);   // la maison reste vide (à vendre) pour tous
  });
});

describe('affichage : HUD, coffre, carte, journal (sans exception, avec les bons textes)', () => {
  it('dessine le jeu avec cheval, mercenaire et maison', async () => {
    const { TextGrid } = await import('@ascii-fort/ascii-engine/TextGrid');
    const { drawHud } = await import('../src/ui/HUD');
    const { MapScreen, JournalScreen } = await import('../src/ui/GameScreens');
    const game = new Game('TEST-001', renderer);
    const grid = new TextGrid(); grid.resize(160, 50);
    const text = () => { let s = ''; for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.cols; x++) s += String.fromCharCode(grid.glyph[y * grid.cols + x] ? 1 : 0); return s; };
    void text;
    const ctx = { input: { key: () => false, pressed: () => false, isDown: () => false, wheel: 0 }, grid, renderer: {} as never, mouseCell: { x: -1, y: -1 }, clicked: false, close() {} } as never;
    const st = { log: [], debug: false, fps: 60, genMs: 1, drawCalls: 1, locked: true };
    // rien de possédé : mêmes écrans qu'avant
    drawHud(grid, game, st); new MapScreen(game).draw(ctx); new JournalScreen(game).draw(ctx);
    // tout possédé, monté, mercenaire à terre
    const s = game.world.civ.settlements.find((x) => game.entities.saleHouse(x.id) !== null)!;
    game.poss.dev('maison', []); game.poss.dev('cheval', ['destrier']); game.poss.dev('mercenaire', []);
    game.entities.horse!.x = game.player.x + 1; game.entities.horse!.z = game.player.z;
    game.poss.toggleMount(); game.poss.beforeMove({ key: () => false } as never);
    game.entities.merc!.ally!.ko = 5;
    game.poss.estate.chest.add('pain', 3); game.poss.estate.chest.gold = 120;
    drawHud(grid, game, st); new MapScreen(game).draw(ctx); new JournalScreen(game).draw(ctx);
    new ChestScreen({ character: game.character, events: game.events, chest: game.poss.estate.chest, title: 'Votre coffre', closeReason: () => null, onClose() {} }).draw(ctx);
    const lines = game.poss.journalLines().map((l) => l.text);
    expect(lines.length).toBe(3); expect(lines[0]).toContain('Maison'); expect(lines[1]).toContain('sous vous'); expect(lines[2]).toContain('à terre');
    expect(game.poss.hint()!.text).toContain('Trot');
    expect(s).toBeDefined();
  });
});
