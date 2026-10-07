import { M } from '@ascii-fort/ascii-engine/Materials';
import { SHAPE } from '@ascii-fort/ascii-engine/Shapes';
import type { InstanceBuffer } from '@ascii-fort/ascii-engine/Renderer';

// Modèles procéduraux animés : un squelette (hanches, genoux, épaules, coudes, cou, mâchoire,
// queue…) habillé de volumes arrondis — sphères, troncs de cône, cylindres, cônes, boîtes.
// Aucune texture : forme et couleur suffisent une fois converties en glyphes. Au loin, le
// renderer remplace la silhouette par la lettre du modèle (style roguelike).

export interface Pose { walk: number; swing: number; dead: number; hover: number; block: number }

interface Rot { pitch: number; yaw: number; roll: number; dy: number }
/** Animation d'un os : écrit sa rotation (et son décalage vertical) selon la pose et le temps. */
type Anim = (p: Pose, t: number, r: Rot) => void;
interface Bone { parent: number; x: number; y: number; z: number; pitch: number; yaw: number; roll: number; anim?: Anim }
interface Part { bone: number; shape: number; x: number; y: number; z: number; w: number; h: number; d: number; pitch: number; yaw: number; roll: number; color: number; mat: number }
interface R3 { pitch?: number; yaw?: number; roll?: number }
/** Chute à la mort (et au coucher) : en avant, sur le côté, sur le dos. */
type Fall = 'avant' | 'côté' | 'dos';
export interface ModelDef { bones: Bone[]; parts: Part[]; letter: string; height: number; radius: number; quad: boolean; fall: Fall }

export type Weapon = 'épée' | 'lance' | 'hache' | 'massue' | 'bâton' | 'dague' | 'marteau' | 'pioche';
export interface HumanLook {
  skin: number; shirt: number; pants: number; hair: number;
  helmet?: boolean; robe?: boolean; hood?: boolean; weapon?: Weapon | null; shield?: boolean | number;
  scale?: number; mat?: number; letter?: string; noLegs?: boolean;
  /** silhouette : normale, massive (troll), squelette (os nus) ; dos voûté (gobelins, trolls) */
  build?: 'normal' | 'massif' | 'squelette'; hunch?: boolean;
  beard?: boolean; hairLong?: boolean; ears?: boolean; nose?: boolean; tusks?: boolean; crown?: boolean;
  /** couleurs optionnelles : tablier, cape, bottes, ceinture, capuche, yeux lumineux */
  apron?: number; cape?: number; boots?: number; belt?: number; hoodColor?: number; eyes?: number;
  /** arc tenu dans la main gauche (joueurs) */
  bow?: boolean;
  /** variété : coiffure, barbe, chapeau, robe longue, bras nus, tabard (couleur de faction + emblème) */
  hairStyle?: 'court' | 'long' | 'chignon' | 'queue' | 'chauve';
  beardStyle?: 'barbe' | 'moustache' | 'bouc';
  hat?: 'paille' | 'bonnet' | 'béret' | 'coiffe';
  hatColor?: number;
  dress?: boolean;
  bareArms?: boolean;
  tabard?: number;
  emblem?: number;
  /** visage visible de près (yeux, bouche, nez) */
  face?: boolean;
}

const { sin, abs, max, min, PI } = Math;
const LEATHER_DARK = 0x3a2a1c, STEEL = 0xc0c0c8, IRON = 0x8a8a94, WOODC = 0x6a4a2a;

class Rig {
  bones: Bone[] = [{ parent: -1, x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }];
  parts: Part[] = [];
  bone(parent: number, x: number, y: number, z: number, anim?: Anim, rest: R3 = {}): number {
    this.bones.push({ parent, x, y, z, pitch: rest.pitch ?? 0, yaw: rest.yaw ?? 0, roll: rest.roll ?? 0, anim });
    return this.bones.length - 1;
  }
  part(bone: number, shape: number, x: number, y: number, z: number, w: number, h: number, d: number, color: number, mat: number, rot: R3 = {}) {
    this.parts.push({ bone, shape, x, y, z, w, h, d, pitch: rot.pitch ?? 0, yaw: rot.yaw ?? 0, roll: rot.roll ?? 0, color, mat });
  }
  /** Segment de membre pendant sous l'articulation, bout étroit vers le bas. */
  limb(bone: number, len: number, w: number, d: number, color: number, mat: number, shape: number = SHAPE.TAPER) {
    this.part(bone, shape, 0, -len / 2, 0, w, -len, d, color, mat);
  }
  done(letter: string, height: number, radius: number, quad: boolean, fall: Fall): ModelDef {
    return { bones: this.bones, parts: this.parts, letter, height, radius, quad, fall };
  }
}

// ---------------------------------------------------------------- humanoïdes

