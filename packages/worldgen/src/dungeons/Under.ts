import type { MeshBuilder } from '@ascii-fort/ascii-engine/Mesh';
import { M } from '@ascii-fort/ascii-engine/Materials';
import type { ChunkData } from '../Chunk';
import type { Dungeon } from '../civilization/types';
import type { DSpawn, DRoom, DLink } from './DungeonGenerator';
import { DUNGEON_ORIGIN_X, FLOOR_Z0, FLOOR_STEP, FLOOR_CODE, CAVE_ORIGIN_Z, CAVE_SLOT, CAVE_COLS, CAVE_CODE } from '../constants';

// Étape 55 (passe 2) : ce qui est commun aux lieux souterrains ajoutés (étages inférieurs des donjons, grottes) et au plan
// d'origine des donjons, que le jeu lit de la même façon. Rien ici ne touche au niveau 1 : il garde son générateur et ses tirages.

/** Créature de garde nommée (gardien d'étage) : variante d'un type existant, incarnée comme une créature unique. */
export interface EliteDef { name: string; title: string; fem: boolean; scale: number; tint?: number; cape?: number; crown?: boolean; eyes?: number }
/** Apparition d'une créature souterraine : celles des étages et des grottes peuvent porter un bonus de niveau ou un gardien. */
export interface USpawn extends DSpawn { bonus?: number; elite?: EliteDef; territory?: number }
export interface UnderChest { x: number; z: number; key: string; tier: number; hasKey: boolean }

/** Ce que le jeu lit d'un lieu souterrain : plan d'origine d'un donjon (DungeonLayout), étage inférieur, grotte. */
export interface UnderLayout {
  /** id du donjon, ou du réseau de grottes */
  id: number;
  kind: Dungeon['kind'];
  name: string;
  entrance: { x: number; z: number; heading: number };
  traps: { x: number; z: number; key: string }[];
  chests: UnderChest[];
  spawns: USpawn[];
  lockedDoor: { x: number; z: number; horizontal: boolean; key: string } | null;
  keyItem: string;
  /** salles et passages (grottes : leurs salles naturelles, sans passages) */
  rooms: DRoom[]; links: DLink[];
}

/** Origine (coin des salles) de l'étage n d'un donjon : même tranche en x que le niveau 1, 400 m plus au sud par étage. */
export function floorOrigin(dungeonId: number, level: number): { ox: number; oz: number } {
  return { ox: DUNGEON_ORIGIN_X + dungeonId * 220, oz: FLOOR_Z0 + (level - 1) * FLOOR_STEP };
}
/** Centre de la case d'une grotte (réseau g) : 24 par rangée, 400 m d'écart. */
export function caveOrigin(id: number): { x: number; z: number } {
  return { x: DUNGEON_ORIGIN_X + (id % CAVE_COLS) * CAVE_SLOT, z: CAVE_ORIGIN_Z + Math.floor(id / CAVE_COLS) * CAVE_SLOT };
}
/** Code du monde souterrain (même convention que Companions.worldOf) : -1 surface, d niveau 1, d + 1000 (n − 1), 100000 + g. */
export function underCode(cave: boolean, id: number, level = 1): number {
  return cave ? CAVE_CODE + id : id + FLOOR_CODE * (level - 1);
}

/** Petit repère local (x, z) tourné de yaw : (lx, lz) → monde. */
export function frameOf(x: number, z: number, yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { wx: (lx: number, lz: number) => x + lx * c + lz * s, wz: (lx: number, lz: number) => z - lx * s + lz * c };
}

/**
 * Cage d'escalier qui descend (étage suivant) : margelle de pierre sur trois côtés, marches qui s'enfoncent dans le noir,
 * barrière invisible au bord du vide (on s'arrête au bord et l'on descend avec [E]). Repère local tourné de `yaw` (quarts de tour) :
 * on arrive par −z, les marches descendent vers +z. `hole` : le sol est réellement percé (étages) ; sinon un aplat noir posé sur
 * le sol suffit (niveau 1, plan intact).
 */
