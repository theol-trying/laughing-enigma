import { FISH, item, baseId, plainId, durOf, wearable, QUALITY, type Inventory, type ItemDef } from './Items';
import type { Character } from './Character';

// Artisanat : recettes déclaratives par atelier (ingrédients, produit, compétence requise, pratique),
// fabrication en lot, pièces « de qualité », réparation à l'enclume ou chez un forgeron.

/** Atelier : enclume (forge), foyer de forge (fonte), établi (alchimie, tannage), feu (âtre, feu de camp : cuisine), âtre d'une guérisseuse. */
export type Workshop = 'enclume' | 'foyer de forge' | 'établi' | 'feu' | 'guérisseuse';
export type CraftTab = 'Armes' | 'Armures' | 'Munitions' | 'Réparer' | 'Fonte' | 'Potions' | 'Tannage' | 'Cuisine';
/** Un ingrédient : l'un des ids (consommés dans l'ordre), en quantité ; label si plusieurs ids. */
export interface Ingredient { ids: string[]; qty: number; label?: string }
export interface Recipe {
  id: string;                          // clé unique (« flèche:os »…)
  tab: Exclude<CraftTab, 'Réparer'>;   // l'onglet désigne l'atelier (TAB_PLACE)
  out: string; qty: number;
  ins: Ingredient[];
  skill: number;                       // artisanat requis
  xp: number;                          // pratique d'artisanat par fabrication
  verb: string;                        // bouton : Forger, Fondre, Carboniser, Préparer, Tanner, Griller, Cuisiner
  label?: string;                      // nom dans la liste (recettes alternatives)
  perSkill?: number;                   // +1 produit par tranche de N points d'artisanat (flèches)
  quality?: boolean;                   // peut sortir « de qualité »
  bulk?: boolean;                      // quantité proposée par défaut : le maximum
}
export interface CraftResult { made: number; per: number; good: number; used: [string, number][] }

export const WORKSHOP_TABS: Record<Workshop, CraftTab[]> = {
  enclume: ['Armes', 'Armures', 'Munitions', 'Réparer'], 'foyer de forge': ['Fonte', 'Cuisine'],
  établi: ['Potions', 'Tannage'], feu: ['Cuisine'], guérisseuse: ['Cuisine', 'Potions'],
};
export const WORKSHOP_TITLE: Record<Workshop, string> = {
  enclume: 'Enclume — forge et réparation', 'foyer de forge': 'Foyer de forge — fonte et cuisine',
  établi: 'Établi — potions et tannage', feu: 'Cuisine', guérisseuse: 'Âtre de la guérisseuse — cuisine et potions',
};
/** Invite [E] (jamais vide : l'atelier reste ciblable). */
export const WORKSHOP_LABEL: Record<Workshop, string> = {
  enclume: 'Enclume : forger et réparer', 'foyer de forge': 'Foyer de forge : fondre le minerai, cuisiner',
  établi: 'Établi : potions et tannage', feu: 'Cuisiner', guérisseuse: 'Âtre de la guérisseuse : cuisine et potions',
};
/** Indication atténuée quand rien n'est faisable. */
export const WORKSHOP_IDLE: Record<Workshop, string> = {
  enclume: 'voir les recettes et ce qui manque', 'foyer de forge': 'il faut 2 minerais de fer + 1 charbon (ou 3 bûches pour du charbon)',
  établi: 'herbes, baies, champignons, peaux…', feu: 'viande, poisson, champignons…', guérisseuse: 'viande, poisson, herbes, baies…',
};
export const TAB_PLACE: Record<CraftTab, string> = { Armes: 'enclume', Armures: 'enclume', Munitions: 'enclume', Réparer: 'enclume', Fonte: 'foyer de forge', Potions: 'établi', Tannage: 'établi', Cuisine: 'feu ou âtre' };
export const TAB_HELP: Record<CraftTab, string> = {
  Armes: 'Lingots au foyer de forge, cuir à l’établi. Un bon artisan réussit des pièces de qualité.',
  Armures: 'Une pièce de qualité protège mieux et s’use moins vite. Le cuir se tanne à l’établi.',
  Munitions: 'Chaque tranche de 10 points d’artisanat ajoute une flèche par fournée.',
  Réparer: 'Porté, l’équipement s’use ; à 0 % il est hors d’usage. Un forgeron répare aussi, contre de l’or.',
  Fonte: '2 minerais de fer + 1 charbon = 1 lingot. Pas de charbon ? 3 bûches en donnent un.',
  Potions: 'Herbes, baies et champignons poussent sur les buissons ; crocs et glandes viennent des bêtes.',
  Tannage: 'Une peau de bête et de l’écorce (ou du sel) donnent deux cuirs.',
  Cuisine: 'Un plat cuisiné rassasie bien plus longtemps que la nourriture crue ; certains réchauffent.',
};
export const VERB_DONE: Record<string, string> = { Forger: 'Vous forgez', Fondre: 'Vous fondez', Carboniser: 'Vous carbonisez', Préparer: 'Vous préparez', Tanner: 'Vous tannez', Griller: 'Vous faites griller', Cuisiner: 'Vous cuisinez' };

