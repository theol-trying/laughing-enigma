import { MeshBuilder } from '../../rendering/Mesh';
import { M } from '../../rendering/Materials';
import type { TerrainSampler } from '../terrain/TerrainSampler';
import { shade } from '../terrain/TerrainSampler';
import type { ChunkData } from '../Chunk';
import type { Building, Decor, WallSeg, Tower, Furniture } from './Layout';
import type { Bridge } from './types';

// Géométrie des constructions (en boîtes, prismes, cylindres) + collisions, planchers,
// lumières et objets interactifs. Les intérieurs reçoivent peu de lumière du ciel.

const INSIDE = 0.28;

/** Repère local d'un objet orienté. */
function frame(x: number, z: number, yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return {
    c, s,
    wx: (lx: number, lz: number) => x + lx * c + lz * s,
    wz: (lx: number, lz: number) => z - lx * s + lz * c,
  };
}

export function buildingFloor(b: Building, sampler: TerrainSampler): number {
  if (!Number.isNaN(b.floorY)) return b.floorY;
  const f = frame(b.x, b.z, b.yaw);
  let hi = -Infinity;
  for (const [lx, lz] of [[0, 0], [-b.w / 2, -b.d / 2], [b.w / 2, -b.d / 2], [b.w / 2, b.d / 2], [-b.w / 2, b.d / 2], [0, b.d / 2 + 1]]) {
    hi = Math.max(hi, sampler.height(f.wx(lx, lz), f.wz(lx, lz)));
  }
  b.floorY = hi + 0.2;
  return b.floorY;
}

/** Mur en deux peaux : extérieure (plein air) et intérieure (sombre). */
function wallPiece(mb: MeshBuilder, ch: ChunkData, f: ReturnType<typeof frame>, yaw: number,
  lx0: number, lz0: number, lx1: number, lz1: number, y0: number, y1: number, t: number, outX: number, outZ: number,
  color: number, mat: number, collide = true) {
  const len = Math.hypot(lx1 - lx0, lz1 - lz0);
  if (len < 0.05) return;
  const mx = (lx0 + lx1) / 2, mz = (lz0 + lz1) / 2;
  const along = Math.abs(lx1 - lx0) > Math.abs(lz1 - lz0);
  const sx = along ? len : t / 2, sz = along ? t / 2 : len;
  mb.sky = 1;
  mb.box(f.wx(mx + outX * t / 4, mz + outZ * t / 4), y0, f.wz(mx + outX * t / 4, mz + outZ * t / 4), sx, y1 - y0, sz, yaw, color, mat);
  mb.sky = INSIDE;
  mb.box(f.wx(mx - outX * t / 4, mz - outZ * t / 4), y0, f.wz(mx - outX * t / 4, mz - outZ * t / 4), sx, y1 - y0, sz, yaw, shade(color, 0.85), mat);
  mb.sky = 1;
  if (collide) ch.segs.push({ ax: f.wx(lx0, lz0), az: f.wz(lx0, lz0), bx: f.wx(lx1, lz1), bz: f.wz(lx1, lz1), r: t / 2, bottom: y0 - 0.5, top: y1 });
}

