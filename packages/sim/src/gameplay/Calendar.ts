import type { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import type { Layout } from '@ascii-fort/worldgen/civilization/Layout';
import type { Settlement, SettlementType } from '@ascii-fort/worldgen/civilization/types';
import type { WorldSeed } from '@ascii-fort/core/Seed';
import type { RNG } from '@ascii-fort/core/RNG';
import { hashString } from '@ascii-fort/core/RNG';
import { NameGen } from '@ascii-fort/worldgen/civilization/Names';
import { B } from '@ascii-fort/worldgen/terrain/Biomes';
import { MACRO } from '@ascii-fort/worldgen/constants';
import { dangerAt, type Lair } from '../entities/Monster';
import type { NPCData } from '../entities/NPC';

// Calendrier des événements vivants : raids nocturnes, fêtes (moissons, saint patron, foire), épidémies et guerres entre
// factions. Tout se tire de façon déterministe sur le flux « événements » (un nom ajouté ne décale aucun autre flux) et de
// l'état du monde (factions et relations, repaires, danger, saison) : chaque joueur d'un salon calcule le même calendrier.
//
// Lieux : chaque implantation découpe le temps en créneaux de SLOT_DAYS jours (décalés d'un lieu à l'autre) ; un créneau
// porte au plus un événement, qui commence et finit dans le créneau (séquelles d'un raid comprises) : deux événements ne
// se chevauchent jamais au même endroit, sans avoir à relire les jours précédents.
// Guerres : une campagne possible par période de WAR_PERIOD jours, entre deux factions en mauvais termes ; une bataille
// par jour, près d'une implantation frontalière libre, dont le site dépend des propriétaires du moment (la frontière
// bouge). Le jeu applique les issues (abstraites, ou observées par un joueur) dans l'ordre : `Outcome`.
// Module pur : aucun accès au jeu.

export const DAY = 1440;
export const SEASON_DAYS = 10, YEAR_DAYS = 4 * SEASON_DAYS;
export const SEASONS = ['printemps', 'été', 'automne', 'hiver'] as const;
export type Season = typeof SEASONS[number];
/** Saison d'un jour de jeu (année de 40 jours, le jour 0 ouvre le printemps). */
export function seasonOf(day: number): Season { return SEASONS[Math.floor((((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS) / SEASON_DAYS)]; }

/** Créneau d'un lieu (jours), probabilité qu'un créneau porte un événement. */
export const SLOT_DAYS = 8, SLOT_CHANCE = 0.5;
/** Raid : durée de l'assaut avant son issue abstraite (minutes), jours pendant lesquels les maisons restent brûlées. */
export const RAID_WINDOW = 100, RAID_RECOVER_DAYS = 3;
/** Bataille : durée avant l'issue abstraite (minutes). Guerre : période de campagne (jours), premier jour possible. */
export const BATTLE_WINDOW = 120, WAR_PERIOD = 24, WAR_CHANCE = 0.55;
/** Une série de défaites (ou de places perdues) pousse à la paix. */
export const PEACE_LOSSES = 3, PEACE_CAPTURES = 2;

export type EventKind = 'raid' | 'fête' | 'épidémie' | 'bataille';
export type FeastKind = 'moissons' | 'patron' | 'foire';
export type Raider = 'bandit' | 'gobelin' | 'loup';

export interface EventBase {
  /** « r<lieu>.<créneau> » raid, « f… » fête, « p… » épidémie, « b<période>.<rang> » bataille ; « x<n><lettre> » : console */
  id: string; kind: EventKind;
  /** implantation concernée (bataille : implantation attaquée) */
  sid: number;
  /** début et fin (minutes absolues) : fenêtre d'un raid ou d'une bataille, dernier soir d'une fête, fin d'une épidémie */
  start: number; end: number;
  /** lieu : centre de l'implantation, ou champ de bataille */
  x: number; z: number;
}
export interface RaidPlan extends EventBase {
  kind: 'raid'; raider: Raider;
  /** repaire d'où viennent les assaillants (clé, position), camp de bandits (implantation « camp », −1 sinon) */
  lair: string; lx: number; lz: number; camp: number;
  count: number; level: number;
  /** issue sans défenseur extérieur : le raid réussit (maisons brûlées, morts, prix en hausse) */
  succeeds: boolean;
  /** maisons qui prennent feu (ids de bâtiments) ; villageois tués si le raid réussit sans témoin */
  burn: number[]; deaths: number;
}
export interface FeastPlan extends EventBase {
  kind: 'fête'; feast: FeastKind;
  /** saint patron du lieu (« Aubin », « Odile ») et son sexe */
  saint: string; fem: boolean;
  /** marchands de foire (étals), rivaux du concours de tir et leur score, or du premier prix */
  merchants: number; rivals: { first: string; last: string; fem: boolean; score: number }[]; prize: number;
}
export interface EpidemicPlan extends EventBase {
  kind: 'épidémie';
  /** « la fièvre des marais » */
  disease: string;
  /** gravité 0..1 : contagion, malades alités (part des habitants), morts si elle s'éteint d'elle-même */
  severity: number; sick: number; deaths: number;
  /** remèdes que réclame la guérisseuse pour l'enrayer */
  remedies: number;
}
export interface BattlePlan extends EventBase {
  kind: 'bataille';
  /** guerre (« g<période> »), rang de la bataille dans la guerre */
  war: string; k: number;
  /** camps : attaquant et défenseur (factions), implantation d'où part l'attaque */
  attacker: number; defender: number; from: number;
  /** effectifs des escouades, niveau des soldats */
  atk: number; def: number; level: number;
  /** issue sans intervention : l'attaquant l'emporte ; la place peut tomber (sièges simplifiés) */
  attackerWins: boolean; capturable: boolean;
  /** direction (unitaire) du champ de bataille vers le camp de l'attaquant */
  dx: number; dz: number;
}
export type SlotPlan = RaidPlan | FeastPlan | EpidemicPlan;
export type EventPlan = SlotPlan | BattlePlan;

export interface WarPlan {
  /** « g<période> » ; « gx<n> » : console */
  id: string; period: number;
  /** les deux factions (a déclare la guerre à b) */
  a: number; b: number;
  /** jour de la déclaration, jour de la paix au plus tard */
  start: number; end: number;
}
/** Bataille résolue (issue abstraite, ou observée par un joueur). */
export interface BattleResult { k: number; sid: number; atk: number; def: number; win: 'a' | 'd'; capture: boolean; t: number }

/**
 * Issue d'un événement (fait partagé « evt:<id> », sauvegarde) : raid repoussé (« r ») ou réussi (« s »), épidémie
 * enrayée (« e »), fête finie (« f »), bataille prévue (« p »), gagnée par l'attaquant (« a ») ou le défenseur (« d »),
 * sans combat (« n ») ; t : minute ; bataille : site et camp attaquant.
 */
export interface Outcome { k: string; t: number; sid?: number; atk?: number }
const OUT_RE = /^([a-z])(\d{1,9})(?::(\d{1,4}):(\d{1,2}))?$/;
export function parseOutcome(v: unknown): Outcome | null {
  if (typeof v !== 'string') return null;
  const m = OUT_RE.exec(v);
  if (!m) return null;
  const o: Outcome = { k: m[1], t: Number(m[2]) };
  if (m[3] !== undefined) { o.sid = Number(m[3]); o.atk = Number(m[4]); }
  return o;
}
export function outcomeValue(o: Outcome): string {
  const t = Math.max(0, Math.round(o.t));
  return o.sid !== undefined && o.atk !== undefined ? `${o.k}${t}:${o.sid}:${o.atk}` : `${o.k}${t}`;
}

// ---------------------------------------------------------------- lieux
const LIVING = new Set<SettlementType>(['hameau', 'village', 'village minier', 'port', 'bourg', 'ville', 'capitale', 'fort', 'château', 'monastère']);
const RAIDABLE = new Set<SettlementType>(['hameau', 'village', 'village minier', 'port', 'bourg']);
const FEASTS = new Set<SettlementType>(['village', 'village minier', 'port', 'bourg', 'ville', 'capitale']);
const SICKLY = new Set<SettlementType>(['hameau', 'village', 'village minier', 'port', 'bourg', 'ville', 'capitale', 'monastère']);
/** places qui peuvent tomber : les villes, capitales, châteaux et monastères résistent (sièges simplifiés) */
export const CAPTURABLE = new Set<SettlementType>(['hameau', 'village', 'village minier', 'port', 'bourg', 'fort']);
const TOWNS = new Set<SettlementType>(['bourg', 'ville', 'capitale']);
const RAIDER_W: Record<Raider, number> = { bandit: 1, gobelin: 0.8, loup: 0.7 };
/** gardes d'une implantation (ordre de grandeur, d'après la génération des PNJ) */
const GUARDS: Partial<Record<SettlementType, number>> = { hameau: 0, village: 2, 'village minier': 2, port: 2, bourg: 4 };
const PRIZE: Partial<Record<SettlementType, number>> = { village: 25, 'village minier': 25, port: 30, bourg: 40, ville: 55, capitale: 70 };
const REMEDIES: Partial<Record<SettlementType, number>> = { hameau: 2, village: 3, 'village minier': 3, port: 3, bourg: 4, ville: 5, capitale: 5, monastère: 3 };
/** métiers qui peuvent périr dans un raid ou une épidémie (les commerces et les donneurs de quêtes sont épargnés par le jeu) */
const VICTIM_PROF = new Set(['fermier', 'artisan', 'chasseur', 'pêcheur', 'mineur', 'meunier', 'garde', 'voyageur']);

export function livingPlace(s: Settlement | undefined): boolean { return !!s && !s.abandoned && LIVING.has(s.type); }

export interface CalendarWorld { civ: Civilization; seed: WorldSeed; layouts: Layout[]; lairs: Lair[] }

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Calendrier : événements des lieux (créneaux), guerres (périodes), batailles (selon les propriétaires du moment). */
export class Calendar {
  private slots = new Map<string, SlotPlan | null>();
  private wars = new Map<number, WarPlan | null>();
  private layouts = new Map<number, Layout>();
  private lairsNear = new Map<number, Lair[]>();
  private swamp = new Map<number, boolean>();
  private offsets: number[];
  private pairs: [number, number][];
  /** événements créés par la console de développement (ils masquent ceux du calendrier au même endroit) */
  readonly dev: EventPlan[] = [];
  /** guerre déclarée par la console (prioritaire sur celle de la période) */
  devWar: WarPlan | null = null;
  private devN = 0;

  constructor(private w: CalendarWorld) {
    for (const L of w.layouts) if (L.sid >= 0) this.layouts.set(L.sid, L);
    this.offsets = w.civ.settlements.map((s) => w.seed.int('événements', 'créneau' + s.id) % SLOT_DAYS);
    this.pairs = hostilePairs(w.civ);
  }

  get civ(): Civilization { return this.w.civ; }
  layout(sid: number): Layout | undefined { return this.layouts.get(sid); }
  /** Paires de factions en mauvais termes (relations ≤ −0,3) qui partagent une frontière (route entre leurs implantations). */
  hostile(): readonly [number, number][] { return this.pairs; }

  // ---------------------------------------------------------------- créneaux des lieux
  /** Créneau d'un lieu contenant le jour donné : rang et premier jour. */
  slotOf(sid: number, day: number): { k: number; d0: number } {
    const off = this.offsets[sid] ?? 0, k = Math.floor((day + off) / SLOT_DAYS);
    return { k, d0: k * SLOT_DAYS - off };
  }

  /** Événement d'un créneau (null : rien) — déterministe, mis en cache. */
  slot(sid: number, k: number): SlotPlan | null {
    const key = `${sid}:${k}`;
    let p = this.slots.get(key);
    if (p === undefined) { p = this.planSlot(sid, k); this.slots.set(key, p); }
    return p;
  }

  /** Fin de l'occupation d'un lieu par un événement (séquelles d'un raid comprises). */
  busyEnd(p: EventPlan): number { return p.kind === 'raid' ? p.end + RAID_RECOVER_DAYS * DAY : p.end; }

  /** Événement d'un lieu en cours (ou en séquelles) à l'instant t, console comprise. */
  at(sid: number, t: number): SlotPlan | null {
    for (const p of this.dev) if (p.kind !== 'bataille' && p.sid === sid && t >= p.start - 60 && t < this.busyEnd(p)) return p;
    const day = Math.floor(t / DAY), { k } = this.slotOf(sid, day), p = this.slot(sid, k);
    if (!p || t < p.start - 60 || t >= this.busyEnd(p) || this.masked(p)) return null;
    return p;
  }

  /** Un lieu est-il pris ce jour-là (événement, séquelles) ? Les batailles évitent ces lieux. */
  busy(sid: number, day: number): boolean {
    const a = day * DAY, b = a + DAY;
    for (const p of this.dev) if (p.sid === sid && p.start < b && this.busyEnd(p) > a) return true;
    const p = this.slot(sid, this.slotOf(sid, day).k);
    return !!p && !this.masked(p) && p.start < b && this.busyEnd(p) > a;
  }

  /** Événements des lieux qui touchent ce jour (début, déroulement ou séquelles), console comprise. */
  eventsOn(day: number, out: SlotPlan[] = []): SlotPlan[] {
    out.length = 0;
    const a = day * DAY, b = a + DAY, civ = this.w.civ;
    for (const s of civ.settlements) {
      if (!livingPlace(s)) continue;
      const { k } = this.slotOf(s.id, day), p = this.slot(s.id, k);
      if (p && !this.masked(p) && p.start < b && this.busyEnd(p) > a) out.push(p);
    }
    for (const p of this.dev) if (p.kind !== 'bataille' && p.start < b && this.busyEnd(p) > a) out.push(p);
    return out;
  }

  /** Un événement du calendrier recouvert par un événement de la console au même endroit est masqué. */
  private masked(p: SlotPlan): boolean {
    if (!this.dev.length) return false;
    for (const d of this.dev) if (d.sid === p.sid && d.start < this.busyEnd(p) && this.busyEnd(d) > p.start - 60) return true;
    return false;
  }

  /** Jour de la fête patronale d'un lieu dans l'année (0..YEAR_DAYS−1) et son saint. */
  patron(sid: number): { day: number; saint: string; fem: boolean } {
    const q = this.w.seed.stream('événements', 'saint', sid), fem = q.next() < 0.4;
    const saint = new NameGen(q.fork('nom')).person(fem ? 'f' : 'm').first;
    return { day: this.w.seed.int('événements', 'patron' + sid) % YEAR_DAYS, saint, fem };
  }

  private planSlot(sid: number, k: number): SlotPlan | null {
    const civ = this.w.civ, s = civ.settlements[sid];
    if (!livingPlace(s)) return null;
    const rng = this.w.seed.stream('événements', 'lieu', sid, k);
    const off = this.offsets[sid] ?? 0, d0 = k * SLOT_DAYS - off;
    // tirages dans un ordre fixe : les détails de chaque sorte d'événement ont leur propre flux dérivé
    const rHappen = rng.next(), rKind = rng.next();
    const season = seasonOf(d0 + 3), L = this.layouts.get(sid);
    const feastOk = FEASTS.has(s.type) && !!L?.plaza;
    // la fête du saint patron revient chaque année, le même jour
    const pat = this.patron(sid);
    let pd = -1;
    for (let d = d0; d <= d0 + 5; d++) if (mod(d, YEAR_DAYS) === pat.day) pd = d;
    if (feastOk && pd >= 0 && rHappen < 0.85) return this.feast(s, k, 'patron', pd - d0, rng.fork('fête'));
    if (rHappen >= SLOT_CHANCE) return null;
    const lairs = this.raidLairs(sid);
    const cold = season === 'automne' || season === 'hiver';
    const harvest = (season === 'été' || season === 'automne') && (s.produces.includes('grain') || s.produces.includes('vin'));
    const trade = TOWNS.has(s.type) || civ.roads.some((r) => (r.a === sid || r.b === sid) && r.kind === 2);
    const w: [string, number][] = [
      ['raid', RAIDABLE.has(s.type) && lairs.length ? 0.38 + (cold ? 0.12 : 0) : 0],
      ['moissons', feastOk && harvest ? 0.3 : 0],
      ['foire', feastOk && trade && season !== 'hiver' ? 0.25 : 0],
      ['épidémie', SICKLY.has(s.type) ? 0.12 + (season === 'hiver' ? 0.12 : season === 'automne' ? 0.06 : 0) + (this.swampy(s) ? 0.06 : 0) : 0],
    ];
    const total = w.reduce((a, [, x]) => a + x, 0);
    if (total <= 0) return null;
    let t = rKind * total, kind = '';
    for (const [kk, x] of w) if (x > 0 && (t -= x) < 0) { kind = kk; break; }
    if (!kind) kind = w.filter(([, x]) => x > 0).pop()![0];
    if (kind === 'raid') return this.raid(s, k, rng.fork('raid'));
    if (kind === 'épidémie') return this.epidemic(s, k, rng.fork('épidémie'), season);
    const days = kind === 'foire' ? 2 : TOWNS.has(s.type) ? 2 : 1;
    return this.feast(s, k, kind as FeastKind, rng.fork('jour').int(0, 6 - days), rng.fork('fête'));
  }

  /** Repaires d'où peuvent venir des pillards : camps de bandits, repaires de gobelins, tanières de loups (1,7 km au plus). */
  raidLairs(sid: number): Lair[] {
    let l = this.lairsNear.get(sid);
    if (!l) {
      const s = this.w.civ.settlements[sid];
      l = this.w.lairs.filter((x) => ((x.type === 'bandit' && x.sid >= 0) || x.type === 'gobelin' || x.type === 'loup') && Math.hypot(x.x - s.x, x.z - s.z) < 1700)
        .sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z) || (a.key < b.key ? -1 : 1));
      this.lairsNear.set(sid, l);
    }
    return l;
  }

  private swampy(s: Settlement): boolean {
    let v = this.swamp.get(s.id);
    if (v === undefined) {
      const m = this.w.civ.macro;
      let n = 0;
      for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
        const i = s.ci + di, j = s.cj + dj;
        if (i >= 0 && j >= 0 && i < MACRO && j < MACRO && m.biome[j * MACRO + i] === B.SWAMP) n++;
      }
      v = n >= 3;
      this.swamp.set(s.id, v);
    }
    return v;
  }

  private raid(s: Settlement, k: number, q: RNG, force?: { raider?: Raider; start?: number; id?: string }): RaidPlan | null {
    const lairs = this.raidLairs(s.id).filter((l) => !force?.raider || l.type === force.raider);
    const rLair = q.next(), rDay = q.next(), rTime = q.next(), rCount = q.next(), rWin = q.next(), rBurnN = q.next(), rDeaths = q.next();
    const burnRng = q.fork('feu');
    let lair: Lair | null = null;
    if (lairs.length) {
      const ws = lairs.map((l) => RAIDER_W[l.type as Raider] * Math.max(0.15, 1 - Math.hypot(l.x - s.x, l.z - s.z) / 1900));
      let t = rLair * ws.reduce((a, b) => a + b, 0);
      lair = lairs[lairs.length - 1];
      for (let i = 0; i < lairs.length; i++) if ((t -= ws[i]) < 0) { lair = lairs[i]; break; }
    }
    const raider: Raider = (lair?.type as Raider) ?? force?.raider ?? 'bandit';
    // pas de repaire (console) : la bande arrive du nord-est, à un kilomètre
    const lx = lair ? lair.x : s.x + 700, lz = lair ? lair.z : s.z - 700;
    const off = this.offsets[s.id] ?? 0, d0 = k * SLOT_DAYS - off;
    const start = force?.start ?? (d0 + Math.floor(rDay * 4)) * DAY + 22 * 60 + 30 + Math.floor(rTime * 150);
    const count = raider === 'bandit' ? 3 + Math.floor(rCount * 3) : raider === 'gobelin' ? 3 + Math.floor(rCount * 4) : 3 + Math.floor(rCount * 2);
    const guards = GUARDS[s.type] ?? 4;
    const p = Math.max(0.12, Math.min(0.85, 0.3 + 0.1 * (count - 1.6 * guards) - (raider === 'loup' ? 0.05 : 0)));
    const succeeds = rWin < p;
    // maisons du côté du repaire : celles qui flamberont si les pillards entrent (les loups ne mettent pas le feu)
    const burn: number[] = [];
    const L = this.layouts.get(s.id);
    if (L && raider !== 'loup') {
      const d = Math.hypot(lx - s.x, lz - s.z) || 1, ex = s.x + ((lx - s.x) / d) * s.radius, ez = s.z + ((lz - s.z) / d) * s.radius;
      const houses = L.buildings.filter((b) => !b.ruined && (b.kind === 'maison' || b.kind === 'ferme' || b.kind === 'grange' || b.kind === 'cabane'))
        .sort((a, b) => Math.hypot(a.x - ex, a.z - ez) - Math.hypot(b.x - ex, b.z - ez) || a.id - b.id).slice(0, 6);
      burnRng.shuffle(houses);
      const n = Math.min(houses.length, 1 + Math.floor(rBurnN * (s.type === 'hameau' ? 2 : 3)));
      for (const b of houses.slice(0, n)) burn.push(b.id);
      burn.sort((a, b) => a - b);
    }
    const deaths = succeeds ? Math.floor(rDeaths * (raider === 'loup' ? 2 : 3)) : 0;
    return {
      id: force?.id ?? `r${s.id}.${k}`, kind: 'raid', sid: s.id, start, end: start + RAID_WINDOW, x: s.x, z: s.z,
      raider, lair: lair?.key ?? '', lx, lz, camp: raider === 'bandit' && lair ? lair.sid : -1,
      count, level: Math.max(1, dangerAt(this.w.civ, lx, lz)), succeeds, burn, deaths,
    };
  }

  private feast(s: Settlement, k: number, feast: FeastKind, o: number, q: RNG, force?: { start?: number; id?: string }): FeastPlan {
    const off = this.offsets[s.id] ?? 0, d0 = k * SLOT_DAYS - off, town = TOWNS.has(s.type);
    const days = feast === 'foire' || (feast === 'moissons' && town) ? 2 : 1;
    const start = force?.start ?? (d0 + o) * DAY + 8 * 60;
    const end = force?.start !== undefined ? force.start + (days - 1) * DAY + 15 * 60 : (d0 + o + days - 1) * DAY + 23 * 60;
    const names = new NameGen(q.fork('rivaux')), best = q.int(town ? 34 : 28, town ? 52 : 44);
    const rivals: FeastPlan['rivals'] = [];
    for (let i = 0; i < 3; i++) {
      const fem = q.chance(0.35), nm = names.person(fem ? 'f' : 'm');
      rivals.push({ ...nm, fem, score: i === 0 ? best : Math.max(6, best - q.int(4, 10) * i) });
    }
    const pat = this.patron(s.id);
    return {
      id: force?.id ?? `f${s.id}.${k}`, kind: 'fête', sid: s.id, start, end, x: s.x, z: s.z, feast, saint: pat.saint, fem: pat.fem,
      merchants: feast === 'foire' ? 3 : 1, rivals, prize: PRIZE[s.type] ?? 25,
    };
  }

  private epidemic(s: Settlement, k: number, q: RNG, season: Season, force?: { start?: number; id?: string; days?: number }): EpidemicPlan {
    const off = this.offsets[s.id] ?? 0, d0 = k * SLOT_DAYS - off;
    const rName = q.next(), rSev = q.next(), rDay = q.next(), rLen = q.next(), rDeaths = q.next();
    const disease = this.swampy(s) ? 'la fièvre des marais' : season === 'hiver' ? 'la toux grise' : rName < 0.5 ? 'la suette' : 'la fièvre quarte';
    const severity = 0.3 + rSev * 0.6;
    const start = force?.start ?? (d0 + Math.floor(rDay * 3)) * DAY + 6 * 60;
    const days = force?.days ?? 4 + Math.floor(rLen * 2);
    const deaths = severity > 0.65 ? 1 + Math.floor(rDeaths * 2) : severity > 0.45 ? Math.floor(rDeaths * 2) : 0;
    return {
      id: force?.id ?? `p${s.id}.${k}`, kind: 'épidémie', sid: s.id, start, end: start + days * DAY, x: s.x, z: s.z,
      disease, severity, sick: 0.2 + severity * 0.25, deaths, remedies: REMEDIES[s.type] ?? 3,
    };
  }

  /** Oublie les créneaux trop anciens (appelé une fois par jour). */
  prune(day: number): void {
    for (const key of [...this.slots.keys()]) {
      const [sid, k] = key.split(':').map(Number);
      if ((k + 2) * SLOT_DAYS - (this.offsets[sid] ?? 0) < day - 12) this.slots.delete(key);
    }
  }

  // ---------------------------------------------------------------- guerres
  /** Campagne d'une période (null : paix), entre deux factions en mauvais termes. */
  war(period: number): WarPlan | null {
    let w = this.wars.get(period);
    if (w !== undefined) return w;
    w = null;
    const rng = this.w.seed.stream('événements', 'guerre', period);
    const rWar = rng.next(), rPair = rng.next(), rStart = rng.next(), rDur = rng.next(), rSide = rng.next();
    if (this.pairs.length && rWar < WAR_CHANCE && period >= 0) {
      const [p0, p1] = this.pairs[Math.floor(rPair * this.pairs.length)];
      const [a, b] = rSide < 0.5 ? [p0, p1] : [p1, p0];
      const start = period * WAR_PERIOD + 3 + Math.floor(rStart * 6);
      w = { id: `g${period}`, period, a, b, start, end: start + 8 + Math.floor(rDur * 5) };
    }
    this.wars.set(period, w);
    return w;
  }

  /** Guerre qui couvre ce jour (déclaration comprise, paix exclue), console d'abord. */
  warOn(day: number): WarPlan | null {
    const d = this.devWar;
    if (d && day >= d.start && day < d.end) return d;
    const w = this.war(Math.floor(day / WAR_PERIOD));
    return w && day >= w.start && day < w.end ? w : null;
  }

  /**
   * Bataille du jour d'une guerre (null : pas de combat). Le camp qui a l'avantage attaque plus souvent ; la cible est une
   * implantation du défenseur reliée par la route à une implantation de l'attaquant, libre ce jour-là (pas de fête, de
   * raid ni d'épidémie en cours) ; le champ de bataille est sur cette route, devant la place. `forced` : site déjà connu
   * (fait partagé, sauvegarde) — la bataille s'y tient même si les propriétaires ont changé depuis.
   */
  battle(w: WarPlan, day: number, owner: (sid: number) => number, prior: readonly BattleResult[], forced?: { sid: number; atk: number }): BattlePlan | null {
    if (day <= w.start || day >= w.end) return null;
    const k = day - w.start - 1, civ = this.w.civ;
    const rng = this.w.seed.stream('événements', 'bataille', w.id, k);
    const rSide = rng.next(), rSite = rng.next(), rWin = rng.next(), rTime = rng.next(), rA = rng.next(), rD = rng.next();
    let score = 0;
    for (const r of prior) score += (r.win === 'a' ? r.atk : r.def) === w.a ? 1 : -1;
    const pA = Math.max(0.2, Math.min(0.8, 0.5 + 0.12 * score));
    const first = rSide < pA ? w.a : w.b;
    const sides = forced ? [forced.atk === w.b ? w.b : w.a] : [first, first === w.a ? w.b : w.a];
    for (const atk of sides) {
      const def = atk === w.a ? w.b : w.a;
      const cands: { road: number; target: number; from: number }[] = [];
      for (const r of civ.roads) {
        for (const [t, f] of [[r.b, r.a], [r.a, r.b]] as const) {
          const T = civ.settlements[t], F = civ.settlements[f];
          if (!livingPlace(T) || !livingPlace(F)) continue;
          if (forced ? t !== forced.sid : owner(t) !== def || owner(f) !== atk || this.busy(t, day)) continue;
          if (!cands.some((c) => c.target === t)) cands.push({ road: r.id, target: t, from: f });
          // site imposé : on part de préférence d'une implantation de l'attaquant
          else if (forced && owner(f) === atk) { const c = cands.find((x) => x.target === t)!; if (owner(c.from) !== atk) { c.road = r.id; c.from = f; } }
        }
      }
      if (!cands.length) continue;
      cands.sort((x, y) => x.target - y.target);
      const c = cands[Math.floor(rSite * cands.length)];
      const T = civ.settlements[c.target], pt = this.field(c.road, c.target, c.from);
      let own = 0, opp = 0;
      for (const s of civ.settlements) if (livingPlace(s)) { const o = owner(s.id); if (o === atk) own++; else if (o === def) opp++; }
      const pWin = Math.max(0.15, Math.min(0.75, 0.3 + (0.4 * own) / Math.max(1, own + opp) - (T.type === 'fort' ? 0.1 : 0)));
      const start = day * DAY + 9 * 60 + Math.floor(rTime * 300);
      return {
        id: `b${w.id.slice(1)}.${k}`, kind: 'bataille', sid: c.target, start, end: start + BATTLE_WINDOW, x: pt.x, z: pt.z,
        war: w.id, k, attacker: atk, defender: def, from: c.from,
        atk: 4 + Math.floor(rA * 3), def: 3 + Math.floor(rD * 3) + (T.type === 'bourg' || T.type === 'fort' ? 1 : 0),
        level: Math.max(1, dangerAt(civ, pt.x, pt.z)), attackerWins: rWin < pWin, capturable: CAPTURABLE.has(T.type), dx: pt.dx, dz: pt.dz,
      };
    }
    return null;
  }

  /** Champ de bataille : sur la route, à l'extérieur de la place (son rayon + 75 m), et la direction du camp attaquant. */
  field(roadId: number, target: number, from: number): { x: number; z: number; dx: number; dz: number } {
    const civ = this.w.civ, T = civ.settlements[target], F = civ.settlements[from], r = civ.roads[roadId];
    const pts = r ? (r.a === target ? r.points : [...r.points].reverse()) : [];
    const want = T.radius + 75, total = Math.hypot(F.x - T.x, F.z - T.z);
    let x = T.x + ((F.x - T.x) / (total || 1)) * Math.min(want, total * 0.45), z = T.z + ((F.z - T.z) / (total || 1)) * Math.min(want, total * 0.45);
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - T.x, pts[i].z - T.z);
      if (d >= want && Math.hypot(pts[i].x - F.x, pts[i].z - F.z) > F.radius + 40) { x = pts[i].x; z = pts[i].z; break; }
    }
    const dx = F.x - x, dz = F.z - z, l = Math.hypot(dx, dz) || 1;
    return { x, z, dx: dx / l, dz: dz / l };
  }

  // ---------------------------------------------------------------- console de développement
  /** Événement immédiat près d'un lieu (console) : raid, fête, épidémie. */
  spawnDev(kind: 'raid' | 'fête' | 'épidémie', sid: number, t: number, opt: { raider?: Raider; feast?: FeastKind } = {}): SlotPlan | null {
    const s = this.w.civ.settlements[sid];
    if (!livingPlace(s)) return null;
    const n = ++this.devN, q = this.w.seed.stream('événements', 'console', n);
    const k = this.slotOf(sid, Math.floor(t / DAY)).k;
    // un seul événement à la fois au même endroit : le nouveau remplace celui de la console qui s'y tenait
    for (let i = this.dev.length - 1; i >= 0; i--) if (this.dev[i].sid === sid && this.dev[i].kind !== 'bataille') this.dev.splice(i, 1);
    let p: SlotPlan | null;
    if (kind === 'raid') p = this.raid(s, k, q, { raider: opt.raider, start: Math.round(t) + 1, id: `x${n}r` });
    else if (kind === 'fête') p = this.feast(s, k, opt.feast ?? 'foire', 0, q, { start: Math.round(t), id: `x${n}f` });
    else p = this.epidemic(s, k, q, seasonOf(Math.floor(t / DAY)), { start: Math.round(t), id: `x${n}p`, days: 2 });
    if (p) this.dev.push(p);
    return p;
  }

  /** Bataille immédiate (console) devant une place, dans la guerre donnée. */
  spawnDevBattle(w: WarPlan, target: number, from: number, roadId: number, t: number): BattlePlan {
    const n = ++this.devN, civ = this.w.civ, T = civ.settlements[target];
    const pt = roadId >= 0 ? this.field(roadId, target, from) : (() => {
      const F = civ.settlements[from], d = Math.hypot(F.x - T.x, F.z - T.z) || 1, x = T.x + ((F.x - T.x) / d) * (T.radius + 75), z = T.z + ((F.z - T.z) / d) * (T.radius + 75);
      return { x, z, dx: (F.x - T.x) / d, dz: (F.z - T.z) / d };
    })();
    const p: BattlePlan = {
      id: `x${n}b`, kind: 'bataille', sid: target, start: Math.round(t) + 1, end: Math.round(t) + 1 + BATTLE_WINDOW, x: pt.x, z: pt.z,
      war: w.id, k: -n, attacker: w.a, defender: w.b, from, atk: 5, def: 4, level: Math.max(1, dangerAt(civ, pt.x, pt.z)),
      attackerWins: true, capturable: CAPTURABLE.has(T.type), dx: pt.dx, dz: pt.dz,
    };
    this.dev.push(p);
    return p;
  }

  /** Guerre immédiate (console) : a déclare la guerre à b aujourd'hui, pour dix jours. */
  declareDev(a: number, b: number, day: number): WarPlan {
    const n = ++this.devN;
    this.devWar = { id: `gx${n}`, period: -1, a, b, start: day, end: day + 10 };
    return this.devWar;
  }

  /** Remise à zéro (chargement) : événements et guerre de la console oubliés. */
  forget(): void { this.dev.length = 0; this.devWar = null; this.slots.clear(); this.wars.clear(); }
}

