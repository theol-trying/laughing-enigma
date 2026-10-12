// Arbres de talents : quatre arbres de 8 talents sur trois rangées. Un point de talent tous les
// 3 niveaux, dépensé dans l'arbre de son choix ; la rangée 2 exige 2 points déjà dépensés dans
// l'arbre, la rangée 3 en exige 4. Les points disponibles se déduisent du niveau (rien n'est
// stocké en plus) : les personnages existants reçoivent donc leurs points rétroactivement.
// Ce module est pur (aucun import de jeu) ; Character en lit les effets par talentFx().

export type TreeId = 'guerrier' | 'rodeur' | 'mage' | 'artisan';

/** Effets chiffrés possibles : une clé = un câblage précis dans le jeu (voir Character). */
export type FxKey =
  | 'melee' | 'staCost' | 'armorPct' | 'guard' | 'blockSta' | 'heavy' | 'atkSpeed' | 'execute' | 'staRegen'   // guerrier
  | 'bow' | 'bowRate' | 'noise' | 'arrowRecover' | 'sneak' | 'steal' | 'stealth'                              // rôdeur
  | 'spell' | 'manaCost' | 'manaMax' | 'manaRegen' | 'spellTime' | 'heal'                                    // mage
  | 'quality' | 'wear' | 'carry' | 'buy' | 'sell' | 'lockW' | 'lockBreak';                                    // artisan-marchand

export interface TreeDef { id: TreeId; name: string; short: string; blurb: string }
export interface TalentDef {
  id: string; tree: TreeId; row: 1 | 2 | 3; name: string; desc: string; max: 1 | 2 | 3;
  /** effet PAR RANG ; l'effet total est rang × valeur */
  fx: Partial<Record<FxKey, number>>;
}
export interface FxMeta { label: string; fmt: (v: number) => string }
export type Refusal = 'inconnu' | 'max' | 'rangee' | 'points';
export interface LearnCheck { ok: boolean; why?: Refusal; need?: number; have?: number }

/** Points à avoir déjà dépensés dans l'arbre pour ouvrir la rangée 1, 2 et 3. */
export const ROW_REQ = [0, 2, 4] as const;
/** Le coup de grâce s'applique sous cette part des PV de la cible. */
export const EXECUTE_HP = 0.35;

/** Nombre à la française, arrondi à d décimales (0,5). */
export const frNum = (v: number, d = 1): string => String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',');

export const TREES: TreeDef[] = [
  { id: 'guerrier', name: 'Guerrier', short: 'Guerrier', blurb: 'Armes, armures, parade : tenir et frapper fort.' },
  { id: 'rodeur', name: 'Rôdeur', short: 'Rôdeur', blurb: 'Arc, furtivité, coups sournois : frapper caché.' },
  { id: 'mage', name: 'Mage', short: 'Mage', blurb: 'Sorts et mana : plus de force, moins de dépense.' },
  { id: 'artisan', name: 'Artisan-marchand', short: 'Artisan', blurb: 'Artisanat, usure, commerce, crochetage, charge.' },
];
export const TREE_BY_ID = new Map<TreeId, TreeDef>(TREES.map((t) => [t.id, t]));

