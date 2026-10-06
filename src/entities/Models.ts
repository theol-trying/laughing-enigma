import { trsYawPitch, mat4 } from '../core/math';
import { M } from '../rendering/Materials';
import type { InstanceBuffer } from '../rendering/Renderer';

// Modèles en volumes (boîtes) animés — aucune texture. Au loin, le renderer remplace la
// silhouette par la lettre du modèle (style roguelike).

type Joint = 'legL' | 'legR' | 'armL' | 'armR' | 'tail' | 'head' | 'weapon' | 'body';
interface Part { x: number; y: number; z: number; w: number; h: number; d: number; color: number; mat: number; joint?: Joint; ry?: number; limb?: boolean }
export interface ModelDef { parts: Part[]; letter: string; height: number; radius: number; quad: boolean }
export interface Pose { walk: number; swing: number; dead: number; hover: number; block: number }

export interface HumanLook { skin: number; shirt: number; pants: number; hair: number; helmet?: boolean; robe?: boolean; hood?: boolean; weapon?: 'épée' | 'lance' | 'hache' | 'massue' | 'bâton' | 'dague' | null; shield?: boolean; scale?: number; mat?: number; letter?: string; noLegs?: boolean }

export function humanoid(l: HumanLook): ModelDef {
  const s = l.scale ?? 1, body = l.mat ?? M.CLOTH, skinM = l.mat === M.BONE ? M.BONE : M.SKIN;
  const P: Part[] = [];
  const legH = 0.85 * s, torsoH = 0.62 * s, armH = 0.62 * s;
  if (!l.noLegs) for (const side of [-1, 1]) P.push({ x: side * 0.12 * s, y: legH, z: 0, w: 0.17 * s, h: legH, d: 0.18 * s, color: l.robe ? l.shirt : l.pants, mat: body, joint: side < 0 ? 'legL' : 'legR', limb: true });
  P.push({ x: 0, y: legH + torsoH / 2, z: 0, w: 0.5 * s, h: torsoH, d: 0.27 * s, color: l.shirt, mat: l.helmet ? M.METAL : body, joint: 'body' });
  if (l.robe) P.push({ x: 0, y: legH * 0.5, z: 0, w: 0.48 * s, h: legH, d: 0.3 * s, color: l.shirt, mat: body });
  for (const side of [-1, 1]) P.push({ x: side * 0.33 * s, y: legH + torsoH - 0.03, z: 0, w: 0.13 * s, h: armH, d: 0.14 * s, color: l.shirt, mat: body, joint: side < 0 ? 'armL' : 'armR', limb: true });
  const headY = legH + torsoH + 0.17 * s;
  P.push({ x: 0, y: headY, z: 0, w: 0.3 * s, h: 0.32 * s, d: 0.3 * s, color: l.skin, mat: skinM, joint: 'head' });
  if (l.helmet) P.push({ x: 0, y: headY + 0.16 * s, z: 0, w: 0.34 * s, h: 0.14 * s, d: 0.34 * s, color: 0x9a9aa4, mat: M.METAL, joint: 'head' });
  else if (l.hood) P.push({ x: 0, y: headY + 0.08 * s, z: 0.03, w: 0.36 * s, h: 0.4 * s, d: 0.34 * s, color: l.shirt, mat: M.CLOTH, joint: 'head' });
  else P.push({ x: 0, y: headY + 0.14 * s, z: 0.02, w: 0.32 * s, h: 0.08 * s, d: 0.32 * s, color: l.hair, mat: M.FUR, joint: 'head' });
  if (l.weapon) {
    const len = l.weapon === 'lance' || l.weapon === 'bâton' ? 1.8 : l.weapon === 'dague' ? 0.35 : 0.9;
    const wcol = l.weapon === 'bâton' || l.weapon === 'massue' ? 0x6a4a2a : 0xb8b8c0;
    P.push({ x: 0.33 * s, y: legH + torsoH - 0.03, z: -0.06, w: l.weapon === 'hache' || l.weapon === 'massue' ? 0.16 : 0.07, h: armH + len, d: 0.07, color: wcol, mat: l.weapon === 'bâton' || l.weapon === 'massue' ? M.WOOD : M.METAL, joint: 'weapon', limb: true });
  }
  if (l.shield) P.push({ x: -0.42 * s, y: legH + torsoH * 0.5, z: -0.1, w: 0.08, h: 0.7, d: 0.55, color: 0x6a4a2a, mat: M.WOOD, joint: 'armL' });
  return { parts: P, letter: l.letter ?? '@', height: (legH + torsoH + 0.35 * s) * 1.05, radius: 0.32 * s, quad: false };
}