type In = [ids: string | string[], qty: number, label?: string];
function R(tab: Recipe['tab'], out: string, qty: number, ins: In[], skill: number, xp: number, verb: string, o: Partial<Recipe> = {}): Recipe {
  return { id: out, tab, out, qty, ins: ins.map(([ids, q, label]) => ({ ids: typeof ids === 'string' ? [ids] : ids, qty: q, label })), skill, xp, verb, ...o };
}
/** poissons crus, du moins cher au plus cher (consommés dans cet ordre) */
const FISH_CHEAP = [...FISH].sort((a, b) => item(a).value - item(b).value);
const BOIS: In = [['branche', 'bois'], 1, 'Branches ou bûches'];
const PEAU: In = [['peau de sanglier', 'peau de cerf', 'peau de loup'], 1, 'Peau de bête'];
const TANIN: In = [['écorce', 'sel'], 1, 'Écorce ou sel'];
const POISSON = (n: number): In => [FISH_CHEAP, n, 'Poisson cru (au choix)'];

export const RECIPES: Recipe[] = [
  // enclume : armes
  R('Armes', 'dague', 1, [['lingot de fer', 1], ['cuir', 1]], 0, 3, 'Forger', { quality: true }),
  R('Armes', 'hache de bûcheron', 1, [['lingot de fer', 1], ['bois', 1]], 0, 2, 'Forger'),
  R('Armes', 'pioche', 1, [['lingot de fer', 1], ['bois', 1]], 0, 2, 'Forger'),
  R('Armes', 'lance', 1, [['lingot de fer', 1], ['bois', 2]], 5, 3, 'Forger', { quality: true }),
  R('Armes', 'épée courte', 1, [['lingot de fer', 2], ['cuir', 1]], 10, 4, 'Forger', { quality: true }),
  R('Armes', 'masse', 1, [['lingot de fer', 3], ['bois', 1]], 15, 5, 'Forger', { quality: true }),
  R('Armes', 'hache', 1, [['lingot de fer', 3], ['bois', 1], ['cuir', 1]], 15, 5, 'Forger', { quality: true }),
  R('Armes', 'épée longue', 1, [['lingot de fer', 4], ['cuir', 1], ['charbon', 1]], 25, 7, 'Forger', { quality: true }),
  // enclume : armures et boucliers
  R('Armures', 'gants', 1, [['cuir', 2]], 0, 2, 'Forger', { quality: true }),
  R('Armures', 'casque de cuir', 1, [['cuir', 2]], 0, 2, 'Forger', { quality: true }),
  R('Armures', 'bottes', 1, [['cuir', 3]], 0, 3, 'Forger', { quality: true }),
  R('Armures', 'tunique de cuir', 1, [['cuir', 4]], 5, 4, 'Forger', { quality: true }),
  R('Armures', 'bouclier en bois', 1, [['bois', 4], ['cuir', 1]], 5, 3, 'Forger', { quality: true }),
  R('Armures', 'gambison', 1, [['étoffe', 4]], 8, 4, 'Forger', { quality: true }),
  R('Armures', 'casque de fer', 1, [['lingot de fer', 2], ['cuir', 1]], 12, 5, 'Forger', { quality: true }),
  R('Armures', 'gantelets de fer', 1, [['lingot de fer', 1], ['cuir', 2]], 15, 5, 'Forger', { quality: true }),
  R('Armures', 'bottes ferrées', 1, [['lingot de fer', 1], ['cuir', 3]], 15, 5, 'Forger', { quality: true }),
  R('Armures', 'bouclier de fer', 1, [['lingot de fer', 3], ['bois', 1], ['cuir', 1]], 20, 7, 'Forger', { quality: true }),
  R('Armures', 'cotte de mailles', 1, [['lingot de fer', 6], ['cuir', 1]], 30, 10, 'Forger', { quality: true }),
  // enclume : munitions (la première reproduit l'existant : 8 + floor(artisanat / 10), branche d'abord)
  R('Munitions', 'flèche', 8, [BOIS, ['lingot de fer', 1]], 0, 3, 'Forger', { perSkill: 10, label: 'Flèches (pointes de fer)' }),
  R('Munitions', 'flèche', 6, [['os', 2], ['branche', 2], ['plume', 2]], 0, 2, 'Forger', { id: 'flèche:os', label: 'Flèches (pointes d’os)' }),
  // foyer de forge
  R('Fonte', 'lingot de fer', 1, [['minerai de fer', 2], ['charbon', 1]], 0, 2, 'Fondre', { bulk: true }),
  R('Fonte', 'charbon', 1, [['bois', 3]], 0, 0.5, 'Carboniser', { bulk: true, label: 'Charbon de bois' }),
  // établi (et âtre de la guérisseuse) : potions
  R('Potions', 'potion de soin', 1, [['herbe médicinale', 2]], 0, 3, 'Préparer'),
  R('Potions', 'potion de soin', 1, [['herbe médicinale', 1], ['écorce', 1]], 0, 3, 'Préparer', { id: 'potion de soin:écorce', label: 'Potion de soin (à l’écorce)' }),
  R('Potions', 'antidote', 2, [['glande à venin', 1], ['herbe médicinale', 1]], 5, 3, 'Préparer'),
  R('Potions', 'potion d’endurance', 1, [['baies', 2], ['herbe médicinale', 1]], 10, 3, 'Préparer'),
  R('Potions', 'potion de chaleur', 1, [['bois de cerf', 1], ['herbe médicinale', 1]], 15, 3, 'Préparer'),
  R('Potions', 'potion de mana', 1, [['champignon', 2], ['herbe médicinale', 1]], 15, 4, 'Préparer'),
  R('Potions', 'potion de force', 1, [[['croc de loup', 'défense de sanglier'], 2, 'Crocs ou défenses'], ['herbe médicinale', 1]], 20, 4, 'Préparer'),
  R('Potions', 'potion de mana', 2, [['essence spectrale', 1], ['champignon', 1]], 25, 5, 'Préparer', { id: 'potion de mana:essence', label: 'Potion de mana (à l’essence)' }),
  R('Potions', 'grande potion de soin', 1, [['potion de soin', 1], ['herbe médicinale', 2], ['champignon', 1]], 30, 6, 'Préparer'),
  // établi : tannage
  R('Tannage', 'cuir', 2, [PEAU, TANIN], 0, 1.5, 'Tanner', { bulk: true }),
  // cuisine (âtre, feu, foyer)
  R('Cuisine', 'viande grillée', 1, [['viande crue', 1]], 0, 1, 'Griller', { bulk: true }),
  R('Cuisine', 'poisson grillé', 1, [POISSON(1)], 0, 0.5, 'Griller', { bulk: true }),
  R('Cuisine', 'ragoût', 2, [['viande crue', 2], ['champignon', 1]], 5, 2, 'Cuisiner'),
  R('Cuisine', 'soupe de poisson', 2, [POISSON(2), [['champignon', 'sel'], 1, 'Champignons ou sel']], 5, 2, 'Cuisiner'),
  R('Cuisine', 'tourte à la viande', 1, [['viande crue', 1], ['pain', 1], [['champignon', 'fromage'], 1, 'Champignons ou fromage']], 12, 3, 'Cuisiner'),
];

