import type { StallKind } from '@ascii-fort/worldgen/civilization/Layout';
import type { Craft } from '@ascii-fort/worldgen/civilization/Districts';
import type { RNG } from '@ascii-fort/core/RNG';

// Marché et tavernes des quartiers (étape 55) : spécialités des étals (marchandises, titres accordés, étalage visible,
// criées), métiers des ateliers, carte de la taverne, chansons et toasts, jeu de dés. Logique pure et testable ; le jeu
// (src/game/Districts.ts) l'incarne.

/** Forme d'un article posé sur l'étal : 0 boîte, 1 cylindre, 2 sphère (mêmes codes que SHAPE). */
export interface Ware { shape: 0 | 1 | 2; color: number; sx: number; sy: number; sz: number }

export interface StallDef {
  /** titre du marchand, au masculin et au féminin */
  m: string; f: string;
  /** ce qu'il vend (ids d'objets) */
  items: string[];
  /** étalage visible le jour */
  wares: Ware[];
  /** criées (bulles au-dessus de la tête, tutoiement des passants) */
  cries: string[];
}

const fruit = (color: number): Ware => ({ shape: 2, color, sx: 0.22, sy: 0.2, sz: 0.22 });
export const STALLS: Record<StallKind, StallDef> = {
  maraîcher: {
    m: 'maraîcher', f: 'maraîchère', items: ['pomme', 'baies', 'champignon', 'pain'],
    wares: [fruit(0xc83a2a), fruit(0x6a9a3a), fruit(0xd88a2a), fruit(0x8a3a6a), fruit(0xc8a040)],
    cries: ['Belles pommes, croquantes et sucrées !', 'Des baies du matin, encore pleines de rosée !', 'Approche, goûte, tu m’en diras des nouvelles !'],
  },
  boulanger: {
    m: 'boulanger', f: 'boulangère', items: ['pain', 'tourte à la viande', 'pomme'],
    wares: [{ shape: 2, color: 0xc8904a, sx: 0.4, sy: 0.18, sz: 0.28 }, { shape: 2, color: 0xb07a3a, sx: 0.36, sy: 0.16, sz: 0.26 }, { shape: 1, color: 0xd8a860, sx: 0.32, sy: 0.12, sz: 0.32 }],
    cries: ['Pain chaud, tout juste sorti du four !', 'Miches dorées et tourtes fumantes !', 'Qui veut du bon pain ?'],
  },
  fromager: {
    m: 'fromager', f: 'fromagère', items: ['fromage', 'pain', 'baies'],
    wares: [{ shape: 1, color: 0xe8c860, sx: 0.36, sy: 0.16, sz: 0.36 }, { shape: 1, color: 0xd8b050, sx: 0.28, sy: 0.22, sz: 0.28 }, { shape: 0, color: 0xf0e0a0, sx: 0.24, sy: 0.14, sz: 0.2 }],
    cries: ['Fromages affinés en cave, goûte-moi ça !', 'Du fromage de brebis, le meilleur du pays !'],
  },
  poissonnier: {
    m: 'poissonnier', f: 'poissonnière', items: ['truite', 'carpe', 'hareng', 'morue', 'poisson grillé', 'sel'],
    wares: [{ shape: 0, color: 0xa8b4bc, sx: 0.5, sy: 0.08, sz: 0.14 }, { shape: 0, color: 0x8a9aa4, sx: 0.44, sy: 0.08, sz: 0.12 }, { shape: 0, color: 0xc0c8cc, sx: 0.38, sy: 0.07, sz: 0.12 }],
    cries: ['Poisson frais, pêché à l’aube !', 'Harengs, truites, carpes : tout frétille encore !'],
  },
  boucher: {
    m: 'boucher', f: 'bouchère', items: ['viande crue', 'viande grillée', 'tourte à la viande', 'cuir'],
    wares: [{ shape: 0, color: 0xa83a3a, sx: 0.36, sy: 0.14, sz: 0.24 }, { shape: 2, color: 0x8a2a2a, sx: 0.3, sy: 0.16, sz: 0.24 }, { shape: 1, color: 0xb05040, sx: 0.12, sy: 0.4, sz: 0.12 }],
    cries: ['Viande tendre, découpée ce matin !', 'Gigots, côtes, saucisses : à la découpe !'],
  },
  drapier: {
    m: 'drapier', f: 'drapière', items: ['étoffe', 'gants', 'bottes', 'tunique de cuir', 'gambison', 'casque de cuir'],
    wares: [{ shape: 1, color: 0x3a5aa8, sx: 0.18, sy: 0.6, sz: 0.18 }, { shape: 1, color: 0xa83a3a, sx: 0.18, sy: 0.6, sz: 0.18 }, { shape: 1, color: 0x3a8a4a, sx: 0.18, sy: 0.6, sz: 0.18 }, { shape: 1, color: 0xc8a040, sx: 0.18, sy: 0.6, sz: 0.18 }],
    cries: ['Draps de laine, toiles fines, couleurs vives !', 'Touche-moi cette étoffe : douce comme une joue d’enfant !'],
  },
  herboriste: {
    m: 'herboriste', f: 'herboriste', items: ['herbe médicinale', 'champignon', 'baies', 'écorce', 'antidote', 'potion de soin'],
    wares: [{ shape: 2, color: 0x5a8a3a, sx: 0.26, sy: 0.18, sz: 0.26 }, { shape: 2, color: 0x7a9a4a, sx: 0.22, sy: 0.16, sz: 0.22 }, { shape: 1, color: 0x6a4a8a, sx: 0.08, sy: 0.2, sz: 0.08 }],
    cries: ['Herbes qui soignent, racines qui guérissent !', 'Un mal de ventre ? J’ai ce qu’il te faut !'],
  },
  saunier: {
    m: 'saunier', f: 'saunière', items: ['sel', 'hareng', 'viande crue'],
    wares: [{ shape: 2, color: 0xe8e4dc, sx: 0.34, sy: 0.3, sz: 0.3 }, { shape: 2, color: 0xd8d4cc, sx: 0.3, sy: 0.26, sz: 0.28 }],
    cries: ['Sel blanc des marais, pour tes salaisons !', 'Sans sel, pas d’hiver : fais tes réserves !'],
  },
  vigneron: {
    m: 'marchand d’hydromel', f: 'marchande d’hydromel', items: ['hydromel', 'bière', 'pain'],
    wares: [{ shape: 1, color: 0x7a5232, sx: 0.3, sy: 0.4, sz: 0.3 }, { shape: 1, color: 0x3a6a3a, sx: 0.09, sy: 0.3, sz: 0.09 }, { shape: 1, color: 0x6a2a3a, sx: 0.09, sy: 0.3, sz: 0.09 }],
    cries: ['Hydromel doré, doux comme le miel !', 'Bière blonde et hydromel : de quoi tenir l’hiver !'],
  },
  quincaillier: {
    m: 'quincaillier', f: 'quincaillière', items: ['outils', 'crochet', 'canne à pêche', 'hache de bûcheron', 'pioche', 'dague', 'flèche'],
    wares: [{ shape: 0, color: 0x8a8a94, sx: 0.36, sy: 0.08, sz: 0.12 }, { shape: 0, color: 0x6a6a72, sx: 0.12, sy: 0.3, sz: 0.12 }, { shape: 1, color: 0x9a9aa2, sx: 0.16, sy: 0.08, sz: 0.16 }],
    cries: ['Clous, serrures, outils de toutes sortes !', 'Une bonne hache, ça ne se refuse pas !'],
  },
  boisselier: {
    m: 'boisselier', f: 'boisselière', items: ['bois', 'branche', 'flèche', 'arc court', 'bouclier en bois', 'bâton'],
    wares: [{ shape: 1, color: 0x8a6a3a, sx: 0.14, sy: 0.6, sz: 0.14 }, { shape: 0, color: 0xa88a5a, sx: 0.3, sy: 0.2, sz: 0.3 }, { shape: 1, color: 0x6a4a2a, sx: 0.3, sy: 0.12, sz: 0.3 }],
    cries: ['Seaux, boisseaux, arcs et flèches !', 'Du bon bois sec, il brûle sans fumer !'],
  },
};