function weapon(R: Rig, hand: number, kind: Weapon, s: number) {
  const upright = kind === 'lance' || kind === 'bâton';
  const g = R.bone(hand, 0, -0.03 * s, 0, undefined, { pitch: upright ? -0.15 : -1.25 });
  const grip = (len: number) => R.part(g, SHAPE.CYL, 0, 0.02, 0, 0.035, len, 0.035, LEATHER_DARK, M.LEATHER);
  switch (kind) {
    case 'épée':
      grip(0.15); R.part(g, SHAPE.SPHERE, 0, -0.07, 0, 0.05, 0.05, 0.05, IRON, M.METAL);
      R.part(g, SHAPE.BOX, 0, 0.1, 0, 0.2, 0.03, 0.04, IRON, M.METAL);
      R.part(g, SHAPE.BOX, 0, 0.5, 0, 0.055, 0.78, 0.015, STEEL, M.METAL);
      break;
    case 'dague':
      grip(0.1); R.part(g, SHAPE.BOX, 0, 0.06, 0, 0.1, 0.02, 0.03, IRON, M.METAL);
      R.part(g, SHAPE.BOX, 0, 0.2, 0, 0.04, 0.26, 0.012, STEEL, M.METAL);
      break;
    case 'hache':
      R.part(g, SHAPE.CYL, 0, 0.3, 0, 0.04, 0.85, 0.04, WOODC, M.WOOD);
      R.part(g, SHAPE.BOX, 0, 0.62, -0.09, 0.025, 0.22, 0.2, STEEL, M.METAL);
      break;
    case 'lance':
      R.part(g, SHAPE.CYL, 0, 0.45, 0, 0.035, 2.0, 0.035, WOODC, M.WOOD);
      R.part(g, SHAPE.CONE, 0, 1.56, 0, 0.07, 0.22, 0.07, STEEL, M.METAL);
      break;
    case 'bâton':
      R.part(g, SHAPE.CYL, 0, 0.35, 0, 0.045, 1.7, 0.045, WOODC, M.WOOD);
      R.part(g, SHAPE.SPHERE, 0, 1.22, 0, 0.08, 0.09, 0.08, WOODC, M.WOOD);
      break;
    case 'massue':
      R.part(g, SHAPE.TAPER, 0, 0.36, 0, 0.13, -0.74, 0.13, WOODC, M.WOOD);
      break;
    case 'pioche':
      R.part(g, SHAPE.CYL, 0, 0.3, 0, 0.04, 0.8, 0.04, WOODC, M.WOOD);
      R.part(g, SHAPE.CONE, 0, 0.66, -0.14, 0.05, 0.3, 0.05, IRON, M.METAL, { pitch: -PI / 2 });
      R.part(g, SHAPE.CONE, 0, 0.66, 0.14, 0.05, 0.3, 0.05, IRON, M.METAL, { pitch: PI / 2 });
      break;
    case 'marteau':
      R.part(g, SHAPE.CYL, 0, 0.22, 0, 0.035, 0.5, 0.035, WOODC, M.WOOD);
      R.part(g, SHAPE.BOX, 0, 0.47, 0, 0.08, 0.1, 0.2, 0x5a5a62, M.METAL);
      break;
  }
}

