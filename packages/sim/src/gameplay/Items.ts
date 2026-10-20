import type { Good } from '@ascii-fort/worldgen/civilization/types';
import { SPELLS, scrollId } from './Spells';
import type { FxKey } from './Talents';

// Catalogue des objets. Les clés de donjon et objets de quête sont créés dynamiquement
// (« clé:3 », « quête:relique:7 »…) mais partagent la même interface.

export type ItemCat = 'arme' | 'armure' | 'bouclier' | 'munition' | 'nourriture' | 'potion' | 'matériau' | 'clé' | 'quête' | 'valeur' | 'parchemin';
export type WeaponKind = 'épée' | 'hache' | 'masse' | 'lance' | 'arc' | 'dague' | 'bâton' | 'pioche';
export type Element = 'feu' | 'givre' | 'poison';

export interface ItemDef {
  id: string; name: string; cat: ItemCat; value: number; weight: number; desc: string;
  rarity?: 'commun' | 'rare' | 'épique';
  weapon?: { kind: WeaponKind; damage: number; speed: number; reach: number; stamina: number; element?: Element };
  armor?: { slot: 'corps' | 'tête' | 'mains' | 'pieds'; value: number };
  shield?: { block: number };
  use?: {
    hp?: number; stamina?: number; mana?: number; cure?: boolean;
    /** minutes « Réchauffé » : insensible au gel, dégâts de givre réduits de moitié */
    warm?: number;
    /** repas : bonus « rassasié » (durée s, PV/s, endurance) ; false = cru, sans bonus ; absent = repas simple (150 s, 0,3 PV/s) */
    meal?: { t: number; regen: number; stam?: number } | false;
    /** bonus temporaire (potions) */
    buff?: { id: string; name: string; t: number; dmg?: number; armor?: number };
    /** se boit (« Vous buvez ») */
    drink?: boolean;
    /** guérit la fièvre d'une épidémie et protège de la contagion une journée */
    fever?: boolean;
  };
  good?: Good;           // catégorie économique (prix régionaux)
  /** solidité : usages (coups portés, reçus, parés, tirs) avant d'être hors d'usage ; défaut selon le type (wearOf) */
  wear?: number;
  /** matériau de réparation à l'enclume (défaut : repairMat) */
  repair?: string;
  /** variante usée : état 0-100 (absent = intact) */
  dur?: number;
  /** pièce « de qualité » (forgée par un bon artisan) */
  quality?: boolean;
  /** effets portés (objets épiques) : mêmes clés que les talents, ajoutés tant que la pièce est équipée et pas hors d'usage */
  fx?: Partial<Record<FxKey, number>>;
}

/** Butin unique des boss des chaînes de quêtes, par archétype (objets épiques du catalogue). */
export const EPICS = ['écorcheuse', 'croc-de-lune', 'heaume royal', 'linceul des cendres', 'glas', 'fend-montagne', 'arc de la tisseuse', 'pavois du veilleur'] as const;

/** Poissons crus (à griller sur un feu). */
export const FISH = ['truite', 'carpe', 'brochet', 'saumon', 'anguille', 'hareng', 'bar', 'morue'];

