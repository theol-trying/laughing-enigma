import type { WorldSeed } from '@ascii-fort/core/Seed';
import { MIN_PER_DAY } from '@ascii-fort/core/Time';
import { NameGen } from '@ascii-fort/worldgen/civilization/Names';
import { DUNGEON_ORIGIN_X } from '@ascii-fort/worldgen/constants';

// Compagnons du joueur : cheval (monture) et mercenaire. Données, prix, contrat, endurance, états
// sauvegardables et leur assainissement. Logique pure (ni DOM, ni Math.random) : tout ce qui se teste
// vit ici ; l'IA est dans ai/AllyAI.ts, l'orchestration (touches, achats, sauvegarde) dans src/game/Possessions.ts.

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const round5 = (n: number) => Math.round(n / 5) * 5;
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---------------------------------------------------------------- cheval

export type HorseGradeId = 'bidet' | 'palefroi' | 'destrier';
export interface HorseGrade { id: HorseGradeId; price: number; hp: number; stamina: number; trot: number; gallop: number; drain: number; armor: number }
/** vitesses en m/s (le joueur marche à 4,2 et court à 7) ; drain : endurance perdue par seconde de galop */
export const HORSE_GRADES: Record<HorseGradeId, HorseGrade> = {
  bidet: { id: 'bidet', price: 400, hp: 70, stamina: 80, trot: 7.5, gallop: 11, drain: 10, armor: 0 },
  palefroi: { id: 'palefroi', price: 500, hp: 90, stamina: 100, trot: 8, gallop: 12.5, drain: 9, armor: 1 },
  destrier: { id: 'destrier', price: 600, hp: 120, stamina: 120, trot: 8.5, gallop: 14, drain: 8, armor: 2 },
};
/** robes : corps et crinière (le modèle les lit) */
export const COATS = [
  { name: 'bai', body: 0x7a4a2a, mane: 0x1e1612 }, { name: 'alezan', body: 0xa8602c, mane: 0xc8924a },
  { name: 'gris', body: 0x9a9a98, mane: 0x6a6a6a }, { name: 'noir', body: 0x24201e, mane: 0x14110f },
  { name: 'palomino', body: 0xd2a458, mane: 0xeee0b8 }, { name: 'blanc', body: 0xe0ddd2, mane: 0xcfcab8 },
];
export const HORSE_NAMES = ['Braise', 'Orage', 'Fumée', 'Châtaigne', 'Sirocco', 'Nuage', 'Tempête', 'Étoile', 'Brume', 'Galant', 'Bruyère', 'Cendre'];

export const MOUNT = {
  lift: 0.6,                       // hauteur d'œil ajoutée par la selle (m) = hauteur du cavalier sur le dos du cheval
  radius: 0.6,                     // rayon de collision monté
  strafe: 0.6, back: 0.4,          // vitesse latérale et arrière, en fraction de l'allure
  trotRegen: 5, idleRegen: 14,     // endurance regagnée par seconde au trot / à l'arrêt
  recover: 0.3,                    // essoufflé : le galop revient à 30 % d'endurance
  hpRegen: 0.5, calm: 10,          // PV par seconde, après 10 s sans coup reçu
  limpHp: 0.25, limpMul: 0.75,     // sous 25 % de PV : boite (vitesse ×0,75)
  throwHp: 0.15, fleeHp: 0.4,      // à 15 % de PV monté : il désarçonne et fuit ; à pied sous 40 % : il fuit
  hurtShare: 0.3, fallDamage: 6,   // part des coups reçus par le cavalier qui va au cheval ; chute si le cheval meurt
  mountRange: 3.5, whistleRange: 120, farFreeze: 200, corpse: 60, stopDist: 2.6, stuckGiveUp: 3, fleeSeconds: 6,
} as const;

export type Gait = 'arret' | 'trot' | 'galop';
export function gaitOf(speed: number, sprinting: boolean): Gait { return speed < 0.8 ? 'arret' : sprinting ? 'galop' : 'trot'; }

/** Endurance du cheval : le galop la vide ; à zéro il est essoufflé (plus de galop) jusqu'à 30 % ; le trot et l'arrêt la rendent. */
export function tickHorse(h: { stamina: number; maxStamina: number; winded: boolean }, g: HorseGrade, dt: number, gait: Gait): void {
  if (gait === 'galop') { h.stamina = Math.max(0, h.stamina - g.drain * dt); if (h.stamina <= 0) h.winded = true; }
  else h.stamina = Math.min(h.maxStamina, h.stamina + (gait === 'trot' ? MOUNT.trotRegen : MOUNT.idleRegen) * dt);
  if (h.winded && h.stamina >= h.maxStamina * MOUNT.recover) h.winded = false;
}

