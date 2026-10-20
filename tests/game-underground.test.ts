import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/Game';
import { hitEntity } from '@ascii-fort/sim/gameplay/Combat';
import { worldOf } from '@ascii-fort/sim/gameplay/Companions';
import type { Prop } from '@ascii-fort/worldgen/Chunk';
import type { SaveData } from '../src/game/SaveManager';

// Étape 55, passe 2, de bout en bout et sans écran : escaliers d'un donjon à trois niveaux (mercenaire qui suit, cheval qui reste
// dehors, aucune créature d'un étage ne traîne dans un autre), leviers et herse, mort sous terre, grotte à plusieurs entrées
// (on ressort par une autre), filon miné à la pioche, champignons, découvertes et carte, sauvegarde et chargement.

const renderer = { createMesh: () => ({}), deleteMesh() {}, render() {}, ui: {} } as never;
const fakeInput = () => {
  const pressed = new Set<string>();
  const input = {
    isDown: () => false, pressed: () => false, key: (k: string) => pressed.has(k),
    mouseDown: () => false, mouseClicked: () => false, mouseReleased: () => false, locked: true, mouseDX: 0, mouseDY: 0, wheel: 0, doubleTapped: null, muted: false,
  };
  return { input: input as never, tap: (...k: string[]) => { pressed.clear(); k.forEach((x) => pressed.add(x)); } };
};

