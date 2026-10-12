import { Inventory, item, durOf, withDur, baseId, wearOf, wearable, wearFactor, type ItemDef } from './Items';
import { fxTotal, canLearn, ranksSpent, talentPointsTotal, sanitizeTalents, respecCost, type FxKey, type LearnCheck } from './Talents';

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
  /** talents appris : id → rang (absent = 0) ; les points disponibles se déduisent du niveau */
  talents: Record<string, number> = {};

  // chaque niveau rend plus robuste, endurant et puissant, en plus du point de caractéristique
  get maxHp(): number { return 70 + this.stats.CON * 6 + (this.level - 1) * 8; }
  get maxStamina(): number { return 60 + this.stats.AGI * 4 + this.stats.VOL * 4 + (this.level - 1) * 4; }
  get maxMana(): number { return 20 + this.stats.INT * 6 + (this.level - 1) * 3 + this.talentFx('manaMax'); }
  /** multiplicateur commun : niveau et bonus temporaires */
  private power(): number { return (1 + (this.level - 1) * 0.03) * (1 + this.bonusDmg); }
  get armor(): number {
    let a = 0;
    for (const s of ['corps', 'tête', 'mains', 'pieds'] as Slot[]) { const id = this.equip[s]; if (id) a += item(id).armor?.value ?? 0; }
    return Math.round(a * (1 + this.talentFx('armorPct'))) + this.bonusArmor;
  }
  /** arme utilisable en main (null : rien, ou hors d'usage ; pour l'affichage, lire equip.arme) */
  get weapon(): ItemDef | null { const id = this.equip.arme; return id && durOf(id) > 0 ? item(id) : null; }
  get shield(): ItemDef | null { const id = this.equip.bouclier; return id && durOf(id) > 0 ? item(id) : null; }
  meleeMult(): number { return (1 + (this.stats.FOR - 5) * 0.06 + this.skills.armes * 0.007) * this.power() * (1 + this.talentFx('melee')); }
  bowMult(): number { return (1 + (this.stats.PER - 5) * 0.06 + this.skills.tir * 0.007) * this.power() * (1 + this.talentFx('bow')); }
  spellMult(): number { return (1 + (this.stats.INT - 5) * 0.07 + this.skills.magie * 0.008 + (this.weapon?.weapon?.kind === 'bâton' ? 0.3 : 0)) * this.power() * (1 + this.talentFx('spell')); }
  /** 0 (bruyant) → 1 (invisible) quand accroupi */
  stealth(): number { return Math.min(0.95, 0.45 + this.skills.furtivité * 0.005 + (this.stats.AGI - 5) * 0.02 + this.talentFx('stealth')); }
  /** prix d'achat ×, prix de vente × */
  priceMult(buy: boolean): number { const k = this.skills.commerce * 0.003 + (this.stats.PER - 5) * 0.01; return buy ? Math.max(0.6, 1.25 - k - this.talentFx('buy')) : 0.45 + k + this.talentFx('sell'); }
  carryMax(): number { return 60 + this.stats.FOR * 6 + this.talentFx('carry'); }

  // ------------------------------------------------------------------ talents
  /** Effet total d'une clé de talent (somme rang × valeur par rang). */
  talentFx(k: FxKey): number { return fxTotal(this.talents, k); }
  talentRank(id: string): number { return Math.min(3, Math.max(0, Math.floor(this.talents[id]) || 0)); }
  /** Points de talent à dépenser : floor(niveau / 3) moins les rangs déjà pris (rétroactif, jamais négatif). */
  talentPoints(): number { return Math.max(0, talentPointsTotal(this.level) - ranksSpent(this.talents)); }
  /** Points de talent déjà dépensés. */
  talentSpent(): number { return ranksSpent(this.talents); }
  canLearnTalent(id: string): LearnCheck { return canLearn(this.talents, this.level, id); }
  /** Apprend un rang du talent (points, prérequis de rangée et rang maximal vérifiés) ; false si refusé. */
  learnTalent(id: string): boolean { if (!this.canLearnTalent(id).ok) return false; this.talents[id] = this.talentRank(id) + 1; return true; }
  resetTalents(): void { this.talents = {}; }
  /** Remise à zéro payante ; false (rien ne change) si l'or manque. */
  respecTalents(): boolean { const c = respecCost(this.level); if (this.inv.gold < c) return false; this.inv.gold -= c; this.talents = {}; return true; }
  /** Restaure les talents d'une sauvegarde : champ absent ou invalide = aucun talent. */
  setTalents(raw: unknown): void { this.talents = sanitizeTalents(raw); }
  /** Copie « et si » en lecture seule (aperçu de l'écran des talents) : ce talent à ce rang, le reste inchangé. */
  previewTalent(id: string, rank: number): Character { const c = Object.create(this) as Character; c.talents = { ...this.talents, [id]: rank }; return c; }

  // effets des talents, un par câblage (les planchers évitent les valeurs absurdes)
  /** × coût d'endurance des attaques (mêlée et arc) */
  staCostMult(): number { return Math.max(0.4, 1 - this.talentFx('staCost')); }
  /** × vitesse de la mêlée */
  atkSpeedMult(): number { return 1 + this.talentFx('atkSpeed'); }
  /** multiplicateur du coup puissant (1,8 de base) */
  heavyMult(): number { return 1.8 + this.talentFx('heavy'); }
  /** × dégâts de mêlée sur une cible sous EXECUTE_HP de ses PV */
  executeMult(): number { return 1 + this.talentFx('execute'); }
  /** part des dégâts qui passe une parade : 0,35 sans bouclier, 0,15 avec un bouclier en bon état (0,12 de qualité), réduite par les talents */
  guard(): number {
    const sh = this.shield, b = sh ? 0.35 - 0.2 * wearFactor(sh.dur ?? 100) - (sh.quality ? 0.03 : 0) : 0.35;
    return Math.max(0.04, b * (1 - this.talentFx('guard')));
  }
  /** endurance perdue en parant, par point de dégât reçu */
  blockCost(): number { return 1.2 * (1 - this.talentFx('blockSta')); }
  /** × récupération d'endurance (hors parade et course) */
  staRegenMult(): number { return 1 + this.talentFx('staRegen'); }
  /** durée du bandage complet de l'arc (s) */
  bowDrawTime(): number { return 0.8 / ((this.weapon?.weapon?.speed ?? 1) * (1 + this.talentFx('bowRate'))); }
  /** délai entre deux tirs (s) */
  bowCooldown(): number { return 0.35 / (1 + this.talentFx('bowRate')); }
  /** chance de récupérer une flèche qui touche */
  arrowRecover(): number { return this.talentFx('arrowRecover'); }
  /** s'ajoute au multiplicateur d'attaque sournoise (×3 en mêlée, ×2 à distance) */
  sneakBonus(): number { return this.talentFx('sneak'); }
  /** × bruit émis (plancher 0,3) */
  noiseMul(): number { return Math.max(0.3, 1 - this.talentFx('noise')); }
  /** chance de réussir un vol à la tire */
  pickpocketChance(): number { return Math.min(0.97, Math.min(0.9, 0.45 + this.skills.furtivité * 0.006 + (this.stats.AGI - 5) * 0.03) + this.talentFx('steal')); }
  /** coût réel d'un sort (arrondi, 1 au minimum, au plus 60 % de réduction) */
  manaCost(base: number): number { return Math.max(1, Math.round(base * Math.max(0.4, 1 - this.talentFx('manaCost')))); }
  /** mana récupéré par seconde */
  manaRegen(): number { return 1.5 * (1 + this.talentFx('manaRegen')); }
  /** durée réelle d'un sort d'aura (s) */
  spellTime(base: number): number { return Math.round(base * (1 + this.talentFx('spellTime'))); }
  /** PV rendus par le sort de soin */
  healAmount(): number { return 25 * this.spellMult() * (1 + this.talentFx('heal')); }
  /** × usure de l'équipement (plancher 0,4) */
  wearMult(): number { return Math.max(0.4, 1 - this.talentFx('wear')); }
  /** s'ajoute à la chance de pièce de qualité */
  qualityBonus(): number { return this.talentFx('quality'); }
  /** crochetage : cases de zone en plus et chance de casse du crochet sur un raté (0,5 de base) */
  lockOpts(): { width: number; breakChance: number } { return { width: this.talentFx('lockW'), breakChance: Math.max(0.05, 0.5 - this.talentFx('lockBreak')) }; }

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
    const x = units * this.wearMult() * 100 / wearOf(item(baseId(id)));
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