export const TALENTS: TalentDef[] = [
  // ---------------------------------------------------------------- guerrier
  { id: 'lame', tree: 'guerrier', row: 1, name: 'Maîtrise d’armes', max: 3, fx: { melee: 0.08 }, desc: 'Vos coups au corps à corps (armes et poings) frappent plus fort.' },
  { id: 'souffle', tree: 'guerrier', row: 1, name: 'Second souffle', max: 3, fx: { staCost: 0.08 }, desc: 'Vos attaques (corps à corps et arc) coûtent moins d’endurance.' },
  { id: 'cuirasse', tree: 'guerrier', row: 1, name: 'Cuirasse', max: 2, fx: { armorPct: 0.2 }, desc: 'Votre armure portée protège mieux (valeur arrondie).' },
  { id: 'garde', tree: 'guerrier', row: 2, name: 'Garde solide', max: 3, fx: { guard: 0.1, blockSta: 0.08 }, desc: 'La parade laisse passer moins de dégâts et coûte moins d’endurance.' },
  { id: 'ecrasante', tree: 'guerrier', row: 2, name: 'Frappe écrasante', max: 2, fx: { heavy: 0.2 }, desc: 'Le coup puissant (clic maintenu) frappe encore plus fort.' },
  { id: 'enchainement', tree: 'guerrier', row: 3, name: 'Enchaînement', max: 2, fx: { atkSpeed: 0.1 }, desc: 'Vous enchaînez les coups de mêlée plus vite.' },
  { id: 'grace', tree: 'guerrier', row: 3, name: 'Coup de grâce', max: 2, fx: { execute: 0.2 }, desc: 'Vos coups de mêlée font plus de dégâts à une cible déjà bien affaiblie.' },
  { id: 'inebranlable', tree: 'guerrier', row: 3, name: 'Inébranlable', max: 1, fx: { staRegen: 0.3 }, desc: 'Hors parade et hors course, l’endurance revient plus vite.' },
  // ---------------------------------------------------------------- rôdeur
  { id: 'tireur', tree: 'rodeur', row: 1, name: 'Tir précis', max: 3, fx: { bow: 0.08 }, desc: 'Vos flèches font plus de dégâts.' },
  { id: 'cadence', tree: 'rodeur', row: 1, name: 'Main leste', max: 3, fx: { bowRate: 0.1 }, desc: 'Vous bandez l’arc et réarmez plus vite.' },
  { id: 'velours', tree: 'rodeur', row: 1, name: 'Pas de velours', max: 3, fx: { noise: 0.15 }, desc: 'Vous faites moins de bruit : les ennemis vous entendent de moins loin.' },
  { id: 'carquois', tree: 'rodeur', row: 2, name: 'Carquois malin', max: 3, fx: { arrowRecover: 0.15 }, desc: 'Une flèche qui touche sa cible peut être récupérée.' },
  { id: 'sournois', tree: 'rodeur', row: 2, name: 'Coup d’ombre', max: 2, fx: { sneak: 0.5 }, desc: 'Les attaques sournoises (accroupi, cible qui ne vous a pas repéré) frappent plus fort.' },
  { id: 'baladeuse', tree: 'rodeur', row: 2, name: 'Main baladeuse', max: 2, fx: { steal: 0.12 }, desc: 'Le vol à la tire a plus de chances de réussir.' },
  { id: 'ombre', tree: 'rodeur', row: 3, name: 'Ombre vivante', max: 2, fx: { stealth: 0.07 }, desc: 'Accroupi, vous passez mieux inaperçu, des monstres comme des habitants.' },
  { id: 'lynx', tree: 'rodeur', row: 3, name: 'Œil de lynx', max: 1, fx: { bow: 0.2 }, desc: 'Vos flèches frappent bien plus fort.' },
  // ---------------------------------------------------------------- mage
  { id: 'arcane', tree: 'mage', row: 1, name: 'Puissance arcane', max: 3, fx: { spell: 0.08 }, desc: 'Vos sorts de dégâts et de soin gagnent en puissance.' },
  { id: 'econome', tree: 'mage', row: 1, name: 'Économe en mana', max: 3, fx: { manaCost: 0.08 }, desc: 'Chaque sort coûte moins de mana (arrondi, 1 au minimum).' },
  { id: 'reserve', tree: 'mage', row: 1, name: 'Grande réserve', max: 3, fx: { manaMax: 8 }, desc: 'Votre réserve de mana maximale augmente.' },
  { id: 'source', tree: 'mage', row: 2, name: 'Source vive', max: 3, fx: { manaRegen: 0.25 }, desc: 'Le mana se régénère plus vite.' },
  { id: 'aura', tree: 'mage', row: 2, name: 'Aura durable', max: 2, fx: { spellTime: 0.3 }, desc: 'Invisibilité, bouclier de mana, lumière et pas feutrés durent plus longtemps.' },
  { id: 'guerisseur', tree: 'mage', row: 2, name: 'Guérisseur', max: 2, fx: { heal: 0.25 }, desc: 'Le sort de soin rend plus de points de vie.' },
  { id: 'archimage', tree: 'mage', row: 3, name: 'Archimage', max: 2, fx: { spell: 0.12, manaCost: 0.1 }, desc: 'Sorts plus puissants et moins coûteux.' },
  { id: 'sagesse', tree: 'mage', row: 3, name: 'Sagesse infinie', max: 1, fx: { manaMax: 20, manaRegen: 0.35 }, desc: 'Un océan de mana : réserve et régénération accrues.' },
  // ---------------------------------------------------------------- artisan-marchand
  { id: 'orfevre', tree: 'artisan', row: 1, name: 'Main d’orfèvre', max: 3, fx: { quality: 0.08 }, desc: 'Les armes, armures et boucliers que vous fabriquez sont plus souvent de qualité.' },
  { id: 'entretien', tree: 'artisan', row: 1, name: 'Entretien soigné', max: 3, fx: { wear: 0.1 }, desc: 'Votre équipement s’use moins vite.' },
  { id: 'portefaix', tree: 'artisan', row: 1, name: 'Portefaix', max: 3, fx: { carry: 10 }, desc: 'Vous portez plus de poids avant d’être surchargé.' },
  { id: 'marchandage', tree: 'artisan', row: 2, name: 'Marchandage', max: 3, fx: { buy: 0.04 }, desc: 'Les marchands vous vendent moins cher (réparations chez le forgeron comprises).' },
  { id: 'negociant', tree: 'artisan', row: 2, name: 'Bon négociant', max: 3, fx: { sell: 0.04 }, desc: 'Les marchands vous rachètent vos objets plus cher, sans jamais dépasser 90 % de leur propre prix de vente.' },
  { id: 'crochetage', tree: 'artisan', row: 2, name: 'Crochetage fin', max: 3, fx: { lockW: 1, lockBreak: 0.1 }, desc: 'La zone de réussite du crochetage s’élargit et les crochets cassent moins.' },
  { id: 'maitre', tree: 'artisan', row: 3, name: 'Maître artisan', max: 2, fx: { quality: 0.1, wear: 0.1 }, desc: 'Pièces de qualité plus fréquentes et usure encore réduite.' },
  { id: 'magnat', tree: 'artisan', row: 3, name: 'Magnat', max: 1, fx: { buy: 0.06, sell: 0.06 }, desc: 'Vous achetez et vendez à des prix de maître.' },
];
export const TALENT_BY_ID = new Map<string, TalentDef>(TALENTS.map((t) => [t.id, t]));
/** Talents d'un arbre, éventuellement limités à une rangée (1 à 3). */
export const talentsOf = (tree: TreeId, row?: number): TalentDef[] => TALENTS.filter((t) => t.tree === tree && (row === undefined || t.row === row));