export function humanoid(l: HumanLook): ModelDef {
  const s = l.scale ?? 1, skel = l.build === 'squelette', massif = l.build === 'massif';
  const th = skel ? 0.5 : massif ? 1.35 : 1;          // épaisseur des membres
  const wid = massif ? 1.22 : skel ? 0.85 : 1;        // carrure
  const armK = (l.hunch ? 1.12 : 1) * (massif ? 1.1 : 1);
  const cloth = l.mat ?? (skel ? M.BONE : M.CLOTH), skinM = skel ? M.BONE : M.SKIN;
  const R = new Rig();
  const k = (p: Pose) => 1 - p.dead;

  const hips = R.bone(0, 0, 0.9 * s, 0, (p, t, r) => {
    r.dy = abs(sin(p.walk)) * 0.035 * s * k(p) + (l.noLegs ? sin(t * 2.1) * 0.07 : 0);
  });
  if (skel) R.part(hips, SHAPE.BOX, 0, 0, 0, 0.3 * s, 0.12 * s, 0.16 * s, l.skin, M.BONE);
  else R.part(hips, SHAPE.SPHERE, 0, 0, 0, 0.36 * s * wid, 0.24 * s, 0.24 * s, l.robe ? l.shirt : l.pants, cloth);

  // jambes : cuisse + tibia (genou), bottes
  if (!l.noLegs) for (const side of [-1, 1]) {
    const ph = side < 0 ? 0 : PI;
    const leg = l.robe ? l.shirt : l.pants;
    const thigh = R.bone(hips, side * 0.1 * s * wid, -0.02 * s, 0, (p, t, r) => { r.pitch = sin(p.walk + ph) * 0.55 * k(p); });
    R.limb(thigh, 0.46 * s, 0.17 * s * th, 0.18 * s * th, skel ? l.skin : leg, cloth);
    const knee = R.bone(thigh, 0, -0.46 * s, 0, (p, t, r) => { r.pitch = -max(0, -sin(p.walk + ph)) * 0.95 * k(p); });
    R.limb(knee, 0.42 * s, 0.13 * s * th, 0.14 * s * th, skel ? l.skin : leg, cloth);
    if (skel) R.part(knee, SHAPE.BOX, 0, -0.43 * s, -0.04 * s, 0.07 * s, 0.04 * s, 0.17 * s, l.skin, M.BONE);
    else R.part(knee, SHAPE.BOX, 0, -0.4 * s, -0.035 * s, 0.13 * s * th, 0.1 * s, 0.25 * s, l.boots ?? LEATHER_DARK, M.LEATHER);
  }
  if ((l.robe || l.dress) && !l.noLegs) R.part(hips, SHAPE.TAPER, 0, -0.43 * s, 0, 0.5 * s * wid, 0.9 * s, 0.42 * s, l.dress && !l.robe ? (l.hatColor ?? l.pants) : l.shirt, cloth);
  if (l.noLegs) R.part(hips, SHAPE.TAPER, 0, -0.45 * s, 0, 0.48 * s, -0.95 * s, 0.4 * s, l.shirt, cloth);

  // torse
  const spine = R.bone(hips, 0, 0.04 * s, 0, (p, t, r) => {
    const kk = k(p);
    r.pitch = (-0.06 * abs(sin(p.walk)) - p.swing * 0.12) * kk;
    r.yaw = (sin(p.walk) * 0.08 + p.swing * 0.35 - p.block * 0.2) * kk;
  }, { pitch: l.hunch ? -0.38 : 0 });
  if (skel) {
    R.part(spine, SHAPE.CYL, 0, 0.14 * s, 0.03 * s, 0.06 * s, 0.32 * s, 0.06 * s, l.skin, M.BONE);
    R.part(spine, SHAPE.SPHERE, 0, 0.36 * s, 0, 0.34 * s, 0.38 * s, 0.24 * s, l.shirt, M.BONE);
  } else {
    R.part(spine, SHAPE.TAPER, 0, 0.29 * s, 0, 0.44 * s * wid, -0.52 * s, 0.27 * s * wid, l.shirt, l.helmet ? M.METAL : cloth);
    R.part(spine, SHAPE.CYL, 0, 0.03 * s, 0, 0.38 * s * wid, 0.07 * s, 0.26 * s * wid, l.belt ?? LEATHER_DARK, M.LEATHER);
  }
  if (l.helmet) for (const side of [-1, 1]) R.part(spine, SHAPE.SPHERE, side * 0.24 * s * wid, 0.5 * s, 0, 0.2 * s, 0.14 * s, 0.22 * s, IRON, M.METAL);
  if (l.tabard !== undefined) {
    R.part(spine, SHAPE.BOX, 0, 0.2 * s, -0.142 * s * wid, 0.34 * s * wid, 0.62 * s, 0.02, l.tabard, M.CLOTH);
    R.part(spine, SHAPE.BOX, 0, 0.2 * s, 0.142 * s * wid, 0.34 * s * wid, 0.62 * s, 0.02, l.tabard, M.CLOTH);
    R.part(spine, SHAPE.BOX, 0, 0.3 * s, -0.155 * s * wid, 0.1 * s, 0.1 * s, 0.015, l.emblem ?? 0xe8d8a0, M.CLOTH, { roll: PI / 4 });
  }
  if (l.apron !== undefined) R.part(spine, SHAPE.BOX, 0, 0.08 * s, -0.145 * s * wid, 0.34 * s * wid, 0.66 * s, 0.02, l.apron, M.LEATHER);
  if (l.cape !== undefined) {
    const cape = R.bone(spine, 0, 0.53 * s, 0.15 * s * wid, (p, t, r) => { r.pitch = -(0.08 + abs(sin(p.walk)) * 0.2) * k(p); });
    R.part(cape, SHAPE.BOX, 0, -0.47 * s, 0, 0.44 * s * wid, 0.94 * s, 0.03, l.cape, M.CLOTH);
  }
  if (l.hood) R.part(spine, SHAPE.TAPER, 0, 0.5 * s, 0, 0.5 * s * wid, 0.15 * s, 0.34 * s * wid, l.hoodColor ?? l.shirt, M.CLOTH);
  if (!skel) R.part(spine, SHAPE.CYL, 0, 0.58 * s, 0, 0.1 * s * th, 0.1 * s, 0.1 * s * th, l.skin, skinM);

  // tête
  const head = R.bone(spine, 0, 0.6 * s, 0, (p, t, r) => {
    r.pitch = sin(p.walk * 2) * 0.03 * k(p);
    r.yaw = -p.swing * 0.2 * k(p);
  }, { pitch: l.hunch ? 0.34 : 0 });
  R.part(head, SHAPE.SPHERE, 0, 0.15 * s, 0, 0.25 * s, 0.29 * s, 0.27 * s, l.skin, skinM);
  if (skel) R.part(head, SHAPE.BOX, 0, 0.03 * s, -0.06 * s, 0.16 * s, 0.06 * s, 0.14 * s, l.skin, M.BONE);
  if (l.eyes !== undefined) for (const side of [-1, 1]) R.part(head, SHAPE.SPHERE, side * 0.055 * s, 0.17 * s, -0.12 * s, 0.05 * s, 0.05 * s, 0.04 * s, l.eyes, M.GLOW);
  if (l.nose) R.part(head, SHAPE.CONE, 0, 0.13 * s, -0.17 * s, 0.06 * s, 0.14 * s, 0.06 * s, l.skin, skinM, { pitch: -PI / 2 });
  if (l.ears) for (const side of [-1, 1]) R.part(head, SHAPE.CONE, side * 0.15 * s, 0.17 * s, 0.02 * s, 0.05 * s, 0.18 * s, 0.04 * s, l.skin, skinM, { roll: -side * 1.25 });
  if (l.tusks) for (const side of [-1, 1]) R.part(head, SHAPE.CONE, side * 0.06 * s, 0.05 * s, -0.12 * s, 0.03 * s, 0.08 * s, 0.03 * s, 0xe8e0c8, M.BONE);
  if (l.helmet) {
    R.part(head, SHAPE.SPHERE, 0, 0.21 * s, 0, 0.3 * s, 0.25 * s, 0.31 * s, 0x9a9aa4, M.METAL);
    R.part(head, SHAPE.CYL, 0, 0.16 * s, 0, 0.33 * s, 0.03 * s, 0.34 * s, IRON, M.METAL);
    R.part(head, SHAPE.BOX, 0, 0.12 * s, -0.145 * s, 0.03 * s, 0.11 * s, 0.02 * s, IRON, M.METAL);
  } else if (l.hood) R.part(head, SHAPE.SPHERE, 0, 0.18 * s, 0.025 * s, 0.32 * s, 0.33 * s, 0.32 * s, l.hoodColor ?? l.shirt, M.CLOTH);
  else if (!skel) {
    const st = l.hairStyle ?? (l.hairLong ? 'long' : 'court');
    if (st !== 'chauve') R.part(head, SHAPE.SPHERE, 0, 0.21 * s, 0.015 * s, 0.27 * s, 0.21 * s, 0.29 * s, l.hair, M.FUR);
    else R.part(head, SHAPE.SPHERE, 0, 0.13 * s, 0.05 * s, 0.27 * s, 0.12 * s, 0.22 * s, l.hair, M.FUR);
    if (st === 'long') R.part(head, SHAPE.BOX, 0, 0.06 * s, 0.11 * s, 0.25 * s, 0.3 * s, 0.07 * s, l.hair, M.FUR);
    if (st === 'chignon') R.part(head, SHAPE.SPHERE, 0, 0.27 * s, 0.12 * s, 0.13 * s, 0.12 * s, 0.13 * s, l.hair, M.FUR);
    if (st === 'queue') R.part(head, SHAPE.TAPER, 0, 0.06 * s, 0.14 * s, 0.08 * s, -0.32 * s, 0.08 * s, l.hair, M.FUR, { pitch: 0.25 });
    // chapeaux
    const hc = l.hatColor ?? 0x6a4a3a;
    if (l.hat === 'paille') { R.part(head, SHAPE.CYL, 0, 0.27 * s, 0, 0.52 * s, 0.03 * s, 0.52 * s, 0xd8c070, M.THATCH); R.part(head, SHAPE.CYL, 0, 0.33 * s, 0, 0.27 * s, 0.12 * s, 0.27 * s, 0xc8b060, M.THATCH); }
    else if (l.hat === 'bonnet') R.part(head, SHAPE.SPHERE, 0, 0.27 * s, 0.02 * s, 0.29 * s, 0.18 * s, 0.3 * s, hc, M.CLOTH);
    else if (l.hat === 'béret') R.part(head, SHAPE.SPHERE, 0.04 * s, 0.3 * s, 0, 0.32 * s, 0.09 * s, 0.32 * s, hc, M.CLOTH);
    else if (l.hat === 'coiffe') { R.part(head, SHAPE.SPHERE, 0, 0.22 * s, 0.03 * s, 0.31 * s, 0.25 * s, 0.32 * s, 0xe8e4d8, M.CLOTH); R.part(head, SHAPE.BOX, 0, 0.02 * s, 0.13 * s, 0.24 * s, 0.3 * s, 0.04 * s, 0xe8e4d8, M.CLOTH); }
  }
  if (l.face && !skel) {
    // yeux, sourcils, nez, bouche : lisibles de près
    for (const side of [-1, 1]) {
      R.part(head, SHAPE.BOX, side * 0.055 * s, 0.17 * s, -0.128 * s, 0.035 * s, 0.025 * s, 0.012, 0x1a1410, M.LEATHER);
      if (!l.helmet) R.part(head, SHAPE.BOX, side * 0.055 * s, 0.205 * s, -0.126 * s, 0.05 * s, 0.012 * s, 0.012, l.hair, M.FUR);
    }
    R.part(head, SHAPE.BOX, 0, 0.125 * s, -0.142 * s, 0.03 * s, 0.05 * s, 0.03 * s, l.skin, skinM);
    R.part(head, SHAPE.BOX, 0, 0.075 * s, -0.128 * s, 0.07 * s, 0.014 * s, 0.012, 0x6a3a30, M.LEATHER);
  }
  if (l.beard || l.beardStyle) {
    const bs = l.beardStyle ?? 'barbe';
    if (bs === 'barbe') R.part(head, SHAPE.SPHERE, 0, 0.05 * s, -0.085 * s, 0.2 * s, 0.17 * s, 0.12 * s, l.hair, M.FUR);
    else if (bs === 'moustache') R.part(head, SHAPE.BOX, 0, 0.095 * s, -0.135 * s, 0.11 * s, 0.025 * s, 0.02 * s, l.hair, M.FUR);
    else R.part(head, SHAPE.TAPER, 0, 0.02 * s, -0.11 * s, 0.07 * s, -0.12 * s, 0.06 * s, l.hair, M.FUR);
  }
  if (l.crown) R.part(head, SHAPE.CYL, 0, 0.31 * s, 0, 0.22 * s, 0.07 * s, 0.22 * s, 0xd8b040, M.METAL);

  // bras : épaule + coude, main ; arme à droite, bouclier ou arc à gauche
  for (const side of [-1, 1]) {
    const right = side > 0, legPh = right ? PI : 0;
    const sh = R.bone(spine, side * 0.25 * s * wid, 0.5 * s, 0, (p, t, r) => {
      const kk = k(p), walk = -sin(p.walk + legPh) * 0.5;
      if (right) { r.pitch = (walk * (1 - p.swing) + p.swing * 2.5) * kk; r.roll = (side * 0.08 - p.swing * 0.25) * kk; }
      else { r.pitch = (walk * (1 - p.block) + p.block * 1.15) * kk; r.yaw = -p.block * 0.55 * kk; r.roll = side * 0.08 * kk; }
    });
    const sleeve = skel ? l.skin : l.shirt;
    R.limb(sh, 0.3 * s * armK, 0.11 * s * th, 0.12 * s * th, sleeve, cloth);
    const el = R.bone(sh, 0, -0.3 * s * armK, 0, (p, t, r) => {
      r.pitch = (0.2 + max(0, sin(p.walk + legPh)) * 0.25 + (right ? p.swing * 0.6 : p.block * 1.0)) * k(p);
    });
    R.limb(el, 0.27 * s * armK, 0.095 * s * th, 0.1 * s * th, l.bareArms ? l.skin : sleeve, l.bareArms ? skinM : cloth);
    const hand = R.bone(el, 0, -0.28 * s * armK, 0);
    const hs = massif ? 1.4 : skel ? 0.8 : 1;
    R.part(hand, SHAPE.SPHERE, 0, -0.02 * s, 0, 0.09 * s * hs, 0.1 * s * hs, 0.08 * s * hs, l.skin, skinM);
    if (right && l.weapon) weapon(R, hand, l.weapon, s);
    if (!right && l.shield) {
      const sb = R.bone(el, -0.07 * s, -0.15 * s, 0, undefined, { yaw: -0.5 });
      const metal = typeof l.shield === 'number';
      R.part(sb, SHAPE.CYL, 0, 0, 0, 0.56, 0.05, 0.56, metal ? (l.shield as number) : WOODC, metal ? M.METAL : M.WOOD, { roll: PI / 2 });
      R.part(sb, SHAPE.SPHERE, -0.035, 0, 0, 0.05, 0.12, 0.12, IRON, M.METAL);
    }
    if (!right && l.bow && !l.shield) {
      const b = R.bone(hand, 0, -0.02 * s, 0);
      R.part(b, SHAPE.CYL, 0, 0.3, -0.04, 0.03, 0.62, 0.03, WOODC, M.WOOD, { pitch: -0.28 });
      R.part(b, SHAPE.CYL, 0, -0.3, -0.04, 0.03, 0.62, 0.03, WOODC, M.WOOD, { pitch: 0.28 });
      R.part(b, SHAPE.CYL, 0, 0, 0.04, 0.008, 1.15, 0.008, 0xd8d0b8, M.CLOTH);
    }
  }
  return R.done(l.letter ?? '@', 1.82 * s, 0.32 * s * wid, false, 'avant');
}