/** Paires de factions en mauvais termes qui partagent une frontière (route entre deux de leurs implantations). */
export function hostilePairs(civ: Civilization): [number, number][] {
  const out: [number, number][] = [];
  for (const fa of civ.factions) for (const fb of civ.factions) {
    if (fa.id >= fb.id || (fa.relations[fb.id] ?? 0) > -0.3) continue;
    const owned = (f: number) => civ.settlements.filter((s) => livingPlace(s) && s.factionId === f).length;
    if (owned(fa.id) < 2 || owned(fb.id) < 2) continue;
    const touch = civ.roads.some((r) => {
      const A = civ.settlements[r.a], B2 = civ.settlements[r.b];
      return livingPlace(A) && livingPlace(B2) && ((A.factionId === fa.id && B2.factionId === fb.id) || (A.factionId === fb.id && B2.factionId === fa.id));
    });
    if (touch) out.push([fa.id, fb.id]);
  }
  return out;
}

/** Jour de la paix d'une guerre selon ses batailles (série de défaites, places perdues) ; null : la guerre suit son cours. */
export function peaceDay(w: WarPlan, results: readonly BattleResult[], dayOf: (r: BattleResult) => number): number | null {
  const lost = new Map<number, number>(), taken = new Map<number, number>();
  const sorted = [...results].sort((a, b) => a.t - b.t);
  for (const r of sorted) {
    const loser = r.win === 'a' ? r.def : r.atk, winner = r.win === 'a' ? r.atk : r.def;
    lost.set(loser, (lost.get(loser) ?? 0) + 1);
    if (r.capture) taken.set(winner, (taken.get(winner) ?? 0) + 1);
    if ((lost.get(loser) ?? 0) >= PEACE_LOSSES || (taken.get(winner) ?? 0) >= PEACE_CAPTURES) return Math.min(w.end, dayOf(r) + 1);
  }
  return null;
}

