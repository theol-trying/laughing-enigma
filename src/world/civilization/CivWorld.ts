import { MACRO, CELL, CHUNK, CHUNKS, WORLD } from '../constants';
import { lerp, smoothstep } from '../../core/math';
import type { TerrainFeature, Sample, TerrainSampler } from '../terrain/TerrainSampler';
import type { ChunkExtras, ChunkData } from '../Chunk';
import { MeshBuilder } from '../../rendering/Mesh';
import { M } from '../../rendering/Materials';
import type { Civilization } from './Civilization';
import type { Settlement, Bridge } from './types';
import { generateLayouts, type Layout, type Building, type WallSeg, type Tower, type Decor } from './Layout';
import { buildBuilding, buildWall, buildTower, buildDecor, buildBridge } from './Builders';

// Pont entre la civilisation (données) et le monde physique : terrain, chunks, horizon.

type Item =
  | { t: 'b'; b: Building } | { t: 'w'; w: WallSeg } | { t: 't'; tw: Tower }
  | { t: 'd'; d: Decor } | { t: 'br'; br: Bridge; stone: boolean };

const N = MACRO;
const COBBLE = new Set(['bourg', 'ville', 'capitale', 'fort', 'château']);

export class CivWorld {
  readonly layouts: Layout[];
  private items = new Map<number, Item[]>();
  private setBuckets = new Map<number, Settlement[]>();
  private layoutBuckets = new Map<number, Layout[]>();

  constructor(readonly civ: Civilization) {
    this.layouts = generateLayouts(civ);
    const put = <T>(map: Map<number, T[]>, key: number, v: T) => { let l = map.get(key); if (!l) map.set(key, (l = [])); l.push(v); };
    const chunkKey = (x: number, z: number) => Math.floor(z / CHUNK) * CHUNKS + Math.floor(x / CHUNK);
    for (const L of this.layouts) {
      for (const b of L.buildings) put(this.items, chunkKey(b.x, b.z), { t: 'b', b });
      for (const w of L.walls) put(this.items, chunkKey((w.ax + w.bx) / 2, (w.az + w.bz) / 2), { t: 'w', w });
      for (const tw of L.towers) put(this.items, chunkKey(tw.x, tw.z), { t: 't', tw });
      for (const d of L.decor) put(this.items, chunkKey(d.x, d.z), { t: 'd', d });
      const R = L.radius + 60;
      for (let j = Math.floor((L.z - R) / CELL); j <= Math.floor((L.z + R) / CELL); j++)
        for (let i = Math.floor((L.x - R) / CELL); i <= Math.floor((L.x + R) / CELL); i++)
          if (i >= 0 && j >= 0 && i < N && j < N) put(this.layoutBuckets, j * N + i, L);
    }
    for (const r of civ.roads) {
      const stone = r.kind === 2;
      for (const br of r.bridges) put(this.items, chunkKey(br.x, br.z), { t: 'br', br, stone });
    }
    for (const s of civ.settlements) {
      const R = s.radius + 32;
      for (let j = Math.floor((s.z - R) / CELL); j <= Math.floor((s.z + R) / CELL); j++)
        for (let i = Math.floor((s.x - R) / CELL); i <= Math.floor((s.x + R) / CELL); i++)
          if (i >= 0 && j >= 0 && i < N && j < N) put(this.setBuckets, j * N + i, s);
    }
  }

  /** Modification du relief : places, routes, champs, emprises bâties. */
  feature(): TerrainFeature {
    const civ = this.civ;
    return {
      minX: 0, minZ: 0, maxX: WORLD, maxZ: WORLD,
      apply: (x: number, z: number, s: Sample) => {
        const cell = Math.min(N - 1, Math.max(0, Math.floor(z / CELL))) * N + Math.min(N - 1, Math.max(0, Math.floor(x / CELL)));
        const wet = () => !Number.isNaN(s.water) && s.h < s.water + 0.3;
        let plateau = 0, town = false;
        for (const st of this.setBuckets.get(cell) ?? []) {
          const d = Math.hypot(x - st.x, z - st.z), R = st.radius + 30;
          if (d >= R) continue;
          const w = 1 - smoothstep(st.radius * 0.7, R, d);
          if (!wet()) s.h = lerp(s.h, st.y + 0.3, w * 0.9);
          plateau = Math.max(plateau, w);
          if (d < st.radius * 0.9 && st.type !== 'ruines') s.occupied = true;
          if (d < st.radius + 10 && COBBLE.has(st.type)) town = true;
        }
        const r = civ.roadIndex.nearest(x, z);
        if (r && r.d < 5 && !wet()) {
          const w = 1 - smoothstep(-1, 5, r.d);
          s.h = lerp(s.h, lerp(r.y, s.h, plateau), w * 0.85);
          if (r.d < 0) { s.road = town ? 3 : r.road.kind; s.occupied = true; }
          else if (r.d < 2) s.occupied = true;
        }
        for (const L of this.layoutBuckets.get(cell) ?? []) {
          if (L.plaza) {
            const d = Math.hypot(x - L.plaza.x, z - L.plaza.z);
            if (d < L.plaza.r) { s.road = L.plaza.cobble ? 3 : 1; s.occupied = true; }
          }
          for (const f of L.fields) {
            const c = Math.cos(f.yaw), sn = Math.sin(f.yaw), dx = x - f.x, dz = z - f.z;
            if (Math.abs(dx * c - dz * sn) < f.w / 2 && Math.abs(dx * sn + dz * c) < f.d / 2 && !s.road) { s.field = f.crop; s.occupied = true; }
          }
          for (const b of L.buildings) if (Math.hypot(x - b.x, z - b.z) < Math.hypot(b.w, b.d) / 2 + 2) s.occupied = true;
          for (const d of L.decor) if (Math.abs(x - d.x) < 3 && Math.abs(z - d.z) < 3) s.occupied = true;
          if (L.sid < 0 && Math.hypot(x - L.x, z - L.z) < 9) s.occupied = true;
        }
      },
    };
  }