function quadruped(color: number, size: number, letter: string, mat: number = M.FUR): ModelDef {
  const s = size, P: Part[] = [];
  P.push({ x: 0, y: 0.62 * s, z: 0, w: 0.38 * s, h: 0.36 * s, d: 1.05 * s, color, mat, joint: 'body' });
  P.push({ x: 0, y: 0.82 * s, z: -0.62 * s, w: 0.3 * s, h: 0.28 * s, d: 0.34 * s, color, mat, joint: 'head' });
  P.push({ x: 0, y: 0.76 * s, z: -0.86 * s, w: 0.15 * s, h: 0.13 * s, d: 0.2 * s, color: 0x3a3632, mat, joint: 'head' });
  for (const sx of [-0.1, 0.1]) P.push({ x: sx * s, y: 1.0 * s, z: -0.58 * s, w: 0.07 * s, h: 0.12 * s, d: 0.05 * s, color, mat, joint: 'head' });
  const legs: [number, number, Joint][] = [[-0.14, -0.38, 'legL'], [0.14, -0.38, 'legR'], [-0.14, 0.38, 'legR'], [0.14, 0.38, 'legL']];
  for (const [x, z, j] of legs) P.push({ x: x * s, y: 0.5 * s, z: z * s, w: 0.11 * s, h: 0.5 * s, d: 0.12 * s, color, mat, joint: j, limb: true });
  P.push({ x: 0, y: 0.72 * s, z: 0.55 * s, w: 0.09 * s, h: 0.45 * s, d: 0.09 * s, color, mat, joint: 'tail', limb: true });
  return { parts: P, letter, height: 1.0 * s, radius: 0.45 * s, quad: true };
}

function spider(color: number, size: number): ModelDef {
  const s = size, P: Part[] = [];
  P.push({ x: 0, y: 0.55 * s, z: 0.2 * s, w: 0.8 * s, h: 0.5 * s, d: 0.9 * s, color, mat: M.FUR, joint: 'body' });
  P.push({ x: 0, y: 0.5 * s, z: -0.45 * s, w: 0.45 * s, h: 0.35 * s, d: 0.4 * s, color: 0x2a2020, mat: M.FUR, joint: 'head' });
  for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
    P.push({ x: side * 0.62 * s, y: 0.36 * s, z: (-0.35 + i * 0.25) * s, w: 0.9 * s, h: 0.07 * s, d: 0.07 * s, color, mat: M.FUR, ry: side * (0.5 - i * 0.33), joint: i % 2 === (side > 0 ? 0 : 1) ? 'legL' : 'legR' });
  }
  return { parts: P, letter: 'a', height: 0.8 * s, radius: 0.7 * s, quad: true };
}

const MODEL_CACHE = new Map<string, ModelDef>();