// ---------------------------------------------------------------- quadrupèdes et araignées

function quadruped(color: number, s: number, letter: string, mat: number = M.FUR, mane = color, snoutC = 0x3a3632, extra?: (R: Rig, head: number) => void, legK = 1): ModelDef {
  const R = new Rig();
  const k = (p: Pose) => 1 - p.dead;
  const body = R.bone(0, 0, 0.62 * s * legK, 0, (p, t, r) => { r.dy = abs(sin(p.walk)) * 0.03 * s * k(p); r.pitch = sin(p.walk * 2) * 0.03 * k(p); });
  R.part(body, SHAPE.SPHERE, 0, 0.02 * s, -0.18 * s, 0.36 * s, 0.38 * s, 0.62 * s, color, mat);
  R.part(body, SHAPE.SPHERE, 0, 0.03 * s, 0.26 * s, 0.3 * s, 0.3 * s, 0.56 * s, color, mat);
  R.part(body, SHAPE.SPHERE, 0, 0.08 * s, -0.33 * s, 0.4 * s, 0.4 * s, 0.36 * s, mane, mat);
  const neck = R.bone(body, 0, 0.12 * s, -0.42 * s, (p, t, r) => { r.pitch = (sin(p.walk * 2) * 0.04 - p.swing * 0.35) * k(p); });
  R.part(neck, SHAPE.TAPER, 0, 0.06 * s, -0.06 * s, 0.2 * s, 0.26 * s, 0.2 * s, mane, mat, { pitch: -1.0 });
  const head = R.bone(neck, 0, 0.14 * s, -0.16 * s);
  R.part(head, SHAPE.SPHERE, 0, 0, 0, 0.25 * s, 0.22 * s, 0.28 * s, color, mat);
  R.part(head, SHAPE.TAPER, 0, -0.03 * s, -0.2 * s, 0.13 * s, 0.22 * s, 0.11 * s, color, mat, { pitch: -PI / 2 });
  R.part(head, SHAPE.SPHERE, 0, -0.01 * s, -0.31 * s, 0.05 * s, 0.045 * s, 0.05 * s, snoutC, mat);
  for (const side of [-1, 1]) R.part(head, SHAPE.CONE, side * 0.075 * s, 0.12 * s, 0.04 * s, 0.07 * s, 0.13 * s, 0.05 * s, color, mat);
  const jaw = R.bone(head, 0, -0.07 * s, -0.08 * s, (p, t, r) => { r.pitch = -p.swing * 0.6 * k(p); });
  R.part(jaw, SHAPE.BOX, 0, -0.01 * s, -0.12 * s, 0.1 * s, 0.04 * s, 0.2 * s, color, mat);
  const legs: [number, number, number][] = [[-1, -1, 0], [1, -1, PI], [-1, 1, PI], [1, 1, 0]];
  for (const [side, fb, ph] of legs) {
    const hip = R.bone(body, side * 0.11 * s, -0.07 * s, fb < 0 ? -0.3 * s : 0.32 * s, (p, t, r) => { r.pitch = sin(p.walk + ph) * 0.6 * k(p); });
    R.limb(hip, 0.28 * s * legK, (fb < 0 ? 0.11 : 0.14) * s, (fb < 0 ? 0.12 : 0.16) * s, color, mat);
    const low = R.bone(hip, 0, -0.28 * s * legK, 0, (p, t, r) => { r.pitch = -max(0, -sin(p.walk + ph)) * 0.8 * k(p); });
    R.limb(low, 0.29 * s * legK, 0.07 * s, 0.075 * s, color, mat);
    R.part(low, SHAPE.SPHERE, 0, -0.29 * s * legK, -0.03 * s, 0.08 * s, 0.05 * s, 0.1 * s, color, mat);
  }
  const tail = R.bone(body, 0, 0.1 * s, 0.55 * s, (p, t, r) => { r.yaw = sin(t * 7 + s) * 0.25 * k(p); r.pitch = -sin(p.walk) * 0.1 * k(p); }, { pitch: 2.0 });
  R.part(tail, SHAPE.TAPER, 0, 0.19 * s, 0, 0.11 * s, 0.4 * s * (legK > 1 ? 0.4 : 1), 0.11 * s, color, mat);
  extra?.(R, head);
  return R.done(letter, 1.0 * s * legK, 0.45 * s, true, 'côté');
}