export function buildBuilding(mb: MeshBuilder, sampler: TerrainSampler, ch: ChunkData, b: Building): void {
  const y = buildingFloor(b, sampler);
  const f = frame(b.x, b.z, b.yaw);
  const hw = b.w / 2, hd = b.d / 2, t = 0.32;
  const wallC = b.ruined ? 0x8a8478 : b.stone ? 0x9a9284 : 0xc8b48a;
  const wallM = b.stone || b.ruined ? M.STONE : M.WOOD;
  // fondation jusqu'au sol le plus bas
  let lo = Infinity;
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) lo = Math.min(lo, sampler.height(f.wx(lx, lz), f.wz(lx, lz)));
  mb.box(b.x, lo - 0.8, b.z, b.w + 0.2, y - lo + 0.8, b.d + 0.2, b.yaw, 0x6e675c, M.STONE);
  // plancher
  mb.sky = INSIDE;
  mb.box(b.x, y - 0.12, b.z, b.w - 0.1, 0.12, b.d - 0.1, b.yaw, 0x7a5a3a, M.PLANKS);
  mb.sky = 1;
  ch.platforms.push({ cx: b.x, cz: b.z, hw: hw + 0.1, hd: hd + 0.1, yaw: b.yaw, top: y });

  const H = b.ruined ? b.wallH * 0.55 : b.wallH;
  const dw = b.kind === 'forge' || b.kind === 'grange' ? 2.4 : 1.4, dh = 2.25;
  const d0 = b.doorX - dw / 2, d1 = b.doorX + dw / 2;
  const piece = (lx0: number, lz0: number, lx1: number, lz1: number, y0: number, y1: number, ox: number, oz: number, collide = true) =>
    wallPiece(mb, ch, f, b.yaw, lx0, lz0, lx1, lz1, y0, y1, t, ox, oz, wallC, wallM, collide);
  const ruinCut = (k: number) => (b.ruined ? H * (0.4 + ((k * 7919) % 10) / 16) : H);
  piece(-hw, -hd + t / 2, hw, -hd + t / 2, y, y + ruinCut(1), 0, -1);           // fond
  piece(-hw + t / 2, -hd, -hw + t / 2, hd, y, y + ruinCut(2), -1, 0);           // gauche
  piece(hw - t / 2, -hd, hw - t / 2, hd, y, y + ruinCut(3), 1, 0);              // droite
  piece(-hw, hd - t / 2, d0, hd - t / 2, y, y + ruinCut(4), 0, 1);              // façade gauche
  piece(d1, hd - t / 2, hw, hd - t / 2, y, y + ruinCut(5), 0, 1);               // façade droite
  if (!b.ruined) piece(d0, hd - t / 2, d1, hd - t / 2, y + dh, y + H, 0, 1, false); // linteau
  // encadrement de porte
  for (const lx of [d0 - 0.1, d1 + 0.1]) mb.box(f.wx(lx, hd), y, f.wz(lx, hd), 0.2, dh + 0.1, t + 0.1, b.yaw, 0x5a3a22, M.DOOR);
  if (!b.ruined) {
    // fenêtres (visibles dedans et dehors, éclairées la nuit)
    const win = (lx: number, lz: number, along: boolean) => mb.box(f.wx(lx, lz), y + 1.2, f.wz(lx, lz), along ? 0.7 : t + 0.08, 0.6, along ? t + 0.08 : 0.7, b.yaw, 0xffc870, M.WINDOW);
    for (let x = -hw + 1.8; x < hw - 1.2; x += 3.2) win(x, -hd + t / 2, true);
    for (let z = -hd + 1.8; z < hd - 1.2; z += 3.2) { win(-hw + t / 2, z, false); win(hw - t / 2, z, false); }
    // plafond (vu de l'intérieur), toit, cheminée
    mb.sky = INSIDE;
    mb.box(b.x, y + H, b.z, b.w - 0.2, 0.12, b.d - 0.2, b.yaw, 0x5a4430, M.PLANKS);
    mb.sky = 1;
    const roofM = b.stone ? M.ROOF : M.THATCH;
    const roofC = b.kind === 'donjon' || b.kind === 'caserne' ? 0x4a5262 : b.stone ? 0x8a3a2a : 0xb09a5a;
    if (b.kind === 'donjon') {
      for (let i = 0; i < 4; i++) for (let k = -2; k <= 2; k++) {
        const lx = i < 2 ? k * hw / 2.5 : (i === 2 ? -hw : hw), lz = i < 2 ? (i === 0 ? -hd : hd) : k * hd / 2.5;
        mb.box(f.wx(lx, lz), y + H, f.wz(lx, lz), 0.9, 1, 0.9, b.yaw, wallC, M.STONE);
      }
    } else mb.gable(b.x, y + H, b.z, b.w + 0.8, b.d + 0.8, b.roofH, b.yaw, roofC, roofM, wallC, wallM);
    if (b.furniture.some((x) => x.kind === 'âtre' || x.kind === 'foyer de forge')) {
      const fx = f.wx(hw - 0.6, -hd + 0.5), fz = f.wz(hw - 0.6, -hd + 0.5);
      mb.box(fx, y + H, fz, 0.7, b.roofH + 1.2, 0.7, b.yaw, 0x6e675c, M.STONE);
    }
  }
  // marches devant la porte si le plancher est haut
  const gx = f.wx(b.doorX, hd + 0.8), gz = f.wz(b.doorX, hd + 0.8);
  const gDoor = sampler.height(gx, gz);
  const n = Math.ceil((y - gDoor - 0.15) / 0.4);
  for (let i = 0; i < n && i < 5; i++) {
    const top = y - (i + 1) * ((y - gDoor) / (n + 1));
    const lz = hd + 0.45 + i * 0.5;
    const sx = f.wx(b.doorX, lz), sz = f.wz(b.doorX, lz);
    mb.box(sx, gDoor - 0.3, sz, dw + 0.6, top - gDoor + 0.3, 0.5, b.yaw, 0x7a7266, M.STONE);
    ch.platforms.push({ cx: sx, cz: sz, hw: dw / 2 + 0.3, hd: 0.25, yaw: b.yaw, top });
  }
  // torches de façade (auberge, forge, garde, temple, donjon)
  if (!b.ruined && ['auberge', 'forge', 'corps de garde', 'temple', 'donjon', 'caserne', 'échoppe'].includes(b.kind)) {
    const tx = f.wx(d1 + 0.6, hd + 0.35), tz = f.wz(d1 + 0.6, hd + 0.35);
    mb.box(tx, y + 1.6, tz, 0.12, 0.6, 0.12, 0, 0x4a3020, M.WOOD);
    mb.box(tx, y + 2.2, tz, 0.22, 0.3, 0.22, 0, 0xffa030, M.FIRE);
    ch.lights.push({ x: tx, y: y + 2.4, z: tz, radius: 11, r: 1.5, g: 0.85, b: 0.4, kind: 'torch' });
  }
  // mobilier
  b.furniture.forEach((fu, i) => furniture(mb, ch, f, b, fu, y, i));
  if (b.dungeonId >= 0) ch.props.push({ key: `b${b.sid}:${b.id}:entrée`, kind: 'entrée', x: b.x, y: y + 0.5, z: b.z, sid: b.sid, bid: b.id, dungeonId: b.dungeonId });
}