const D: ItemDef[] = [
  // armes
  { id: 'dague', name: 'Dague', cat: 'arme', value: 18, weight: 0.5, desc: 'Courte et rapide.', weapon: { kind: 'dague', damage: 7, speed: 1.45, reach: 1.7, stamina: 6 }, good: 'outils' },
  { id: 'épée courte', name: 'Épée courte', cat: 'arme', value: 40, weight: 1.5, desc: "L'arme du garde et du voyageur.", weapon: { kind: 'épée', damage: 11, speed: 1.05, reach: 2.1, stamina: 9 }, good: 'outils' },
  { id: 'épée longue', name: 'Épée longue', cat: 'arme', value: 95, weight: 2.4, desc: 'Allonge et tranchant.', weapon: { kind: 'épée', damage: 15, speed: 0.88, reach: 2.4, stamina: 12 }, good: 'outils' },
  { id: 'hache', name: 'Hache de guerre', cat: 'arme', value: 70, weight: 2.6, desc: 'Fend les boucliers.', weapon: { kind: 'hache', damage: 14, speed: 0.8, reach: 2.0, stamina: 12 }, good: 'outils' },
  { id: 'masse', name: 'Masse d’armes', cat: 'arme', value: 65, weight: 2.8, desc: 'Brise les os (efficace contre les squelettes).', weapon: { kind: 'masse', damage: 13, speed: 0.82, reach: 1.9, stamina: 12 }, good: 'outils' },
  { id: 'lance', name: 'Lance', cat: 'arme', value: 45, weight: 2.2, desc: 'Garde l’ennemi à distance.', weapon: { kind: 'lance', damage: 12, speed: 0.9, reach: 2.9, stamina: 10 }, good: 'outils' },
  { id: 'bâton', name: 'Bâton de marche', cat: 'arme', value: 12, weight: 1.6, desc: 'Renforce la magie de son porteur.', weapon: { kind: 'bâton', damage: 8, speed: 1.0, reach: 2.4, stamina: 8 }, good: 'bois' },
  { id: 'arc court', name: 'Arc court', cat: 'arme', value: 50, weight: 1, desc: 'Tir rapide. Nécessite des flèches.', weapon: { kind: 'arc', damage: 10, speed: 1, reach: 60, stamina: 6 }, good: 'bois' },
  { id: 'arc long', name: 'Arc long', cat: 'arme', value: 110, weight: 1.4, desc: 'Puissant, demande de la force.', weapon: { kind: 'arc', damage: 15, speed: 0.8, reach: 90, stamina: 9 }, good: 'bois' },
  { id: 'épée ardente', name: 'Épée ardente', cat: 'arme', value: 320, weight: 2.4, desc: 'Sa lame couve encore les braises de sa forge.', rarity: 'rare', weapon: { kind: 'épée', damage: 16, speed: 0.9, reach: 2.3, stamina: 12, element: 'feu' } },
  { id: 'hache de givre', name: 'Hache de givre', cat: 'arme', value: 300, weight: 2.6, desc: 'Le froid mord ce qu’elle touche.', rarity: 'rare', weapon: { kind: 'hache', damage: 15, speed: 0.82, reach: 2.0, stamina: 12, element: 'givre' } },
  { id: 'dague venimeuse', name: 'Dague venimeuse', cat: 'arme', value: 240, weight: 0.5, desc: 'Enduite du venin des araignées du marais.', rarity: 'rare', weapon: { kind: 'dague', damage: 8, speed: 1.5, reach: 1.7, stamina: 6, element: 'poison' } },
  // défense
  { id: 'bouclier en bois', name: 'Bouclier en bois', cat: 'bouclier', value: 30, weight: 3, desc: 'Pare la plupart des coups.', shield: { block: 0.75 }, good: 'bois' },
  { id: 'bouclier de fer', name: 'Bouclier de fer', cat: 'bouclier', value: 90, weight: 5, desc: 'Lourd, mais rien ne passe.', shield: { block: 0.88 }, good: 'fer' },
  { id: 'tunique de cuir', name: 'Tunique de cuir', cat: 'armure', value: 35, weight: 3, desc: 'Armure légère.', armor: { slot: 'corps', value: 4 }, good: 'étoffe' },
  { id: 'gambison', name: 'Gambison matelassé', cat: 'armure', value: 50, weight: 4, desc: 'Plusieurs couches de lin.', armor: { slot: 'corps', value: 5 }, good: 'étoffe', repair: 'étoffe' },
  { id: 'cotte de mailles', name: 'Cotte de mailles', cat: 'armure', value: 160, weight: 10, desc: 'Arrête les lames.', armor: { slot: 'corps', value: 9 }, good: 'fer' },
  { id: 'casque de cuir', name: 'Casque de cuir', cat: 'armure', value: 15, weight: 1, desc: '', armor: { slot: 'tête', value: 1 }, good: 'étoffe' },
  { id: 'casque de fer', name: 'Casque de fer', cat: 'armure', value: 55, weight: 2.5, desc: '', armor: { slot: 'tête', value: 3 }, good: 'fer' },
  { id: 'gants', name: 'Gants de cuir', cat: 'armure', value: 12, weight: 0.5, desc: '', armor: { slot: 'mains', value: 1 }, good: 'étoffe' },
  { id: 'bottes', name: 'Bottes de marche', cat: 'armure', value: 18, weight: 1.5, desc: '', armor: { slot: 'pieds', value: 1 }, good: 'étoffe' },
  { id: 'gantelets de fer', name: 'Gantelets de fer', cat: 'armure', value: 40, weight: 1.2, desc: 'Mailles et plaques sur cuir.', armor: { slot: 'mains', value: 2 }, good: 'fer' },
  { id: 'bottes ferrées', name: 'Bottes ferrées', cat: 'armure', value: 45, weight: 2.5, desc: 'Le pas lourd, mais sûr.', armor: { slot: 'pieds', value: 2 }, good: 'fer' },
  { id: 'flèche', name: 'Flèche', cat: 'munition', value: 1, weight: 0.05, desc: 'Empennée de plumes d’oie.', good: 'bois' },
  // nourriture et potions
  { id: 'pain', name: 'Miche de pain', cat: 'nourriture', value: 3, weight: 0.3, desc: '', use: { hp: 8, stamina: 15 }, good: 'grain' },
  { id: 'fromage', name: 'Fromage', cat: 'nourriture', value: 5, weight: 0.4, desc: '', use: { hp: 12, stamina: 10 }, good: 'laine' },
  { id: 'pomme', name: 'Pomme', cat: 'nourriture', value: 2, weight: 0.2, desc: '', use: { hp: 5, stamina: 10 }, good: 'grain' },
  { id: 'viande crue', name: 'Viande crue', cat: 'nourriture', value: 3, weight: 0.6, desc: 'À cuire sur un feu ou dans un âtre.', use: { hp: 3, meal: false }, good: 'gibier' },
  { id: 'viande grillée', name: 'Viande grillée', cat: 'nourriture', value: 7, weight: 0.5, desc: '', use: { hp: 20, stamina: 20, meal: { t: 300, regen: 0.6, stam: 0.2 } }, good: 'gibier' },
  { id: 'poisson grillé', name: 'Poisson grillé', cat: 'nourriture', value: 6, weight: 0.4, desc: '', use: { hp: 15, stamina: 15, meal: { t: 240, regen: 0.5, stam: 0.15 } }, good: 'poisson' },
  { id: 'ragoût', name: 'Bol de ragoût', cat: 'nourriture', value: 9, weight: 0.6, desc: 'Spécialité de l’auberge. Réchauffe.', use: { hp: 30, stamina: 30, warm: 3, meal: { t: 300, regen: 0.6, stam: 0.2 } }, good: 'grain' },
  { id: 'bière', name: 'Chope de bière', cat: 'nourriture', value: 4, weight: 0.5, desc: '', use: { stamina: 40, drink: true }, good: 'grain' },
  { id: 'hydromel', name: 'Hydromel', cat: 'nourriture', value: 8, weight: 0.5, desc: '', use: { stamina: 60, hp: 5, drink: true }, good: 'vin' },
  { id: 'soupe de poisson', name: 'Soupe de poisson', cat: 'nourriture', value: 11, weight: 0.6, desc: 'Chaude et nourrissante. Réchauffe.', use: { hp: 25, stamina: 35, warm: 4, meal: { t: 360, regen: 0.6, stam: 0.35 } }, good: 'poisson' },
  { id: 'tourte à la viande', name: 'Tourte à la viande', cat: 'nourriture', value: 16, weight: 0.8, desc: 'Le repas qui tient au corps.', use: { hp: 45, stamina: 25, meal: { t: 480, regen: 0.8, stam: 0.25 } }, good: 'gibier' },
  { id: 'baies', name: 'Baies sauvages', cat: 'nourriture', value: 2, weight: 0.1, desc: 'Mûres, myrtilles, airelles. Potions d’endurance (établi).', use: { hp: 3, stamina: 8, meal: false }, good: 'herbes' },
  { id: 'potion de soin', name: 'Potion de soin', cat: 'potion', value: 30, weight: 0.3, desc: 'Rend 45 PV.', use: { hp: 45 }, good: 'herbes' },
  { id: 'grande potion de soin', name: 'Grande potion de soin', cat: 'potion', value: 70, weight: 0.4, desc: 'Rend 90 PV.', use: { hp: 90 }, good: 'herbes' },
  { id: 'potion d’endurance', name: 'Potion d’endurance', cat: 'potion', value: 25, weight: 0.3, desc: '', use: { stamina: 100 }, good: 'herbes' },
  { id: 'potion de mana', name: 'Potion de mana', cat: 'potion', value: 35, weight: 0.3, desc: '', use: { mana: 50 }, good: 'herbes' },
  { id: 'antidote', name: 'Antidote', cat: 'potion', value: 20, weight: 0.2, desc: 'Soigne le poison.', use: { cure: true, hp: 5 }, good: 'herbes' },
  { id: 'potion de force', name: 'Potion de force', cat: 'potion', value: 45, weight: 0.3, desc: 'Dégâts +25 % pendant 3 min.', use: { buff: { id: 'force', name: 'Force', t: 180, dmg: 0.25 } }, good: 'herbes' },
  { id: 'potion de chaleur', name: 'Potion de chaleur', cat: 'potion', value: 30, weight: 0.3, desc: 'Réchauffé 8 min : insensible au gel, dégâts de givre réduits de moitié.', use: { stamina: 20, warm: 8 }, good: 'herbes' },
  // événements vivants (étape 54) : remède des épidémies, objets particuliers des foires, prix du concours de tir
  // (sans bien économique : ils n'entrent ni dans les marchandises des caravanes, ni dans les épaves)
  { id: 'remède contre la fièvre', name: 'Remède contre la fièvre', cat: 'potion', value: 24, weight: 0.2, desc: 'Guérit les fièvres et protège de la contagion pendant une journée. Établi ou âtre de la guérisseuse : 2 herbes médicinales + 1 écorce.', use: { hp: 10, fever: true } },
  { id: 'pain d’épices', name: 'Pain d’épices', cat: 'nourriture', value: 9, weight: 0.3, desc: 'Miel et épices de la foire : il tient au corps.', use: { hp: 12, stamina: 30, meal: { t: 420, regen: 0.45, stam: 0.3 } } },
  { id: 'cidre', name: 'Pichet de cidre', cat: 'nourriture', value: 5, weight: 0.5, desc: 'Le cidre doux des jours de fête.', use: { stamina: 45, hp: 3, drink: true } },
  { id: 'élixir de foire', name: 'Élixir de foire', cat: 'potion', value: 55, weight: 0.3, desc: 'Le bonimenteur jure qu’il donne du cœur au ventre : dégâts +10 %, armure +2 pendant 4 min.', use: { buff: { id: 'élixir', name: 'Élixir', t: 240, dmg: 0.1, armor: 2 } } },
  { id: 'arc de concours', name: 'Arc de concours', cat: 'arme', value: 190, weight: 1.1, rarity: 'rare', desc: 'Un arc d’if poli, prix des concours de tir des jours de fête : précis et rapide.', weapon: { kind: 'arc', damage: 13, speed: 1.15, reach: 75, stamina: 6 } },
  { id: 'ruban de vainqueur', name: 'Ruban de vainqueur', cat: 'valeur', value: 15, weight: 0.01, desc: 'Remis au meilleur archer d’une fête de village.' },
  // matériaux
  { id: 'peau de cerf', name: 'Peau de cerf', cat: 'matériau', value: 10, weight: 1.4, desc: 'Une peau souple. Se tanne en cuir à l’établi (avec de l’écorce ou du sel).', good: 'laine' },
  { id: 'bois de cerf', name: 'Bois de cerf', cat: 'matériau', value: 9, weight: 0.8, desc: 'Ramure recherchée des artisans. Potion de chaleur (établi).', good: 'outils' },
  { id: 'peau de sanglier', name: 'Peau de sanglier', cat: 'matériau', value: 8, weight: 1.6, desc: 'Épaisse et rêche. Se tanne en cuir à l’établi.', good: 'laine' },
  { id: 'défense de sanglier', name: 'Défense de sanglier', cat: 'matériau', value: 7, weight: 0.2, desc: 'Potion de force (établi).', good: 'outils' },
  { id: 'plume', name: 'Plume', cat: 'matériau', value: 1, weight: 0.01, desc: 'Pour empenner des flèches (enclume).', good: 'laine' },
  { id: 'canne à pêche', name: 'Canne à pêche', cat: 'matériau', value: 12, weight: 1, desc: 'Au bord de l’eau : [E] pour lancer la ligne, puis [E] dès que ça mord.', good: 'outils' },
  { id: 'truite', name: 'Truite', cat: 'nourriture', value: 4, weight: 0.4, desc: 'À griller sur un feu.', use: { hp: 4, meal: false }, good: 'poisson' },
  { id: 'carpe', name: 'Carpe', cat: 'nourriture', value: 4, weight: 0.6, desc: 'À griller sur un feu.', use: { hp: 4, meal: false }, good: 'poisson' },
  { id: 'brochet', name: 'Brochet', cat: 'nourriture', value: 6, weight: 0.8, desc: 'À griller sur un feu.', use: { hp: 5, meal: false }, good: 'poisson' },
  { id: 'saumon', name: 'Saumon', cat: 'nourriture', value: 11, weight: 0.9, desc: 'Une belle prise !', use: { hp: 6, meal: false }, good: 'poisson', rarity: 'rare' },
  { id: 'anguille', name: 'Anguille', cat: 'nourriture', value: 5, weight: 0.5, desc: 'À griller sur un feu.', use: { hp: 4, meal: false }, good: 'poisson' },
  { id: 'hareng', name: 'Hareng', cat: 'nourriture', value: 3, weight: 0.3, desc: 'À griller sur un feu.', use: { hp: 3, meal: false }, good: 'poisson' },
  { id: 'bar', name: 'Bar', cat: 'nourriture', value: 6, weight: 0.7, desc: 'À griller sur un feu.', use: { hp: 5, meal: false }, good: 'poisson' },
  { id: 'morue', name: 'Morue', cat: 'nourriture', value: 7, weight: 0.9, desc: 'À griller sur un feu.', use: { hp: 5, meal: false }, good: 'poisson' },
  { id: 'vieille botte', name: 'Vieille botte', cat: 'matériau', value: 0, weight: 0.8, desc: 'Ça a mordu, pourtant…' },
  { id: 'peau de loup', name: 'Peau de loup', cat: 'matériau', value: 12, weight: 1.5, desc: 'Le tanneur en donne un bon prix. Se tanne en cuir à l’établi.', good: 'laine' },
  { id: 'croc de loup', name: 'Croc de loup', cat: 'matériau', value: 4, weight: 0.05, desc: 'Potion de force (établi).', good: 'gibier' },
  { id: 'lingot de fer', name: 'Lingot de fer', cat: 'matériau', value: 18, weight: 1.5, desc: 'Enclume : armes, armures, flèches, réparations.', good: 'fer' },
  { id: 'bois', name: 'Bûches', cat: 'matériau', value: 2, weight: 2, desc: 'Bois de chauffe et de construction.', good: 'bois' },
  // outils et ressources récoltées
  { id: 'hache de bûcheron', name: 'Hache de bûcheron', cat: 'arme', value: 25, weight: 2.2, desc: 'Abat les arbres : bûches, branches, écorce. Se manie aussi au combat.', weapon: { kind: 'hache', damage: 8, speed: 0.95, reach: 1.9, stamina: 9 }, good: 'outils', wear: 250 },
  { id: 'pioche', name: 'Pioche', cat: 'arme', value: 28, weight: 2.8, desc: 'Brise la roche : pierre, minerai de fer, charbon, parfois de l’or ou une gemme.', weapon: { kind: 'pioche', damage: 8, speed: 0.85, reach: 1.9, stamina: 10 }, good: 'outils', wear: 250 },
  { id: 'crochet', name: 'Crochet de serrurier', cat: 'matériau', value: 6, weight: 0.05, desc: 'Pour crocheter les coffres verrouillés (il peut se briser).', good: 'outils' },
  { id: 'branche', name: 'Branches', cat: 'matériau', value: 1, weight: 0.4, desc: 'Hampes de flèches (enclume), petit bois.', good: 'bois' },
  { id: 'écorce', name: 'Écorce', cat: 'matériau', value: 3, weight: 0.2, desc: 'Tanin et remèdes (établi : potions, tannage des peaux).', good: 'herbes' },
  { id: 'pierre', name: 'Pierres', cat: 'matériau', value: 2, weight: 3, desc: 'Moellons de construction.', good: 'pierre' },
  { id: 'minerai de fer', name: 'Minerai de fer', cat: 'matériau', value: 8, weight: 2.5, desc: 'Se fond au foyer d’une forge : 2 minerais + 1 charbon = 1 lingot.', good: 'minerai' },
  { id: 'charbon', name: 'Charbon', cat: 'matériau', value: 4, weight: 1, desc: 'Combustible de forge.', good: 'minerai' },
  { id: 'pépite d’or', name: 'Pépite d’or', cat: 'valeur', value: 45, weight: 0.1, desc: 'Se revend bien.', good: 'minerai' },
  { id: 'gemme brute', name: 'Gemme brute', cat: 'valeur', value: 70, weight: 0.1, desc: 'Une pierre précieuse à polir.', good: 'minerai' },
  { id: 'herbe médicinale', name: 'Herbe médicinale', cat: 'matériau', value: 5, weight: 0.1, desc: 'Base des potions (établi). Pousse sur les buissons des bois et des marais.', good: 'herbes' },
  { id: 'soie d’araignée', name: 'Soie d’araignée', cat: 'matériau', value: 14, weight: 0.2, desc: '', good: 'étoffe' },
  { id: 'glande à venin', name: 'Glande à venin', cat: 'matériau', value: 20, weight: 0.1, desc: 'Antidotes (établi).', good: 'herbes' },
  { id: 'os', name: 'Os', cat: 'matériau', value: 1, weight: 0.3, desc: 'Pointes de flèches de fortune (enclume).' },
  { id: 'essence spectrale', name: 'Essence spectrale', cat: 'matériau', value: 40, weight: 0.1, desc: 'Froide comme la tombe. Potions de mana (établi).' },
  { id: 'cœur de troll', name: 'Cœur de troll', cat: 'matériau', value: 150, weight: 3, desc: 'Il bat encore, faiblement.' },
  // créatures des grottes (étape 55)
  { id: 'peau d’ours', name: 'Peau d’ours', cat: 'matériau', value: 30, weight: 3, desc: 'Épaisse et chaude. Se tanne en cuir à l’établi.', good: 'laine' },
  { id: 'griffe d’ours', name: 'Griffe d’ours', cat: 'matériau', value: 9, weight: 0.05, desc: 'Potion de force (établi).', good: 'gibier' },
  { id: 'aile de chauve-souris', name: 'Aile de chauve-souris', cat: 'matériau', value: 6, weight: 0.05, desc: 'Membrane séchée : potion de mana (établi).', good: 'herbes' },
  { id: 'étoffe', name: 'Rouleau d’étoffe', cat: 'matériau', value: 10, weight: 1, desc: 'Gambison (enclume) ; répare les armures d’étoffe.', good: 'étoffe' },
  { id: 'sel', name: 'Sac de sel', cat: 'matériau', value: 8, weight: 2, desc: '', good: 'sel' },
  { id: 'outils', name: 'Outils', cat: 'matériau', value: 15, weight: 2, desc: '', good: 'outils' },
  { id: 'cuir', name: 'Cuir tanné', cat: 'matériau', value: 7, weight: 0.6, desc: 'Peau tannée à l’établi. Armures légères, poignées, réparations.', good: 'étoffe' },
  { id: 'champignon', name: 'Champignons', cat: 'matériau', value: 3, weight: 0.1, desc: 'Cèpes et girolles : ragoût, tourte, potion de mana.', good: 'herbes' },
  // butin unique des boss des chaînes de quêtes (épique : effets portés, usure comme les autres armes et armures)
  { id: 'écorcheuse', name: 'Écorcheuse', cat: 'arme', value: 650, weight: 2, rarity: 'épique', wear: 450, desc: 'L’épée du Seigneur-Brigand : elle achève sans pitié.', weapon: { kind: 'épée', damage: 18, speed: 1.0, reach: 2.3, stamina: 10 }, fx: { melee: 0.1, execute: 0.3 } },
  { id: 'croc-de-lune', name: 'Croc-de-Lune', cat: 'arme', value: 560, weight: 0.5, rarity: 'épique', wear: 450, desc: 'Taillée dans le croc d’un loup géant, froide comme une nuit d’hiver.', weapon: { kind: 'dague', damage: 10, speed: 1.6, reach: 1.8, stamina: 5, element: 'givre' }, fx: { atkSpeed: 0.1, sneak: 0.5 } },
  { id: 'heaume royal', name: 'Heaume du Roi des galeries', cat: 'armure', value: 600, weight: 2.5, rarity: 'épique', wear: 450, desc: 'Une couronne de fer martelée par des mains gobelines.', armor: { slot: 'tête', value: 5 }, fx: { armorPct: 0.1, carry: 15 } },
  { id: 'linceul des cendres', name: 'Linceul des cendres', cat: 'armure', value: 700, weight: 3, rarity: 'épique', wear: 450, repair: 'étoffe', desc: 'Le suaire d’un seigneur mort, tissé de fils d’argent.', armor: { slot: 'corps', value: 6 }, fx: { manaMax: 25, manaRegen: 0.5, spell: 0.1 } },
  { id: 'glas', name: 'Glas', cat: 'arme', value: 680, weight: 3, rarity: 'épique', wear: 450, desc: 'La masse du Roi déchu : chaque coup sonne comme un glas.', weapon: { kind: 'masse', damage: 19, speed: 0.85, reach: 2.0, stamina: 12, element: 'feu' }, fx: { heavy: 0.4 } },
  { id: 'fend-montagne', name: 'Fend-Montagne', cat: 'arme', value: 720, weight: 3.2, rarity: 'épique', wear: 450, desc: 'Une hache de troll retaillée pour une main d’homme.', weapon: { kind: 'hache', damage: 22, speed: 0.78, reach: 2.1, stamina: 13 }, fx: { melee: 0.08, staCost: 0.15 } },
  { id: 'arc de la tisseuse', name: 'Arc de la Tisseuse', cat: 'arme', value: 680, weight: 1.3, rarity: 'épique', wear: 450, desc: 'Sa corde de soie d’araignée ne se détend jamais ; ses flèches empoisonnent.', weapon: { kind: 'arc', damage: 17, speed: 1.0, reach: 85, stamina: 8, element: 'poison' }, fx: { bowRate: 0.15, bow: 0.1 } },
  { id: 'pavois du veilleur', name: 'Pavois du Veilleur', cat: 'bouclier', value: 600, weight: 5, rarity: 'épique', wear: 450, desc: 'Le bouclier d’un champion mort : il ne recule jamais.', shield: { block: 0.92 }, fx: { guard: 0.15, blockSta: 0.2 } },
  // valeurs
  { id: 'pièces anciennes', name: 'Pièces anciennes', cat: 'valeur', value: 25, weight: 0.1, desc: 'Frappées d’un royaume oublié.' },
  { id: 'bague en or', name: 'Bague en or', cat: 'valeur', value: 60, weight: 0.05, desc: '' },
  { id: 'gemme', name: 'Gemme taillée', cat: 'valeur', value: 120, weight: 0.05, desc: '' },
  { id: 'coupe d’argent', name: 'Coupe d’argent', cat: 'valeur', value: 45, weight: 0.5, desc: '' },
];