function bird(color: number, wing: number, s: number, letter: string): ModelDef {
  const R = new Rig();
  const body = R.bone(0, 0, 0.2 * s, 0, (p, t, r) => { r.dy = abs(sin(p.walk * 2)) * 0.02 * s * (1 - p.dead); r.pitch = -min(1, p.hover) * 0.15; });
  R.part(body, SHAPE.SPHERE, 0, 0, 0, 0.26 * s, 0.22 * s, 0.36 * s, color, M.FUR);
  R.part(body, SHAPE.SPHERE, 0, 0.13 * s, -0.18 * s, 0.15 * s, 0.15 * s, 0.15 * s, color, M.FUR);
  R.part(body, SHAPE.CONE, 0, 0.12 * s, -0.28 * s, 0.04 * s, 0.07 * s, 0.04 * s, 0xc89040, M.BONE, { pitch: -PI / 2 });
  R.part(body, SHAPE.BOX, 0, 0.03 * s, 0.2 * s, 0.14 * s, 0.03 * s, 0.14 * s, wing, M.FUR, { pitch: -0.3 });
  for (const side of [-1, 1]) {
    const w = R.bone(body, side * 0.11 * s, 0.05 * s, 0, (p, t, r) => { const fly = min(1, p.hover); r.roll = side * fly * (0.3 + sin(t * 26) * 0.9) * (1 - p.dead); });
    R.part(w, SHAPE.BOX, side * 0.14 * s, 0, 0, 0.3 * s, 0.03 * s, 0.22 * s, wing, M.FUR);
    R.part(body, SHAPE.CYL, side * 0.05 * s, -0.15 * s, 0.02 * s, 0.02 * s, 0.13 * s, 0.02 * s, 0xc89040, M.BONE);
  }
  return R.done(letter, 0.38 * s, 0.2 * s, true, 'côté');
}