function furniture(mb: MeshBuilder, ch: ChunkData, f: ReturnType<typeof frame>, b: Building, fu: Furniture, y: number, i: number) {
  const x = f.wx(fu.lx, fu.lz), z = f.wz(fu.lx, fu.lz), yaw = b.yaw + fu.yaw;
  const key = `b${b.sid}:${b.id}:${i}`;
  const prop = (kind: string) => ch.props.push({ key, kind, x, y, z, sid: b.sid, bid: b.id, dungeonId: -1 });
  mb.sky = INSIDE;
  switch (fu.kind) {
    case 'lit':
      mb.box(x, y, z, 1.0, 0.45, 2.0, yaw, 0x6a4a30, M.WOOD);
      mb.box(x, y + 0.45, z + 0.1, 0.9, 0.12, 1.6, yaw, [0x8a3a3a, 0x3a5a8a, 0x6a7a3a][i % 3], M.CLOTH);
      ch.circles.push({ x, z, r: 0.6, bottom: y, top: y + 0.5 }); prop('lit'); break;
    case 'table': mb.box(x, y, z, 1.8, 0.8, 0.9, yaw, 0x7a5636, M.PLANKS); ch.circles.push({ x, z, r: 0.6, bottom: y, top: y + 0.8 }); break;
    case 'banc': mb.box(x, y, z, 1.5, 0.45, 0.35, yaw, 0x6a4a2c, M.WOOD); break;
    case 'coffre': mb.box(x, y, z, 0.9, 0.55, 0.6, yaw, 0x5a3a20, M.WOOD); mb.box(x, y + 0.3, z, 0.95, 0.06, 0.65, yaw, 0x8a8a80, M.METAL); prop('coffre'); break;
    case 'tonneau': mb.cylinder(x, y, z, 0.4, 0.9, 7, 0x7a5232, M.WOOD); prop('tonneau'); ch.circles.push({ x, z, r: 0.42, bottom: y, top: y + 0.9 }); break;
    case 'âtre':
      mb.box(x, y, z, 1.6, 1.1, 1.0, yaw, 0x6e675c, M.STONE);
      mb.sky = 1; mb.box(x, y + 0.15, z, 0.8, 0.45, 0.5, yaw, 0xff9a30, M.FIRE); mb.sky = INSIDE;
      ch.lights.push({ x, y: y + 0.8, z, radius: 9, r: 1.6, g: 0.8, b: 0.35, kind: 'fire' }); prop('âtre');
      ch.circles.push({ x, z, r: 0.7, bottom: y, top: y + 1.1 }); break;
    case 'comptoir': mb.box(x, y, z, 3.2, 1.05, 0.6, yaw, 0x6a4628, M.WOOD); ch.segs.push({ ax: f.wx(fu.lx - 1.6, fu.lz), az: f.wz(fu.lx - 1.6, fu.lz), bx: f.wx(fu.lx + 1.6, fu.lz), bz: f.wz(fu.lx + 1.6, fu.lz), r: 0.3, bottom: y, top: y + 1.05 }); prop('comptoir'); break;
    case 'enclume': mb.box(x, y, z, 0.5, 0.5, 0.5, yaw, 0x5a4030, M.WOOD); mb.box(x, y + 0.5, z, 0.8, 0.3, 0.4, yaw, 0x4a4a52, M.METAL); prop('enclume'); ch.circles.push({ x, z, r: 0.45, bottom: y, top: y + 0.8 }); break;
    case 'foyer de forge':
      mb.box(x, y, z, 1.5, 1.0, 1.5, yaw, 0x5e574c, M.STONE);
      mb.sky = 1; mb.box(x, y + 1.0, z, 0.9, 0.35, 0.9, yaw, 0xff7a20, M.FIRE); mb.sky = INSIDE;
      ch.lights.push({ x, y: y + 1.5, z, radius: 12, r: 1.9, g: 0.75, b: 0.3, kind: 'fire' }); prop('foyer');
      ch.circles.push({ x, z, r: 0.9, bottom: y, top: y + 1.3 }); break;
    case 'étagère': mb.box(x, y, z, 1.6, 2.0, 0.4, yaw, 0x6a4a2c, M.WOOD); for (let k = 0; k < 3; k++) mb.box(x, y + 0.5 + k * 0.55, z, 1.3, 0.25, 0.3, yaw, [0xa86a3a, 0x8a8a6a, 0x6a8a5a][k], M.CLOTH); break;
    case 'autel':
      mb.box(x, y, z, 1.8, 1.0, 0.8, yaw, 0xb8b0a0, M.STONE);
      mb.sky = 1; for (const k of [-0.6, 0.6]) mb.box(f.wx(fu.lx + k, fu.lz), y + 1.0, f.wz(fu.lx + k, fu.lz), 0.08, 0.3, 0.08, 0, 0xffe0a0, M.GLOW); mb.sky = INSIDE;
      ch.lights.push({ x, y: y + 1.4, z, radius: 6, r: 1.1, g: 0.9, b: 0.6, kind: 'candle' }); prop('autel'); break;
    case 'râtelier': mb.box(x, y, z, 1.4, 1.6, 0.3, yaw, 0x5a3a22, M.WOOD); for (let k = -1; k <= 1; k++) mb.box(f.wx(fu.lx, fu.lz + k * 0.35), y + 0.3, f.wz(fu.lx, fu.lz + k * 0.35), 0.06, 1.4, 0.06, yaw, 0x9a9aa2, M.METAL); prop('râtelier'); break;
    case 'établi': mb.box(x, y, z, 2.0, 0.9, 0.8, yaw, 0x7a5636, M.PLANKS); prop('établi'); break;
    case 'meule': mb.cylinder(x, y, z, 0.9, 0.5, 9, 0x8a8478, M.STONE); prop('meule'); ch.circles.push({ x, z, r: 0.9, bottom: y, top: y + 0.5 }); break;
    case 'foin': mb.box(x, y, z, 1.2, 1.0, 1.0, yaw, 0xc8b060, M.FIELD); break;
    case 'trône': mb.box(x, y, z, 1.0, 0.5, 0.9, yaw, 0x6a2a2a, M.CLOTH); mb.box(f.wx(fu.lx, fu.lz - 0.4), y, f.wz(fu.lx, fu.lz - 0.4), 1.0, 1.8, 0.2, yaw, 0x8a6a2a, M.WOOD); prop('trône'); break;
    case 'escalier':
      for (let k = 0; k < 4; k++) mb.box(f.wx(fu.lx, fu.lz - k * 0.4), y - 0.25 * k, f.wz(fu.lx, fu.lz - k * 0.4), 1.4, 0.1, 0.4, yaw, 0x3a3630, M.STONE);
      mb.box(x, y - 1.2, z, 1.6, 0.05, 2, yaw, 0x050505, M.STONE); break;
  }
  mb.sky = 1;
}

