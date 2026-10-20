import type { WorldSeed } from '@ascii-fort/core/Seed';
import type { MeshBuilder } from '@ascii-fort/ascii-engine/Mesh';
import { M } from '@ascii-fort/ascii-engine/Materials';
import type { ChunkData } from '../Chunk';
import type { Civilization } from '../civilization/Civilization';
import type { TerrainSampler } from '../terrain/TerrainSampler';
import { MACRO, CELL, CHUNK, CHUNKS } from '../constants';
import { B } from '../terrain/Biomes';
import { W_NONE } from '../terrain/Hydrology';
import { de } from '../civilization/Names';
import { frameOf } from '../dungeons/Under';

// Étape 55 (passe 2) : réseaux de grottes. Les entrées sont des AJOUTS au monde de surface : un décor (arche de roche, ouverture
// sombre) et un objet interactif posés sur un flanc de colline ou de montagne, loin des bâtiments, routes, eaux et lieux. Le relief
// et la végétation ne changent pas : la bouche exacte se cale, au chargement de son chunk, à l'écart de la végétation d'origine
// (enregistrée par buildChunk, abattue ou non : la place ne bouge jamais). Choix sur toute la carte une fois (flux « grottes »).

export interface CaveEntrance {
  /** réseau, rang de l'entrée dans le réseau, clé de l'objet (« gr<réseau>:e<rang> ») */
  net: number; k: number; key: string;
  /** ancre (flanc choisi à la génération) et orientation de l'ouverture (repère local : +z vers l'extérieur) */
  ax: number; az: number; yaw: number; biome: number;
}
export interface CaveNet { id: number; name: string; entrances: CaveEntrance[]; x: number; z: number }
/** Bouche d'une entrée, calée au chargement de son chunk : centre du massif, objet [E], point de sortie et regard vers l'extérieur. */
export interface CaveMouth { x: number; z: number; yaw: number; px: number; pz: number; ox: number; oz: number; heading: number }

const TILE = 16;            // cases macro par tuile (512 m)
const MIN_GAP = 350;        // écart minimal entre deux entrées
const EDGE = 19;            // l'ancre reste à 19 m au moins du bord de son chunk (la bouche se cale à 10 m près, son emprise dans le chunk)

/** Flanc praticable : ça monte derrière (le massif), on se tient devant (pente douce, au sec). */
function flank(sampler: TerrainSampler, x: number, z: number): { yaw: number } | null {
  const h = (a: number, b: number) => sampler.height(a, b);
  const gx = (h(x + 3, z) - h(x - 3, z)) / 6, gz = (h(x, z + 3) - h(x, z - 3)) / 6, g = Math.hypot(gx, gz);
  if (g < 0.22 || g > 1.1) return null;
  const ux = gx / g, uz = gz / g;
  const fx = x - ux * 6, fz = z - uz * 6, bx = x + ux * 4, bz = z + uz * 4;
  if (h(bx, bz) - h(fx, fz) < 3) return null;
  const fg = Math.hypot(h(fx + 1.5, fz) - h(fx - 1.5, fz), h(fx, fz + 1.5) - h(fx, fz - 1.5)) / 3;
  if (fg > 0.5) return null;
  for (const [px, pz] of [[x, z], [fx, fz], [x - ux * 3, z - uz * 3]]) {
    const s = sampler.sample(px, pz);
    if (!Number.isNaN(s.water) && s.water > s.h - 0.5) return null;
  }
  return { yaw: Math.atan2(-ux, -uz) };
}