/** Issue d'une bataille (observée ou abstraite) : vainqueur, prise de la place. */
export function battleResult(p: BattlePlan, o: Outcome | undefined): BattleResult {
  const k = o && (o.k === 'a' || o.k === 'd') ? o.k : p.attackerWins ? 'a' : 'd';
  return { k: p.k, sid: p.sid, atk: p.attacker, def: p.defender, win: k, capture: k === 'a' && p.capturable, t: o && (o.k === 'a' || o.k === 'd') ? o.t : p.end };
}

/** Issue d'un raid : observée, sinon tirée (réussi « s » ou repoussé « r ») à la fin de l'assaut. */
export function raidResult(p: RaidPlan, o: Outcome | undefined): Outcome {
  return o && (o.k === 'r' || o.k === 's') ? o : { k: p.succeeds ? 's' : 'r', t: p.end };
}

/** Fin d'une épidémie : enrayée par les remèdes (« e »), sinon d'elle-même (avec des morts possibles). */
export function epidemicEnd(p: EpidemicPlan, o: Outcome | undefined): { t: number; stopped: boolean } {
  return o && o.k === 'e' && o.t < p.end ? { t: Math.max(p.start, o.t), stopped: true } : { t: p.end, stopped: false };
}

/** Fin d'une fête (la console peut l'abréger). */
export function feastEnd(p: FeastPlan, o: Outcome | undefined): number { return o && o.k === 'f' ? Math.min(p.end, Math.max(p.start, o.t)) : p.end; }