function spider(color: number, s: number): ModelDef {
  const R = new Rig();
  const body = R.bone(0, 0, 0.5 * s, 0, (p, t, r) => { r.dy = abs(sin(p.walk * 1.3)) * 0.02 * s; });
  R.part(body, SHAPE.SPHERE, 0, 0.1 * s, 0.32 * s, 0.7 * s, 0.56 * s, 0.8 * s, color, M.FUR);
  R.part(body, SHAPE.SPHERE, 0, 0, -0.2 * s, 0.42 * s, 0.3 * s, 0.42 * s, 0x2a2020, M.FUR);
  for (const side of [-1, 1]) {
    R.part(body, SHAPE.SPHERE, side * 0.06 * s, 0.08 * s, -0.4 * s, 0.05 * s, 0.05 * s, 0.04 * s, 0xff4030, M.GLOW);
    R.part(body, SHAPE.CONE, side * 0.06 * s, -0.12 * s, -0.4 * s, 0.05 * s, 0.14 * s, 0.05 * s, 0x1a1414, M.BONE, { pitch: PI });
  }
  for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
    const ph = (i % 2 ? PI : 0) + (side > 0 ? PI : 0);
    const hip = R.bone(body, side * 0.16 * s, -0.02 * s, (-0.3 + i * 0.13) * s, (p, t, r) => {
      const kk = 1 - p.dead;
      r.yaw = sin(p.walk * 1.3 + ph) * 0.28 * kk;
      r.roll = side * (max(0, sin(p.walk * 1.3 + ph + PI / 2)) * 0.25 * kk + p.dead * 0.6);
    }, { yaw: side * (0.55 - i * 0.37), roll: side * 2.2 });
    R.limb(hip, 0.42 * s, 0.065 * s, 0.065 * s, color, M.FUR);
    const knee = R.bone(hip, 0, -0.42 * s, 0, (p, t, r) => { r.roll = -side * p.dead * 1.3; }, { roll: -side * 1.75 });
    R.limb(knee, 0.82 * s, 0.05 * s, 0.05 * s, color, M.FUR);
  }
  return R.done('a', 0.8 * s, 0.7 * s, true, 'dos');
}