export function buildWall(mb: MeshBuilder, sampler: TerrainSampler, ch: ChunkData, w: WallSeg): void {
  const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
  const yaw = Math.atan2(w.bx - w.ax, w.bz - w.az);
  const n = Math.max(1, Math.ceil(len / 4));
  const t = w.stone ? 1.6 : 0.5;
  for (let i = 0; i < n; i++) {
    const x = w.ax + (w.bx - w.ax) * (i + 0.5) / n, z = w.az + (w.bz - w.az) * (i + 0.5) / n;
    const g = sampler.height(x, z);
    const h = w.ruined ? w.h * (0.4 + ((i * 37 + Math.floor(x)) % 7) / 10) : w.h;
    mb.box(x, g - 1, z, t, h + 1, len / n + 0.05, yaw, w.stone ? 0x8a8478 : 0x6a5034, w.stone ? M.STONE : M.WOOD);
    if (w.stone && !w.ruined && i % 2 === 0) mb.box(x, g + h, z, t, 0.7, 1, yaw, 0x8a8478, M.STONE);
  }
  const g = sampler.height(w.ax, w.az);
  ch.segs.push({ ax: w.ax, az: w.az, bx: w.bx, bz: w.bz, r: t / 2, bottom: g - 2, top: g + w.h });
}