/** Choix des entrées et regroupement en réseaux (2 ou 3 entrées éloignées pour certains). Déterministe, une fois par monde. */
export function placeCaves(civ: Civilization, sampler: TerrainSampler, seed: WorldSeed): CaveNet[] {
  const m = civ.macro, N = MACRO, T = N / TILE;
  const nearRoad = new Uint8Array(N * N);
  for (const r of civ.roads) for (const c of r.cells) {
    const i = c % N, j = (c / N) | 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < N && b < N) nearRoad[b * N + a] = 1; }
  }
  const found: { x: number; z: number; yaw: number; biome: number }[] = [];
  for (let tj = 0; tj < T; tj++) for (let ti = 0; ti < T; ti++) {
    const rng = seed.stream('grottes', 'tuile', tj * T + ti);
    let land = 0, mount = 0, hill = 0;
    const cands: number[] = [], high: number[] = [];
    for (let j = tj * TILE; j < (tj + 1) * TILE; j++) for (let i = ti * TILE; i < (ti + 1) * TILE; i++) {
      const c = j * N + i;
      if (m.hydro.water[c] !== W_NONE || m.elev[c] <= 4) continue;
      land++;
      const b = m.biome[c], s = m.slope[c];
      if (b === B.MOUNTAIN || b === B.SNOW) mount++;
      else if (s > 0.06 && (b === B.HEATH || m.elev[c] > 45)) hill++;
      // pas dans les bois denses (forêts, taïga, marais) : la bouche n'y trouverait pas de place sans arbre
      const dense = b === B.FOREST || b === B.TAIGA || b === B.SWAMP;
      if (s > 0.05 && !dense && !nearRoad[c] && i > 2 && j > 2 && i < N - 3 && j < N - 3) { cands.push(c); if (b === B.MOUNTAIN || b === B.SNOW) high.push(c); }
    }
    // rencontres régulières en montagne, rares ailleurs
    const p = land < 30 ? 0 : Math.min(0.85, 0.03 + 0.8 * Math.min(1, mount / 50) + 0.1 * Math.min(1, hill / 40));
    if (!cands.length || !rng.chance(p)) continue;
    for (let t = 0; t < 14; t++) {
      const from = high.length && t < 10 ? high : cands, c = from[rng.int(0, from.length - 1)], i = c % N, j = (c / N) | 0;
      // tirée dans la case macro, puis ramenée au cœur de son chunk
      const x0 = (i + rng.float(0.1, 0.9)) * CELL, z0 = (j + rng.float(0.1, 0.9)) * CELL;
      const bx = Math.floor(x0 / CHUNK) * CHUNK, bz = Math.floor(z0 / CHUNK) * CHUNK;
      const x = Math.max(bx + EDGE, Math.min(bx + CHUNK - EDGE, x0)), z = Math.max(bz + EDGE, Math.min(bz + CHUNK - EDGE, z0));
      if (found.some((e) => Math.hypot(e.x - x, e.z - z) < MIN_GAP)) continue;
      if (civ.settlements.some((s) => Math.hypot(s.x - x, s.z - z) < s.radius * 1.6 + 80)) continue;
      if (civ.pois.some((q) => Math.hypot(q.x - x, q.z - z) < 80)) continue;
      const r = civ.roadIndex.nearest(x, z);
      if (r && r.d < 30) continue;
      const f = flank(sampler, x, z);
      if (!f) continue;
      found.push({ x, z, yaw: f.yaw, biome: m.biome[c] });
      break;
    }
  }
  // réseaux : une entrée en entraîne parfois une ou deux autres, éloignées (300 à 1100 m)
  const used = new Array(found.length).fill(-1), nets: CaveNet[] = [], names = new Set<string>();
  const towns = civ.settlements.filter((s) => s.type !== 'camp');
  for (let i = 0; i < found.length; i++) {
    if (used[i] >= 0) continue;
    const id = nets.length, rng = seed.stream('grottes', 'réseau', i), members = [i];
    used[i] = id;
    const want = rng.chance(0.45) ? (rng.chance(0.35) ? 3 : 2) : 1;
    while (members.length < want) {
      let best = -1, bd = Infinity;
      for (let j = 0; j < found.length; j++) {
        if (used[j] >= 0) continue;
        const d = Math.hypot(found[j].x - found[i].x, found[j].z - found[i].z);
        if (d >= 300 && d <= 1100 && d < bd && members.every((k) => Math.hypot(found[j].x - found[k].x, found[j].z - found[k].z) >= 300)) { bd = d; best = j; }
      }
      if (best < 0) break;
      used[best] = id; members.push(best);
    }
    const cx = members.reduce((a, k) => a + found[k].x, 0) / members.length, cz = members.reduce((a, k) => a + found[k].z, 0) / members.length;
    const town = towns.length ? towns.reduce((a, b) => (Math.hypot(a.x - cx, a.z - cz) < Math.hypot(b.x - cx, b.z - cz) ? a : b)) : null;
    const fancy = ['des Échos', 'aux Cristaux', 'du Vent froid', 'des Murmures', 'de la Dame blanche', 'aux Chauves-souris', 'des Larmes', 'du Loup gris', 'de la Source noire', 'des Ossements'];
    const kindName = members.length > 1 ? rng.pick(['Cavernes', 'Galeries', 'Grottes']) : rng.pick(['Grotte', 'Grotte', 'Gouffre', 'Caverne']);
    const tries = [`${kindName} ${rng.pick(fancy)}`, town ? `${kindName} ${de(town.name)}` : '', `${kindName} ${rng.pick(fancy)}`];
    let name = tries.find((t) => t && !names.has(t)) ?? '';
    for (let n = 2; !name; n++) if (!names.has(`${tries[0]} (${n})`)) name = `${tries[0]} (${n})`;
    names.add(name);
    nets.push({ id, name, x: cx, z: cz, entrances: members.map((k, r) => ({ net: id, k: r, key: `gr${id}:e${r}`, ax: found[k].x, az: found[k].z, yaw: found[k].yaw, biome: found[k].biome })) });
  }
  return nets;
}

