// Persuasion et intimidation : chance de réussite (en %) calculée d'après le personnage (caractéristiques, compétence
// commerce, niveau, talents de l'arbre Artisan-marchand), l'opinion du PNJ, son métier et son caractère. Une tentative
// par PNJ et par jour ; les remises et majorations obtenues chez un marchand ne valent que pour la journée.
// Module pur : aucun accès au jeu (le tirage reçoit sa source d'aléa).

import type { Stat } from './Character';

export type Approach = 'persuader' | 'intimider';
/** Contexte : marchandage, garde après un délit, bandit au combat, quête (informateur), demande d'une meilleure récompense. */
export type SocialCase = 'marchandage' | 'garde' | 'bandit' | 'quête' | 'récompense';

/** Ce que le calcul lit du personnage (Character le fournit). */
export interface SocialActor {
  stats: Record<Stat, number>;
  skills: { commerce: number };
  level: number;
  talentRank(id: string): number;
}

/** Ce que le calcul lit de la cible : un PNJ (opinion, métier, caractère) ou une créature (PV, isolement, niveau). */
export interface SocialTarget {
  opinion?: number;
  profession?: string;
  traits?: { bravery: number; kindness: number; greed: number; honesty: number };
  hpFrac?: number; alone?: boolean; leader?: boolean; level?: number;
}

export interface SocialChance { chance: number; parts: { label: string; v: number }[] }

export const CHANCE_MIN = 5, CHANCE_MAX = 95;
/** Multiplicateur de prix du jour chez un marchand : remise (persuasion, intimidation) ou majoration (échec). */
export const DEAL = { persuader: 0.85, intimider: 0.75, échec: 1.15 } as const;
/** Poids des souvenirs laissés au PNJ (×30 sur l'opinion) : menacer marque, échouer à convaincre agace un peu. */
export const MEMORY = { persuaderRaté: -0.1, intimider: -0.5, intimiderRaté: -0.6 } as const;

const TOUGH = new Set(['forgeron', 'chasseur', 'mineur', 'bûcheron']);
const TRADERS = new Set(['marchand', 'aubergiste', 'forgeron']);

/** Chance de réussite (5 à 95 %) et sa décomposition lisible (« Volonté +6 », « Garde −20 »…). */
export function socialChance(a: SocialActor, t: SocialTarget, ap: Approach, c: SocialCase, renown = 0): SocialChance {
  const parts: { label: string; v: number }[] = [];
  const add = (label: string, v: number) => { const r = Math.round(v); if (r) parts.push({ label, v: r }); };
  const s = a.stats, tr = t.traits, op = t.opinion ?? 0, prof = t.profession ?? '';
  let base: number;
  if (ap === 'persuader') {
    base = 35;
    add('Volonté', (s.VOL - 5) * 3);
    add('Intelligence', (s.INT - 5) * 2);
    add('Commerce', a.skills.commerce * 0.3);
    add('Talents', a.talentRank('marchandage') * 4 + a.talentRank('negociant') * 3 + a.talentRank('magnat') * 8);
    if (c !== 'bandit') add('Opinion', op * 0.25);
    if (tr) {
      add('Bonté', (tr.kindness - 0.5) * 20);
      if (c === 'marchandage') add('Âpreté', -(tr.greed - 0.5) * 24);
      if (c === 'récompense') add('Avarice', -(tr.greed - 0.5) * 30);
      if (c === 'garde') add('Intégrité', -(tr.honesty - 0.5) * 30);
    }
    if (c === 'marchandage' && TRADERS.has(prof)) add('Métier', -5);
    if (c === 'garde') add(prof === 'soldat' ? 'Soldat' : 'Garde', -10);
    if (c === 'récompense') add('Exigence', -5);
    if (prof === 'noble') add('Noble', -10);
    if (c === 'quête' && (prof === 'prêtre' || prof === 'moine')) add('Écoute', 5);
    if (c === 'bandit') add('Bandit', -15);
  } else {
    base = 30;
    add('Force', (s.FOR - 5) * 3);
    add('Volonté', (s.VOL - 5) * 2);
    add('Renommée', Math.min(10, Math.max(0, renown) * 0.15));
    add('Talents', a.talentRank('ecrasante') * 3 + a.talentRank('magnat') * 4);
    if (c === 'bandit') {
      // une créature : ses blessures, sa solitude, son rang et l'écart de niveau comptent
      add('Niveau', Math.max(-15, Math.min(15, (a.level - (t.level ?? a.level)) * 3)));
      add('Blessé', (1 - Math.max(0, Math.min(1, t.hpFrac ?? 1))) * 45);
      if (t.alone) add('Isolé', 15);
      if (t.leader) add('Chef', -25);
    } else {
      add('Niveau', Math.min(20, (a.level - 1) * 1.5));
      if (tr) add('Bravoure', -(tr.bravery - 0.5) * 40);
      add('Amitié', -Math.max(0, op) * 0.1);
      if (prof === 'garde' || prof === 'soldat') add(prof === 'soldat' ? 'Soldat' : 'Garde', -20);
      if (prof === 'noble') add('Noble', -15);
      if (TOUGH.has(prof)) add('Robuste', -8);
    }
  }
  const total = base + parts.reduce((x, p) => x + p.v, 0);
  return { chance: Math.max(CHANCE_MIN, Math.min(CHANCE_MAX, Math.round(total))), parts };
}

/** Décomposition courte pour l'écran (« Volonté +6 · Garde −20 »), au plus `max` morceaux, les plus forts d'abord. */
export function chanceParts(c: SocialChance, max = 4): string {
  return [...c.parts].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, max).map((p) => `${p.label} ${p.v > 0 ? '+' : '-'}${Math.abs(p.v)}`).join(' · ');
}

/** Jet de réussite : vrai avec la probabilité `chance` %. */
export function roll(chance: number, rnd: () => number = Math.random): boolean { return rnd() * 100 < chance; }

/** Tentatives du jour : une seule par PNJ (ou par créature) et par jour de jeu. */
export class SocialLog {
  readonly tries = new Map<string, number>();
  canTry(id: string, day: number): boolean { return this.tries.get(id) !== day; }
  mark(id: string, day: number): void { this.tries.set(id, day); }
  /** Oublie les tentatives des jours passés. */
  prune(day: number): void { for (const [k, d] of [...this.tries]) if (d !== day) this.tries.delete(k); }
  clear(): void { this.tries.clear(); }
}

/** Remises et majorations : multiplicateur de prix d'un marchand, valable le jour donné seulement. */
export function dealOf(deals: Map<string, { day: number; mult: number }>, id: string, day: number): number {
  const d = deals.get(id);
  return d && d.day === day ? d.mult : 1;
}

/** Données sauvegardées assainies : couples [id, jour] et triplets [id, jour, multiplicateur] valides du jour seulement. */
export function sanitizeSocial(raw: unknown, day: number): { tries: [string, number][]; deals: [string, number, number][] } {
  const out = { tries: [] as [string, number][], deals: [] as [string, number, number][] };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { tries?: unknown; deals?: unknown };
  if (Array.isArray(r.tries)) for (const t of r.tries) if (Array.isArray(t) && typeof t[0] === 'string' && t[1] === day) out.tries.push([t[0], day]);
  if (Array.isArray(r.deals)) for (const t of r.deals) {
    if (!Array.isArray(t) || typeof t[0] !== 'string' || t[1] !== day || typeof t[2] !== 'number' || !Number.isFinite(t[2])) continue;
    out.deals.push([t[0], day, Math.max(0.5, Math.min(1.5, t[2]))]);
  }
  return out;
}