/** Où trouver un ingrédient (affiché sous un ingrédient manquant). */
export const SOURCES: Record<string, string> = {
  'lingot de fer': 'foyer de forge (2 minerais + 1 charbon) · forgeron, mineur',
  'minerai de fer': 'rochers (pioche), surtout en montagne · mineur',
  charbon: 'rochers (pioche) · foyer de forge (3 bûches) · forgeron',
  cuir: 'établi : tanner une peau (+ écorce ou sel) · chasseur, marchand',
  bois: 'arbres (hache de bûcheron) · marchand', branche: 'arbres (hache de bûcheron)', écorce: 'arbres (hache de bûcheron)',
  étoffe: 'marchand · maisons', os: 'squelettes, gobelins', plume: 'perdrix', sel: 'marchand, pêcheur',
  'herbe médicinale': 'buissons (forêt, marais) · guérisseuse', baies: 'buissons (lande, forêt, plaine) · fermier, guérisseuse',
  champignon: 'buissons (forêt, marais, taïga) · arbres abattus · guérisseuse',
  'glande à venin': 'araignées (marais)', 'bois de cerf': 'cerfs', 'croc de loup': 'loups', 'défense de sanglier': 'sangliers',
  'essence spectrale': 'spectres (cimetières, la nuit)', 'potion de soin': 'établi · guérisseuse, prêtre, marchand',
  'peau de sanglier': 'sangliers', 'peau de cerf': 'cerfs', 'peau de loup': 'loups',
  'viande crue': 'chasse (cerfs, sangliers, loups) · fermier, chasseur', pain: 'fermier, aubergiste, meunier, marchand', fromage: 'fermier, aubergiste, marchand',
};
for (const f of FISH) SOURCES[f] = 'pêche (canne à pêche) · pêcheur';

