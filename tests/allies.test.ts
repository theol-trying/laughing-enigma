import { describe, it, expect } from 'vitest';
import { WorldSeed } from '@ascii-fort/core/Seed';
import { GameTime } from '@ascii-fort/core/Time';
import { EventBus } from '@ascii-fort/core/Events';
import { World } from '@ascii-fort/worldgen/World';
import { Player } from '@ascii-fort/sim/entities/Player';
import { EntityManager, type EntityHost } from '@ascii-fort/sim/entities/EntityManager';
import { makeMonster } from '@ascii-fort/sim/entities/Monster';
import { hitEntity, type CombatHost } from '@ascii-fort/sim/gameplay/Combat';
import { HORSE_GRADES, MERC, MOUNT, mercStats, worldOf, type SavedHorse, type SavedMerc } from '@ascii-fort/sim/gameplay/Companions';
import { generateDungeon, buildDungeon } from '@ascii-fort/worldgen/dungeons/DungeonGenerator';

const world = new World(new WorldSeed('TEST-001'), null);

/** Un coin de terre sèche et dégagé (pas d'eau profonde dans un carré de 160 m), loin des villages. */
function openSpot(): { x: number; z: number } {
  const dry = (x: number, z: number) => { const w = world.waterAt(x, z); return Number.isNaN(w) || w - world.heightAt(x, z) < 0.3; };
  for (let r = 300; r < 3000; r += 100) for (let a = 0; a < 16; a++) {
    const cx = world.civ.start.x + Math.cos(a) * r, cz = world.civ.start.z + Math.sin(a * 2.3) * r;
    if (cx < 200 || cz < 200 || cx > 8000 || cz > 8000) continue;
    if (world.civ.settlements.some((s) => !s.abandoned && Math.hypot(s.x - cx, s.z - cz) < s.radius + 400)) continue;
    let ok = true;
    for (let dx = -80; dx <= 80 && ok; dx += 10) for (let dz = -80; dz <= 80 && ok; dz += 10) ok = dry(cx + dx, cz + dz);
    if (ok) return { x: cx, z: cz };
  }
  throw new Error('pas de terrain dégagé');
}
const spot = openSpot();

function setup(at = spot) {
  const player = new Player(), events = new EventBus(), time = new GameTime();
  player.x = at.x; player.z = at.z; world.chunks.update(at.x, at.z, -1); player.y = world.heightAt(at.x, at.z);
  const combat: CombatHost = { player, events, onPlayerDeath() { player.dead = true; }, playerArmor: () => 0 };
  let dungeon = false;
  const host: EntityHost = { world, time, player, events, combat, inDungeon: () => dungeon, rain: () => 0, night: () => 0, fog: () => 0 };
  const em = new EntityManager(host);
  const msgs: string[] = [];
  events.on('message', (m) => msgs.push(m.text));
  const run = (secs: number, dt = 0.05, each?: (t: number) => void) => { for (let t = 0; t < secs; t += dt) { each?.(t); em.update(dt); } };
  return { player, events, em, combat, msgs, run, setDungeon: (v: boolean) => { dungeon = v; } };
}
const horseAt = (x: number, z: number, over: Partial<SavedHorse> = {}): SavedHorse => ({ grade: 'palefroi', coat: 1, name: 'Braise', hp: 90, x, z, heading: 0, ...over });
const mercAt = (x: number, z: number, over: Partial<SavedMerc> = {}): SavedMerc & { x: number; z: number } => ({ first: 'Aldric', last: 'Roche', sex: 'm', arch: 'lame', look: 12, hp: 999, left: 7 * 1440, mode: 'suivre', x, z, ...over });