export function buildTower(mb: MeshBuilder, sampler: TerrainSampler, ch: ChunkData, t: Tower): void {
  const g = sampler.height(t.x, t.z);
  if (t.stone) {
    mb.cylinder(t.x, g - 1, t.z, t.r, t.h + 1, 8, 0x8e887c, M.STONE);
    for (let i = 0; i < 8; i += 2) { const a = (i / 8) * Math.PI * 2; mb.box(t.x + Math.cos(a) * t.r * 0.85, g + t.h, t.z + Math.sin(a) * t.r * 0.85, 0.9, 0.8, 0.9, a, 0x8e887c, M.STONE); }
    mb.cone(t.x, g + t.h + 0.8, t.z, t.r * 1.05, t.r * 1.6, 8, 0x4a5262, M.ROOF);
  } else {
    mb.box(t.x, g - 0.5, t.z, t.r * 2, t.h + 0.5, t.r * 2, 0.3, 0x6a5034, M.WOOD);
    mb.pyramid(t.x, g + t.h, t.z, t.r * 2.6, t.r * 2.6, 1.8, 0.3, 0x7a6a3a, M.THATCH);
  }
  ch.circles.push({ x: t.x, z: t.z, r: t.r, bottom: g - 1, top: g + t.h });
}

export function buildBridge(mb: MeshBuilder, sampler: TerrainSampler, ch: ChunkData, b: Bridge, stone: boolean): void {
  const s = Math.sin(b.yaw), c = Math.cos(b.yaw), hl = b.length / 2;
  const e1 = sampler.height(b.x - s * (hl + 1), b.z - c * (hl + 1)), e2 = sampler.height(b.x + s * (hl + 1), b.z + c * (hl + 1));
  const y = Math.max(b.y - 0.7, (e1 + e2) / 2 + 0.15);
  const col = stone ? 0x8a8478 : 0x7a5a3a, mat = stone ? M.STONE : M.PLANKS;
  mb.box(b.x, y - 0.6, b.z, b.width, 0.6, b.length, b.yaw, col, mat);
  ch.platforms.push({ cx: b.x, cz: b.z, hw: b.width / 2, hd: hl + 0.5, yaw: b.yaw, top: y });
  for (const side of [-1, 1]) {
    const ox = c * side * (b.width / 2 - 0.15), oz = -s * side * (b.width / 2 - 0.15);
    mb.box(b.x + ox, y, b.z + oz, 0.25, 1.0, b.length, b.yaw, shade(col, 0.85), mat);
    ch.segs.push({ ax: b.x + ox - s * hl, az: b.z + oz - c * hl, bx: b.x + ox + s * hl, bz: b.z + oz + c * hl, r: 0.15, bottom: y - 1, top: y + 1 });
  }
  for (const k of [-1, 1]) {
    const px = b.x + s * k * (hl - 1), pz = b.z + c * k * (hl - 1);
    mb.box(px, y - 7, pz, b.width + 0.4, 6.4, 1.6, b.yaw, 0x6e675c, M.STONE);
    for (const end of [e1, e2]) {
      const n = Math.ceil((y - end - 0.15) / 0.4);
      for (let i = 0; i < n && i < 4 && k === (end === e1 ? -1 : 1); i++) {
        const top = y - (i + 1) * ((y - end) / (n + 1));
        const sx = b.x + s * k * (hl + 0.5 + i * 0.6), sz = b.z + c * k * (hl + 0.5 + i * 0.6);
        mb.box(sx, end - 0.4, sz, b.width, top - end + 0.4, 0.6, b.yaw, col, mat);
        ch.platforms.push({ cx: sx, cz: sz, hw: b.width / 2, hd: 0.3, yaw: b.yaw, top });
      }
    }
  }
}

