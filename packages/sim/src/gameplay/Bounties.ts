import type { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import type { WorldSeed } from '@ascii-fort/core/Seed';
import type { RNG } from '@ascii-fort/core/RNG';
import { B } from '@ascii-fort/worldgen/terrain/Biomes';
import { dangerAt, type Lair, type FoeDef } from '../entities/Monster';
import { item } from './Items';
import { lieu } from './Chains';

// Tableau des primes : sur la place des villes et des villages, 3 à 5 avis renouvelés chaque jour de jeu (flux « primes »,
// par implantation et par jour). Les cibles existent déjà dans le monde (chef d'un camp de bandits, repaire de loups,
// d'araignées ou de gobelins), sauf la bête nommée, créature unique propre au joueur. Récompense selon le danger du lieu.
// Module pur : le jeu fournit l'état des repaires (chefs tués, camps démantelés) pour écarter les avis devenus sans objet.

export type BountyKind = 'chef' | 'repaire' | 'bête' | 'peaux';

export interface Bounty {
  /** « prime:<implantation>:<jour>:<cible> » : stable dans la journée, quel que soit l'ordre des avis */
  id: string; sid: number; day: number; kind: BountyKind;
  title: string; text: string;
  /** cible (pour les peaux : le tableau lui-même) */
  x: number; z: number; place: string;
  /** repaire visé (chef, repaire), nombre à abattre ou à rapporter, objet à rapporter, bête nommée */
  lair?: string; type?: string; count?: number; item?: string; foe?: FoeDef;
  danger: number;
  reward: { gold: number; xp: number; rep: number };
}

/** Primes acceptées en même temps, au plus. */
export const MAX_BOUNTIES = 3;
/** Implantations qui ont un tableau des primes sur leur place. */
export const BOARD_TYPES = new Set(['village', 'village minier', 'port', 'bourg', 'ville', 'capitale']);

export interface BountyWorld {
  civ: Civilization; seed: WorldSeed; lairs: Lair[];
  /** créatures uniques tuées (« lair:12:chef », « prime:… ») et camps démantelés */
  killed: Set<string>; cleared: Set<number>;
  /** membres vivants d'un repaire (hors chef) */
  alive(key: string): number;
}

const BEASTS: Record<string, { names: string[]; title: string; look: FoeDef['look'] }> = {
  loup: { names: ['Croc-Gris', 'Gueule-Noire', 'Pattes-de-Cendre', 'Échine-Rousse', 'Vieux-Borgne'], title: 'le loup géant', look: { scale: 1.45, tint: 0x5a5a56, eyes: 0xffd040 } },
  sanglier: { names: ['Grand-Groin', 'Défenses-de-Fer', 'le Laboureur', 'Hure-Noire'], title: 'le sanglier balafré', look: { scale: 1.45, tint: 0x3a2a1c, eyes: 0xff5020 } },
  araignée: { names: ['la Veuve', 'la Fileuse', 'Tisse-Mort'], title: 'l’araignée géante', look: { scale: 1.45, tint: 0x2a2a1a, eyes: 0xffa020 } },
};
const LAIR_LABEL: Record<string, string> = { loup: 'loups', araignée: 'araignées', gobelin: 'gobelins' };
const HIDES: Record<string, string> = { loup: 'peau de loup', cerf: 'peau de cerf', sanglier: 'peau de sanglier' };

/** Avis possible ; make() reçoit un flux propre à l'avis (son contenu ne dépend pas des autres avis du jour). */
interface Cand { key: string; make: (r: RNG) => Omit<Bounty, 'id' | 'sid' | 'day'> }

/** Le tableau d'une implantation a-t-il des avis ? (types qui en ont un) */
export function hasBoard(civ: Civilization, sid: number): boolean { const s = civ.settlements[sid]; return !!s && !s.abandoned && BOARD_TYPES.has(s.type); }

/** Avis du jour au tableau d'une implantation (3 à 5, sans ceux devenus sans objet). */
export function boardOffers(w: BountyWorld, sid: number, day: number): Bounty[] {
  const civ = w.civ, s = civ.settlements[sid];
  if (!hasBoard(civ, sid)) return [];
  const rng = w.seed.stream('primes', sid, day);
  const dist = (x: number, z: number) => Math.hypot(x - s.x, z - s.z);
  const poiName = (l: Lair) => civ.pois.find((p) => p.id === l.poiId)?.name ?? 'repaire';
  const jitter = (r: RNG) => 0.9 + r.next() * 0.2;
  const cands: Cand[] = [];
  for (const l of w.lairs) {
    if (l.poiId < 0) continue;
    const d = dist(l.x, l.z);
    if (l.leader === 'chef bandit' && d < 3200) cands.push({ key: `chef-${l.poiId}`, make: (r) => {
      const g = dangerAt(civ, l.x, l.z), place = poiName(l);
      return { kind: 'chef', title: `Le chef ${lieu(place, 'de')}`, text: `Mort ou vif : le chef des brigands ${lieu(place, 'de')} détrousse les voyageurs. Abattez-le.`,
        x: l.x, z: l.z, place, lair: l.key, type: 'chef bandit', count: 1, danger: g, reward: { gold: Math.round((45 + 30 * g) * jitter(r)), xp: 60 + 25 * g, rep: 6 } };
    } });
    if (LAIR_LABEL[l.type] && d < 2600) cands.push({ key: `rep-${l.poiId}`, make: (r) => {
      const g = dangerAt(civ, l.x, l.z), place = poiName(l), n = Math.max(2, Math.min(4, l.max));
      return { kind: 'repaire', title: `Nettoyer ${lieu(place)}`, text: `Les fermiers n’osent plus approcher ${lieu(place, 'de')}. Abattez ${n} ${LAIR_LABEL[l.type]} de ce repaire.`,
        x: l.x, z: l.z, place, lair: l.key, type: l.type, count: n, danger: g, reward: { gold: Math.round((20 + 8 * n + 12 * g) * jitter(r)), xp: 40 + 15 * g, rep: 4 } };
    } });
  }
  // bête nommée : à l'écart, sur les terres d'une harde (une seule par jour)
  const herds = w.lairs.filter((l) => l.key.startsWith('herd:') && dist(l.x, l.z) > 450 && dist(l.x, l.z) < 2400);
  if (herds.length) {
    const h = herds[Math.floor(rng.next() * herds.length)];
    cands.push({ key: `bete-${h.key.slice(5)}`, make: (r) => {
      const biome = civ.macro.biome[civ.macro.cellOf(h.x, h.z)];
      const type = biome === B.SWAMP ? 'araignée' : h.type === 'sanglier' ? 'sanglier' : 'loup', def = BEASTS[type];
      const name = r.pick(def.names), g = dangerAt(civ, h.x, h.z);
      const foe: FoeDef = { key: '', name, title: def.title, fem: name.startsWith('la '), base: type, look: def.look, level: g + 1, hpMul: 3, dmgMul: 1.3, armor: 1, xpMul: 3, canYield: false };
      const big = name.charAt(0).toUpperCase() + name.slice(1);
      return { kind: 'bête', title: `Abattre ${name}`, text: `${big}, ${def.title}, rôde du côté des pâtures sauvages et s’en prend aux troupeaux. Prime pour sa peau.`,
        x: h.x, z: h.z, place: 'pâtures sauvages', foe, danger: g, reward: { gold: Math.round((55 + 32 * g) * jitter(r)), xp: 70 + 28 * g, rep: 5 } };
    } });
  }
  // peaux : une sorte de gibier qui vit dans les environs
  const kinds = ['loup', 'cerf', 'sanglier'].filter((t) => w.lairs.some((l) => l.type === t && dist(l.x, l.z) < 3000));
  if (!kinds.length) kinds.push('cerf');
  for (const t of kinds) cands.push({ key: `peaux-${t}`, make: (r) => {
    const id = HIDES[t], n = r.int(2, 4), g = dangerAt(civ, s.x, s.z), name = item(id).name.toLowerCase();
    return { kind: 'peaux', title: `Rapporter ${n} ${name.replace('peau', 'peaux')}`, text: `Le tanneur manque de cuir : rapportez ${n} ${name.replace('peau', 'peaux')} à ce tableau.`,
      x: s.x, z: s.z, place: s.name, item: id, count: n, danger: g, reward: { gold: Math.round((item(id).value * n * 1.7 + 10) * jitter(r)), xp: 20 + 5 * n, rep: 3 } };
  } });
  // tirage du jour : au plus deux avis de la même sorte ; les avis sans objet sont remplacés par les suivants
  rng.shuffle(cands);
  const want = rng.int(3, 5), out: Bounty[] = [], per = new Map<string, number>();
  for (const c of cands) {
    if (out.length >= want) break;
    const k = c.key.split('-')[0];
    if ((per.get(k) ?? 0) >= 2) continue;
    const b: Bounty = { id: `prime:${sid}:${day}:${c.key}`, sid, day, ...c.make(rng.fork(c.key)) };
    if (b.foe) b.foe.key = b.id;
    if (!bountyValid(w, b)) continue;
    per.set(k, (per.get(k) ?? 0) + 1);
    out.push(b);
  }
  return out;
}

/** L'objectif existe-t-il encore ? (chef vivant, camp debout, repaire peuplé, bête vivante) */
export function bountyValid(w: BountyWorld, b: Bounty): boolean {
  const l = b.lair ? w.lairs.find((x) => x.key === b.lair) : undefined;
  if (b.kind === 'chef') return !!l && l.leaderAlive && !w.killed.has(`${l.key}:chef`) && !w.cleared.has(l.sid);
  if (b.kind === 'repaire') return !!l && w.alive(l.key) > 0 && !(l.sid >= 0 && w.cleared.has(l.sid));
  if (b.kind === 'bête') return !w.killed.has(b.id);
  return true;
}

/** Prime acceptée, telle que la sauvegarde la garde (assainie au chargement). */
export interface SavedBounty { b: Bounty; kills: number; st: 'en cours' | 'remplie' | 'caduque' }

/** Primes de la sauvegarde assainies : structure vérifiée, au plus MAX_BOUNTIES, identifiants uniques. */
export function sanitizeBounties(raw: unknown): SavedBounty[] {
  const out: SavedBounty[] = [];
  if (!Array.isArray(raw)) return out;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  for (const r of raw) {
    if (out.length >= MAX_BOUNTIES || !r || typeof r !== 'object') continue;
    const { b, kills, st } = r as SavedBounty;
    if (!b || typeof b !== 'object' || typeof b.id !== 'string' || !b.id.startsWith('prime:') || out.some((x) => x.b.id === b.id)) continue;
    if (!['chef', 'repaire', 'bête', 'peaux'].includes(b.kind) || typeof b.title !== 'string' || typeof b.text !== 'string' || !num(b.x) || !num(b.z) || !num(b.sid) || !num(b.day)) continue;
    if (!b.reward || !num(b.reward.gold) || !num(b.reward.xp) || !num(b.reward.rep)) continue;
    if (b.kind === 'bête') {
      const f = b.foe;
      if (!f || typeof f.base !== 'string' || typeof f.name !== 'string' || typeof f.title !== 'string' || !f.look || !num(f.look.scale)
        || !num(f.level) || !num(f.hpMul) || !num(f.dmgMul) || !num(f.armor) || !num(f.xpMul)) continue;
      f.key = b.id;   // la mort de la bête se reconnaît à cette clé
    }
    if (b.kind === 'peaux' && (typeof b.item !== 'string' || !num(b.count))) continue;
    out.push({ b, kills: num(kills) ? Math.max(0, Math.floor(kills)) : 0, st: st === 'remplie' || st === 'caduque' ? st : 'en cours' });
  }
  return out;
}