describe('souterrains : étages des donjons et grottes', () => {
  const g = new Game('TEST-001', renderer);
  g.ui = { openDialogue() {}, openTrade() {}, openScreen() {} };
  g.god = true;
  const f = fakeInput();
  const frame = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) { g.update(dt, f.input); f.tap(); } };
  const goTo = (x: number, z: number, heading = 0) => {
    if (g.dungeon) g.exitDungeon();
    const p = g.player; p.x = x; p.z = z; p.heading = heading; p.vx = p.vz = p.vy = 0;
    g.world.chunks.update(x, z, -1); p.y = g.world.heightAt(x, z) + 0.1;
  };
  /** objet souterrain (superpositions) par clé */
  const prop = (key: string): Prop => { const pr = g.world.chunks.overlays.flatMap((o) => o.props).find((x) => x.key === key); expect(pr, key).toBeDefined(); return pr!; };
  /** se place à 1,1 m de l'objet, du côté de (ax, az), face à lui, et appuie sur [E] */
  const use = (pr: Prop, ax: number, az: number) => {
    const p = g.player, dx = ax - pr.x, dz = az - pr.z, l = Math.hypot(dx, dz) || 1;
    p.x = pr.x + (dx / l) * 1.1; p.z = pr.z + (dz / l) * 1.1; p.vx = p.vz = p.vy = 0;
    if (!g.dungeon) { g.world.chunks.update(p.x, p.z, -1); p.y = g.world.heightAt(p.x, p.z) + 0.05; } else p.y = 0.05;
    p.heading = Math.atan2(pr.x - p.x, -(pr.z - p.z));
    // le mercenaire (qui suit) ne doit pas se tenir entre le joueur et l'objet : on le met derrière
    const m = g.entities.merc;
    if (m && worldOf(m.x, m.z) === worldOf(p.x, p.z)) { m.x = p.x + (dx / l) * 1.5; m.z = p.z + (dz / l) * 1.5; m.ally!.following = false; }
    frame(1);
    expect(g.focus?.t === 'prop' && g.focus.prop.key, `[E] sur ${pr.key} (focus : ${g.focus?.label ?? 'aucun'})`).toBe(pr.key);
    f.tap('e'); frame(1);
  };
  const mobs = () => g.entities.entities.filter((e) => e.mon && !e.ally);
  const civ = g.world.civ;
  const d = civ.dungeons.find((x) => x.kind === 'forteresse')!;
  const poi = civ.pois.find((x) => x.id === d.poiId)!;

  it('niveau 1 : le plan d’origine et ses créatures (« dj<id>:m<i> »), plus un escalier qui descend', () => {
    goTo(poi.x + 6, poi.z + 6);
    g.poss.dev('cheval', ['destrier']);
    g.poss.dev('mercenaire', []);
    expect(g.entities.merc).toBeTruthy();
    g.enterDungeon(d.id);
    frame(2);
    expect(g.dungeon?.floor).toBe(1);
    expect(g.underId()).toBe(d.id);
    expect(g.under.floors(d)).toBe(3);
    expect(mobs().every((e) => e.id.startsWith(`dj${d.id}:`))).toBe(true);
    expect(mobs().length).toBeGreaterThan(3);
    expect(g.under.label()).toContain('niveau 1/3');
    expect(g.under.floorTag()).toBe('niveau 1/3');
    prop(`dj${d.id}:descendre`);
    // le cheval est resté dehors, le mercenaire a suivi
    const h = g.entities.horse!, m = g.entities.merc!;
    expect(worldOf(h.x, h.z)).toBe(-1);
    expect(worldOf(m.x, m.z)).toBe(d.id);
  });

  it('[E] sur l’escalier : niveau 2 puis 3 ; créatures plus fortes, aucune du niveau précédent ; le mercenaire suit', () => {
    const lvl1 = mobs().find((e) => !e.mon!.leader)!.mon!.level;
    const ds = prop(`dj${d.id}:descendre`);
    use(ds, ds.x, ds.z - 4);
    expect(g.dungeon?.floor).toBe(2);
    expect(g.underId()).toBe(d.id + 1000);
    expect(g.entities.underZone).toBe(`d${d.id}.2`);
    expect(g.entities.activeZoneKeys()).toContain(`d${d.id}.2`);
    frame(3);
    expect(mobs().length).toBeGreaterThan(3);
    expect(mobs().every((e) => e.id.startsWith(`dj${d.id}.2:`))).toBe(true);
    expect(Math.max(...mobs().filter((e) => !e.mon!.leader).map((e) => e.mon!.level))).toBeGreaterThan(lvl1);
    const m = g.entities.merc!;
    expect(worldOf(m.x, m.z)).toBe(g.underId());
    expect(Math.hypot(m.x - g.player.x, m.z - g.player.z)).toBeLessThan(3);
    expect(g.state.discovered.has(`étage:${d.id}:2`)).toBe(true);
    const F2 = g.dungeon!.floorPlan!;
    use(prop(F2.down!.key), F2.down!.x, F2.down!.z - 4);
    expect(g.dungeon?.floor).toBe(3);
    frame(3);
    expect(mobs().every((e) => e.id.startsWith(`dj${d.id}.3:`))).toBe(true);
    expect(worldOf(g.entities.merc!.x, g.entities.merc!.z)).toBe(d.id + 2000);
    // le gardien de l'étage : une créature unique nommée ; sa mort est retenue
    const F3 = g.dungeon!.floorPlan!, gi = F3.spawns.findIndex((s) => s.elite);
    expect(gi).toBeGreaterThanOrEqual(0);
    const guard = g.entities.entities.find((e) => e.id === `dj${d.id}.3:m${gi}`)!;
    expect(guard.name).toContain(F3.spawns[gi].elite!.name);
    hitEntity(g.combat, guard, 1e6, 'player');
    expect(g.entities.killed.has(guard.id)).toBe(true);
    expect(g.banner?.text).toContain('TOMBÉ');
  });

  it('on remonte au niveau 1 à côté de l’escalier ; le boss de chaîne et la porte du niveau 1 sont toujours là ; sortie au bon endroit', () => {
    const ret = { ...g.dungeon!.ret };
    const up3 = prop(`dj${d.id}.3:monter`);
    use(up3, up3.x, up3.z - 3);
    expect(g.dungeon?.floor).toBe(2);
    const F2 = g.dungeon!.floorPlan!;
    expect(Math.hypot(g.player.x - F2.down!.x, g.player.z - F2.down!.z)).toBeLessThan(4);
    use(prop(`dj${d.id}.2:monter`), F2.up.x, F2.up.z - 3);
    expect(g.dungeon?.floor).toBe(1);
    const ds = prop(`dj${d.id}:descendre`);
    expect(Math.hypot(g.player.x - ds.x, g.player.z - ds.z)).toBeLessThan(2);
    frame(2);
    expect(mobs().every((e) => e.id.startsWith(`dj${d.id}:`))).toBe(true);
    expect(g.dungeon!.layout.lockedDoor).not.toBeNull();
    // la sortie du niveau 1 ramène devant l'entrée du donjon (et non ailleurs)
    g.exitDungeon();
    expect(g.dungeon).toBeNull();
    expect(Math.hypot(g.player.x - ret.x, g.player.z - ret.z)).toBeLessThan(0.01);
    frame(2);
    expect(mobs().some((e) => e.id.startsWith('dj'))).toBe(false);
  });

  it('sauvegarde au niveau 2 : la surface dans l’ancien champ, le souterrain dans « under » ; chargement au même endroit', () => {
    goTo(poi.x + 6, poi.z + 6);
    g.under.dev('etages', ['aller', String(d.id), '2']);
    expect(g.dungeon?.floor).toBe(2);
    const p = g.player; p.x += 1.5; const at = { x: p.x, z: p.z };
    const ret = { ...g.dungeon!.ret };
    const save = JSON.parse(JSON.stringify(g.toSave())) as SaveData;
    expect(save.player.dungeon).toBe(-1);
    expect(Math.hypot(save.player.x - ret.x, save.player.z - ret.z)).toBeLessThan(0.02);
    expect(save.under?.k).toBe('étage'); expect(save.under?.floor).toBe(2);
    expect(save.killed).toContain(`dj${d.id}.3:m${g.under.floorPlan(d, 3).spawns.findIndex((s) => s.elite)}`);
    g.exitDungeon(); goTo(100, 100);
    g.applySave(save);
    expect(g.dungeon?.floor).toBe(2);
    expect(g.underId()).toBe(d.id + 1000);
    expect(Math.hypot(g.player.x - at.x, g.player.z - at.z)).toBeLessThan(0.02);
    expect(Math.hypot(g.dungeon!.ret.x - ret.x, g.dungeon!.ret.z - ret.z)).toBeLessThan(0.02);
    frame(3);
    const m = g.entities.merc!;
    expect(worldOf(m.x, m.z)).toBe(g.underId());
    // le gardien tué ne revient pas
    g.under.dev('descendre', []);
    expect(g.dungeon?.floor).toBe(3);
    const gi = g.under.floorPlan(d, 3).spawns.findIndex((s) => s.elite);
    expect(g.entities.entities.some((e) => e.id === `dj${d.id}.3:m${gi}`)).toBe(false);
  });

  it('mort sous terre : on se réveille à la surface, le mercenaire rejoint', () => {
    g.god = false;
    g.player.hp = 0; g.player.dead = true; g.onPlayerDeath();
    frame(100);
    g.god = true;
    expect(g.dungeon).toBeNull();
    expect(g.player.dead).toBe(false);
    expect(g.player.x).toBeLessThan(9000);
    frame(3);
    const m = g.entities.merc!;
    expect(worldOf(m.x, m.z)).toBe(-1);
  });

  const atlas = g.world.caves;
  const net = atlas.nets.find((n) => n.entrances.length >= 2)!;

  it('grotte en réseau : entrée découverte en passant, [E] pour entrer, on ressort par une autre entrée, plus loin', () => {
    expect(net).toBeDefined();
    const e0 = net.entrances[0], e1 = net.entrances[1];
    goTo(e0.ax + 30, e0.az + 20);
    frame(25);
    expect(g.state.discovered.has('grotte:' + e0.key)).toBe(true);
    expect(g.under.markers().some((m) => m.name === net.name)).toBe(true);
    const mo = atlas.mouth(e0)!;
    const pr = g.world.chunks.propsNear(mo.px, mo.pz, 1).find((x) => x.key === e0.key)!;
    expect(pr).toBeDefined();
    use(pr, mo.ox, mo.oz);
    expect(g.dungeon?.floor).toBe(0);
    expect(g.dungeon?.cave?.id).toBe(net.id);
    expect(g.underId()).toBe(100000 + net.id);
    expect(g.entities.underZone).toBe('gr' + net.id);
    expect(g.under.label()).toBe(net.name);
    frame(3);
    expect(mobs().length).toBeGreaterThan(0);
    expect(mobs().every((e) => e.id.startsWith(`gr${net.id}:`))).toBe(true);
    expect(worldOf(g.entities.merc!.x, g.entities.merc!.z)).toBe(g.underId());
    expect(worldOf(g.entities.horse!.x, g.entities.horse!.z)).toBe(-1);
    // l'issue 1 mène devant l'entrée 1 du réseau
    const C = g.dungeon!.cave!, x1 = C.exits[1];
    use(prop(x1.key), x1.arrive.x, x1.arrive.z);
    expect(g.dungeon).toBeNull();
    const m1 = atlas.mouth(e1)!;
    expect(Math.hypot(g.player.x - m1.ox, g.player.z - m1.oz)).toBeLessThan(0.01);
    expect(Math.hypot(g.player.x - e0.ax, g.player.z - e0.az)).toBeGreaterThan(250);
    expect(g.state.discovered.has('grotte:' + e1.key)).toBe(true);
    frame(2);
    expect(mobs().some((e) => e.id.startsWith('gr'))).toBe(false);
  });

  it('filon à la pioche (minerai, filon épuisé et retenu), champignons cueillis, créature tuée : tout survit à la sauvegarde', () => {
    g.under.dev('grotte', [String(net.id), '1']);
    expect(g.dungeon?.cave?.id).toBe(net.id);
    const C = g.dungeon!.cave!, v = C.veins[0], p = g.player;
    // face au filon, pioche en main
    g.character.inv.add('pioche', 1); g.character.equipItem('pioche');
    const cx = Math.floor((v.x - C.ox) / 2), cz = Math.floor((v.z - C.oz) / 2);
    let best = { x: v.x, z: v.z, d: Infinity };
    for (let j = cz - 2; j <= cz + 2; j++) for (let i = cx - 2; i <= cx + 2; i++) {
      if (C.cells[j * C.W + i] !== 1) continue;
      const x = C.ox + i * 2 + 1, z = C.oz + j * 2 + 1, dd = Math.hypot(x - v.x, z - v.z);
      if (dd > 0.9 && dd < best.d) best = { x, z, d: dd };
    }
    p.x = best.x; p.z = best.z; p.y = 0.05; p.heading = Math.atan2(v.x - p.x, -(v.z - p.z));
    const before = g.character.inv.count('minerai de fer') + g.character.inv.count('charbon') + g.character.inv.count('pépite d’or') + g.character.inv.count('gemme brute');
    const harvest = (g as unknown as { harvest(heavy: boolean): void }).harvest.bind(g);
    for (let i = 0; i < 6 && !g.world.chunks.removed.has(v.id); i++) harvest(true);
    expect(g.world.chunks.removed.has(v.id)).toBe(true);
    const after = g.character.inv.count('minerai de fer') + g.character.inv.count('charbon') + g.character.inv.count('pépite d’or') + g.character.inv.count('gemme brute');
    expect(after).toBeGreaterThan(before);
    expect(g.world.chunks.nodesNear(v.x, v.z, 3).some((n) => n.id === v.id)).toBe(false);
    frame(2);
    // champignons
    const pa = C.patches[0], pp = prop(pa.key);
    const mush = g.character.inv.count('champignon');
    const near = (() => { for (const r of [1.2, 1.6, 2]) for (let a = 0; a < 16; a++) { const x = pa.x + Math.cos(a * 0.4) * r, z = pa.z + Math.sin(a * 0.4) * r, k = Math.floor((z - C.oz) / 2) * C.W + Math.floor((x - C.ox) / 2); if (C.cells[k] === 1) return { x, z }; } return { x: pa.x, z: pa.z + 1 }; })();
    use(pp, near.x, near.z);
    expect(g.character.inv.count('champignon')).toBeGreaterThan(mush);
    frame(1);
    expect(g.focus?.t === 'prop' && g.focus.prop.key === pa.key).toBe(false);   // plus rien à cueillir aujourd'hui
    // une créature tuée
    const e = mobs().find((x) => x.id.startsWith(`gr${net.id}:m`))!;
    hitEntity(g.combat, e, 1e6, 'player');
    expect(g.entities.killed.has(e.id)).toBe(true);
    const at = { x: g.player.x, z: g.player.z };
    const save = JSON.parse(JSON.stringify(g.toSave())) as SaveData;
    expect(save.under?.k).toBe('grotte');
    expect(save.removed).toContain(v.id);
    g.exitDungeon(); goTo(100, 100);
    g.applySave(save);
    expect(g.dungeon?.cave?.id).toBe(net.id);
    expect(Math.hypot(g.player.x - at.x, g.player.z - at.z)).toBeLessThan(0.02);
    frame(2);
    expect(g.entities.entities.some((x) => x.id === e.id)).toBe(false);
    expect(g.world.chunks.nodesNear(v.x, v.z, 3).some((n) => n.id === v.id)).toBe(false);
    // ressortir : par l'entrée enregistrée
    const ret = g.dungeon!.ret;
    g.exitDungeon();
    expect(Math.hypot(g.player.x - ret.x, g.player.z - ret.z)).toBeLessThan(0.01);
  });

  it('affichage : HUD (lieu et étage), carte (titre, entrée, grottes), journal (Souterrains), sans exception', async () => {
    const { TextGrid } = await import('@ascii-fort/ascii-engine/TextGrid');
    const { CHARSET } = await import('@ascii-fort/ascii-engine/GlyphAtlas');
    const { drawHud } = await import('../src/ui/HUD');
    const { MapScreen, JournalScreen } = await import('../src/ui/GameScreens');
    const grid = new TextGrid(); grid.resize(160, 50);
    const screen = () => { let s = ''; for (let y = 0; y < grid.rows; y++) { for (let x = 0; x < grid.cols; x++) s += CHARSET[grid.glyph[y * grid.cols + x]] ?? ' '; s += '\n'; } return s; };
    const ctx = { input: { key: () => false, pressed: () => false, isDown: () => false, wheel: 0 }, grid, renderer: {} as never, mouseCell: { x: -1, y: -1 }, clicked: false, close() {} } as never;
    const st = { log: [], debug: false, fps: 60, genMs: 1, drawCalls: 1, locked: true };
    goTo(poi.x + 6, poi.z + 6);
    g.under.dev('etages', ['aller', String(d.id), '2']);
    grid.clear?.(); drawHud(grid, g, st);
    expect(screen()).toContain(`${d.name} · niveau 2/3`);
    new MapScreen(g).draw(ctx);
    expect(screen()).toContain('sous terre');
    new JournalScreen(g).draw(ctx);
    expect(screen()).toContain('Souterrains');
    g.exitDungeon();
    g.under.dev('grotte', [String(net.id), '0']);
    drawHud(grid, g, st); new MapScreen(g).draw(ctx); new JournalScreen(g).draw(ctx);
    expect(screen()).toContain(net.name);
    g.exitDungeon();
  });

  it('console : liste des grottes et des étages, aller à l’entrée la plus proche', () => {
    expect(g.under.dev('grottes', [])[0].text).toContain('réseaux');
    const r = g.under.dev('grotte', []);
    expect(r[0].text).toContain('devant');
    expect(g.dungeon).toBeNull();
    const l = g.under.dev('etages', [String(d.id)]);
    expect(l.some((x) => x.text.includes('niveau 3'))).toBe(true);
    expect(g.under.journalLines().some((x) => x.text.includes(d.name))).toBe(true);
    // des villages parlent de grottes (une rumeur entendue met l'entrée sur la carte)
    const rum = g.rumors.list.find((x) => x.tag.startsWith('grotte:'));
    expect(rum).toBeDefined();
    expect(atlas.entrance(rum!.tag.slice('grotte:'.length))).toBeDefined();
  });
});