export function stairsDown(mb: MeshBuilder, data: ChunkData, x: number, z: number, key: string, stone: number, dungeonId: number, hole: boolean, yaw = 0): void {
  const W = 2.4, D = 3.2, y0 = hole ? -0.3 : 0, f = frameOf(x, z, yaw);
  const box = (lx: number, y: number, lz: number, sx: number, sy: number, sz: number, c: number, m: number) => mb.box(f.wx(lx, lz), y, f.wz(lx, lz), sx, sy, sz, yaw, c, m);
  // margelle (côtés et fond), un peu plus large que le trou
  box(-W / 2 - 0.25, 0, 0, 0.5, 0.8, D + 0.5, stone, M.STONE);
  box(W / 2 + 0.25, 0, 0, 0.5, 0.8, D + 0.5, stone, M.STONE);
  box(0, 0, D / 2 + 0.25, W + 1, 0.8, 0.5, stone, M.STONE);
  // le vide et les marches, noircies par la profondeur
  if (!hole) box(0, 0, 0, W, 0.03, D, 0x050404, M.DIRT);
  else box(0, -4, 0, W, 0.2, D, 0x050404, M.DIRT);
  for (let i = 0; i < 4; i++) {
    const top = hole ? -0.25 - i * 0.55 : 0.04, shade = [0x6a665e, 0x4a4640, 0x2e2a26, 0x1a1816][i];
    box(0, top - 0.15, -D / 2 + 0.4 + i * 0.75, W - 0.1, 0.15, 0.7, shade, M.STONE);
  }
  if (hole) for (const k of [-1, 1]) box(k * W / 2, -4, 0, 0.1, 4 + y0, D, 0x2a2622, M.STONE);
  // linteau sombre au-dessus du fond
  box(0, 2.2, D / 2 + 0.25, W + 1, 0.5, 0.5, stone, M.STONE);
  for (const k of [-1, 1]) box(k * (W / 2 + 0.25), 0.8, D / 2 + 0.25, 0.5, 1.4, 0.5, stone, M.STONE);
  // barrière : le trou ne se traverse pas (assez haute pour ne pas s'y percher d'un saut ; « haute » aussi pour les PNJ)
  const seg = (ax: number, az: number, bx: number, bz: number) => data.segs.push({ ax: f.wx(ax, az), az: f.wz(ax, az), bx: f.wx(bx, bz), bz: f.wz(bx, bz), r: 0.3, bottom: -1, top: 2.2 });
  seg(-W / 2 - 0.2, -D / 2, W / 2 + 0.2, -D / 2);
  seg(-W / 2 - 0.25, -D / 2, -W / 2 - 0.25, D / 2 + 0.25);
  seg(W / 2 + 0.25, -D / 2, W / 2 + 0.25, D / 2 + 0.25);
  seg(-W / 2 - 0.25, D / 2 + 0.25, W / 2 + 0.25, D / 2 + 0.25);
  data.props.push({ key, kind: 'escalier', x: f.wx(0, -D / 2 - 0.9), y: 0, z: f.wz(0, -D / 2 - 0.9), sid: -1, bid: -1, dungeonId });
}

/** Escalier qui remonte (comme la sortie du niveau 1 : trois marches contre le mur sud, lueur de torche venue d'en haut). */
export function stairsUp(mb: MeshBuilder, data: ChunkData, x: number, z: number, key: string, stone: number, dungeonId: number, glow = 0xffc070): void {
  mb.box(x, 0, z, 2.4, 0.4, 0.8, 0, stone, M.STONE);
  mb.box(x, 0.4, z + 0.6, 2.4, 0.4, 0.8, 0, stone, M.STONE);
  mb.box(x, 0.8, z + 1.2, 2.4, 0.4, 0.8, 0, stone, M.STONE);
  const sky = mb.sky;
  mb.sky = 0.2;
  mb.box(x, 1.2, z + 1.9, 2.2, 2.4, 0.2, 0, glow, M.GLOW);
  mb.sky = sky;
  data.lights.push({ x, y: 2, z: z + 1.2, radius: 8, r: 1.3, g: 0.95, b: 0.6, kind: 'candle' });
  data.props.push({ key, kind: 'escalier', x, y: 0, z, sid: -1, bid: -1, dungeonId });
}