export interface CraftDef { m: string; f: string; items: string[]; job: string }
export const CRAFT_DEFS: Record<Craft, CraftDef> = {
  tisserand: { m: 'tisserand', f: 'tisserande', items: ['étoffe', 'gambison', 'gants'], job: 'Le métier à tisser ne s’arrête jamais : il faut des draps pour tout le monde.' },
  tanneur: { m: 'tanneur', f: 'tanneuse', items: ['cuir', 'tunique de cuir', 'casque de cuir', 'bottes'], job: 'Les peaux arrivent des chasseurs, je les tanne à l’écorce. Ça sent fort, mais ça paie.' },
  potier: { m: 'potier', f: 'potière', items: [], job: 'Pots, cruches, écuelles : tout le monde casse, alors tout le monde rachète.' },
  menuisier: { m: 'menuisier', f: 'menuisière', items: ['bois', 'bouclier en bois', 'bâton'], job: 'Tables, bancs, portes : le bois de chêne ne trahit jamais.' },
  tonnelier: { m: 'tonnelier', f: 'tonnelière', items: ['bois', 'bière'], job: 'Mes tonneaux tiennent la bière des tavernes. Un fût qui fuit, c’est mon nom qui coule.' },
  cordonnier: { m: 'cordonnier', f: 'cordonnière', items: ['bottes', 'cuir', 'gants'], job: 'Des bottes solides pour les routes. Tes semelles en auraient bien besoin, d’ailleurs.' },
  vannier: { m: 'vannier', f: 'vannière', items: ['branche', 'bois'], job: 'Paniers, hottes, nasses : l’osier se tresse mieux à la belle saison.' },
  chandelier: { m: 'chandelier', f: 'chandelière', items: [], job: 'Chandelles de suif pour les maisons, de cire pour le temple.' },
};