export function buildDecor(mb: MeshBuilder, sampler: TerrainSampler, ch: ChunkData, d: Decor): void {
  const g = sampler.height(d.x, d.z), s = d.s;
  const light = (y: number, radius: number, r: number, gg: number, b: number, kind: 'torch' | 'fire' | 'candle') => ch.lights.push({ x: d.x, y, z: d.z, radius, r, g: gg, b, kind });
  const prop = (kind: string) => ch.props.push({ key: d.key, kind, x: d.x, y: g, z: d.z, sid: -1, bid: -1, dungeonId: d.dungeonId });
  const f = frame(d.x, d.z, d.yaw);
  switch (d.kind) {
    case 'puits':
      mb.cylinder(d.x, g - 0.3, d.z, 1.0, 1.2, 8, 0x8a8478, M.STONE);
      mb.box(d.x, g + 0.9, d.z, 0.06, 0.05, 0.06, 0, 0x101820, M.WATER);
      for (const k of [-0.9, 0.9]) mb.box(f.wx(k, 0), g + 0.9, f.wz(k, 0), 0.15, 1.6, 0.15, d.yaw, 0x5a3a22, M.WOOD);
      mb.gable(d.x, g + 2.5, d.z, 2.4, 1.6, 0.7, d.yaw, 0x8a6a3a, M.THATCH);
      ch.circles.push({ x: d.x, z: d.z, r: 1.1, bottom: g - 1, top: g + 1 }); prop('puits'); break;
    case 'fontaine':
      mb.cylinder(d.x, g - 0.3, d.z, 1.8, 0.8, 10, 0x9a948a, M.STONE);
      mb.cylinder(d.x, g + 0.4, d.z, 1.5, 0.05, 10, 0x3a7aa0, M.WATER, true);
      mb.cylinder(d.x, g + 0.4, d.z, 0.3, 1.6, 6, 0x9a948a, M.STONE);
      ch.circles.push({ x: d.x, z: d.z, r: 1.9, bottom: g - 1, top: g + 0.6 }); prop('puits'); break;
    case 'statue':
      mb.box(d.x, g - 0.5, d.z, 2.2 * s, 2 * s, 2.2 * s, d.yaw, 0x8a8478, M.STONE);
      mb.box(d.x, g + 1.5 * s, d.z, 0.8 * s, 1.6 * s, 0.5 * s, d.yaw, 0xb0aa9c, M.STONE);
      mb.box(d.x, g + 3.1 * s, d.z, 0.45 * s, 0.5 * s, 0.45 * s, d.yaw, 0xb0aa9c, M.STONE);
      mb.box(f.wx(0.6 * s, 0), g + 2 * s, f.wz(0.6 * s, 0), 0.12, 2.4 * s, 0.12, d.yaw, 0x9a9488, M.METAL);
      ch.circles.push({ x: d.x, z: d.z, r: 1.5 * s, bottom: g - 1, top: g + 3 }); prop('statue'); break;
    case 'brasero': case 'lanterne':
      mb.box(d.x, g, d.z, 0.15, d.kind === 'lanterne' ? 2.6 : 1.0, 0.15, 0, 0x3a3a3a, M.METAL);
      if (d.kind === 'brasero') mb.cylinder(d.x, g + 1.0, d.z, 0.5, 0.3, 6, 0x4a4a4a, M.METAL);
      mb.box(d.x, g + (d.kind === 'lanterne' ? 2.5 : 1.25), d.z, 0.4, 0.4, 0.4, 0, 0xffa030, d.kind === 'lanterne' ? M.GLOW : M.FIRE);
      light(g + 2.6, d.kind === 'lanterne' ? 10 : 13, 1.6, 0.9, 0.45, 'torch');
      ch.circles.push({ x: d.x, z: d.z, r: 0.4, bottom: g, top: g + 2.5 }); break;
    case 'feu de camp':
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; mb.blob(d.x + Math.cos(a) * 0.9, g + 0.1, d.z + Math.sin(a) * 0.9, 0.25, 0.2, 0.25, 0x6a665e, M.ROCK, 4, 2); }
      mb.box(d.x, g, d.z, 0.7, 0.6, 0.7, 0.4, 0xff9030, M.FIRE);
      light(g + 1, 15, 1.9, 0.9, 0.4, 'fire'); prop('feu'); break;
    case 'tente':
      mb.pyramid(d.x, g, d.z, 3.2 * s, 3.2 * s, 2.4 * s, d.yaw, [0x8a7a5a, 0x6a5a40, 0x7a4a3a][Math.floor(d.x) & 1], M.CLOTH);
      ch.circles.push({ x: d.x, z: d.z, r: 1.3 * s, bottom: g, top: g + 2.4 }); break;
    case 'caisse': mb.box(d.x, g, d.z, 0.85, 0.75, 0.85, d.yaw, 0x7a5a32, M.WOOD); prop('caisse'); ch.circles.push({ x: d.x, z: d.z, r: 0.5, bottom: g, top: g + 0.75 }); break;
    case 'pieu': mb.box(d.x, g - 0.3, d.z, 0.3, 2.6, 0.3, d.yaw, 0x5a4028, M.WOOD); ch.circles.push({ x: d.x, z: d.z, r: 0.2, bottom: g, top: g + 2 }); break;
    case 'tombe': mb.box(d.x, g - 0.2, d.z, 0.7, 0.9, 0.2, d.yaw, 0x8a8a84, M.STONE); mb.box(f.wx(0, 0.9), g, f.wz(0, 0.9), 0.8, 0.12, 1.6, d.yaw, 0x5a5040, M.DIRT); break;
    case 'croix': mb.box(d.x, g - 0.2, d.z, 0.14, 1.5, 0.14, d.yaw, 0x6a5a40, M.WOOD); mb.box(d.x, g + 0.85, d.z, 0.7, 0.12, 0.14, d.yaw, 0x6a5a40, M.WOOD); break;
    case 'menhir':
      mb.box(d.x, g - 0.5, d.z, 1.1 * s, 3.8 * s, 0.8 * s, d.yaw, 0x7e7a72, M.ROCK);
      ch.circles.push({ x: d.x, z: d.z, r: 0.7 * s, bottom: g, top: g + 3 }); break;
    case 'étal':
      mb.box(d.x, g, d.z, 2.2, 0.9, 1.0, d.yaw, 0x7a5636, M.PLANKS);
      mb.gable(d.x, g + 2.1, d.z, 2.6, 1.6, 0.5, d.yaw, [0xa83a3a, 0x3a6aa8, 0xc8a040][Math.floor(d.z) & 1], M.CLOTH);
      for (const k of [-1.1, 1.1]) mb.box(f.wx(k, 0.6), g, f.wz(k, 0.6), 0.1, 2.1, 0.1, d.yaw, 0x5a3a22, M.WOOD);
      ch.circles.push({ x: d.x, z: d.z, r: 1.1, bottom: g, top: g + 1 }); prop('étal'); break;
    case 'sanctuaire':
      mb.box(d.x, g - 0.3, d.z, 1.2, 1.9, 0.8, d.yaw, 0x8a8478, M.STONE);
      mb.pyramid(d.x, g + 1.6, d.z, 1.4, 1.0, 0.6, d.yaw, 0x6a6458, M.STONE);
      mb.box(f.wx(0, 0.42), g + 0.9, f.wz(0, 0.42), 0.1, 0.25, 0.1, d.yaw, 0xffe0a0, M.GLOW);
      light(g + 1.2, 5, 1.0, 0.85, 0.5, 'candle'); prop('sanctuaire'); break;
    case 'arbre géant':
      mb.cylinder(d.x, g - 0.5, d.z, 1.3 * s, 9 * s, 7, 0x4e3a28, M.TRUNK, false, 0.8 * s);
      mb.vflags = 1;
      for (let i = 0; i < 5; i++) { const a = i * 1.3; mb.blob(d.x + Math.cos(a) * 3 * s, g + (9 + (i % 2) * 2) * s, d.z + Math.sin(a) * 3 * s, 4.5 * s, 3.2 * s, 4.5 * s, 0x2e5a26, M.FOLIAGE, 7, 4); }
      mb.vflags = 0;
      ch.circles.push({ x: d.x, z: d.z, r: 1.3 * s, bottom: g - 1, top: g + 9 }); break;
    case 'tour de guet':
      mb.box(d.x, g - 1, d.z, 5, 13, 5, d.yaw, 0x8a8478, M.STONE);
      for (let i = 0; i < 4; i++) for (const k of [-1.8, 0, 1.8]) {
        const lx = i < 2 ? k : (i === 2 ? -2.2 : 2.2), lz = i < 2 ? (i === 0 ? -2.2 : 2.2) : k;
        mb.box(f.wx(lx, lz), g + 12, f.wz(lx, lz), 0.8, 0.9, 0.8, d.yaw, 0x8a8478, M.STONE);
      }
      mb.box(f.wx(0, 2.52), g, f.wz(0, 2.52), 1.2, 2.2, 0.08, d.yaw, 0x3a2416, M.DOOR);
      mb.box(f.wx(1.2, 2.55), g + 6, f.wz(1.2, 2.55), 0.5, 0.8, 0.08, d.yaw, 0xffc870, M.WINDOW);
      ch.segs.push({ ax: f.wx(-2.5, 0), az: f.wz(-2.5, 0), bx: f.wx(2.5, 0), bz: f.wz(2.5, 0), r: 2.5, bottom: g - 1, top: g + 12 }); break;
    case 'gravats': mb.blob(d.x, g, d.z, 1.2 * s, 0.5 * s, 0.9 * s, 0x7a756c, M.RUBBLE, 5, 2); break;
    case 'ossements': mb.box(d.x, g, d.z, 0.7, 0.12, 0.12, d.yaw, 0xd8d0b8, M.BONE); mb.box(d.x + 0.3, g, d.z + 0.2, 0.25, 0.22, 0.25, d.yaw, 0xd8d0b8, M.BONE); break;
    case 'lance brisée': mb.box(d.x, g - 0.3, d.z, 0.08, 1.4, 0.08, d.yaw, 0x6a5a40, M.WOOD); mb.box(d.x, g + 1.1, d.z, 0.12, 0.3, 0.05, d.yaw, 0x8a8a8a, M.METAL); break;
    case 'tanière':
      mb.blob(d.x, g - 0.5, d.z, 4 * s, 2.4 * s, 3.5 * s, 0x6a6458, M.ROCK, 7, 3);
      mb.box(f.wx(0, 3.2 * s), g - 0.2, f.wz(0, 3.2 * s), 1.8 * s, 1.5 * s, 0.6, d.yaw, 0x0a0806, M.DIRT);
      ch.circles.push({ x: d.x, z: d.z, r: 3 * s, bottom: g - 1, top: g + 2 }); break;
    case 'entrée grotte': case 'entrée mine': {
      const mine = d.kind === 'entrée mine';
      mb.blob(d.x, g - 1, d.z, 6, 4, 5, 0x6a6458, M.ROCK, 8, 3);
      for (const k of [-1.6, 1.6]) mb.box(f.wx(k, 4.4), g - 0.5, f.wz(k, 4.4), mine ? 0.35 : 1.2, 3.4, mine ? 0.35 : 1.4, d.yaw, mine ? 0x5a4028 : 0x6a6458, mine ? M.WOOD : M.ROCK);
      mb.box(f.wx(0, 4.4), g + 2.6, f.wz(0, 4.4), 4.2, mine ? 0.4 : 1.2, 1, d.yaw, mine ? 0x5a4028 : 0x6a6458, mine ? M.WOOD : M.ROCK);
      mb.box(f.wx(0, 4.9), g - 0.4, f.wz(0, 4.9), 2.6, 2.9, 0.1, d.yaw, 0x030302, M.DIRT);
      ch.circles.push({ x: d.x, z: d.z, r: 4.5, bottom: g - 1, top: g + 3 });
      ch.props.push({ key: d.key, kind: 'entrée', x: f.wx(0, 5.3), y: g, z: f.wz(0, 5.3), sid: -1, bid: -1, dungeonId: d.dungeonId });
      if (mine) { ch.lights.push({ x: f.wx(2.2, 5), y: g + 2, z: f.wz(2.2, 5), radius: 9, r: 1.5, g: 0.85, b: 0.4, kind: 'torch' }); mb.box(f.wx(2.2, 5), g + 1.8, f.wz(2.2, 5), 0.2, 0.3, 0.2, 0, 0xffa030, M.FIRE); }
      break;
    }
    case 'roue':
      mb.box(d.x, g - 0.5, d.z, 0.3, 4.2, 0.6, d.yaw, 0x5a4028, M.WOOD);
      mb.box(d.x, g + 1.3, d.z, 0.3, 0.6, 4.2, d.yaw, 0x5a4028, M.WOOD);
      break;
    case 'clôture': mb.box(d.x, g, d.z, 0.1, 1.0, 3, d.yaw, 0x6a5034, M.WOOD); break;
  }
}