/** Modèles des créatures (les humains passent par humanoid() avec leurs couleurs). */
export function creatureModel(type: string): ModelDef {
  let m = MODEL_CACHE.get(type);
  if (m) return m;
  switch (type) {
    case 'loup': m = quadruped(0x6a6a66, 1, 'w'); break;
    case 'araignée': m = spider(0x2e2a26, 1.1); break;
    case 'gobelin': m = humanoid({ skin: 0x5a8a3a, shirt: 0x5a4a2a, pants: 0x3a3020, hair: 0x2a2a1a, scale: 0.62, weapon: 'dague', letter: 'g' }); break;
    case 'chef gobelin': m = humanoid({ skin: 0x4a7a2a, shirt: 0x7a2a2a, pants: 0x3a3020, hair: 0x2a2a1a, scale: 0.85, weapon: 'hache', shield: true, letter: 'G' }); break;
    case 'squelette': m = humanoid({ skin: 0xd8d0b8, shirt: 0xc8c0a8, pants: 0xc8c0a8, hair: 0xd8d0b8, mat: M.BONE, weapon: 'épée', letter: 's', scale: 0.95 }); break;
    case 'roi-squelette': case 'gardien des tombes': m = humanoid({ skin: 0xe0d8c0, shirt: 0x6a5a8a, pants: 0xc8c0a8, hair: 0xd8b040, mat: M.BONE, weapon: 'épée', shield: true, helmet: type === 'gardien des tombes', letter: 'S', scale: 1.15 }); break;
    case 'spectre': m = humanoid({ skin: 0xb0c8d8, shirt: 0x8aa0b8, pants: 0x8aa0b8, hair: 0xb0c8d8, robe: true, noLegs: true, letter: 'W' }); break;
    case 'troll': m = humanoid({ skin: 0x6a7a5a, shirt: 0x5a4a32, pants: 0x4a3a28, hair: 0x2a2a20, scale: 1.75, weapon: 'massue', letter: 'T' }); break;
    case 'bandit': m = humanoid({ skin: 0xc89870, shirt: 0x4a3a2a, pants: 0x2e2a24, hair: 0x2a1a10, hood: true, weapon: 'épée', letter: 'B' }); break;
    case 'chef bandit': m = humanoid({ skin: 0xc89870, shirt: 0x6a2a2a, pants: 0x2e2a24, hair: 0x2a1a10, helmet: true, weapon: 'hache', shield: true, letter: 'B', scale: 1.08 }); break;
    default: m = humanoid({ skin: 0xc89870, shirt: 0x6a6a6a, pants: 0x3a3a3a, hair: 0x2a1a10 });
  }
  MODEL_CACHE.set(type, m);
  return m;
}

const tmp = mat4();

/** Écrit les pièces animées d'un modèle dans le tampon d'instances. */
export function drawModel(ib: InstanceBuffer, model: ModelDef, x: number, y: number, z: number, heading: number, pose: Pose, flags = 0): void {
  const yawM = -heading;
  const c = Math.cos(yawM), s = Math.sin(yawM);
  const rootPitch = -pose.dead * Math.PI / 2 * (model.quad ? 0 : 1);
  const roll = model.quad ? pose.dead * 1.4 : 0;
  const cr = Math.cos(rootPitch), sr = Math.sin(rootPitch);
  const letter = model.letter.charCodeAt(0) - 31; // index du glyphe ASCII dans l'atlas
  const walkA = Math.sin(pose.walk) * (model.quad ? 0.6 : 0.55);
  for (const p of model.parts) {
    let pitch = 0;
    switch (p.joint) {
      case 'legL': pitch = walkA; break;
      case 'legR': pitch = -walkA; break;
      case 'armL': pitch = -walkA * 0.7 + pose.block * 1.2; break;
      case 'armR': case 'weapon': pitch = walkA * 0.7 + pose.swing * 1.9 - (pose.swing > 0 ? 0.3 : 0); break;
      case 'tail': pitch = -0.7 + Math.sin(pose.walk * 2) * 0.2; break;
      case 'head': pitch = model.quad ? 0 : Math.sin(pose.walk) * 0.03; break;
    }
    if (pose.dead > 0) pitch *= 1 - pose.dead;
    let lx = p.x, ly = p.y, lz = p.z;
    if (p.limb) { ly = p.y - (p.h / 2) * Math.cos(pitch); lz = p.z - (p.h / 2) * Math.sin(pitch); }
    if (pose.dead > 0 && model.quad) ly = ly * (1 - pose.dead * 0.55);
    // rotation de la racine (chute en arrière), puis cap
    const ry = ly * cr - lz * sr, rz = ly * sr + lz * cr;
    const wx = x + lx * c + rz * s, wz = z - lx * s + rz * c;
    trsYawPitch(tmp, wx, y + ry + pose.hover - (pose.dead > 0 && !model.quad ? -0.15 * pose.dead : 0), wz, yawM + (p.ry ?? 0) + roll * 0, rootPitch + pitch, p.w, p.h, p.d);
    ib.add(tmp, p.color, p.mat, letter, flags);
  }
}