  /** Constructions injectées dans le maillage des chunks. */
  extras(sampler: TerrainSampler): ChunkExtras {
    return {
      build: (cx: number, cz: number, mb: MeshBuilder, ch: ChunkData) => {
        for (const it of this.items.get(cz * CHUNKS + cx) ?? []) {
          if (it.t === 'b') buildBuilding(mb, sampler, ch, it.b);
          else if (it.t === 'w') buildWall(mb, sampler, ch, it.w);
          else if (it.t === 't') buildTower(mb, sampler, ch, it.tw);
          else if (it.t === 'd') buildDecor(mb, sampler, ch, it.d);
          else buildBridge(mb, sampler, ch, it.br, it.stone);
        }
      },
    };
  }

  /** Silhouettes lointaines (villages, châteaux, tours) dans le terrain lointain. */
  landmarks(mb: MeshBuilder): void {
    const m = this.civ.macro;
    for (const L of this.layouts) {
      for (const b of L.buildings) {
        const y = m.elevAt(b.x, b.z) + 0.5;
        const H = b.ruined ? b.wallH * 0.5 : b.wallH;
        mb.box(b.x, y - 2, b.z, b.w, H + 2, b.d, b.yaw, b.stone ? 0x9a9284 : 0xc8b48a, b.stone ? M.STONE : M.WOOD);
        if (!b.ruined) mb.gable(b.x, y + H, b.z, b.w + 0.8, b.d + 0.8, b.roofH, b.yaw, b.stone ? 0x8a3a2a : 0xb09a5a, b.stone ? M.ROOF : M.THATCH);
      }
      for (const w of L.walls) {
        const x = (w.ax + w.bx) / 2, z = (w.az + w.bz) / 2;
        mb.box(x, m.elevAt(x, z) - 2, z, w.stone ? 1.6 : 0.5, w.h + 2, Math.hypot(w.bx - w.ax, w.bz - w.az), Math.atan2(w.bx - w.ax, w.bz - w.az), w.stone ? 0x8a8478 : 0x6a5034, w.stone ? M.STONE : M.WOOD);
      }
      for (const t of L.towers) {
        const y = m.elevAt(t.x, t.z);
        mb.cylinder(t.x, y - 2, t.z, t.r, t.h + 2, 6, 0x8e887c, M.STONE);
        if (t.stone) mb.cone(t.x, y + t.h, t.z, t.r * 1.05, t.r * 1.6, 6, 0x4a5262, M.ROOF);
      }
      for (const d of L.decor) if (d.kind === 'tour de guet') mb.box(d.x, m.elevAt(d.x, d.z) - 2, d.z, 5, 15, 5, d.yaw, 0x8a8478, M.STONE);
    }
  }

  /** Point de départ : devant l'auberge du village de départ, tourné vers la place. */
  spawn(sampler: TerrainSampler): { x: number; z: number; heading: number } {
    const st = this.civ.start;
    const L = this.layouts.find((l) => l.sid === st.id)!;
    const inn = L.buildings.find((b) => b.kind === 'auberge') ?? L.buildings[0];
    if (!inn) return { x: st.x, z: st.z, heading: 0 };
    const c = Math.cos(inn.yaw), s = Math.sin(inn.yaw), lz = inn.d / 2 + 3.5;
    const x = inn.x + inn.doorX * c + lz * s, z = inn.z - inn.doorX * s + lz * c;
    void sampler;
    // regarder vers la place (forward = (sin h, −cos h))
    return { x, z, heading: Math.atan2(st.x - x, -(st.z - z)) };
  }
}