describe('cheval', () => {
  it('monté, il suit le joueur ; au galop il s’essouffle, au trot il récupère', () => {
    const s = setup(), h = s.em.spawnHorse(horseAt(spot.x + 2, spot.z));
    h.ally!.mounted = true;
    s.player.vx = 0; s.player.vz = -12; s.player.sprinting = true;
    s.run(20, 0.05, () => { s.player.z += s.player.vz * 0.05; });
    expect(h.x).toBe(s.player.x); expect(h.z).toBe(s.player.z); expect(h.ally!.winded).toBe(true);
    expect(s.msgs.some((m) => m.includes('s’essouffle'))).toBe(true);
    expect(s.em.dynamic.some((c) => Math.hypot(c.x - h.x, c.z - h.z) < 0.01)).toBe(false);     // le cheval monté ne bloque pas son cavalier
    expect(s.em.pick(s.player.x, s.player.z, 0, 5, false)).toBeNull();
    s.player.sprinting = false; s.player.vz = -6;
    s.run(8, 0.05, () => { s.player.z += s.player.vz * 0.05; });
    expect(h.ally!.winded).toBe(false);
  });

  it('laissé à pied il reste où il est (sans jamais être poussé), même si le joueur s’éloigne', () => {
    const s = setup(), h = s.em.spawnHorse(horseAt(spot.x + 5, spot.z));
    const x0 = h.x, z0 = h.z;
    s.player.x += 120; s.run(10);
    expect(h.x).toBe(x0); expect(h.z).toBe(z0); expect(h.ally!.dormant).toBe(false);
    s.player.x += 200; s.run(2);
    expect(h.ally!.dormant).toBe(true); expect(h.x).toBe(x0);
  });

  it('au sifflet il accourt jusqu’à 2,6 m du joueur', () => {
    const s = setup(), h = s.em.spawnHorse(horseAt(spot.x + 60, spot.z + 10));
    h.ally!.mode = 'siffle';
    s.run(20);
    expect(Math.hypot(h.x - s.player.x, h.z - s.player.z)).toBeLessThan(MOUNT.stopDist + 1);
    expect(h.ally!.mode).toBe('attendre');
  });

  it('blessé et menacé il fuit ; il guérit lentement ; à zéro PV il meurt (perdu) et le cadavre disparaît', () => {
    const s = setup(), h = s.em.spawnHorse(horseAt(spot.x + 30, spot.z, { hp: 20 }));
    const w = makeMonster('t:wolf', 'loup', h.x + 8, h.z, h.x + 8, h.z, 40);
    w.mon!.alerted = true; w.mon!.state = 'chasse'; w.mon!.targetId = 'ally:horse';
    s.em.entities.push(w);
    const d0 = Math.hypot(h.x - w.x, h.z - w.z);
    s.run(2);
    expect(h.ally!.mode).toBe('fuite'); expect(s.msgs.some((m) => m.includes('prend la fuite'))).toBe(true);
    s.run(3);
    expect(Math.hypot(h.x - w.x, h.z - w.z)).toBeGreaterThan(d0);
    // guérison hors de portée du danger
    s.em.removeAlly('horse'); s.em.entities.splice(s.em.entities.indexOf(w), 1);
    const h2 = s.em.spawnHorse(horseAt(spot.x + 10, spot.z, { hp: 10 }));
    s.run(30);
    expect(h2.hp).toBeGreaterThan(20);
    // mort
    hitEntity(s.combat, h2, 500, 'loup');
    expect(h2.alive).toBe(false); expect(h2.looted).toBe(true); expect(s.msgs.some((m) => m.includes('est mort'))).toBe(true);
    expect(s.em.horse).toBe(h2);
    s.run(MOUNT.corpse + 5);
    expect(s.em.horse).toBeNull(); expect(s.em.entities.includes(h2)).toBe(false);
  });

  it('pas de tir ami ; l’armure du grade réduit les coups ; aucun entity:killed', () => {
    const s = setup(), h = s.em.spawnHorse(horseAt(spot.x + 3, spot.z, { grade: 'destrier', hp: 120 }));
    let killed = 0; s.events.on('entity:killed', () => killed++);
    expect(hitEntity(s.combat, h, 50, 'player')).toBe(0); expect(hitEntity(s.combat, h, 50, 'ally:merc')).toBe(0); expect(h.hp).toBe(120);
    const dmg = hitEntity(s.combat, h, 30, 'loup');
    expect(dmg).toBe(Math.round(30 * (1 - HORSE_GRADES.destrier.armor / (HORSE_GRADES.destrier.armor + 12))));
    hitEntity(s.combat, h, 999, 'loup');
    expect(killed).toBe(0);
  });
});