export function recipesFor(tab: CraftTab): Recipe[] { return RECIPES.filter((r) => r.tab === tab); }
/** Recette d'origine d'un objet (qualité et usure ignorées). */
export function recipeFor(id: string): Recipe | undefined { const p = plainId(id); return RECIPES.find((r) => r.out === p); }
/** Recettes qui consomment cet objet. */
export function usesOf(id: string): Recipe[] { return RECIPES.filter((r) => r.ins.some((g) => g.ids.includes(id))); }
export function have(inv: Inventory, g: Ingredient): number { let n = 0; for (const id of g.ids) n += inv.count(id); return n; }
export function maxBatch(inv: Inventory, r: Recipe, skill: number, cap = 99): number {
  if (skill < r.skill) return 0;
  let m = cap;
  for (const g of r.ins) m = Math.min(m, Math.floor(have(inv, g) / g.qty));
  return m;
}
export function missing(inv: Inventory, r: Recipe, n: number): { ing: Ingredient; lack: number }[] {
  return r.ins.map((g) => ({ ing: g, lack: g.qty * n - have(inv, g) })).filter((x) => x.lack > 0);
}
export function outQty(r: Recipe, skill: number): number { return r.qty + (r.perSkill ? Math.floor(skill / r.perSkill) : 0); }
/** Chance de pièce de qualité : +2 % par point d'artisanat au-dessus du requis, 60 % au plus. */
export function qualityChance(r: Recipe, skill: number): number { return r.quality ? Math.max(0, Math.min(0.6, (skill - r.skill) * 0.02)) : 0; }
/** Recettes faisables tout de suite dans ces onglets (indication [E]). */
export function craftableCount(inv: Inventory, tabs: CraftTab[], skill: number): number { return RECIPES.filter((r) => tabs.includes(r.tab) && maxBatch(inv, r, skill) > 0).length; }
/** Fabrique n fois (borné au possible) ; la pratique est à la charge de l'appelant. */
export function craft(inv: Inventory, r: Recipe, n: number, skill: number, rnd: () => number = Math.random): CraftResult | null {
  n = Math.min(n, maxBatch(inv, r, skill));
  if (n <= 0) return null;
  const used: [string, number][] = [];
  for (const g of r.ins) {
    let need = g.qty * n;
    for (const id of g.ids) { const take = Math.min(inv.count(id), need); if (take > 0) { inv.remove(id, take); used.push([id, take]); need -= take; } }
  }
  const per = outQty(r, skill), q = qualityChance(r, skill);
  let good = 0;
  if (r.quality) for (let i = 0; i < n; i++) if (rnd() < q) good++;
  inv.add(r.out, (n - good) * per);
  if (good) inv.add(r.out + QUALITY, good * per);
  return { made: n, per, good, used };
}