/** Verdict d'un raid ou d'une bataille interrompu (le joueur s'éloigne) : forces en présence. */
export function raidVerdict(raiders: number, defenders: number): 'r' | 's' { return raiders === 0 || defenders * 1.2 >= raiders ? 'r' : 's'; }
export function battleVerdict(atk: number, def: number, attackerWins: boolean): 'a' | 'd' { return atk === def ? (attackerWins ? 'a' : 'd') : atk > def ? 'a' : 'd'; }

/** Villageois alité pendant une épidémie (part « sick » des habitants ; ni guérisseurs, ni prêtres, ni gardes). */
export function bedridden(n: NPCData, p: EpidemicPlan): boolean {
  if (n.profession === 'guérisseuse' || n.profession === 'prêtre' || n.profession === 'moine' || n.profession === 'garde' || n.profession === 'soldat') return false;
  return hashString(`${p.id}|${n.id}`) / 4294967296 < p.sick;
}

/** Victimes d'un raid réussi ou d'une épidémie qui s'éteint seule : déterministes, jamais un commerce ni un donneur de quête. */
export function pickVictims(npcs: readonly NPCData[], n: number, seed: WorldSeed, evId: string, spare: (n: NPCData) => boolean, among?: (n: NPCData) => boolean): NPCData[] {
  if (n <= 0) return [];
  const c = npcs.filter((x) => x.alive && VICTIM_PROF.has(x.profession) && !spare(x) && (!among || among(x))).sort((a, b) => (a.id < b.id ? -1 : 1));
  seed.stream('événements', 'victimes', evId).shuffle(c);
  return c.slice(0, n);
}