describe('souterrains : leviers et herse', () => {
  // TEST-002 : le dernier étage de la forteresse cache son gardien derrière une herse à leviers
  const g = new Game('TEST-002', renderer);
  g.ui = { openDialogue() {}, openTrade() {}, openScreen() {} };
  g.god = true;
  const f = fakeInput();
  const frame = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) { g.update(dt, f.input); f.tap(); } };

  it('tous les leviers actionnés ([E]), la herse se lève : collision retirée, faits « door: » enregistrés', () => {
    let done = false;
    for (const dd of g.world.civ.dungeons) {
      const n = g.under.floors(dd);
      for (let l = 2; l <= n && !done; l++) {
        const F = g.under.floorPlan(dd, l);
        if (!F.gate) continue;
        done = true;
        g.under.dev('etages', ['aller', String(dd.id), String(l)]);
        expect(g.dungeon?.floor).toBe(l);
        const gateSeg = () => g.dungeon!.data.segs.some((x) => (x as { gate?: boolean }).gate);
        expect(gateSeg()).toBe(true);
        expect(g.under.gateOpen()).toBe(false);
        expect(g.under.propLabel(g.dungeon!.data.props.find((x) => x.kind === 'herse')!)).toBe('Herse fermée');
        for (const lv of F.levers) {
          const pr = g.dungeon!.data.props.find((x) => x.key === lv.key)!, p = g.player;
          p.x = pr.x - 1.1; p.z = pr.z; p.y = 0.05; p.heading = Math.PI / 2;   // face au mur est
          const m = g.entities.merc; if (m) { m.x = p.x - 2; m.z = p.z; }
          frame(1);
          expect(g.focus?.t === 'prop' && g.focus.prop.key).toBe(lv.key);
          f.tap('e'); frame(1);
          expect(g.state.flags.get('door:' + lv.key)).toBe(true);
        }
        expect(g.under.gateOpen()).toBe(true);
        expect(gateSeg()).toBe(false);
        frame(40);
        // la herse reste levée au retour (drapeaux sauvegardés)
        g.exitDungeon();
        g.under.dev('etages', ['aller', String(dd.id), String(l)]);
        expect(gateSeg()).toBe(false);
        g.exitDungeon();
      }
    }
    expect(done).toBe(true);
  });
});