/** Prix : base du grade × (commerce du joueur, opinion du vendeur) bornée à ±10 %, arrondi à 5 or, toujours entre 400 et 600. */
export function priceModifier(charMult: number, npcFactor: number): number { return clamp((charMult / 1.25) * npcFactor, 0.9, 1.1); }
export function horsePrice(g: HorseGradeId, charMult: number, npcFactor: number): number {
  return clamp(round5(HORSE_GRADES[g].price * priceModifier(charMult, npcFactor)), 400, 600);
}

/** chances (bidet, palefroi, destrier) selon le lieu ; les petits lieux n'ont que des bidets et des palefrois */
const GRADE_ODDS: Record<string, [number, number, number]> = { capitale: [0, 0.4, 0.6], ville: [0.1, 0.5, 0.4], bourg: [0.2, 0.6, 0.2] };
const DEFAULT_ODDS: [number, number, number] = [0.65, 0.35, 0];

export interface HorseOffer { grade: HorseGradeId; coat: number; name: string; price: number }
/** Cheval proposé cette semaine par un vendeur (déterministe : flux « cheval » de la seed). Le fermier n'a que des bidets. */
export function horseOffer(seed: WorldSeed, sid: number, type: string, week: number, vendorId: string, farmer: boolean, charMult: number, npcFactor: number): HorseOffer {
  const rng = seed.stream('cheval', sid, week, vendorId);
  const r = rng.next(), odds = GRADE_ODDS[type] ?? DEFAULT_ODDS;
  const grade: HorseGradeId = farmer || r < odds[0] ? 'bidet' : r < odds[0] + odds[1] ? 'palefroi' : 'destrier';
  const coat = rng.int(0, COATS.length - 1), name = rng.pick(HORSE_NAMES);
  return { grade, coat, name, price: horsePrice(grade, charMult, npcFactor) };
}

// ---------------------------------------------------------------- mercenaire

export type MercArch = 'lame' | 'lancier' | 'hache';
const ARCH: Record<MercArch, { dmg: number; cd: number; reach: number; armor: number; blurbs: [string, string][] }> = {   // blurbs : [masculin, féminin]
  lame: { dmg: 1, cd: 1, reach: 2, armor: 1, blurbs: [['ancien garde de caravane', 'ancienne garde de caravane'], ['déserteur d’une garnison', 'déserteuse d’une garnison']] },
  lancier: { dmg: 0.95, cd: 1, reach: 2.7, armor: 0, blurbs: [['ex-piquier de la milice', 'ex-piquière de la milice'], ['ancien soldat du fort', 'ancienne soldate du fort']] },
  hache: { dmg: 1.2, cd: 1.25, reach: 1.9, armor: -1, blurbs: [['bûcheron devenu soudard', 'bûcheronne devenue soudarde'], ['mineur sans mine', 'mineuse sans mine']] },
};
export const MERC_ARCHS: MercArch[] = ['lame', 'lancier', 'hache'];
/** Intitulé de l'archétype, accordé au sexe du mercenaire (lancier / lancière). */
export function archName(arch: MercArch, sex: 'm' | 'f'): string { return arch === 'lancier' && sex === 'f' ? 'lancière' : arch; }

export const MERC = {
  days: 7, capDays: 14,                       // contrat de 7 jours de jeu, renouvelable jusqu'à 14 jours cumulés
  basePrice: 150, perLevel: 10, maxPrice: 350,
  koSeconds: 20, reviveFrac: 0.3, potionFrac: 0.6, regen: 0.005,   // à terre 20 s, puis relevé à 30 % de ses PV ; une potion le relève à 60 %
  walk: 4.4, run: 7.4, followStart: 4.5, followStop: 2.6, engageRange: 22, waitRange: 10, teleportDist: 45,
} as const;
export const CONTRACT_MIN = MERC.days * MIN_PER_DAY;