// ---------------------------------------------------------------- concours de tir
/** Points d'une flèche selon sa distance au centre de la cible (m) : 10, 6, 3, sinon rien. */
export function ringScore(r: number): number { return r <= 0.16 ? 10 : r <= 0.34 ? 6 : r <= 0.62 ? 3 : 0; }
/** Bonus des cibles lointaines (cible 1, 2, 3). */
export const TARGET_BONUS = [0, 2, 4];
export const CONTEST_ARROWS = 6, CONTEST_FEE = 3;
/** Rang du joueur (1 : vainqueur) : il faut battre strictement le meilleur rival. */
export function contestRank(score: number, rivals: readonly { score: number }[]): number { return 1 + rivals.filter((r) => r.score >= score).length; }

// ---------------------------------------------------------------- sauvegarde
export interface EventSave {
  /** issues observées et batailles résolues : [événement, « r1234 », « a1234:16:0 »…] */
  out?: [string, string][];
  /** dernier jour dont les événements ont été appliqués */
  jour?: number;
  /** événements connus (journal, carte) */
  vus?: string[];
  /** participations : « visite:<id> », « concours:<id> », « aide:<id> »… */
  fait?: string[];
  /** maladie du joueur : nom, fin (minute absolue) ; immunité (minute absolue) */
  malade?: { nom: string; fin: number } | null;
  immun?: number;
  /** victoires par faction servie (rang) ; camp choisi dans la guerre en cours [guerre, faction] */
  rangs?: [number, number][];
  camp?: [string, number] | null;
  /** quêtes de la guérisseuse : [quête, événement, PNJ, remèdes demandés] */
  remedes?: [string, string, string, number][];
  journal?: string[];
}