/** Atlas des grottes d'un monde : réseaux, entrées par chunk, bouches calées au chargement. */
export class CaveAtlas {
  readonly nets: CaveNet[];
  readonly entrances: CaveEntrance[];
  private byChunk = new Map<number, CaveEntrance[]>();
  private mouths = new Map<string, CaveMouth>();

  constructor(civ: Civilization, private sampler: TerrainSampler, seed: WorldSeed) {
    this.nets = placeCaves(civ, sampler, seed);
    this.entrances = this.nets.flatMap((n) => n.entrances);
    for (const e of this.entrances) {
      const k = Math.floor(e.az / CHUNK) * CHUNKS + Math.floor(e.ax / CHUNK);
      let l = this.byChunk.get(k);
      if (!l) this.byChunk.set(k, (l = []));
      l.push(e);
    }
  }

  entrance(key: string): CaveEntrance | undefined { return this.entrances.find((e) => e.key === key); }
  /** Bouche calée d'une entrée (null tant que son chunk n'a jamais été construit). */
  mouth(e: CaveEntrance): CaveMouth | null { return this.mouths.get(e.key) ?? null; }

  /** Ajouts d'un chunk (appelé après la végétation et la civilisation : rien de ce qui existe ne bouge). */
  build(cx: number, cz: number, mb: MeshBuilder, ch: ChunkData): void {
    for (const e of this.byChunk.get(cz * CHUNKS + cx) ?? []) {
      let mo = this.mouths.get(e.key);
      if (!mo) { mo = this.fit(e, ch); this.mouths.set(e.key, mo); }
      this.buildMouth(mb, ch, e, mo);
    }
  }

  /**
   * Cale la bouche à 10 m au plus de l'ancre : la première place (en spirale) encore sur le flanc et sans végétation d'origine sous le
   * massif, les rochers ou devant l'ouverture ; à défaut, celle qui en touche le moins.
   */
  private fit(e: CaveEntrance, ch: ChunkData): CaveMouth {
    const offs: [number, number][] = [[0, 0]];
    for (let r = 1.5; r <= 10; r += 1.5) { const n = Math.round(r * 2.5); for (let a = 0; a < n; a++) offs.push([Math.cos((a / n) * Math.PI * 2) * r, Math.sin((a / n) * Math.PI * 2) * r]); }
    const h = (x: number, z: number) => (x >= ch.x0 && z >= ch.z0 && x < ch.x0 + CHUNK && z < ch.z0 + CHUNK ? ch.heightAt(x, z) : this.sampler.height(x, z));
    let best = { dx: 0, dz: 0, yaw: e.yaw }, bn = Infinity;
    // d'abord sur le flanc et face à la pente (ça monte derrière, on se tient devant sans glisser), puis un peu de biais,
    // puis n'importe où à portée
    for (let pass = 0; pass < 3 && bn > 0; pass++) for (const yaw of pass === 1 ? [e.yaw - 0.5, e.yaw + 0.5] : [e.yaw]) for (const [dx, dz] of offs) {
      const x = e.ax + dx, z = e.az + dz, f = frameOf(x, z, yaw);
      if (pass < 2 && (dx || dz || yaw !== e.yaw)) {
        const front = h(f.wx(0, 6), f.wz(0, 6)), back = h(f.wx(0, -4), f.wz(0, -4)), fr = h(f.wx(0, 4.5), f.wz(0, 4.5));
        if (back - front < 2 || Math.abs(fr - front) > 1.4) continue;
      }
      let n = 0;
      for (let i = 0; i < ch.veg.length; i += 3) {
        const vx = ch.veg[i], vz = ch.veg[i + 1], vr = ch.veg[i + 2];
        if (Math.hypot(vx - f.wx(0, -0.8), vz - f.wz(0, -0.8)) < vr + 4.6 || Math.hypot(vx - f.wx(0, -2.5), vz - f.wz(0, -2.5)) < vr + 5.2) n++;
        else if (Math.hypot(vx - f.wx(0, 5.2), vz - f.wz(0, 5.2)) < vr + 2.2) n++;
        else if (Math.hypot(vx - f.wx(-3.6, 2.2), vz - f.wz(-3.6, 2.2)) < vr + 2 || Math.hypot(vx - f.wx(3.6, 2.2), vz - f.wz(3.6, 2.2)) < vr + 2) n++;
      }
      if (n < bn) { bn = n; best = { dx, dz, yaw }; }
      if (n === 0) break;
    }
    const x = e.ax + best.dx, z = e.az + best.dz, yaw = best.yaw, f = frameOf(x, z, yaw);
    const ox = f.wx(0, 6.6), oz = f.wz(0, 6.6);
    return { x, z, yaw, px: f.wx(0, 4.5), pz: f.wz(0, 4.5), ox, oz, heading: Math.atan2(Math.sin(yaw), -Math.cos(yaw)) };
  }