/** Niveau du mercenaire : celui du joueur moins un (au moins 1). */
export function mercLevel(playerLevel: number): number { return Math.max(1, Math.floor(playerLevel) - 1); }
export function mercPrice(playerLevel: number): number { return Math.min(MERC.maxPrice, MERC.basePrice + MERC.perLevel * (Math.max(1, Math.floor(playerLevel)) - 1)); }
export interface MercStats { hp: number; damage: number; atkCd: number; reach: number; armor: number; tier: 0 | 1 | 2 }
/** Statistiques modestes, calées sur celles d'un bandit du même niveau ; palier visuel : 0 cuir, 1 casque, 2 casque + cape + mailles. */
export function mercStats(level: number, arch: MercArch): MercStats {
  const L = Math.max(1, Math.floor(level)), a = ARCH[arch];
  return {
    hp: Math.round(50 + 9 * (L - 1)), damage: Math.round((6 + 1.4 * (L - 1)) * a.dmg), atkCd: Math.round(1.4 * a.cd * 100) / 100,
    reach: a.reach, armor: Math.max(0, 2 + Math.floor(L / 2) + a.armor), tier: L >= 8 ? 2 : L >= 4 ? 1 : 0,
  };
}

export interface MercOffer { first: string; last: string; sex: 'm' | 'f'; arch: MercArch; look: number; blurb: string; level: number; price: number }
/** Mercenaire à louer dans une auberge cette semaine (déterministe : flux « mercenaire » de la seed, jamais Math.random). */
export function mercOffer(seed: WorldSeed, sid: number, placeName: string, week: number, vendorId: string, playerLevel: number): MercOffer {
  const rng = seed.stream('mercenaire', sid, week, vendorId);
  const sex: 'm' | 'f' = rng.chance(0.3) ? 'f' : 'm';
  const arch = rng.pick(MERC_ARCHS), look = rng.int(0, 255), bl = rng.pick(ARCH[arch].blurbs), blurb = bl[sex === 'f' ? 1 : 0];
  const nm = new NameGen(rng.fork('names')).person(sex, false, placeName);
  return { first: nm.first, last: nm.last, sex, arch, look, blurb, level: mercLevel(playerLevel), price: mercPrice(playerLevel) };
}

/** Contrat : minutes de jeu restantes. */
export function renewContract(left: number): number { return Math.min(MERC.capDays * MIN_PER_DAY, Math.max(0, left) + CONTRACT_MIN); }
export function canRenew(left: number): boolean { return left + CONTRACT_MIN <= MERC.capDays * MIN_PER_DAY; }
export function tickContract(left: number, minutes: number): number { return minutes > 0 ? Math.max(0, left - minutes) : left; }
export function contractLabel(left: number): string {
  const d = Math.floor(left / MIN_PER_DAY), h = Math.floor((left % MIN_PER_DAY) / 60);
  return d > 0 ? `${d} j ${h} h` : h > 0 ? `${h} h` : 'moins d’une heure';
}

// ---------------------------------------------------------------- état d'un compagnon (Entity.ally)

export interface AllyState {
  kind: 'horse' | 'merc';
  /** cheval : attendre · siffle (accourt) · fuite ; mercenaire : suivre · attendre */
  mode: 'suivre' | 'attendre' | 'siffle' | 'fuite';
  level: number; armor: number; damage: number; reach: number; atkCd: number; cooldown: number;
  /** cheval : robe (0..5) ; mercenaire : apparence (0..255) */
  look: number;
  grade: HorseGradeId; arch: MercArch; first: string; last: string; sex: 'm' | 'f';
  mounted: boolean; stamina: number; maxStamina: number; winded: boolean;
  /** mercenaire à terre : secondes restantes (0 : debout) ; minutes de contrat restantes */
  ko: number; left: number;
  lastHurt: number; stuck: number; fleeT: number; fleeDx: number; fleeDz: number; barkT: number; scanT: number;
  post: { x: number; z: number } | null; trail: { x: number; z: number }[]; following: boolean;
  /** gelé : hors du monde du joueur (surface/donjon) ou à plus de 200 m ; ni simulé, ni ciblable */
  dormant: boolean;
}
export function newAlly(kind: 'horse' | 'merc', over: Partial<AllyState> = {}): AllyState {
  return {
    kind, mode: kind === 'merc' ? 'suivre' : 'attendre', level: 0, armor: 0, damage: 0, reach: 0, atkCd: 1.4, cooldown: 0, look: 0,
    grade: 'palefroi', arch: 'lame', first: '', last: '', sex: 'm', mounted: false, stamina: 0, maxStamina: 0, winded: false, ko: 0, left: 0,
    lastHurt: 99, stuck: 0, fleeT: 0, fleeDx: 0, fleeDz: 0, barkT: 0, scanT: 0, post: null, trail: [], following: false, dormant: false, ...over,
  };
}
/** Un monstre peut-il viser ce compagnon ? (pas à terre, pas monté — le cavalier encaisse —, pas gelé) */
export function allyTargetable(a: AllyState): boolean { return !a.dormant && !a.mounted && a.ko <= 0; }