const MODEL_CACHE = new Map<string, ModelDef>();

/** Modèles des créatures (les humains passent par humanoid() avec leurs couleurs). */
export function creatureModel(type: string): ModelDef {
  let m = MODEL_CACHE.get(type);
  if (m) return m;
  switch (type) {
    case 'loup': m = quadruped(0x6a6a66, 1, 'w', M.FUR, 0x5a5a56); break;
    case 'araignée': m = spider(0x2e2a26, 1.1); break;
    case 'cerf': m = quadruped(0x8a6440, 1.05, 'c', M.FUR, 0x7a5636, 0x2a2420, (R, head) => {
      // ramure : deux merrains et leurs andouillers
      for (const side of [-1, 1]) {
        R.part(head, SHAPE.CYL, side * 0.1, 0.27, 0.04, 0.03, 0.36, 0.03, 0xd8c8a0, M.BONE, { roll: -side * 0.45 });
        R.part(head, SHAPE.CYL, side * 0.2, 0.47, 0.0, 0.025, 0.24, 0.025, 0xd8c8a0, M.BONE, { roll: side * 0.1, pitch: -0.5 });
        R.part(head, SHAPE.CYL, side * 0.24, 0.46, 0.1, 0.025, 0.22, 0.025, 0xd8c8a0, M.BONE, { roll: -side * 0.6 });
      }
    }, 1.3); break;
    case 'sanglier': m = quadruped(0x4a3a2c, 0.82, 'b', M.FUR, 0x2e241c, 0x6a4a40, (R, head) => {
      for (const side of [-1, 1]) R.part(head, SHAPE.CONE, side * 0.06, -0.04, -0.27, 0.03, 0.1, 0.03, 0xe8e0c8, M.BONE, { pitch: -0.5 });
    }, 0.8); break;
    case 'perdrix': m = bird(0x8a7458, 0x6a5a48, 1, 'p'); break;
    case 'gobelin': m = humanoid({ skin: 0x5a8a3a, shirt: 0x5a4a2a, pants: 0x3a3020, hair: 0x2a2a1a, scale: 0.62, weapon: 'dague', letter: 'g', hunch: true, ears: true, nose: true, eyes: 0xffd040 }); break;
    case 'chef gobelin': m = humanoid({ skin: 0x4a7a2a, shirt: 0x7a2a2a, pants: 0x3a3020, hair: 0x2a2a1a, scale: 0.85, weapon: 'hache', shield: true, letter: 'G', hunch: true, ears: true, nose: true, eyes: 0xffd040, crown: true }); break;
    case 'squelette': m = humanoid({ skin: 0xd8d0b8, shirt: 0xc8c0a8, pants: 0xc8c0a8, hair: 0xd8d0b8, build: 'squelette', weapon: 'épée', letter: 's', scale: 0.95, eyes: 0x60d0ff }); break;
    case 'roi-squelette': case 'gardien des tombes': m = humanoid({ skin: 0xe0d8c0, shirt: 0xc8c0a8, pants: 0xc8c0a8, hair: 0xd8b040, build: 'squelette', weapon: 'épée', shield: IRON, helmet: type === 'gardien des tombes', crown: type === 'roi-squelette', cape: 0x4a3a6a, letter: 'S', scale: 1.15, eyes: 0x60d0ff }); break;
    case 'spectre': m = humanoid({ skin: 0x9ab0c8, shirt: 0x8aa0b8, pants: 0x8aa0b8, hair: 0xb0c8d8, hood: true, hoodColor: 0x6a7a90, noLegs: true, letter: 'W', eyes: 0x80e8ff }); break;
    case 'troll': m = humanoid({ skin: 0x6a7a5a, shirt: 0x5a4a32, pants: 0x4a3a28, hair: 0x2a2a20, scale: 1.75, weapon: 'massue', letter: 'T', build: 'massif', hunch: true, tusks: true, nose: true }); break;
    case 'bandit': m = humanoid({ skin: 0xc89870, shirt: 0x4a3a2a, pants: 0x2e2a24, hair: 0x2a1a10, hood: true, hoodColor: 0x3a3428, weapon: 'épée', letter: 'B' }); break;
    case 'chef bandit': m = humanoid({ skin: 0xc89870, shirt: 0x6a2a2a, pants: 0x2e2a24, hair: 0x2a1a10, helmet: true, weapon: 'hache', shield: true, cape: 0x5a1a1a, beard: true, letter: 'B', scale: 1.08 }); break;
    default: m = humanoid({ skin: 0xc89870, shirt: 0x6a6a6a, pants: 0x3a3a3a, hair: 0x2a1a10 });
  }
  MODEL_CACHE.set(type, m);
  return m;
}