const up = (v: number) => `+${frNum(v * 100, 0)} %`;
const down = (v: number) => `-${frNum(v * 100, 0)} %`;
const pts = (v: number) => `+${frNum(v * 100, 0)} pts`;
/** Libellé et format de chaque effet (l'écran des talents s'en sert : le texte ne diverge jamais des données). */
export const FX_META: Record<FxKey, FxMeta> = {
  melee: { label: 'Dégâts de mêlée', fmt: up },
  staCost: { label: 'Coût d’endurance des attaques', fmt: down },
  armorPct: { label: 'Armure portée', fmt: up },
  guard: { label: 'Dégâts qui passent la parade', fmt: down },
  blockSta: { label: 'Endurance perdue en parant', fmt: down },
  heavy: { label: 'Multiplicateur du coup puissant', fmt: (v) => `+${frNum(v, 1)}` },
  atkSpeed: { label: 'Vitesse d’attaque', fmt: up },
  execute: { label: `Dégâts sous ${frNum(EXECUTE_HP * 100, 0)} % de PV de la cible`, fmt: up },
  staRegen: { label: 'Récupération d’endurance', fmt: up },
  bow: { label: 'Dégâts des flèches', fmt: up },
  bowRate: { label: 'Cadence de l’arc', fmt: up },
  noise: { label: 'Bruit émis', fmt: down },
  arrowRecover: { label: 'Chance de récupérer la flèche', fmt: (v) => `${frNum(v * 100, 0)} %` },
  sneak: { label: 'Multiplicateur d’attaque sournoise', fmt: (v) => `+${frNum(v, 1)}` },
  steal: { label: 'Chance de vol à la tire', fmt: pts },
  stealth: { label: 'Discrétion accroupi', fmt: pts },
  spell: { label: 'Puissance des sorts', fmt: up },
  manaCost: { label: 'Coût des sorts', fmt: down },
  manaMax: { label: 'Mana maximal', fmt: (v) => `+${frNum(v, 0)}` },
  manaRegen: { label: 'Régénération du mana', fmt: up },
  spellTime: { label: 'Durée des sorts d’aura', fmt: up },
  heal: { label: 'Soins du sort de soin', fmt: up },
  quality: { label: 'Chance de pièce de qualité', fmt: pts },
  wear: { label: 'Usure de l’équipement', fmt: down },
  carry: { label: 'Charge portée', fmt: (v) => `+${frNum(v, 0)}` },
  buy: { label: 'Prix d’achat', fmt: down },
  sell: { label: 'Prix de revente', fmt: up },
  lockW: { label: 'Zone de crochetage', fmt: (v) => `+${frNum(v, 0)} case${v > 1 ? 's' : ''}` },
  lockBreak: { label: 'Casse du crochet par raté', fmt: (v) => `-${frNum(v * 100, 0)} pts` },
};