describe('mercenaire', () => {
  it('suit le joueur et ne le lâche pas (il court s’il a du retard, se téléporte s’il est à plus de 45 m)', () => {
    const s = setup(), m = s.em.spawnMerc(mercAt(spot.x - 3, spot.z), 5);
    expect(m.ally!.level).toBe(4); expect(m.maxHp).toBe(mercStats(4, 'lame').hp);
    s.player.vz = -4.2;
    let worst = 0;
    s.run(40, 0.05, () => { s.player.z += s.player.vz * 0.05; worst = Math.max(worst, Math.hypot(m.x - s.player.x, m.z - s.player.z)); });
    expect(worst).toBeLessThan(MERC.teleportDist);
    expect(Math.hypot(m.x - s.player.x, m.z - s.player.z)).toBeLessThan(8);
    s.player.z += 300; s.run(1);
    expect(Math.hypot(m.x - s.player.x, m.z - s.player.z)).toBeLessThan(3);
  });

  it('« attendre ici » : il garde sa position et revient à son poste', () => {
    const s = setup(), m = s.em.spawnMerc(mercAt(spot.x + 4, spot.z, { mode: 'attendre' }), 5);
    const x0 = m.x, z0 = m.z;
    s.player.x -= 30; s.run(8);
    expect(Math.hypot(m.x - x0, m.z - z0)).toBeLessThan(0.5);
  });

  it('combat les monstres qui visent le joueur, crédite le joueur, ne touche ni PNJ ni gibier', () => {
    const s = setup(), m = s.em.spawnMerc(mercAt(spot.x - 2, spot.z, { arch: 'hache' }), 12);
    const w = makeMonster('t:wolf', 'loup', spot.x, spot.z - 9, spot.x, spot.z - 9, 40);
    w.mon!.alerted = true; w.mon!.state = 'chasse'; w.mon!.targetId = 'player';
    const deer = makeMonster('t:deer', 'cerf', spot.x + 6, spot.z, spot.x + 6, spot.z, 40);
    s.em.entities.push(w, deer);
    const kills: (string | null)[] = []; s.events.on('entity:killed', (k) => kills.push(`${k.type}:${k.killerId}`));
    s.run(15);
    expect(w.alive).toBe(false); expect(deer.alive).toBe(true);
    expect(kills).toEqual(['loup:player']);
    expect(s.msgs.some((t) => t.startsWith('Aldric : «'))).toBe(true);
  });

  it('tombe à terre (KO), n’est plus ciblable, se relève avec 30 % de ses PV', () => {
    const s = setup(), m = s.em.spawnMerc(mercAt(spot.x - 2, spot.z), 3);
    const dmg = hitEntity(s.combat, m, 9999, 'troll');
    expect(dmg).toBeGreaterThan(0); expect(m.alive).toBe(true); expect(m.ally!.ko).toBe(MERC.koSeconds); expect(m.hp).toBe(0);
    expect(hitEntity(s.combat, m, 50, 'troll')).toBe(0);
    const t = makeMonster('t:troll', 'troll', m.x + 3, m.z, m.x, m.z, 40);
    t.mon!.targetId = 'ally:merc'; t.mon!.alerted = true; t.mon!.state = 'chasse';
    s.em.entities.push(t);
    s.run(1);
    expect(t.mon!.targetId).not.toBe('ally:merc');
    s.em.entities.splice(s.em.entities.indexOf(t), 1);
    s.run(MERC.koSeconds + 1);
    expect(m.ally!.ko).toBe(0); expect(m.hp).toBeGreaterThanOrEqual(Math.ceil(m.maxHp * MERC.reviveFrac)); expect(s.msgs.some((x) => x.includes('se relève'))).toBe(true);
  });

  it('suit le joueur dans un donjon, reste sur place s’il attend, rejoint s’il est resté sous terre', () => {
    const s = setup(), m = s.em.spawnMerc(mercAt(spot.x - 2, spot.z), 5), w = s.em.spawnMerc(mercAt(spot.x - 2, spot.z), 5);
    s.em.removeAlly('merc');
    const follow = s.em.spawnMerc(mercAt(spot.x - 2, spot.z), 5);
    s.setDungeon(true); s.player.x = 20000 + 440 + 30; s.player.z = 1060;
    s.run(1);
    expect(Math.hypot(follow.x - s.player.x, follow.z - s.player.z)).toBeLessThan(3);
    expect(follow.x).toBeGreaterThan(20000);
    // il attendait en surface : gelé sous terre
    follow.ally!.mode = 'attendre'; follow.ally!.post = { x: spot.x, z: spot.z }; follow.x = spot.x; follow.z = spot.z;
    s.run(1);
    expect(follow.ally!.dormant).toBe(true); expect(follow.x).toBe(spot.x);
    // le joueur ressort ; resté dans un souterrain en attendant : il rejoint
    s.setDungeon(false); s.player.x = spot.x + 50; s.player.z = spot.z;
    follow.x = 20000 + 440 + 30; follow.z = 1060; follow.ally!.mode = 'attendre';
    s.run(1);
    expect(follow.ally!.mode).toBe('suivre'); expect(Math.hypot(follow.x - s.player.x, follow.z - s.player.z)).toBeLessThan(3);
    void m; void w;
  });

  it('le niveau suit celui du joueur ; les PV sont conservés en proportion', () => {
    const s = setup(), m = s.em.spawnMerc(mercAt(spot.x, spot.z, { hp: 25 }), 1);
    expect(m.ally!.level).toBe(1); const half = m.hp / m.maxHp;
    s.em.syncMerc(11);
    expect(m.ally!.level).toBe(10); expect(m.maxHp).toBe(mercStats(10, 'lame').hp); expect(m.ally!.damage).toBe(mercStats(10, 'lame').damage);
    expect(m.hp / m.maxHp).toBeCloseTo(half, 1);
    expect(m.model.parts.length).toBeGreaterThan(0);
  });
});