// parchemins : un par sort à apprendre
for (const s of SPELLS) if (s.price) D.push({ id: scrollId(s.id), name: `Parchemin : ${s.name}`, cat: 'parchemin', value: s.price, weight: 0.1, desc: `${s.desc} Lire le parchemin (Entrée dans l'inventaire) apprend le sort pour toujours ; le parchemin se consume.` });

/** Usure : un exemplaire usé porte son état dans son id (« épée courte~62 ») ; sans suffixe = 100 %. */
export const WEAR_SEP = '~';
/** Suffixe des pièces « de qualité ». */
export const QUALITY = ' de qualité';
/** Objets que l'enclume peut réussir « de qualité » (une recette de qualité par objet). */
export const QUALITY_BASES = ['dague', 'lance', 'épée courte', 'masse', 'hache', 'épée longue', 'gants', 'casque de cuir', 'bottes', 'tunique de cuir',
  'bouclier en bois', 'gambison', 'casque de fer', 'gantelets de fer', 'bottes ferrées', 'bouclier de fer', 'cotte de mailles'];

export function baseId(id: string): string { const i = id.lastIndexOf(WEAR_SEP); return i < 0 ? id : id.slice(0, i); }
/** id sans état ni « de qualité » (recette d'origine) */
export function plainId(id: string): string { const b = baseId(id); return b.endsWith(QUALITY) ? b.slice(0, -QUALITY.length) : b; }
/** État 0-100 d'un exemplaire (100 si pas de suffixe ou suffixe invalide). */
export function durOf(id: string): number { const i = id.lastIndexOf(WEAR_SEP); if (i < 0) return 100; const s = id.slice(i + 1); return /^\d{1,3}$/.test(s) && +s <= 100 ? +s : 100; }
/** id d'un exemplaire à un état donné (borné, arrondi ; 100 → id nu). */
export function withDur(id: string, dur: number): string { const b = baseId(id), v = Math.max(0, Math.min(100, Math.round(dur))); return v >= 100 ? b : `${b}${WEAR_SEP}${v}`; }
export function wearable(d: ItemDef): boolean { return !!(d.weapon || d.armor || d.shield); }
/** Solidité (usages avant d'être hors d'usage). */
export function wearOf(d: ItemDef): number {
  if (d.wear) return d.wear;
  if (d.weapon) return d.rarity ? 300 : d.weapon.kind === 'arc' ? 250 : d.weapon.kind === 'dague' ? 150 : d.weapon.kind === 'bâton' ? 120 : 200;
  if (d.shield) return d.good === 'fer' ? 160 : 90;
  return d.good === 'fer' ? 200 : 140;
}
/** Efficacité selon l'état : ≥ 50 % ×1 · 25-49 % ×0,85 · 1-24 % ×0,65 · 0 : hors d'usage. */
export function wearFactor(dur: number): number { return dur <= 0 ? 0 : dur < 25 ? 0.65 : dur < 50 ? 0.85 : 1; }
export function wearState(dur: number): string { return dur <= 0 ? 'hors d’usage' : dur < 25 ? 'usure critique' : dur < 50 ? 'usure visible' : dur < 100 ? 'bon état' : 'parfait état'; }
/** id reçu d'un autre joueur : état normalisé (suffixe 100 ou invalide retiré, suffixe sur un objet qui ne s'use pas ignoré). */
export function cleanId(id: string): string { if (!id.includes(WEAR_SEP)) return id; const b = baseId(id); return wearable(item(b)) ? withDur(b, durOf(id)) : b; }