// ------------------------------------------------------------------ points et prérequis
/** Rang effectif d'un talent dans une table (inconnu : 0 ; borné au rang maximal). */
function rankOf(t: Record<string, number>, d: TalentDef): number { return Math.min(d.max, Math.max(0, Math.floor(t[d.id]) || 0)); }
/** Points de talent gagnés par un personnage de ce niveau : un tous les 3 niveaux. */
export const talentPointsTotal = (level: number): number => Math.floor(Math.max(0, level) / 3);
/** Points dépensés (somme des rangs). */
export function ranksSpent(t: Record<string, number>): number { let s = 0; for (const d of TALENTS) s += rankOf(t, d); return s; }
/** Points dépensés dans un arbre. */
export function treeSpent(t: Record<string, number>, tree: TreeId): number { let s = 0; for (const d of TALENTS) if (d.tree === tree) s += rankOf(t, d); return s; }
/** Somme rang × effet par rang d'une clé (arrondie : pas de 0.30000000000000004). */
export function fxTotal(t: Record<string, number>, key: FxKey): number {
  let s = 0;
  for (const d of TALENTS) { const v = d.fx[key]; if (v) s += v * rankOf(t, d); }
  return Math.round(s * 1e6) / 1e6;
}
/** Ce talent peut-il être appris maintenant ? (rang maximal, prérequis de rangée, points disponibles) */
export function canLearn(t: Record<string, number>, level: number, id: string): LearnCheck {
  const d = TALENT_BY_ID.get(id);
  if (!d) return { ok: false, why: 'inconnu' };
  if (rankOf(t, d) >= d.max) return { ok: false, why: 'max' };
  const need = ROW_REQ[d.row - 1], have = treeSpent(t, d.tree);
  if (have < need) return { ok: false, why: 'rangee', need, have };
  if (talentPointsTotal(level) - ranksSpent(t) <= 0) return { ok: false, why: 'points' };
  return { ok: true };
}
/** Raison d'un refus, en français. */
export function refusalText(c: LearnCheck, d?: TalentDef): string {
  switch (c.why) {
    case 'inconnu': return 'Talent inconnu.';
    case 'max': return 'Rang maximal atteint.';
    case 'rangee': return `Rangée verrouillée : ${c.need} points requis dans l’arbre${d ? ' ' + TREE_BY_ID.get(d.tree)!.name : ''} (vous en avez ${c.have}).`;
    case 'points': return 'Aucun point de talent disponible (un point tous les 3 niveaux).';
    default: return '';
  }
}
/** Coût en or d'une remise à zéro des talents. */
export const respecCost = (level: number): number => 20 + 10 * level;

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/œ/g, 'oe').replace(/[’‘]/g, "'").trim();
/** Recherche par id ou par nom (accents et casse tolérés) : id exact, puis nom exact, puis sous-chaîne. */
export function findTalent(q: string): TalentDef[] {
  const n = norm(q);
  if (!n) return [];
  const byId = TALENTS.filter((t) => t.id === n);
  if (byId.length) return byId;
  const byName = TALENTS.filter((t) => norm(t.name) === n);
  if (byName.length) return byName;
  return TALENTS.filter((t) => t.id.includes(n) || norm(t.name).includes(n));
}

/** Table de talents sûre à partir de données quelconques (sauvegarde) : ids inconnus ignorés, rangs bornés. */
export function sanitizeTalents(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const d of TALENTS) { const v = src[d.id]; if (typeof v === 'number' && Number.isFinite(v) && v >= 1) out[d.id] = Math.min(d.max, Math.floor(v)); }
  return out;
}