// ---------------------------------------------------------------- évaluation et dessin

// Affines 3×4 en colonnes (rotation·échelle puis translation), calculées sans allocation.
const MAX_BONES = 64;
const BW = new Float64Array(12 * MAX_BONES);
const LOC = new Float64Array(12), PM = new Float64Array(12);
const OUT = new Float32Array(16); OUT[15] = 1;
const ROT: Rot = { pitch: 0, yaw: 0, roll: 0, dy: 0 };

/** o = T(t) · Ry(yaw) · Rx(pitch) · Rz(roll) · S(s) */
function setLocal(o: Float64Array, tx: number, ty: number, tz: number, yaw: number, pitch: number, roll: number, sx = 1, sy = 1, sz = 1) {
  const cy = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  o[0] = (cy * cr + syw * sp * sr) * sx; o[1] = cp * sr * sx; o[2] = (-syw * cr + cy * sp * sr) * sx;
  o[3] = (-cy * sr + syw * sp * cr) * sy; o[4] = cp * cr * sy; o[5] = (syw * sr + cy * sp * cr) * sy;
  o[6] = syw * cp * sz; o[7] = -sp * sz; o[8] = cy * cp * sz;
  o[9] = tx; o[10] = ty; o[11] = tz;
}

/** out[oo..] = P[po..] × L */
function compose(out: Float64Array, oo: number, P: Float64Array, po: number, L: Float64Array) {
  for (let c = 0; c < 4; c++) {
    const x = L[c * 3], y = L[c * 3 + 1], z = L[c * 3 + 2];
    for (let r = 0; r < 3; r++) out[oo + c * 3 + r] = P[po + r] * x + P[po + 3 + r] * y + P[po + 6 + r] * z + (c === 3 ? P[po + 9 + r] : 0);
  }
}

/** Écrit les pièces animées d'un modèle dans le tampon d'instances. */
export function drawModel(ib: InstanceBuffer, model: ModelDef, x: number, y: number, z: number, heading: number, pose: Pose, flags = 0, t = performance.now() / 1000): void {
  const letter = model.letter.charCodeAt(0) - 31; // index du glyphe ASCII dans l'atlas
  const d = pose.dead, f = model.fall;
  const lift = f === 'avant' ? 0.12 * d : f === 'dos' ? d * model.height * 0.9 : 0;
  setLocal(BW, x, y + pose.hover + lift, z, -heading, f === 'avant' ? -d * PI / 2 : 0, f === 'côté' ? d * 1.45 : f === 'dos' ? d * PI : 0);
  const bones = model.bones;
  for (let i = 1; i < bones.length && i < MAX_BONES; i++) {
    const b = bones[i];
    ROT.pitch = 0; ROT.yaw = 0; ROT.roll = 0; ROT.dy = 0;
    if (b.anim) b.anim(pose, t, ROT);
    setLocal(LOC, b.x, b.y + ROT.dy, b.z, b.yaw + ROT.yaw, b.pitch + ROT.pitch, b.roll + ROT.roll);
    compose(BW, i * 12, BW, b.parent * 12, LOC);
  }
  for (const p of model.parts) {
    setLocal(LOC, p.x, p.y, p.z, p.yaw, p.pitch, p.roll, p.w, p.h, p.d);
    compose(PM, 0, BW, p.bone * 12, LOC);
    OUT[0] = PM[0]; OUT[1] = PM[1]; OUT[2] = PM[2];
    OUT[4] = PM[3]; OUT[5] = PM[4]; OUT[6] = PM[5];
    OUT[8] = PM[6]; OUT[9] = PM[7]; OUT[10] = PM[8];
    OUT[12] = PM[9]; OUT[13] = PM[10]; OUT[14] = PM[11];
    ib.add(OUT, p.color, p.mat, letter, flags, 1, p.shape);
  }
}