// pièces « de qualité » : un vrai objet par base forgeable
for (const id of QUALITY_BASES) {
  const b = D.find((d) => d.id === id)!;
  D.push({ ...b, id: id + QUALITY, name: b.name + QUALITY, quality: true, value: Math.round(b.value * 1.6), wear: Math.round(wearOf(b) * 1.5),
    desc: `${b.desc ? b.desc + ' ' : ''}Pièce de qualité : ${b.weapon ? 'dégâts accrus' : b.shield ? 'parade accrue' : 'armure +1'}, plus solide.`,
    weapon: b.weapon && { ...b.weapon, damage: b.weapon.damage + Math.max(1, Math.round(b.weapon.damage * 0.15)) },
    armor: b.armor && { ...b.armor, value: b.armor.value + 1 },
    shield: b.shield && { block: Math.min(0.95, b.shield.block + 0.05) } });
}

export const ITEMS = new Map<string, ItemDef>(D.map((d) => [d.id, d]));
/** cache des définitions usées (le poids est calculé à chaque image) */
const WORN = new Map<string, ItemDef>();

/** Définition d'un objet, y compris les objets dynamiques (clés, objets de quête, exemplaires usés). */
export function item(id: string): ItemDef {
  const d = ITEMS.get(id);
  if (d) return d;
  if (id.startsWith('clé:')) return { id, name: `Clé de fer (${id.split(':')[2] ?? 'donjon'})`, cat: 'clé', value: 0, weight: 0.05, desc: 'Ouvre une porte quelque part sous terre.' };
  if (id.startsWith('quête:')) {
    const [, kind, , label] = id.split(':');
    const names: Record<string, string> = { marchandises: 'Marchandises volées', relique: 'Relique sacrée', journal: 'Journal de l’expédition', trophée: 'Trophée de chasse',
      // objets des chaînes de quêtes
      lettre: 'Lettre cachetée', registre: 'Registre des rançons', carnet: 'Carnet du chasseur disparu', plan: 'Plan des galeries', grimoire: 'Grimoire noir', sceau: 'Sceau royal brisé', fiole: 'Fiole de venin pur', étendard: 'Étendard en lambeaux' };
    return { id, name: label ? `${names[kind] ?? kind} (${label})` : names[kind] ?? kind, cat: 'quête', value: 0, weight: 1, desc: 'Objet de quête.' };
  }
  const at = id.lastIndexOf(WEAR_SEP);
  if (at > 0) {
    let w = WORN.get(id);
    if (!w) { w = wornDef(item(id.slice(0, at)), id, durOf(id)); WORN.set(id, w); }
    return w;
  }
  return { id, name: id, cat: 'valeur', value: 1, weight: 0.1, desc: '' };
}

