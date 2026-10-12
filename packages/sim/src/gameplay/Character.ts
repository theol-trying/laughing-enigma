import { Inventory, item, durOf, withDur, baseId, wearOf, wearable, type ItemDef } from './Items';

// Fiche du personnage : caractéristiques, compétences (progressent à l'usage), expérience,
// équipement et valeurs dérivées. Peu de systèmes, mais tous branchés sur le jeu.

export const STATS = ['FOR', 'AGI', 'CON', 'PER', 'INT', 'VOL'] as const;
export type Stat = typeof STATS[number];
export const STAT_NAMES: Record<Stat, string> = { FOR: 'Force', AGI: 'Agilité', CON: 'Constitution', PER: 'Perception', INT: 'Intelligence', VOL: 'Volonté' };
export const STAT_DESC: Record<Stat, string> = {
  FOR: 'dégâts au corps à corps, charge portée', AGI: 'endurance, discrétion', CON: 'points de vie',
  PER: 'dégâts à l\'arc, prix', INT: 'mana, puissance des sorts', VOL: 'endurance',
};
export const SKILLS = ['armes', 'tir', 'magie', 'furtivité', 'commerce', 'artisanat'] as const;
export type Skill = typeof SKILLS[number];
export const SKILL_NAMES: Record<Skill, string> = { armes: 'Armes', tir: "Tir à l'arc", magie: 'Magie', furtivité: 'Furtivité', commerce: 'Commerce', artisanat: 'Artisanat' };

export type Slot = 'arme' | 'bouclier' | 'corps' | 'tête' | 'mains' | 'pieds';
export const SLOTS: Slot[] = ['arme', 'bouclier', 'corps', 'tête', 'mains', 'pieds'];
/** Usure d'une pièce portée : nouvel id et état avant / après. */
export interface WearEvent { slot: Slot; id: string; from: number; to: number }

export class Character {
  stats: Record<Stat, number> = { FOR: 5, AGI: 5, CON: 5, PER: 5, INT: 5, VOL: 5 };
  skills: Record<Skill, number> = { armes: 10, tir: 5, magie: 5, furtivité: 5, commerce: 5, artisanat: 5 };
  skillXp: Record<Skill, number> = { armes: 0, tir: 0, magie: 0, furtivité: 0, commerce: 0, artisanat: 0 };
  level = 1;
  xp = 0;
  statPoints = 0;
  readonly inv = new Inventory();
  equip: Record<Slot, string | null> = { arme: null, bouclier: null, corps: null, tête: null, mains: null, pieds: null };
  /** bonus temporaires (bénédiction, repas…), mis à jour par le jeu */
  bonusDmg = 0; bonusArmor = 0;
  /** sorts connus */
  spells: string[] = ['trait de feu', 'soin'];
  /** sorts lancés par R et par F (choisis dans l'inventaire, onglet Sorts) */
  spellR = 'trait de feu';
  spellF = 'soin';

  // chaque niveau rend plus robuste, endurant et puissant, en plus du point de caractéristique
  get maxHp(): number { return 70 + this.stats.CON * 6 + (this.level - 1) * 8; }
  get maxStamina(): number { return 60 + this.stats.AGI * 4 + this.stats.VOL * 4 + (this.level - 1) * 4; }
  get maxMana(): number { return 20 + this.stats.INT * 6 + (this.level - 1) * 3; }
  /** multiplicateur commun : niveau et bonus temporaires */
  private power(): number { return (1 + (this.level - 1) * 0.03) * (1 + this.bonusDmg); }
  get armor(): number {
    let a = 0;
    for (const s of ['corps', 'tête', 'mains', 'pieds'] as Slot[]) { const id = this.equip[s]; if (id) a += item(id).armor?.value ?? 0; }
    return a + this.bonusArmor;
  }
  /** arme utilisable en main (null : rien, ou hors d'usage ; pour l'affichage, lire equip.arme) */
  get weapon(): ItemDef | null { const id = this.equip.arme; return id && durOf(id) > 0 ? item(id) : null; }
  get shield(): ItemDef | null { const id = this.equip.bouclier; return id && durOf(id) > 0 ? item(id) : null; }
  meleeMult(): number { return (1 + (this.stats.FOR - 5) * 0.06 + this.skills.armes * 0.007) * this.power(); }
  bowMult(): number { return (1 + (this.stats.PER - 5) * 0.06 + this.skills.tir * 0.007) * this.power(); }
  spellMult(): number { return (1 + (this.stats.INT - 5) * 0.07 + this.skills.magie * 0.008 + (this.weapon?.weapon?.kind === 'bâton' ? 0.3 : 0)) * this.power(); }
  /** 0 (bruyant) → 1 (invisible) quand accroupi */
  stealth(): number { return Math.min(0.95, 0.45 + this.skills.furtivité * 0.005 + (this.stats.AGI - 5) * 0.02); }
  /** prix d'achat ×, prix de vente × */
  priceMult(buy: boolean): number { const k = this.skills.commerce * 0.003 + (this.stats.PER - 5) * 0.01; return buy ? 1.25 - k : 0.45 + k; }
  carryMax(): number { return 60 + this.stats.FOR * 6; }