/** Sauvegarde assainie : structure vérifiée, valeurs bornées ; champ absent = état par défaut. */
export function sanitizeEventSave(raw: unknown): Required<EventSave> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as EventSave;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const str = (v: unknown, max = 80): v is string => typeof v === 'string' && v.length > 0 && v.length < max;
  const out: [string, string][] = [];
  if (Array.isArray(r.out)) for (const t of r.out) if (Array.isArray(t) && str(t[0], 40) && parseOutcome(t[1]) && !out.some((x) => x[0] === t[0])) out.push([t[0], t[1] as string]);
  const list = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.filter((x) => str(x)))].slice(0, max) as string[] : []);
  let malade: { nom: string; fin: number } | null = null;
  if (r.malade && typeof r.malade === 'object' && str(r.malade.nom, 60) && num(r.malade.fin)) malade = { nom: r.malade.nom, fin: Math.max(0, Math.floor(r.malade.fin)) };
  const rangs: [number, number][] = [];
  if (Array.isArray(r.rangs)) for (const t of r.rangs) if (Array.isArray(t) && num(t[0]) && num(t[1]) && t[0] >= 0 && t[0] < 64 && !rangs.some((x) => x[0] === t[0])) rangs.push([Math.floor(t[0]), Math.max(0, Math.min(999, Math.floor(t[1])))]);
  const camp: [string, number] | null = Array.isArray(r.camp) && str(r.camp[0], 20) && num(r.camp[1]) && r.camp[1] >= 0 ? [r.camp[0], Math.floor(r.camp[1])] : null;
  const remedes: [string, string, string, number][] = [];
  if (Array.isArray(r.remedes)) for (const t of r.remedes) {
    if (!Array.isArray(t) || !str(t[0]) || !t[0].startsWith('épidémie:') || !str(t[1], 40) || !str(t[2], 40) || !num(t[3]) || remedes.length >= 4) continue;
    if (!remedes.some((x) => x[0] === t[0])) remedes.push([t[0], t[1], t[2], Math.max(1, Math.min(9, Math.floor(t[3])))]);
  }
  const journal = Array.isArray(r.journal) ? r.journal.filter((x) => str(x, 240)).slice(0, 8) : [];
  return {
    out, jour: num(r.jour) ? Math.floor(r.jour) : -1, vus: list(r.vus, 300), fait: list(r.fait, 300), malade,
    immun: num(r.immun) ? Math.max(0, Math.floor(r.immun)) : 0, rangs, camp, remedes, journal,
  };
}

/** Rang militaire modeste selon les victoires remportées pour une faction. */
export function rankOf(wins: number, fem: boolean): string { return wins >= 6 ? (fem ? 'sergente' : 'sergent') : wins >= 2 ? 'soldat' : 'recrue'; }