  private buildMouth(mb: MeshBuilder, ch: ChunkData, e: CaveEntrance, mo: CaveMouth): void {
    const f = frameOf(mo.x, mo.z, mo.yaw);
    const inside = (x: number, z: number) => x >= ch.x0 && z >= ch.z0 && x < ch.x0 + CHUNK && z < ch.z0 + CHUNK;
    const h = (lx: number, lz: number) => { const x = f.wx(lx, lz), z = f.wz(lx, lz); return inside(x, z) ? ch.heightAt(x, z) : this.sampler.height(x, z); };
    const snow = e.biome === B.SNOW, rock = snow ? 0x8e8e94 : 0x6a6458, dark = 0x030302;
    const gm = h(0, 3.4), g0 = h(0, -0.8);
    // massif (dans le flanc), rochers de part et d'autre, arche (piliers, linteau), ouverture noire
    // (ellipsoïde rond en plan : il ne tourne pas avec l'entrée ; son bord avant reste juste derrière l'ouverture)
    mb.blob(f.wx(0, -2.5), g0 - 1.6, f.wz(0, -2.5), 5, 5.4 + Math.max(0, gm - g0) * 0.3, 5, rock, M.ROCK, 8, 4);
    for (const k of [-1, 1]) mb.blob(f.wx(k * 3.6, 2.2), h(k * 3.6, 2.2) - 0.6, f.wz(k * 3.6, 2.2), 2.2, 2.6, 2.2, rock, M.ROCK, 6, 3);
    for (const k of [-1, 1]) {
      const gp = h(k * 1.6, 3.0);
      mb.box(f.wx(k * 1.6, 3.0), gp - 0.6, f.wz(k * 1.6, 3.0), 1.0, gm + 3.1 - gp + 0.6, 1.0, mo.yaw, rock, M.ROCK);
    }
    mb.box(f.wx(0, 3.0), gm + 2.6, f.wz(0, 3.0), 4.4, 0.9, 1.2, mo.yaw, rock, M.ROCK);
    mb.box(f.wx(0, 2.75), gm - 0.4, f.wz(0, 2.75), 2.3, 3.0, 0.25, mo.yaw, dark, M.DIRT);
    mb.box(f.wx(0, 3.3), gm - 0.05, f.wz(0, 3.3), 2.2, 0.08, 1.2, mo.yaw, 0x0c0a08, M.DIRT);
    for (let i = 0; i < 3; i++) { const lx = (i - 1) * 2.2, lz = 4.6 + (i % 2) * 0.8; mb.blob(f.wx(lx, lz), h(lx, lz) - 0.1, f.wz(lx, lz), 0.35, 0.22, 0.3, 0x5e5a52, M.RUBBLE, 4, 2); }
    // collisions : le massif (l'ouverture est au bord), piliers, rochers
    const g = gm;
    ch.circles.push({ x: f.wx(0, -0.8), z: f.wz(0, -0.8), r: 4.4, bottom: g - 3, top: g + 4 }, { x: f.wx(0, -3), z: f.wz(0, -3), r: 4.6, bottom: g - 3, top: g + 5 });
    for (const k of [-1, 1]) {
      ch.circles.push({ x: f.wx(k * 1.6, 3.0), z: f.wz(k * 1.6, 3.0), r: 0.6, bottom: g - 2, top: g + 3.5 });
      ch.circles.push({ x: f.wx(k * 3.6, 2.2), z: f.wz(k * 3.6, 2.2), r: 1.9, bottom: g - 2, top: g + 2.5 });
    }
    ch.props.push({ key: e.key, kind: 'grotte', x: mo.px, y: h(0, 4.5), z: mo.pz, sid: -1, bid: -1, dungeonId: -1 });
  }
}

/** Ancre ou bouche calée d'une entrée, pour la carte et les distances. */
export function entrancePos(atlas: CaveAtlas, e: CaveEntrance): { x: number; z: number } {
  const m = atlas.mouth(e);
  return m ? { x: m.px, z: m.pz } : { x: e.ax, z: e.az };
}