  xpForNext(): number { return Math.round(100 * Math.pow(this.level, 1.5)); }

  /** Gagne de l'expérience ; renvoie le nombre de niveaux gagnés. */
  gainXp(n: number): number {
    this.xp += n;
    let ups = 0;
    while (this.xp >= this.xpForNext()) { this.xp -= this.xpForNext(); this.level++; this.statPoints++; ups++; }
    return ups;
  }

  /** Une compétence progresse quand on l'utilise ; renvoie true si elle augmente. */
  practice(s: Skill, amount: number): boolean {
    if (this.skills[s] >= 100) return false;
    this.skillXp[s] += amount;
    const need = 10 + this.skills[s] * 1.5;
    if (this.skillXp[s] >= need) { this.skillXp[s] -= need; this.skills[s]++; return true; }
    return false;
  }

  /** Équipe un objet de l'inventaire dans l'emplacement qui lui correspond. */
  equipItem(id: string): Slot | null {
    const d = item(id);
    const slot: Slot | null = d.weapon ? 'arme' : d.shield ? 'bouclier' : d.armor ? d.armor.slot : null;
    if (!slot || this.inv.count(id) <= 0) return null;
    if (slot === 'bouclier' && this.equip.arme && item(this.equip.arme).weapon?.kind === 'arc') this.equip.arme = null;
    if (slot === 'arme' && d.weapon?.kind === 'arc') this.equip.bouclier = null;
    this.equip[slot] = this.equip[slot] === id ? null : id;
    return slot;
  }

  isEquipped(id: string): boolean { return Object.values(this.equip).includes(id); }

  /** État (0-100) de la pièce portée à cet emplacement (100 si vide). */
  cond(s: Slot): number { const id = this.equip[s]; return id ? durOf(id) : 100; }
  /** Pire état parmi les pièces portées (100 si rien d'usable). */
  worstEquipped(): number { let m = 100; for (const s of SLOTS) { const id = this.equip[s]; if (id && wearable(item(id))) m = Math.min(m, durOf(id)); } return m; }
  /** Change l'état d'un exemplaire (renomme une unité ; si cet id est porté, c'est la pièce portée qui change). Renvoie le nouvel id. */
  setDur(id: string, dur: number): string {
    const nid = withDur(id, dur);
    if (nid === id || !this.inv.remove(id, 1)) return id;
    this.inv.add(nid, 1);
    for (const s of SLOTS) if (this.equip[s] === id) { this.equip[s] = nid; break; }
    return nid;
  }
  /** Use la pièce portée de `units` usages (fraction de point tirée au sort) ; null si rien ne change. */
  wear(slot: Slot, units: number, rnd: () => number = Math.random): WearEvent | null {
    const id = this.equip[slot];
    if (!id) return null;
    if (this.inv.count(id) <= 0) { this.equip[slot] = null; return null; }
    const from = durOf(id);
    if (from <= 0) return null;
    const x = units * 100 / wearOf(item(baseId(id)));
    const loss = Math.floor(x) + (rnd() < x % 1 ? 1 : 0);
    if (!loss) return null;
    const nid = this.setDur(id, from - loss);
    return nid === id ? null : { slot, id: nid, from, to: durOf(nid) };
  }
  /** Objets abîmés du sac (portés d'abord, puis du plus abîmé). */
  worn(): { id: string; qty: number; def: ItemDef; slot: Slot | null }[] {
    const out: { id: string; qty: number; def: ItemDef; slot: Slot | null }[] = [];
    for (const [id, qty] of this.inv.items) { const def = item(id); if (wearable(def) && durOf(id) < 100) out.push({ id, qty, def, slot: SLOTS.find((s) => this.equip[s] === id) ?? null }); }
    return out.sort((a, b) => (a.slot ? 0 : 1) - (b.slot ? 0 : 1) || durOf(a.id) - durOf(b.id));
  }
}
