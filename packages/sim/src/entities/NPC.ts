import type { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import type { Layout, Building, QuarterKind } from '@ascii-fort/worldgen/civilization/Layout';
import { baseBuildings, craftOf } from '@ascii-fort/worldgen/civilization/Districts';
import { STALLS, CRAFT_DEFS, RESIDENT_TITLES } from '../gameplay/Market';
import type { Settlement } from '@ascii-fort/worldgen/civilization/types';
import { NameGen } from '@ascii-fort/worldgen/civilization/Names';
import type { RNG } from '@ascii-fort/core/RNG';

// Identité et vie des PNJ : générés par implantation, de façon déterministe et indépendante de
// l'ordre de chargement (flux « npc » propre à chaque implantation).

export type Profession =
  | 'fermier' | 'forgeron' | 'marchand' | 'aubergiste' | 'garde' | 'prêtre' | 'meunier' | 'chasseur'
  | 'pêcheur' | 'mineur' | 'soldat' | 'moine' | 'noble' | 'artisan' | 'guérisseuse' | 'voyageur'
  // voyageurs des routes (convois : Caravans.ts)
  | 'charretier' | 'escorte' | 'pèlerin' | 'colporteur' | 'messager'
  // quartiers des villes (étape 55)
  | 'tavernier' | 'barde' | 'bourgeois';

export type Activity = 'dormir' | 'manger' | 'travailler' | 'loisir' | 'prier' | 'patrouiller' | 'garder' | 'voyager';
export type PlaceRef = 'home' | 'work' | 'inn' | 'plaza' | 'temple' | 'field' | 'patrol' | 'wild'
  // étape 55 : un étal du marché (le sien, ou celui où l'on flâne), une taverne du lieu
  | 'market' | 'tavern';
export interface ScheduleBlock { from: number; to: number; act: Activity; place: PlaceRef }

export interface Traits { bravery: number; kindness: number; greed: number; piety: number; sociability: number; honesty: number }
export interface Relation { id: string; kind: 'époux' | 'parent' | 'enfant' | 'frère' | 'ami' | 'rival'; value: number }
export interface Memory { kind: string; subject: string; day: number; weight: number; text: string }

export interface NPCData {
  id: string; sid: number;
  first: string; last: string; sex: 'm' | 'f'; age: number;
  profession: Profession;
  home: number; work: number;          // ids de bâtiments dans le plan de l'implantation
  factionId: number;
  traits: Traits;
  relations: Relation[];
  wealth: number;
  inventory: { id: string; qty: number }[];
  needs: { faim: number; fatigue: number; social: number; sécurité: number };
  knowledge: string[];                 // « poi:12 », « event:3 », « settlement:5 »
  goal: string;
  schedule: ScheduleBlock[];
  shift: 'jour' | 'nuit';
  colors: { skin: number; shirt: number; pants: number; hair: number };
  look: 'civil' | 'garde' | 'moine' | 'noble';
  // état dynamique (sauvegardé en différence)
  alive: boolean;
  hp: number;
  memories: Memory[];
  /** métier affiché, accordé (« marchande », « garde de caravane ») ; absent : `profession` */
  title?: string;
  /** voyageur d'un convoi : route suivie (implantations de départ et d'arrivée) et identifiant du convoi */
  road?: { from: number; to: number; convoy: string };
  /** habitant ajouté par les quartiers (étape 55) : son quartier ; absent pour les PNJ d'origine */
  quarter?: QuarterKind;
  /** marchand du marché : indice de son étal dans layout.district.stalls */
  stall?: number;
}

const SKINS = [0xe0b090, 0xc89870, 0xa87850, 0xf0c8a8, 0x8a6040];
const HAIRS = [0x2a1a10, 0x5a3a20, 0x8a6a30, 0xc8a050, 0x6a6a6a, 0x1a1a1a, 0xa04020];
const SHIRTS = [0x8a3a2a, 0x3a5a8a, 0x5a7a3a, 0x8a7a4a, 0x6a4a6a, 0xa88a5a, 0x4a4a4a, 0x7a2a3a];
const PANTS = [0x3a3a4a, 0x4a3a2a, 0x2a3a2a, 0x5a4a3a];

const h = (hh: number, mm = 0) => hh * 60 + mm;

/** Emploi du temps type par métier (avec un peu de variation individuelle). */
function scheduleFor(p: Profession, rng: RNG, shift: 'jour' | 'nuit'): ScheduleBlock[] {
  const j = () => rng.int(-20, 20);
  const B = (a: number, b: number, act: Activity, place: PlaceRef): ScheduleBlock => ({ from: a, to: b, act, place });
  const wake = h(6, 30) + j(), eve = h(18, 30) + j(), bed = h(22) + j();
  switch (p) {
    case 'aubergiste': return [B(0, h(6), 'dormir', 'home'), B(h(6), h(23, 30), 'travailler', 'work'), B(h(23, 30), 1440, 'dormir', 'home')];
    case 'garde': case 'soldat':
      return shift === 'jour'
        ? [B(0, h(5, 30), 'dormir', 'home'), B(h(5, 30), h(6), 'manger', 'home'), B(h(6), h(12), 'patrouiller', 'patrol'), B(h(12), h(13), 'manger', 'inn'), B(h(13), h(18), 'garder', 'plaza'), B(h(18), h(21), 'loisir', 'inn'), B(h(21), 1440, 'dormir', 'home')]
        : [B(0, h(6), 'patrouiller', 'patrol'), B(h(6), h(14), 'dormir', 'home'), B(h(14), h(17), 'loisir', 'inn'), B(h(17), h(18), 'manger', 'home'), B(h(18), 1440, 'patrouiller', 'patrol')];
    case 'fermier': {
      const w = h(5, 30) + j();
      return [B(0, w, 'dormir', 'home'), B(w, h(6), 'manger', 'home'), B(h(6), h(12), 'travailler', 'field'), B(h(12), h(13), 'manger', 'home'), B(h(13), h(19), 'travailler', 'field'), B(h(19), h(21), 'loisir', rng.chance(0.5) ? 'inn' : 'home'), B(h(21), 1440, 'dormir', 'home')];
    }
    case 'prêtre': case 'moine':
      return [B(0, h(5, 30), 'dormir', 'home'), B(h(5, 30), h(7), 'prier', 'temple'), B(h(7), h(12), 'travailler', 'work'), B(h(12), h(13), 'manger', 'home'), B(h(13), h(18), 'travailler', 'work'), B(h(18), h(20), 'prier', 'temple'), B(h(20), h(21), 'loisir', 'plaza'), B(h(21), 1440, 'dormir', 'home')];
    case 'chasseur': case 'pêcheur':
      return [B(0, h(5), 'dormir', 'home'), B(h(5), h(12), 'travailler', 'wild'), B(h(12), h(13), 'manger', 'home'), B(h(13), h(18), 'travailler', 'wild'), B(h(18), h(22), 'loisir', 'inn'), B(h(22), 1440, 'dormir', 'home')];
    case 'voyageur':
      return [B(0, h(7), 'dormir', 'inn'), B(h(7), h(9), 'manger', 'inn'), B(h(9), h(12), 'loisir', 'plaza'), B(h(12), h(14), 'manger', 'inn'), B(h(14), h(18), 'voyager', 'plaza'), B(h(18), 1440, 'loisir', 'inn')];
    default:
      return [B(0, wake, 'dormir', 'home'), B(wake, h(7, 30), 'manger', 'home'), B(h(7, 30), h(12), 'travailler', 'work'), B(h(12), h(13), 'manger', rng.chance(0.4) ? 'inn' : 'home'), B(h(13), eve, 'travailler', 'work'), B(eve, bed, 'loisir', rng.chance(0.6) ? 'inn' : 'plaza'), B(bed, 1440, 'dormir', 'home')];
  }
}

const WORK_OF: Partial<Record<string, Profession>> = {
  auberge: 'aubergiste', forge: 'forgeron', échoppe: 'marchand', chapelle: 'prêtre', temple: 'prêtre',
  'corps de garde': 'garde', caserne: 'soldat', moulin: 'meunier', ferme: 'fermier', donjon: 'noble', dortoir: 'moine',
};
const WEALTH: Record<Profession, number> = {
  fermier: 25, forgeron: 110, marchand: 220, aubergiste: 130, garde: 45, prêtre: 60, meunier: 70, chasseur: 30, pêcheur: 25,
  mineur: 35, soldat: 40, moine: 10, noble: 600, artisan: 60, guérisseuse: 50, voyageur: 80,
  charretier: 20, escorte: 40, pèlerin: 15, colporteur: 90, messager: 30,
  tavernier: 120, barde: 35, bourgeois: 320,
};

/** PNJ importants d'une implantation (déterministe). */
export function generateNPCs(civ: Civilization, s: Settlement, L: Layout): NPCData[] {
  if (s.abandoned || s.type === 'camp') return [];
  const rng = civ.seed.stream('npc', s.id);
  const names = new NameGen(rng.fork('names'));
  const out: NPCData[] = [];
  // plan d'origine seulement : les bâtiments ajoutés par les quartiers (étape 55) ne changent rien à ces PNJ
  const B0 = baseBuildings(L);
  const houses = B0.filter((b) => b.kind === 'maison' || b.kind === 'ferme' || b.kind === 'cabane');
  let houseIdx = 0;
  const nextHome = (fallback: Building) => (houses.length ? houses[houseIdx++ % houses.length].id : fallback.id);
  const make = (prof: Profession, home: number, work: number, opts: Partial<NPCData> = {}): NPCData => {
    const sex: 'm' | 'f' = prof === 'guérisseuse' ? 'f' : prof === 'moine' ? 'm' : rng.chance(prof === 'garde' || prof === 'soldat' ? 0.25 : 0.5) ? 'f' : 'm';
    const noble = prof === 'noble';
    const nm = names.person(sex, noble, s.name);
    const shift: 'jour' | 'nuit' = (prof === 'garde' || prof === 'soldat') && out.filter((n) => n.profession === prof).length % 2 === 1 ? 'nuit' : 'jour';
    const ageRange: [number, number] = prof === 'garde' || prof === 'soldat' ? [19, 45] : prof === 'prêtre' ? [32, 70] : prof === 'voyageur' ? [20, 55] : [17, 72];
    const n: NPCData = {
      id: `n${s.id}:${out.length}`, sid: s.id, first: nm.first, last: nm.last, sex, age: rng.int(ageRange[0], ageRange[1]),
      profession: prof, home, work, factionId: s.factionId,
      traits: { bravery: rng.next(), kindness: rng.next(), greed: rng.next(), piety: rng.next(), sociability: rng.next(), honesty: rng.next() },
      relations: [], wealth: Math.round(WEALTH[prof] * rng.float(0.6, 1.5)), inventory: [],
      needs: { faim: rng.float(0, 0.4), fatigue: rng.float(0, 0.3), social: rng.float(0.2, 0.6), sécurité: 0 },
      knowledge: [], goal: '', schedule: scheduleFor(prof, rng, shift), shift,
      colors: { skin: rng.pick(SKINS), shirt: rng.pick(SHIRTS), pants: rng.pick(PANTS), hair: rng.pick(HAIRS) },
      look: prof === 'garde' || prof === 'soldat' ? 'garde' : prof === 'moine' || prof === 'prêtre' ? 'moine' : noble ? 'noble' : 'civil',
      alive: true, hp: prof === 'garde' || prof === 'soldat' ? 60 : 30, memories: [], ...opts,
    };
    if (n.traits.bravery < 0.5 && (prof === 'garde' || prof === 'soldat')) n.traits.bravery += 0.4;
    out.push(n);
    return n;
  };

  // métiers liés aux bâtiments
  for (const b of B0) {
    const prof = WORK_OF[b.kind];
    if (!prof) continue;
    const count = prof === 'garde' ? 2 + (s.population > 300 ? 2 : 0) : prof === 'soldat' ? 4 : prof === 'moine' ? 3 : 1;
    for (let k = 0; k < count; k++) {
      const livesThere = ['aubergiste', 'garde', 'soldat', 'moine', 'noble', 'fermier', 'meunier'].includes(prof);
      make(prof, livesThere ? b.id : nextHome(b), b.id);
    }
  }
  // métiers liés au milieu
  const inn = B0.find((b) => b.kind === 'auberge');
  if (s.produces.includes('gibier') && s.type !== 'monastère') make('chasseur', nextHome(B0[0]), -1);
  if (s.produces.includes('poisson') && s.type !== 'monastère' && rng.chance(0.7)) make('pêcheur', nextHome(B0[0]), -1);
  if (s.type === 'village minier') for (let k = 0; k < 2; k++) make('mineur', nextHome(B0[0]), -1);
  if (s.type !== 'hameau' && s.type !== 'fort' && s.type !== 'château' && rng.chance(0.6)) make('guérisseuse', nextHome(B0[0]), -1);
  // familles : chaque maison non attribuée reçoit un artisan ou un fermier
  for (const hb of houses) if (!out.some((n) => n.home === hb.id)) make(rng.chance(0.5) ? 'artisan' : 'fermier', hb.id, hb.kind === 'ferme' ? hb.id : -1);
  // voyageurs à l'auberge
  if (inn) for (let k = 0; k < (s.population > 300 ? 2 : 1); k++) {
    const v = make('voyageur', inn.id, inn.id);
    const towns = civ.settlements.filter((o) => o.id !== s.id && !o.abandoned && (o.type === 'bourg' || o.type === 'ville' || o.type === 'capitale'));
    if (towns.length) v.knowledge.push(`settlement:${rng.pick(towns).id}`);
  }
  const cap = s.population > 1000 ? 40 : s.population > 300 ? 28 : s.type === 'hameau' ? 8 : 20;
  out.length = Math.min(out.length, cap);

  // relations : couples dans un même foyer, amis et rivaux
  const byHome = new Map<number, NPCData[]>();
  for (const n of out) byHome.set(n.home, [...(byHome.get(n.home) ?? []), n]);
  for (const group of byHome.values()) {
    const adults = group.filter((n) => n.profession !== 'voyageur' && n.profession !== 'garde' && n.profession !== 'soldat' && n.profession !== 'moine');
    if (adults.length >= 2 && adults[0].sex !== adults[1].sex) {
      adults[1].last = adults[0].last;
      adults[0].relations.push({ id: adults[1].id, kind: 'époux', value: 0.8 });
      adults[1].relations.push({ id: adults[0].id, kind: 'époux', value: 0.8 });
    }
  }
  for (const n of out) {
    for (let k = 0; k < 2 && out.length > 2; k++) {
      const o = out[rng.int(0, out.length - 1)];
      if (o.id === n.id || n.relations.some((r) => r.id === o.id)) continue;
      const rival = rng.chance(0.25);
      n.relations.push({ id: o.id, kind: rival ? 'rival' : 'ami', value: rival ? -0.5 : 0.5 });
      o.relations.push({ id: n.id, kind: rival ? 'rival' : 'ami', value: rival ? -0.5 : 0.5 });
    }
  }

  // connaissances : lieux proches, histoire selon l'âge et le métier
  const near = civ.pois.filter((p) => Math.hypot(p.x - s.x, p.z - s.z) < 1800 && p.kind !== 'pont');
  for (const n of out) {
    for (const p of near) if (rng.chance(n.profession === 'chasseur' || n.profession === 'garde' ? 0.9 : 0.55)) n.knowledge.push(`poi:${p.id}`);
    for (const e of civ.events) {
      const old = civ.presentYear - e.year;
      const local = e.places.some((pl) => { const o = civ.settlements[pl]; return o && Math.hypot(o.x - s.x, o.z - s.z) < 2500; });
      const scholar = n.profession === 'prêtre' || n.profession === 'moine' || n.profession === 'noble';
      if ((old < n.age - 8 && local) || scholar || (old < 30 && rng.chance(0.5))) n.knowledge.push(`event:${e.id}`);
    }
    for (const r of civ.roads) if (r.a === s.id || r.b === s.id) n.knowledge.push(`settlement:${r.a === s.id ? r.b : r.a}`);
  }

  // objectifs de vie reliés au monde
  const exp = civ.events.find((e) => e.kind === 'expédition');
  for (const n of out) {
    const g = n.profession === 'forgeron' ? 'trouver du bon fer pour sa forge' : n.profession === 'marchand' ? 'faire fortune sur la route commerciale'
      : n.profession === 'garde' ? 'garder le village en sécurité' : n.profession === 'fermier' ? 'rentrer une bonne récolte'
      : n.profession === 'prêtre' ? 'ramener les fidèles à la chapelle' : n.profession === 'aubergiste' ? 'remplir son auberge de voyageurs' : 'vivre tranquille';
    n.goal = g;
  }
  if (exp && exp.places.includes(s.id) && out.length) {
    const kin = out.find((n) => n.profession === 'artisan' || n.profession === 'fermier') ?? out[0];
    const leader = exp.title.replace("L'expédition de ", '');
    kin.goal = `retrouver ${leader}, parti avec l'expédition`;
    kin.memories.push({ kind: 'perte', subject: leader, day: 0, weight: 1, text: `${leader} n'est jamais revenu des ruines.` });
  }
  return out;
}

// ---------------------------------------------------------------- quartiers (étape 55)
type DistrictRole = 'tavernier' | 'étal' | 'barde' | 'échoppe' | 'atelier' | 'aisé' | 'habitant';
const RICH_SHIRTS = [0x6a2a4a, 0x2a3a6a, 0x4a2a5a, 0x7a5a2a, 0x2a5a4a];

/** Emploi du temps des habitants des quartiers : étal le jour, taverne le soir, flânerie au marché. */
function districtSchedule(role: DistrictRole, rng: RNG, market: boolean, tavern: boolean): ScheduleBlock[] {
  const j = () => rng.int(-20, 20);
  const B = (a: number, b: number, act: Activity, place: PlaceRef): ScheduleBlock => ({ from: a, to: b, act, place });
  const out: PlaceRef = market ? 'market' : 'plaza', eve: PlaceRef = tavern && rng.chance(0.6) ? 'tavern' : 'home';
  switch (role) {
    case 'tavernier': return [B(0, h(1, 30), 'travailler', 'work'), B(h(1, 30), h(9, 30), 'dormir', 'home'), B(h(9, 30), h(10, 30), 'manger', 'home'), B(h(10, 30), 1440, 'travailler', 'work')];
    case 'étal': {
      const wake = h(5, 30) + j(), bed = h(21, 30) + j();
      return [B(0, wake, 'dormir', 'home'), B(wake, h(6, 45), 'manger', 'home'), B(h(6, 45), h(12, 15), 'travailler', 'market'), B(h(12, 15), h(13), 'manger', 'market'), B(h(13), h(18, 30), 'travailler', 'market'), B(h(18, 30), bed, 'loisir', eve), B(bed, 1440, 'dormir', 'home')];
    }
    case 'barde': return [B(0, h(1), 'travailler', 'tavern'), B(h(1), h(10, 30), 'dormir', 'home'), B(h(10, 30), h(11, 30), 'manger', 'home'), B(h(11, 30), h(14), 'loisir', out), B(h(14), h(17, 30), 'loisir', 'plaza'), B(h(17, 30), h(19), 'manger', tavern ? 'tavern' : 'home'), B(h(19), 1440, 'travailler', 'tavern')];
    case 'échoppe': case 'atelier': {
      const wake = h(6, 30) + j(), eve2 = h(18, 30) + j(), bed = h(22) + j();
      return [B(0, wake, 'dormir', 'home'), B(wake, h(7, 30), 'manger', 'home'), B(h(7, 30), h(12), 'travailler', 'work'), B(h(12), h(13), 'manger', tavern && rng.chance(0.4) ? 'tavern' : 'home'), B(h(13), eve2, 'travailler', 'work'), B(eve2, bed, 'loisir', eve), B(bed, 1440, 'dormir', 'home')];
    }
    default: {
      const wake = h(6, 45) + j(), bed = h(22) + j(), pm: PlaceRef = role === 'aisé' && rng.chance(0.5) ? 'temple' : out;
      return [B(0, wake, 'dormir', 'home'), B(wake, h(8), 'manger', 'home'), B(h(8), h(11, 30), 'loisir', out), B(h(11, 30), h(13), 'manger', 'home'), B(h(13), h(15), 'loisir', 'home'), B(h(15), h(17, 30), 'loisir', pm), B(h(17, 30), h(19), 'manger', 'home'), B(h(19), bed, 'loisir', eve), B(bed, 1440, 'dormir', 'home')];
    }
  }
}

const DISTRICT_GOALS: Record<DistrictRole, string> = {
  tavernier: 'faire de sa taverne la plus courue de la ville', étal: 'vendre tout son étal avant midi', barde: 'composer une chanson qu’on chantera encore dans cent ans',
  échoppe: 'ouvrir une seconde boutique', atelier: 'prendre un apprenti et lui transmettre le métier', aisé: 'tenir son rang en ville', habitant: 'vivre tranquille',
};

/**
 * Habitants des quartiers (étape 55) : taverniers, marchands du marché, barde, boutiquiers, artisans, puis les familles des
 * nouvelles maisons. Flux propre (« quartiers ») : les PNJ d'origine (generateNPCs) ne changent pas ; les nouveaux prennent les
 * numéros suivants (`n<sid>:<base.length + k>`), vivent dans les bâtiments ajoutés, et sont au plus la moitié des PNJ d'origine.
 */
export function generateDistrictNPCs(civ: Civilization, s: Settlement, L: Layout, base: readonly NPCData[]): NPCData[] {
  const D = L.district;
  if (!D || s.abandoned || s.type === 'camp') return [];
  const budget = Math.floor(base.length * 0.5);
  if (budget <= 0) return [];
  const rng = civ.seed.stream('quartiers', 'pnj', s.id);
  const names = new NameGen(rng.fork('noms'));
  const taken = new Set(base.map((n) => `${n.first} ${n.last}`));
  const added = L.buildings.filter((b) => b.quarter !== undefined);
  const houses = added.filter((b) => b.kind === 'maison');
  const count = new Map<number, number>();
  const market = D.stalls.length > 0, tavern = D.taverns.length > 0;
  const out: NPCData[] = [];
  /** maison ajoutée la moins peuplée (deux habitants au plus), de préférence dans le quartier demandé */
  const homeFor = (q: QuarterKind | undefined): number => {
    let best = -1, bk = Infinity;
    for (const b of houses) {
      const n = count.get(b.id) ?? 0;
      if (n >= 2) continue;
      const k = n * 10 + (q && b.quarter !== q ? 1 : 0);
      if (k < bk) { bk = k; best = b.id; }
    }
    return best;
  };
  const make = (role: DistrictRole, prof: Profession, home: number, work: number, q: QuarterKind, title: (sex: 'm' | 'f') => string, opts: Partial<NPCData> = {}): NPCData | null => {
    if (out.length >= budget || home < 0) return null;
    const sex: 'm' | 'f' = opts.sex ?? (rng.chance(0.5) ? 'f' : 'm');
    let nm = names.person(sex);
    for (let k = 0; k < 6 && taken.has(`${nm.first} ${nm.last}`); k++) nm = names.person(sex);
    taken.add(`${nm.first} ${nm.last}`);
    const rich = prof === 'bourgeois';
    const n: NPCData = {
      id: `n${s.id}:${base.length + out.length}`, sid: s.id, first: nm.first, last: nm.last, sex, age: rng.int(role === 'barde' ? 18 : 20, role === 'aisé' ? 70 : 62),
      profession: prof, home, work, factionId: s.factionId,
      traits: { bravery: rng.next(), kindness: rng.next(), greed: rng.next(), piety: rng.next(), sociability: rng.next(), honesty: rng.next() },
      relations: [], wealth: Math.round(WEALTH[prof] * rng.float(0.6, 1.5)), inventory: [],
      needs: { faim: rng.float(0, 0.4), fatigue: rng.float(0, 0.3), social: rng.float(0.2, 0.6), sécurité: 0 },
      knowledge: [], goal: DISTRICT_GOALS[role], schedule: districtSchedule(role, rng, market, tavern), shift: 'jour',
      colors: { skin: rng.pick(SKINS), shirt: rich ? rng.pick(RICH_SHIRTS) : rng.pick(SHIRTS), pants: rng.pick(PANTS), hair: rng.pick(HAIRS) },
      look: 'civil', alive: true, hp: 30, memories: [], quarter: q, ...opts,
    };
    n.title = title(sex);
    if (role === 'barde') n.traits.sociability = Math.max(n.traits.sociability, 0.7);
    count.set(home, (count.get(home) ?? 0) + 1);
    out.push(n);
    return n;
  };
  const fm = (m: string, f: string) => (sex: 'm' | 'f') => (sex === 'f' ? f : m);
  const resident = (sex: 'm' | 'f') => rng.pick(RESIDENT_TITLES[sex]);

  // tenanciers (dans une maison du quartier de leur taverne ; à défaut, le lit de la taverne)
  for (const tid of D.taverns) {
    const tb = L.buildings[tid], hm = homeFor(tb.quarter);
    make('tavernier', 'tavernier', hm >= 0 ? hm : tid, tid, tb.quarter ?? 'marchand', fm('tavernier', 'tavernière'));
  }
  // un marchand par étal (ceux du plan d'origine compris)
  D.stalls.forEach((st, i) => make('étal', 'marchand', homeFor('marchand'), -1, 'marchand', fm(STALLS[st.kind].m, STALLS[st.kind].f), { stall: i }));
  // le barde (pas dans toutes les villes)
  if (tavern && rng.chance(0.75)) make('barde', 'barde', homeFor('résidentiel'), -1, 'résidentiel', () => 'barde');
  // boutiquiers et artisans
  for (const b of added) if (b.kind === 'échoppe') make('échoppe', 'marchand', homeFor('marchand'), b.id, 'marchand', fm('marchand', 'marchande'));
  for (const b of added) {
    const c = craftOf(b);
    if (c) make('atelier', 'artisan', homeFor('artisan'), b.id, 'artisan', fm(CRAFT_DEFS[c].m, CRAFT_DEFS[c].f));
  }
  // une personne par maison encore vide, puis un conjoint dans les maisons d'une seule personne
  for (const b of houses) if (!count.get(b.id)) {
    const rich = b.quarter === 'aisé';
    make(rich ? 'aisé' : 'habitant', rich ? 'bourgeois' : 'artisan', b.id, -1, b.quarter!, rich ? fm('bourgeois', 'bourgeoise') : resident);
  }
  for (const b of houses) {
    if (count.get(b.id) !== 1) continue;
    const first = out.find((n) => n.home === b.id);
    if (!first) continue;
    const rich = first.profession === 'bourgeois';
    make(rich ? 'aisé' : 'habitant', rich ? 'bourgeois' : 'artisan', b.id, -1, b.quarter!, rich ? fm('bourgeois', 'bourgeoise') : resident, { sex: first.sex === 'm' ? 'f' : 'm', last: first.last });
  }
  // relations entre nouveaux habitants : couples sous un même toit, amis et rivaux
  for (const b of houses) {
    const pair = out.filter((n) => n.home === b.id);
    if (pair.length === 2 && pair[0].sex !== pair[1].sex) {
      pair[0].relations.push({ id: pair[1].id, kind: 'époux', value: 0.8 });
      pair[1].relations.push({ id: pair[0].id, kind: 'époux', value: 0.8 });
    }
  }
  for (const n of out) {
    if (out.length < 3) break;
    const o = out[rng.int(0, out.length - 1)];
    if (o.id === n.id || n.relations.some((r) => r.id === o.id)) continue;
    const rival = rng.chance(0.2);
    n.relations.push({ id: o.id, kind: rival ? 'rival' : 'ami', value: rival ? -0.5 : 0.5 });
    o.relations.push({ id: n.id, kind: rival ? 'rival' : 'ami', value: rival ? -0.5 : 0.5 });
  }
  // connaissances : lieux proches, histoire récente, routes du lieu
  const near = civ.pois.filter((p) => Math.hypot(p.x - s.x, p.z - s.z) < 1800 && p.kind !== 'pont');
  for (const n of out) {
    for (const p of near) if (rng.chance(n.profession === 'tavernier' || n.profession === 'barde' ? 0.85 : 0.5)) n.knowledge.push(`poi:${p.id}`);
    for (const e of civ.events) {
      const old = civ.presentYear - e.year;
      if ((old < 30 && rng.chance(0.5)) || (n.profession === 'barde' && rng.chance(0.6))) n.knowledge.push(`event:${e.id}`);
    }
    for (const r of civ.roads) if (r.a === s.id || r.b === s.id) n.knowledge.push(`settlement:${r.a === s.id ? r.b : r.a}`);
  }
  return out;
}