/** Matériau de réparation : bois (arcs, bâtons, bois), cuir (cuir, étoffe), lingot (le reste, armes rares comprises). */
export function repairMat(d: ItemDef): string {
  if (d.repair) return d.repair;
  if (d.weapon?.kind === 'arc' || d.weapon?.kind === 'bâton' || d.good === 'bois') return 'bois';
  if (d.good === 'étoffe') return 'cuir';
  return 'lingot de fer';
}
/** Réparation à l'enclume jusqu'à 100 % : la moitié du matériau de fabrication, au prorata de l'usure (1 au moins) ; pièces rares : artisanat 30. */
export function repairNeed(id: string): { mat: string; n: number; skill: number } | null {
  const d = item(id), dur = durOf(id);
  if (!wearable(d) || dur >= 100) return null;
  const mat = repairMat(d);
  const full = recipeFor(id)?.ins.find((g) => g.ids.includes(mat))?.qty ?? Math.max(1, Math.round(item(baseId(id)).value / 40));
  return { mat, n: Math.max(1, Math.ceil(full * (100 - dur) / 100 * 0.5)), skill: d.rarity ? 30 : 0 };
}
/** Répare dans l'ordre les exemplaires donnés (un id par exemplaire) tant que matériaux et compétence suffisent. */
export function repairAt(ch: Character, ids: string[]): { fixed: string[]; used: [string, number][]; blocked: string | null } {
  const fixed: string[] = [], used = new Map<string, number>();
  let blocked: string | null = null;
  for (const id of ids) {
    const need = repairNeed(id);
    if (!need || ch.inv.count(id) <= 0) continue;
    if (ch.skills.artisanat < need.skill) { blocked ??= `Pièce rare : Artisanat ${need.skill} requis. Un forgeron saura la réparer.`; continue; }
    const got = ch.inv.count(need.mat);
    if (got < need.n) { blocked ??= `Il manque : ${need.n - got} × ${item(need.mat).name}.`; continue; }
    ch.inv.remove(need.mat, need.n);
    used.set(need.mat, (used.get(need.mat) ?? 0) + need.n);
    fixed.push(ch.setDur(id, 100));
  }
  return { fixed, used: [...used], blocked };
}
/** Prix de la réparation chez un forgeron : 40 % du prix d'achat local × part usée (2 or au moins). */
export function goldRepairCost(id: string, unitPrice: number): number { return Math.max(2, Math.round(unitPrice * (100 - durOf(id)) / 100 * 0.4)); }
