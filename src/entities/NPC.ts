import type { Civilization } from '../world/civilization/Civilization';
import type { Layout, Building } from '../world/civilization/Layout';
import type { Settlement } from '../world/civilization/types';
import { NameGen } from '../world/civilization/Names';
import type { RNG } from '../core/RNG';

// Identité et vie des PNJ : générés par implantation, de façon déterministe et indépendante de
// l'ordre de chargement (flux « npc » propre à chaque implantation).

export type Profession =
  | 'fermier' | 'forgeron' | 'marchand' | 'aubergiste' | 'garde' | 'prêtre' | 'meunier' | 'chasseur'
  | 'pêcheur' | 'mineur' | 'soldat' | 'moine' | 'noble' | 'artisan' | 'guérisseuse' | 'voyageur';

export type Activity = 'dormir' | 'manger' | 'travailler' | 'loisir' | 'prier' | 'patrouiller' | 'garder' | 'voyager';
export type PlaceRef = 'home' | 'work' | 'inn' | 'plaza' | 'temple' | 'field' | 'patrol' | 'wild';
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
};

/** PNJ importants d'une implantation (déterministe). */
export function generateNPCs(civ: Civilization, s: Settlement, L: Layout): NPCData[] {
  if (s.abandoned || s.type === 'camp') return [];
  const rng = civ.seed.stream('npc', s.id);
  const names = new NameGen(rng.fork('names'));
  const out: NPCData[] = [];
  const houses = L.buildings.filter((b) => b.kind === 'maison' || b.kind === 'ferme' || b.kind === 'cabane');
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
  for (const b of L.buildings) {
    const prof = WORK_OF[b.kind];
    if (!prof) continue;
    const count = prof === 'garde' ? 2 + (s.population > 300 ? 2 : 0) : prof === 'soldat' ? 4 : prof === 'moine' ? 3 : 1;
    for (let k = 0; k < count; k++) {
      const livesThere = ['aubergiste', 'garde', 'soldat', 'moine', 'noble', 'fermier', 'meunier'].includes(prof);
      make(prof, livesThere ? b.id : nextHome(b), b.id);
    }
  }
  // métiers liés au milieu
  const inn = L.buildings.find((b) => b.kind === 'auberge');
  if (s.produces.includes('gibier') && s.type !== 'monastère') make('chasseur', nextHome(L.buildings[0]), -1);
  if (s.produces.includes('poisson') && s.type !== 'monastère' && rng.chance(0.7)) make('pêcheur', nextHome(L.buildings[0]), -1);
  if (s.type === 'village minier') for (let k = 0; k < 2; k++) make('mineur', nextHome(L.buildings[0]), -1);
  if (s.type !== 'hameau' && s.type !== 'fort' && s.type !== 'château' && rng.chance(0.6)) make('guérisseuse', nextHome(L.buildings[0]), -1);
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