/** Définition d'un exemplaire usé : nom avec l'état, caractéristiques et valeur réduites. */
function wornDef(b: ItemDef, id: string, dur: number): ItemDef {
  if (!wearable(b) || dur >= 100) return b;
  const f = wearFactor(dur);
  return { ...b, id, dur, name: `${b.name} (${dur > 0 ? dur + ' %' : 'hors d’usage'})`,
    value: Math.max(1, Math.round(b.value * (dur > 0 ? 0.3 + 0.7 * dur / 100 : 0.2))),
    weapon: b.weapon && { ...b.weapon, damage: Math.round(b.weapon.damage * f) },
    armor: b.armor && { ...b.armor, value: Math.round(b.armor.value * f) },
    shield: b.shield && { block: Math.round(b.shield.block * f * 100) / 100 } };
}

export class Inventory {
  readonly items = new Map<string, number>();
  gold = 0;

  add(id: string, qty = 1): void { if (qty > 0) this.items.set(id, (this.items.get(id) ?? 0) + qty); }
  remove(id: string, qty = 1): boolean {
    const n = this.items.get(id) ?? 0;
    if (n < qty) return false;
    if (n === qty) this.items.delete(id); else this.items.set(id, n - qty);
    return true;
  }
  count(id: string): number { return this.items.get(id) ?? 0; }
  weight(): number { let w = 0; for (const [id, n] of this.items) w += item(id).weight * n; return w; }
  list(): { id: string; qty: number; def: ItemDef }[] {
    const order: ItemCat[] = ['arme', 'bouclier', 'armure', 'munition', 'potion', 'nourriture', 'clé', 'quête', 'matériau', 'valeur'];
    return [...this.items].map(([id, qty]) => ({ id, qty, def: item(id) }))
      .sort((a, b) => order.indexOf(a.def.cat) - order.indexOf(b.def.cat) || a.def.name.localeCompare(b.def.name) || a.id.localeCompare(b.id));
  }
}