/** Titres des habitants des nouvelles maisons (sans échoppe). */
export const RESIDENT_TITLES: { m: string[]; f: string[] } = {
  m: ['journalier', 'porteur d’eau', 'scribe', 'barbier', 'charpentier', 'maçon'],
  f: ['lavandière', 'fileuse', 'couturière', 'journalière', 'brodeuse', 'nourrice'],
};

/** Carte de la taverne : boissons et plats (les spécialités régionales s'y ajoutent). */
export const TAVERN_MENU = ['bière', 'hydromel', 'pain', 'fromage', 'ragoût', 'tourte à la viande'];
/** Ce que l'on commande au comptoir (consommé sur place). */
export const TAVERN_ORDERS: { id: string; label: string }[] = [
  { id: 'bière', label: 'Une chope de bière' }, { id: 'hydromel', label: 'Un gobelet d’hydromel' }, { id: 'ragoût', label: 'Un bol de ragoût' },
];

/** Couplets chantés par les clients le soir (bulles). */
export const SONGS = [
  '♪ Remplis ma chope, tavernier, la nuit est encore jeune ! ♪',
  '♪ Au fond des bois chantait le merle… ♪',
  '♪ Trois compagnons s’en vont à la guerre, tra la la… ♪',
  '♪ Et j’ai perdu mes bottes au fond du gué ! ♪',
  '♪ Le meunier dort, son moulin tourne… ♪',
  '♪ À la santé du roi et de sa jument ! ♪',
];
export const TOASTS = ['À la tienne !', 'Santé !', 'Encore une tournée !', 'Qui paie la suivante ?', 'Tavernier, à boire !', 'À nos amours !'];
/** Le barde entre deux airs. */
export const BARD_LINES = ['♫ Une ballade pour la belle assemblée ! ♫', '♫ Voici la geste du chevalier sans nom… ♫', '♫ Une pièce pour le barde, une chanson pour la salle ! ♫'];

// ---------------------------------------------------------------- jeu de dés
/** Mises proposées (or). */
export const DICE_STAKES = [5, 10, 25];
/** Un client ne joue plus après avoir perdu tant dans la journée (sa bourse est vide). */
export const DICE_PURSE = 60;
export type DiceResult = 'gagné' | 'perdu' | 'égalité';
/** Deux dés à six faces. */
export function rollDice(rng: RNG): [number, number] { return [rng.int(1, 6), rng.int(1, 6)]; }
/**
 * Règle de la taverne : le plus gros total l'emporte ; un double bat tout total sans double ; deux doubles, le plus fort
 * gagne ; à égalité, la mise est rendue.
 */
export function diceOutcome(me: readonly [number, number], him: readonly [number, number]): DiceResult {
  const dm = me[0] === me[1], dh = him[0] === him[1];
  if (dm !== dh) return dm ? 'gagné' : 'perdu';
  const a = me[0] + me[1], b = him[0] + him[1];
  return a > b ? 'gagné' : a < b ? 'perdu' : 'égalité';
}