describe('maison à vendre au chargement des PNJ', () => {
  it('la maison à vendre est vide dès le premier chargement ; l’achat n’y change rien ; setOwnedHouse libère une autre maison', () => {
    const s = setup();
    let checked = 0;
    for (const st of world.civ.settlements) {
      const sale = s.em.saleHouse(st.id);
      if (sale === null) continue;
      const npcs = s.em.npcsOf(st.id);
      expect(npcs.some((n) => n.home === sale)).toBe(false);
      checked++;
      if (checked === 1) {
        const other = npcs.find((n) => n.profession === 'artisan' || n.profession === 'fermier')!.home;
        s.em.setOwnedHouse({ sid: st.id, bid: other });
        expect(npcs.some((n) => n.home === other)).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(8);
  });
});

describe('mercenaire dans un donjon', () => {
  it('suit le joueur de salle en salle sans se coincer dans un mur, jusqu’au fond', () => {
    for (const d of world.civ.dungeons.slice(0, 3)) {
      const layout = generateDungeon(world.seed, d), built = buildDungeon(layout);
      world.chunks.overlays = [built.data];
      try {
        const s = setup({ x: layout.entrance.x, z: layout.entrance.z });
        s.setDungeon(true); s.player.y = 0.05;
        // trajet : de la salle d'entrée à la plus éloignée (liens libres), par le centre des salles
        const route: { x: number; z: number }[] = [], adj = (c: number) => layout.links.filter((l) => !l.locked && (l.a === c || l.b === c)).map((l) => (l.a === c ? l.b : l.a));
        const prev = new Map<number, number>([[0, -1]]), q = [0];
        while (q.length) { const c = q.shift()!; for (const n of adj(c)) if (!prev.has(n)) { prev.set(n, c); q.push(n); } }
        const far = [...prev.keys()].pop()!;
        for (let c = far; c >= 0; c = prev.get(c)!) route.unshift({ x: layout.rooms[c].x, z: layout.rooms[c].z });
        const m = s.em.spawnMerc(mercAt(layout.entrance.x + 1, layout.entrance.z), 5);
        let worst = 0, k = 0;
        s.player.x = route[0].x; s.player.z = route[0].z; m.x = route[0].x + 1; m.z = route[0].z;
        for (const wp of route.slice(1)) {
          for (let guard = 0; guard < 4000 && Math.hypot(wp.x - s.player.x, wp.z - s.player.z) > 0.5; guard++, k++) {
            const dx = wp.x - s.player.x, dz = wp.z - s.player.z, l = Math.hypot(dx, dz);
            s.player.x += (dx / l) * 4.2 * 0.05; s.player.z += (dz / l) * 4.2 * 0.05;
            s.em.update(0.05);
            worst = Math.max(worst, Math.hypot(m.x - s.player.x, m.z - s.player.z));
          }
        }
        s.run(5);
        expect(worst).toBeLessThan(MERC.teleportDist);
        expect(Math.hypot(m.x - s.player.x, m.z - s.player.z)).toBeLessThan(8);
        expect(worldOf(m.x)).toBe(d.id);
      } finally { world.chunks.overlays = []; }
    }
  });
});