/**
 * Monde d'une coordonnée : −1 pour la surface, sinon l'id du donjon (les donjons vivent à x ≥ 20000, 220 m d'écart).
 * Les tranches sont centrées sur les donjons : leurs salles débordent à gauche de l'origine (jusqu'à 8 m) et vont
 * jusqu'à ~90 m à droite ; la tranche du donjon d couvre donc de ox + 220 d − 100 à ox + 220 d + 120.
 */
const WORLD_MARGIN = 100;
export function worldOf(x: number): number { return x < DUNGEON_ORIGIN_X - WORLD_MARGIN ? -1 : Math.floor((x - DUNGEON_ORIGIN_X + WORLD_MARGIN) / 220); }

// ---------------------------------------------------------------- sauvegarde et réseau (tout est assaini : un champ absent ou invalide = rien)

export interface SavedHorse { grade: HorseGradeId; coat: number; name: string; hp: number; x: number; z: number; heading: number; stamina?: number; mounted?: boolean }
export interface SavedMerc { first: string; last: string; sex: 'm' | 'f'; arch: MercArch; look: number; hp: number; left: number; mode: 'suivre' | 'attendre'; x?: number; z?: number; heading?: number }

export function sanitizeHorse(raw: unknown): SavedHorse | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.grade !== 'string' || !Object.prototype.hasOwnProperty.call(HORSE_GRADES, r.grade)) return null;
  const grade = r.grade as HorseGradeId, g = HORSE_GRADES[grade], x = num(r.x, NaN), z = num(r.z, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const n = COATS.length;
  return {
    grade, coat: ((Math.floor(num(r.coat)) % n) + n) % n, name: typeof r.name === 'string' && r.name ? r.name.slice(0, 24) : 'Cheval',
    hp: clamp(Math.round(num(r.hp, g.hp)), 1, g.hp), x, z, heading: num(r.heading), stamina: clamp(num(r.stamina, g.stamina), 0, g.stamina), mounted: r.mounted === true,
  };
}

export function sanitizeMerc(raw: unknown): SavedMerc | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.arch !== 'string' || !MERC_ARCHS.includes(r.arch as MercArch)) return null;
  const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v.slice(0, 24) : d);
  const out: SavedMerc = {
    first: str(r.first, 'Mercenaire'), last: str(r.last, ''), sex: r.sex === 'f' ? 'f' : 'm', arch: r.arch as MercArch,
    look: clamp(Math.floor(num(r.look)), 0, 255), hp: clamp(Math.round(num(r.hp, 50)), 1, 5000),
    left: clamp(Math.floor(num(r.left)), 0, MERC.capDays * MIN_PER_DAY), mode: r.mode === 'attendre' ? 'attendre' : 'suivre',
  };
  if (out.left <= 0) return null;                                  // contrat échu : plus de mercenaire
  const x = num(r.x, NaN), z = num(r.z, NaN);
  if (Number.isFinite(x) && Number.isFinite(z)) { out.x = x; out.z = z; out.heading = num(r.heading); }
  return out;
}

/** Réseau : « mt » = robe + 1 si monté (0 ou absent : à pied) ; « mc » = [x, z, cap, code, à terre]. */
export function sanitizeMountWire(v: unknown): number { const n = Math.floor(num(v)); return n >= 1 && n <= COATS.length ? n : 0; }
export function mercCode(look: number, arch: MercArch, tier: number, sex: 'm' | 'f'): number {
  return (look & 255) | (MERC_ARCHS.indexOf(arch) << 8) | (clamp(Math.floor(tier), 0, 2) << 10) | (sex === 'f' ? 1 << 12 : 0);
}
export interface MercWire { x: number; z: number; h: number; look: number; arch: MercArch; tier: 0 | 1 | 2; sex: 'm' | 'f'; ko: boolean }
export function sanitizeMercWire(v: unknown): MercWire | null {
  if (!Array.isArray(v) || v.length < 5) return null;
  const [x, z, h, code, ko] = v.map((q) => num(q, NaN));
  if (![x, z, h, code].every(Number.isFinite)) return null;
  const c = Math.floor(code), arch = MERC_ARCHS[(c >> 8) & 3], tier = (c >> 10) & 3;
  if (!arch || tier > 2) return null;
  return { x, z, h, look: c & 255, arch, tier: tier as 0 | 1 | 2, sex: c & (1 << 12) ? 'f' : 'm', ko: ko === 1 };
}
