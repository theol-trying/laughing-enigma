import type { Good } from '@ascii-fort/worldgen/civilization/types';

// Catalogue des objets. Les clés de donjon et objets de quête sont créés dynamiquement
// (« clé:3 », « quête:relique:7 »…) mais partagent la même interface.

export type ItemCat = 'arme' | 'armure' | 'bouclier' | 'munition' | 'nourriture' | 'potion' | 'matériau' | 'clé' | 'quête' | 'valeur';
export type WeaponKind = 'épée' | 'hache' | 'masse' | 'lance' | 'arc' | 'dague' | 'bâton';
export type Element = 'feu' | 'givre' | 'poison';

export interface ItemDef {
  id: string; name: string; cat: ItemCat; value: number; weight: number; desc: string;
  rarity?: 'commun' | 'rare' | 'épique';
  weapon?: { kind: WeaponKind; damage: number; speed: number; reach: number; stamina: number; element?: Element };
  armor?: { slot: 'corps' | 'tête' | 'mains' | 'pieds'; value: number };
  shield?: { block: number };
  use?: { hp?: number; stamina?: number; mana?: number; cure?: boolean; warm?: number };
  good?: Good;           // catégorie économique (prix régionaux)
}

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
  { id: 'gambison', name: 'Gambison matelassé', cat: 'armure', value: 50, weight: 4, desc: 'Plusieurs couches de lin.', armor: { slot: 'corps', value: 5 }, good: 'étoffe' },
  { id: 'cotte de mailles', name: 'Cotte de mailles', cat: 'armure', value: 160, weight: 10, desc: 'Arrête les lames.', armor: { slot: 'corps', value: 9 }, good: 'fer' },
  { id: 'casque de cuir', name: 'Casque de cuir', cat: 'armure', value: 15, weight: 1, desc: '', armor: { slot: 'tête', value: 1 }, good: 'étoffe' },
  { id: 'casque de fer', name: 'Casque de fer', cat: 'armure', value: 55, weight: 2.5, desc: '', armor: { slot: 'tête', value: 3 }, good: 'fer' },
  { id: 'gants', name: 'Gants de cuir', cat: 'armure', value: 12, weight: 0.5, desc: '', armor: { slot: 'mains', value: 1 }, good: 'étoffe' },
  { id: 'bottes', name: 'Bottes de marche', cat: 'armure', value: 18, weight: 1.5, desc: '', armor: { slot: 'pieds', value: 1 }, good: 'étoffe' },
  { id: 'flèche', name: 'Flèche', cat: 'munition', value: 1, weight: 0.05, desc: 'Empennée de plumes d’oie.', good: 'bois' },
  // nourriture et potions
  { id: 'pain', name: 'Miche de pain', cat: 'nourriture', value: 3, weight: 0.3, desc: '', use: { hp: 8, stamina: 15 }, good: 'grain' },
  { id: 'fromage', name: 'Fromage', cat: 'nourriture', value: 5, weight: 0.4, desc: '', use: { hp: 12, stamina: 10 }, good: 'laine' },
  { id: 'pomme', name: 'Pomme', cat: 'nourriture', value: 2, weight: 0.2, desc: '', use: { hp: 5, stamina: 10 }, good: 'grain' },
  { id: 'viande crue', name: 'Viande crue', cat: 'nourriture', value: 3, weight: 0.6, desc: 'À cuire sur un feu.', use: { hp: 3 }, good: 'gibier' },
  { id: 'viande grillée', name: 'Viande grillée', cat: 'nourriture', value: 7, weight: 0.5, desc: '', use: { hp: 20, stamina: 20 }, good: 'gibier' },
  { id: 'poisson grillé', name: 'Poisson grillé', cat: 'nourriture', value: 6, weight: 0.4, desc: '', use: { hp: 15, stamina: 15 }, good: 'poisson' },
  { id: 'ragoût', name: 'Bol de ragoût', cat: 'nourriture', value: 9, weight: 0.6, desc: 'Spécialité de l’auberge.', use: { hp: 30, stamina: 30, warm: 1 }, good: 'grain' },
  { id: 'bière', name: 'Chope de bière', cat: 'nourriture', value: 4, weight: 0.5, desc: '', use: { stamina: 40 }, good: 'grain' },
  { id: 'hydromel', name: 'Hydromel', cat: 'nourriture', value: 8, weight: 0.5, desc: '', use: { stamina: 60, hp: 5 }, good: 'vin' },
  { id: 'potion de soin', name: 'Potion de soin', cat: 'potion', value: 30, weight: 0.3, desc: 'Rend 45 PV.', use: { hp: 45 }, good: 'herbes' },
  { id: 'grande potion de soin', name: 'Grande potion de soin', cat: 'potion', value: 70, weight: 0.4, desc: 'Rend 90 PV.', use: { hp: 90 }, good: 'herbes' },
  { id: 'potion d’endurance', name: 'Potion d’endurance', cat: 'potion', value: 25, weight: 0.3, desc: '', use: { stamina: 100 }, good: 'herbes' },
  { id: 'potion de mana', name: 'Potion de mana', cat: 'potion', value: 35, weight: 0.3, desc: '', use: { mana: 50 }, good: 'herbes' },
  { id: 'antidote', name: 'Antidote', cat: 'potion', value: 20, weight: 0.2, desc: 'Soigne le poison.', use: { cure: true, hp: 5 }, good: 'herbes' },
  // matériaux
  { id: 'peau de loup', name: 'Peau de loup', cat: 'matériau', value: 12, weight: 1.5, desc: 'Le tanneur en donne un bon prix.', good: 'laine' },
  { id: 'croc de loup', name: 'Croc de loup', cat: 'matériau', value: 4, weight: 0.05, desc: '', good: 'gibier' },
  { id: 'minerai de fer', name: 'Minerai de fer', cat: 'matériau', value: 6, weight: 2, desc: '', good: 'minerai' },
  { id: 'lingot de fer', name: 'Lingot de fer', cat: 'matériau', value: 18, weight: 1.5, desc: '', good: 'fer' },
  { id: 'bois', name: 'Bûches', cat: 'matériau', value: 2, weight: 2, desc: '', good: 'bois' },
  { id: 'herbe médicinale', name: 'Herbe médicinale', cat: 'matériau', value: 5, weight: 0.1, desc: 'Base des potions.', good: 'herbes' },
  { id: 'soie d’araignée', name: 'Soie d’araignée', cat: 'matériau', value: 14, weight: 0.2, desc: '', good: 'étoffe' },
  { id: 'glande à venin', name: 'Glande à venin', cat: 'matériau', value: 20, weight: 0.1, desc: '', good: 'herbes' },
  { id: 'os', name: 'Os', cat: 'matériau', value: 1, weight: 0.3, desc: '' },
  { id: 'essence spectrale', name: 'Essence spectrale', cat: 'matériau', value: 40, weight: 0.1, desc: 'Froide comme la tombe.' },
  { id: 'cœur de troll', name: 'Cœur de troll', cat: 'matériau', value: 150, weight: 3, desc: 'Il bat encore, faiblement.' },
  { id: 'étoffe', name: 'Rouleau d’étoffe', cat: 'matériau', value: 10, weight: 1, desc: '', good: 'étoffe' },
  { id: 'sel', name: 'Sac de sel', cat: 'matériau', value: 8, weight: 2, desc: '', good: 'sel' },
  { id: 'outils', name: 'Outils', cat: 'matériau', value: 15, weight: 2, desc: '', good: 'outils' },
  // valeurs
  { id: 'pièces anciennes', name: 'Pièces anciennes', cat: 'valeur', value: 25, weight: 0.1, desc: 'Frappées d’un royaume oublié.' },
  { id: 'bague en or', name: 'Bague en or', cat: 'valeur', value: 60, weight: 0.05, desc: '' },
  { id: 'gemme', name: 'Gemme taillée', cat: 'valeur', value: 120, weight: 0.05, desc: '' },
  { id: 'coupe d’argent', name: 'Coupe d’argent', cat: 'valeur', value: 45, weight: 0.5, desc: '' },
];

export const ITEMS = new Map<string, ItemDef>(D.map((d) => [d.id, d]));

/** Définition d'un objet, y compris les objets dynamiques (clés, objets de quête). */
export function item(id: string): ItemDef {
  const d = ITEMS.get(id);
  if (d) return d;
  if (id.startsWith('clé:')) return { id, name: `Clé de fer (${id.split(':')[2] ?? 'donjon'})`, cat: 'clé', value: 0, weight: 0.05, desc: 'Ouvre une porte quelque part sous terre.' };
  if (id.startsWith('quête:')) {
    const [, kind, , label] = id.split(':');
    const names: Record<string, string> = { marchandises: 'Marchandises volées', relique: 'Relique sacrée', journal: 'Journal de l’expédition', trophée: 'Trophée de chasse' };
    return { id, name: label ? `${names[kind] ?? kind} (${label})` : names[kind] ?? kind, cat: 'quête', value: 0, weight: 1, desc: 'Objet de quête.' };
  }
  return { id, name: id, cat: 'valeur', value: 1, weight: 0.1, desc: '' };
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
      .sort((a, b) => order.indexOf(a.def.cat) - order.indexOf(b.def.cat) || a.def.name.localeCompare(b.def.name));
  }
}
