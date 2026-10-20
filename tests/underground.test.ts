import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { WorldSeed } from '@ascii-fort/core/Seed';
import { MacroWorld } from '@ascii-fort/worldgen/MacroWorld';
import { World } from '@ascii-fort/worldgen/World';
import { buildChunk } from '@ascii-fort/worldgen/Chunk';
import { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import { generateDungeon, buildDungeon } from '@ascii-fort/worldgen/dungeons/DungeonGenerator';
import { generateFloor, buildFloor, floorCount, levelOneDescent, buildDescent, type FloorLayout } from '@ascii-fort/worldgen/dungeons/Floors';
import { frameOf } from '@ascii-fort/worldgen/dungeons/Under';
import { CaveAtlas } from '@ascii-fort/worldgen/caves/Caves';
import { generateCave, buildCave, buildVeins, OPEN, ROCK, type CaveLayout } from '@ascii-fort/worldgen/caves/CaveInterior';
import { CHUNK, DUNGEON_ORIGIN_X } from '@ascii-fort/worldgen/constants';
import { W_NONE } from '@ascii-fort/worldgen/terrain/Hydrology';
import { dungeonLevel, MONSTERS } from '@ascii-fort/sim/entities/Monster';
import { worldOf } from '@ascii-fort/sim/gameplay/Companions';

// Étape 55, passe 2 : étages des donjons et réseaux de grottes. RÈGLE : ajout sans déplacement (GENERATOR_VERSION inchangée).
// Le niveau 1 de chaque donjon (plan, salles, créatures et leurs clés, coffres, pièges, porte, boss, géométrie) est figé par une
// empreinte relevée AVANT la passe 2 ; étages et grottes viennent de flux à part et ont leurs propres clés et coordonnées.

/** Empreintes du niveau 1 (generateDungeon + niveau des créatures, et buildDungeon : maillage, collisions, objets, lumières). */
const FROZEN: Record<string, { n: number; layouts: string; geometry: string }> = {
  'TEST-001': { n: 6, layouts: 'b72059b0122886bbca228dfeb0076c8458b25879', geometry: '98d5842c21b3e13eb3a0f49f923ae7157cefd50e' },
  'TEST-002': { n: 5, layouts: '8696eca5f25281d25dd44ee674718063821b3c13', geometry: '3b3ec85e2d36ade5e78268aa73a50bd1406e04ee' },
};

const civs = new Map<string, Civilization>();
const civOf = (seed: string) => { let c = civs.get(seed); if (!c) { c = Civilization.generate(MacroWorld.generate(new WorldSeed(seed))); civs.set(seed, c); } return c; };
/** Monde TEST-001 (une seule génération pour tout le fichier : macro et civilisation partagées) */
let w1: World | null = null;
const worldOf1 = () => (w1 ??= new World(new WorldSeed('TEST-001'), null, civOf('TEST-001').macro, civOf('TEST-001')));

function levelOne(seedText: string) {
  const seed = new WorldSeed(seedText), civ = civOf(seedText);
  const lay = createHash('sha1'), geo = createHash('sha1');
  for (const d of civ.dungeons) {
    const L = generateDungeon(seed, d);
    lay.update(JSON.stringify(L)); lay.update(String(dungeonLevel(civ, d)));
    const b = buildDungeon(L);
    geo.update(new Uint8Array(b.mesh.vertices, 0, b.mesh.vertexCount * 24)); geo.update(new Uint8Array(b.mesh.indices.buffer, 0, b.mesh.indexCount * 4));
    geo.update(JSON.stringify({ s: b.data.segs, p: b.data.platforms, pr: b.data.props, l: b.data.lights, c: b.data.circles }));
  }
  return { n: civ.dungeons.length, layouts: lay.digest('hex'), geometry: geo.digest('hex') };
}

/** Salles atteignables depuis l'arrivée (liens permis). */
function reach(F: { rooms: { id: number }[]; links: { a: number; b: number }[] }, ok: (l: { a: number; b: number }) => boolean): Set<number> {
  const seen = new Set([0]), q = [0];
  while (q.length) { const c = q.pop()!; for (const l of F.links) { if (!ok(l)) continue; const n = l.a === c ? l.b : l.b === c ? l.a : -1; if (n >= 0 && !seen.has(n)) { seen.add(n); q.push(n); } } }
  return seen;
}
const roomOf = (F: FloorLayout, x: number, z: number) => F.rooms.find((r) => Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2);

describe('donjons : le niveau 1 ne bouge pas', () => {
  for (const seed of Object.keys(FROZEN)) {
    it(`${seed} : plans, créatures, coffres, pièges et géométrie du niveau 1 identiques à l’étape 55 (passe 1)`, () => {
      expect(levelOne(seed)).toEqual(FROZEN[seed]);
    });
  }
});

describe('donjons : étages inférieurs', () => {
  const seed = new WorldSeed('TEST-001'), civ = civOf('TEST-001');

  it('les grands donjons descendent (forteresse : 3 niveaux, mines : 2), les petits restent à un niveau', () => {
    const counts = civ.dungeons.map((d) => floorCount(civ, d));
    expect(counts.every((n) => n >= 1 && n <= 3)).toBe(true);
    for (const d of civ.dungeons) {
      if (d.kind === 'forteresse') expect(floorCount(civ, d)).toBe(3);
      if (d.kind === 'mine') expect(floorCount(civ, d)).toBeGreaterThanOrEqual(2);
      if (d.depth <= 1 && d.kind === 'crypte') expect(floorCount(civ, d)).toBe(1);
    }
    expect(counts.some((n) => n === 1)).toBe(true);
  });

  it('déterminisme, clés propres (« dj<id>.<n>: »), salles toutes atteignables, élément nouveau à chaque étage, herse et leviers', () => {
    let gates = 0, guardians = 0;
    for (const d of civ.dungeons) {
      const n = floorCount(civ, d);
      for (let l = 2; l <= n; l++) {
        const F = generateFloor(seed, d, l, n);
        expect(JSON.stringify(generateFloor(seed, d, l, n))).toBe(JSON.stringify(F));
        expect(F.level).toBe(l);
        // coordonnées propres : même tranche en x que le niveau 1, 400 m plus au sud par étage, code de monde distinct
        expect(worldOf(F.up.x, F.up.z)).toBe(d.id + 1000 * (l - 1));
        expect(worldOf(F.up.x, F.up.z)).not.toBe(worldOf(F.up.x));
        const keys = [...F.chests.map((c) => c.key), ...F.traps.map((t) => t.key), ...F.levers.map((v) => v.key), F.up.key, ...(F.down ? [F.down.key] : []), ...(F.gate ? [F.gate.key] : [])];
        expect(new Set(keys).size).toBe(keys.length);
        for (const k of keys) expect(k.startsWith(`dj${d.id}.${l}:`)).toBe(true);
        expect(!!F.down).toBe(l < n);
        // au moins un élément nouveau
        expect(F.features.some((f) => f === 'trésor' || f === 'gardien' || f === 'leviers')).toBe(true);
        // connexité : tout est atteignable (herse ouverte) ; sans la herse, tout sauf la salle qu'elle ferme
        expect(reach(F, () => true).size).toBe(F.rooms.length);
        const gateLink = F.gate ? F.links.find((k) => Math.abs(k.x - F.gate!.x) < 0.01 && Math.abs(k.z - F.gate!.z) < 0.01) : undefined;
        if (F.gate) {
          gates++;
          expect(gateLink).toBeDefined();
          const free = reach(F, (k) => k !== gateLink);
          expect(free.size).toBe(F.rooms.length - 1);
          expect(F.levers.length).toBeGreaterThanOrEqual(2);
          for (const v of F.levers) { const r = roomOf(F, v.x, v.z); expect(r).toBeDefined(); expect(free.has(r!.id)).toBe(true); }
          if (F.down) expect(free.has(roomOf(F, F.down.x, F.down.z)!.id)).toBe(true);
        }
        // créatures connues, plus fortes qu'au niveau 1 ; gardien nommé au plus un
        for (const s of F.spawns) expect(MONSTERS[s.type], s.type).toBeDefined();
        const el = F.spawns.filter((s) => s.elite);
        expect(el.length).toBeLessThanOrEqual(1);
        if (el.length) { guardians++; expect(F.guardian).toContain(el[0].elite!.name); expect(el[0].bonus).toBe(2); }
        // personne n'apparaît dans la cage de l'escalier, ni dans un mur
        for (const s of F.spawns) {
          expect(roomOf(F, s.x, s.z), `${d.id}.${l} ${s.type}`).toBeDefined();
          if (F.down) expect(Math.abs(s.x - F.down.x) < 1.5 && Math.abs(s.z - F.down.z) < 1.9).toBe(false);
        }
        for (const c of F.chests) expect(roomOf(F, c.x, c.z)).toBeDefined();
        expect(F.chests.some((c) => c.tier >= 3)).toBe(true);
        const b = buildFloor(F);
        expect(b.mesh.indexCount).toBeGreaterThan(100);
        expect(b.data.props.filter((p) => p.kind === 'escalier').length).toBe(F.down ? 2 : 1);
      }
    }
    expect(gates + guardians).toBeGreaterThan(0);
  });

  it('l’escalier du niveau 1 est un ajout : dans une salle libre (sans la clé), à l’écart des coffres, sorties et passages', () => {
    for (const d of civ.dungeons) {
      const L = generateDungeon(seed, d), ds = levelOneDescent(L);
      expect(ds, d.name).not.toBeNull();
      const r = L.rooms[ds!.room];
      expect(r.role).not.toBe('boss');
      // emprise (cage + place devant) dans la salle, quelle que soit l'orientation
      const fr = frameOf(ds!.x, ds!.z, ds!.yaw);
      for (const [lx, lz] of [[-1.5, -3.2], [1.5, -3.2], [-1.5, 1.9], [1.5, 1.9]]) {
        expect(Math.abs(fr.wx(lx, lz) - r.x)).toBeLessThanOrEqual(r.w / 2 + 1e-6);
        expect(Math.abs(fr.wz(lx, lz) - r.z)).toBeLessThanOrEqual(r.d / 2 + 1e-6);
      }
      for (const c of L.chests) expect(Math.hypot(c.x - ds!.x, c.z - ds!.z)).toBeGreaterThan(1.5);
      // atteignable sans la clé
      const free = reach(L, (l) => !(l as { locked?: boolean }).locked);
      expect(free.has(r.id)).toBe(true);
      const b = buildDescent(L, ds!);
      expect(b.data.props.length).toBe(1);
      const pr = b.data.props[0];
      expect([pr.key, pr.kind, pr.dungeonId]).toEqual([`dj${d.id}:descendre`, 'escalier', d.id]);
      expect(Math.hypot(pr.x - fr.wx(0, -2.5), pr.z - fr.wz(0, -2.5))).toBeLessThan(1e-6);
      expect(worldOf(ds!.x, ds!.z)).toBe(d.id);
    }
  });
});

describe('grottes : entrées à la surface', () => {
  const world = worldOf1(), civ = world.civ;
  const t0 = performance.now(), atlas = world.caves, ms = performance.now() - t0;

  it('choix rapide et déterministe, densité modérée, surtout en montagne ; réseaux de 1 à 3 entrées éloignées', () => {
    expect(ms).toBeLessThan(150);
    const again = new CaveAtlas(civ, world.sampler, world.seed);
    expect(JSON.stringify(again.nets)).toBe(JSON.stringify(atlas.nets));
    expect(atlas.entrances.length).toBeGreaterThanOrEqual(8);
    expect(atlas.entrances.length).toBeLessThanOrEqual(60);
    const mount = atlas.entrances.filter((e) => e.biome === 8 || e.biome === 9).length;
    expect(mount / atlas.entrances.length).toBeGreaterThan(0.6);
    expect(atlas.nets.some((n) => n.entrances.length >= 2)).toBe(true);
    for (const n of atlas.nets) {
      expect(n.entrances.length).toBeGreaterThanOrEqual(1); expect(n.entrances.length).toBeLessThanOrEqual(3);
      for (const a of n.entrances) for (const b of n.entrances) if (a !== b) expect(Math.hypot(a.ax - b.ax, a.az - b.az)).toBeGreaterThanOrEqual(300);
      n.entrances.forEach((e, k) => { expect(e.key).toBe(`gr${n.id}:e${k}`); expect(e.net).toBe(n.id); });
    }
    expect(new Set(atlas.nets.map((n) => n.name)).size).toBe(atlas.nets.length);
  });

  it('loin des villages, routes, lieux et eaux ; écartées les unes des autres', () => {
    const m = civ.macro;
    for (const e of atlas.entrances) {
      for (const s of civ.settlements) expect(Math.hypot(s.x - e.ax, s.z - e.az)).toBeGreaterThan(s.radius * 1.6 + 79);
      for (const q of civ.pois) expect(Math.hypot(q.x - e.ax, q.z - e.az)).toBeGreaterThan(79);
      const r = civ.roadIndex.nearest(e.ax, e.az);
      expect(!r || r.d >= 30).toBe(true);
      expect(m.hydro.water[m.cellOf(e.ax, e.az)]).toBe(W_NONE);
      for (const o of atlas.entrances) if (o !== e) expect(Math.hypot(o.ax - e.ax, o.az - e.az)).toBeGreaterThanOrEqual(350);
    }
  });

  it('une entrée est un ajout : relief, eau, végétation et objets d’origine du chunk inchangés ; ni arbre ni rocher sous l’arche', () => {
    const civEx = world.civWorld.extras(world.sampler);
    for (const e of atlas.entrances) {
      const cx = Math.floor(e.ax / CHUNK), cz = Math.floor(e.az / CHUNK);
      const base = buildChunk(world.sampler, cx, cz, civEx), full = buildChunk(world.sampler, cx, cz, world.chunks.extras);
      expect(Array.from(full.heights)).toEqual(Array.from(base.heights));
      expect(Array.from(full.water)).toEqual(Array.from(base.water));
      expect(JSON.stringify(full.nodes)).toBe(JSON.stringify(base.nodes));
      expect(full.veg).toEqual(base.veg);
      expect(JSON.stringify(full.props.slice(0, base.props.length))).toBe(JSON.stringify(base.props));
      expect(JSON.stringify(full.circles.slice(0, base.circles.length))).toBe(JSON.stringify(base.circles));
      expect(JSON.stringify(full.segs)).toBe(JSON.stringify(base.segs));
      const bv = new Uint8Array(base.mesh!.vertices), fv = new Uint8Array(full.mesh!.vertices, 0, bv.length);
      expect(Buffer.compare(Buffer.from(bv), Buffer.from(fv))).toBe(0);
      expect(Array.from(full.mesh!.indices.subarray(0, base.mesh!.indexCount))).toEqual(Array.from(base.mesh!.indices));
      const prop = full.props.slice(base.props.length).find((p) => p.key === e.key);
      expect(prop?.kind).toBe('grotte');
      const mo = atlas.mouth(e)!;
      expect(Math.hypot(mo.x - e.ax, mo.z - e.az)).toBeLessThanOrEqual(10.01);
      // ni arbre, ni buisson, ni rocher d'origine sous le massif, les rochers de l'arche ou devant l'ouverture
      const fr = frameOf(mo.x, mo.z, mo.yaw);
      for (let i = 0; i < full.veg.length; i += 3) {
        const vx = full.veg[i], vz = full.veg[i + 1], vr = full.veg[i + 2];
        expect(Math.hypot(vx - fr.wx(0, -0.8), vz - fr.wz(0, -0.8)), `${e.key} : massif`).toBeGreaterThanOrEqual(vr + 4.6);
        expect(Math.hypot(vx - fr.wx(0, -2.5), vz - fr.wz(0, -2.5)), `${e.key} : massif`).toBeGreaterThanOrEqual(vr + 5.2);
        expect(Math.hypot(vx - fr.wx(0, 5.2), vz - fr.wz(0, 5.2)), `${e.key} : devant`).toBeGreaterThanOrEqual(vr + 2.2);
        for (const k of [-1, 1]) expect(Math.hypot(vx - fr.wx(k * 3.6, 2.2), vz - fr.wz(k * 3.6, 2.2)), `${e.key} : rochers`).toBeGreaterThanOrEqual(vr + 2);
      }
    }
  });

  it('classement des mondes : surface, niveau 1, étages et grottes distincts ; l’ancien classement inchangé', () => {
    expect([worldOf(100), worldOf(19899.9), worldOf(20000), worldOf(20000 + 220 * 3 + 80)]).toEqual([-1, -1, 0, 3]);
    expect(worldOf(20000 + 440 + 30, 1060)).toBe(2);
    expect(worldOf(20000 + 440 + 30, 1460)).toBe(1002);
    expect(worldOf(20000 + 440 + 30, 1860)).toBe(2002);
    expect(worldOf(20000 + 400 * 3 + 50, 6000 + 400 + 70)).toBe(100000 + 24 + 3);
    expect(worldOf(500, 7000)).toBe(-1);
    expect(DUNGEON_ORIGIN_X).toBe(20000);
  });
});

describe('grottes : intérieur', () => {
  const world = worldOf1(), atlas = world.caves;
  const caves: CaveLayout[] = atlas.nets.map((n) => generateCave(world.seed, n, 1 + (n.id % 7)));

  it('déterministe ; une issue par entrée ; clés « gr<id>: » ; dans sa case de 400 m', () => {
    for (const C of caves.slice(0, 5)) {
      const N = atlas.nets[C.id];
      expect(JSON.stringify(generateCave(world.seed, N, 1 + (N.id % 7)))).toBe(JSON.stringify(C));
      expect(C.exits.length).toBe(N.entrances.length);
      const keys = [...C.exits.map((x) => x.key), ...C.chests.map((c) => c.key), ...C.veins.map((v) => v.id), ...C.patches.map((p) => p.key)];
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) expect(k.startsWith(`gr${C.id}:`)).toBe(true);
      for (const x of C.exits) expect(worldOf(x.arrive.x, x.arrive.z)).toBe(100000 + C.id);
    }
  });

  it('connexité : toute la grotte se parcourt depuis la première issue (issues, salles, coffre, créatures, champignons, filons)', () => {
    for (const C of caves) {
      const { W, H, cells } = C, at = (x: number, z: number) => Math.floor((z - C.oz) / 2) * W + Math.floor((x - C.ox) / 2);
      const seen = new Uint8Array(W * H), q = [at(C.exits[0].x, C.exits[0].z)];
      seen[q[0]] = 1;
      for (let h = 0; h < q.length; h++) {
        const c = q[h], i = c % W, j = (c / W) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (j + dj) * W + i + di; if (i + di >= 0 && i + di < W && j + dj >= 0 && j + dj < H && !seen[k] && cells[k] === OPEN) { seen[k] = 1; q.push(k); } }
      }
      for (let k = 0; k < W * H; k++) if (cells[k] === OPEN) expect(seen[k], `grotte ${C.id} case ${k}`).toBe(1);
      for (const x of C.exits) { expect(seen[at(x.x, x.z)]).toBe(1); expect(seen[at(x.arrive.x, x.arrive.z)]).toBe(1); }
      for (const r of C.chambers) {
        if (!r.lake) { expect(seen[at(r.x, r.z)], `salle de ${C.id}`).toBe(1); continue; }
        // salle du lac : on en atteint la rive
        let rim = false;
        for (let dz = -r.r - 4; dz <= r.r + 4 && !rim; dz += 2) for (let dx = -r.r - 4; dx <= r.r + 4 && !rim; dx += 2) { const k = at(r.x + dx, r.z + dz); if (k >= 0 && k < W * H && seen[k]) rim = true; }
        expect(rim).toBe(true);
      }
      for (const s of C.spawns) expect(seen[at(s.x, s.z)], `${s.type} de ${C.id}`).toBe(1);
      for (const c of C.chests) expect(seen[at(c.x, c.z)]).toBe(1);
      for (const p of C.patches) expect(seen[at(p.x, p.z)]).toBe(1);
      for (const v of C.veins) {
        // filon : sur une paroi (un pas de la case de sol, côté roche)
        expect(v.ore).toBeDefined();
        const k = at(v.x, v.z);
        expect(cells[k] === ROCK || seen[k] === 1).toBe(true);
      }
      // les stalagmites ne bouchent aucun passage : toujours au large (au moins 6 m de roche autour)
      for (const m of C.mites) expect(C.dist[at(m.x, m.z)]).toBeGreaterThanOrEqual(3);
      for (const s of C.spawns) expect(MONSTERS[s.type]).toBeDefined();
    }
  });

  it('géométrie : roche brute, collisions des parois et des stalagmites, lumières, issues, filons (refaits sans ceux épuisés)', () => {
    const C = caves.find((c) => c.exits.length >= 2) ?? caves[0];
    const b = buildCave(C);
    expect(b.mesh.vertexCount).toBeGreaterThan(5000);
    expect(b.data.segs.length).toBeGreaterThan(50);
    expect(b.data.circles.length).toBe(C.mites.length);
    expect(b.data.lights.length).toBeGreaterThanOrEqual(C.glows.length + C.exits.length);
    expect(b.data.props.filter((p) => p.kind === 'issue').length).toBe(C.exits.length);
    expect(b.data.props.filter((p) => p.kind === 'champignons').length).toBe(C.patches.length);
    expect(b.data.platforms.length).toBe(1);
    const all = buildVeins(C, () => false), some = buildVeins(C, (id) => id === C.veins[0].id);
    expect(some.vertexCount).toBeLessThan(all.vertexCount);
  });
});
