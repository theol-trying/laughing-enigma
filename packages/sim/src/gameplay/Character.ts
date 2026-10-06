import { Inventory, item, type ItemDef } from './Items';

// Fiche du personnage : caractéristiques, compétences (progressent à l'usage), expérience,
// équipement et valeurs dérivées. Peu de systèmes, mais tous branchés sur le jeu.

export const STATS = ['FOR', 'AGI', 'CON', 'PER', 'INT', 'VOL'] as const;
export type Stat = typeof STATS[number];
export const STAT_NAMES: Record<Stat, string> = { FOR: 'Force', AGI: 'Agilité', CON: 'Constitution', PER: 'Perception', INT: 'Intelligence', VOL: 'Volonté' };
export const SKILLS = ['armes', 'tir', 'magie', 'furtivité', 'commerce', 'artisanat'] as const;
export type Skill = typeof SKILLS[number];
export const SKILL_NAMES: Record<Skill, string> = { armes: 'Armes', tir: "Tir à l'arc", magie: 'Magie', furtivité: 'Furtivité', commerce: 'Commerce', artisanat: 'Artisanat' };

export type Slot = 'arme' | 'bouclier' | 'corps' | 'tête' | 'mains' | 'pieds';

export class Character {
  stats: Record<Stat, number> = { FOR: 5, AGI: 5, CON: 5, PER: 5, INT: 5, VOL: 5 };
  skills: Record<Skill, number> = { armes: 10, tir: 5, magie: 5, furtivité: 5, commerce: 5, artisanat: 5 };
  skillXp: Record<Skill, number> = { armes: 0, tir: 0, magie: 0, furtivité: 0, commerce: 0, artisanat: 0 };
  level = 1;
  xp = 0;
  statPoints = 0;
  readonly inv = new Inventory();
  equip: Record<Slot, string | null> = { arme: null, bouclier: null, corps: null, tête: null, mains: null, pieds: null };
  /** sorts connus */
  spells: string[] = ['trait de feu', 'soin'];

  get maxHp(): number { return 70 + this.stats.CON * 6 + (this.level - 1) * 5; }
  get maxStamina(): number { return 60 + this.stats.AGI * 4 + this.stats.VOL * 4; }
  get maxMana(): number { return 20 + this.stats.INT * 6; }
  get armor(): number {
    let a = 0;
    for (const s of ['corps', 'tête', 'mains', 'pieds'] as Slot[]) { const id = this.equip[s]; if (id) a += item(id).armor?.value ?? 0; }
    return a;
  }
  get weapon(): ItemDef | null { return this.equip.arme ? item(this.equip.arme) : null; }
  get shield(): ItemDef | null { return this.equip.bouclier ? item(this.equip.bouclier) : null; }
  meleeMult(): number { return 1 + (this.stats.FOR - 5) * 0.06 + this.skills.armes * 0.007; }
  bowMult(): number { return 1 + (this.stats.PER - 5) * 0.06 + this.skills.tir * 0.007; }
  spellMult(): number { return 1 + (this.stats.INT - 5) * 0.07 + this.skills.magie * 0.008 + (this.weapon?.weapon?.kind === 'bâton' ? 0.3 : 0); }
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
    if (slot === 'bouclier' && this.weapon?.weapon?.kind === 'arc') this.equip.arme = null;
    if (slot === 'arme' && d.weapon?.kind === 'arc') this.equip.bouclier = null;
    this.equip[slot] = this.equip[slot] === id ? null : id;
    return slot;
  }

  isEquipped(id: string): boolean { return Object.values(this.equip).includes(id); }
}
