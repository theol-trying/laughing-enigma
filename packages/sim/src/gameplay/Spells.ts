// Sorts : projectiles (feu, givre, éclair), soin et bonus (bouclier, lumière, pas feutrés).
// Deux sont connus au départ ; les autres s'apprennent en lisant un parchemin (prêtres, moines).
// Le joueur choisit dans l'inventaire (onglet Sorts) le sort lancé par R et celui lancé par F.

export type SpellKind = 'projectile' | 'soin' | 'bonus';
export type SpellFx = 'feu' | 'givre' | 'éclair';

export interface SpellDef {
  id: string; name: string; mana: number; kind: SpellKind; desc: string;
  dmg?: number; speed?: number; element?: 'feu' | 'givre' | 'poison'; fx?: SpellFx;
  /** prix du parchemin (0 : connu dès le départ) */
  price: number;
}

export const SPELLS: SpellDef[] = [
  { id: 'trait de feu', name: 'Trait de feu', mana: 15, kind: 'projectile', dmg: 16, speed: 24, element: 'feu', fx: 'feu', price: 0, desc: 'Une boule de feu qui brûle sa cible (les trolls la craignent).' },
  { id: 'soin', name: 'Soin', mana: 20, kind: 'soin', price: 0, desc: 'Referme les plaies (+25 PV) et chasse le poison.' },
  { id: 'éclat de givre', name: 'Éclat de givre', mana: 15, kind: 'projectile', dmg: 12, speed: 28, element: 'givre', fx: 'givre', price: 120, desc: 'Un éclat de glace qui ralentit fortement sa cible.' },
  { id: 'éclair', name: 'Éclair', mana: 26, kind: 'projectile', dmg: 26, speed: 70, fx: 'éclair', price: 220, desc: 'Un trait de foudre presque instantané, très puissant.' },
  { id: 'bouclier de mana', name: 'Bouclier de mana', mana: 25, kind: 'bonus', price: 150, desc: 'Une aura protectrice : armure +6 pendant une minute.' },
  { id: 'lumière', name: 'Lumière', mana: 10, kind: 'bonus', price: 60, desc: 'Un globe lumineux vous suit pendant deux minutes (donjons, nuit).' },
  { id: 'pas feutrés', name: 'Pas feutrés', mana: 20, kind: 'bonus', price: 140, desc: 'Vos pas ne font presque plus de bruit pendant 45 secondes.' },
  { id: 'invisibilité', name: 'Invisibilité', mana: 35, kind: 'bonus', price: 260, desc: 'Personne ne vous voit pendant 20 secondes (attaquer ou voler y met fin).' },
];

export function spell(id: string): SpellDef | undefined { return SPELLS.find((s) => s.id === id); }

/** Identifiant de l'objet « parchemin » qui enseigne un sort. */
export const scrollId = (spellId: string) => `parchemin : ${spellId}`;
