import { Entity } from '@ascii-fort/sim/entities/Entity';
import type { NPCData } from '@ascii-fort/sim/entities/NPC';
import { humanoid, type ModelDef } from '@ascii-fort/sim/entities/Models';
import { makeMonster } from '@ascii-fort/sim/entities/Monster';
import type { EventHost } from '@ascii-fort/sim/entities/EntityManager';
import { updateSoldier, type WarAICtx } from '@ascii-fort/sim/ai/WarAI';
import { turn } from '@ascii-fort/sim/ai/MonsterAI';
import { resolveSpot, blockAt, type Spot } from '@ascii-fort/sim/ai/Schedule';
import {
  Calendar, DAY, RAID_RECOVER_DAYS, CONTEST_ARROWS, CONTEST_FEE, TARGET_BONUS, CAPTURABLE,
  parseOutcome, outcomeValue, raidResult, battleResult, epidemicEnd, feastEnd, raidVerdict, battleVerdict, bedridden, pickVictims,
  peaceDay, ringScore, contestRank, sanitizeEventSave, rankOf, livingPlace,
  type EventPlan, type SlotPlan, type RaidPlan, type FeastPlan, type EpidemicPlan, type BattlePlan, type WarPlan, type BattleResult,
  type Outcome, type EventSave, type Raider,
} from '@ascii-fort/sim/gameplay/Calendar';
import { obstaclesOf, pushOut, type Obstacle } from '@ascii-fort/sim/gameplay/Caravans';
import type { Quest } from '@ascii-fort/sim/gameplay/QuestSystem';
import { direction, type DialogueHooks, type DialogueNode, type DialogueOption } from '@ascii-fort/sim/gameplay/Dialogue';
import { item } from '@ascii-fort/sim/gameplay/Items';
import type { Projectile } from '@ascii-fort/sim/gameplay/PlayerCombat';
import { deFaction, cap } from '@ascii-fort/sim/gameplay/Chains';
import { de, NameGen } from '@ascii-fort/worldgen/civilization/Names';
import type { Layout, Building } from '@ascii-fort/worldgen/civilization/Layout';
import { buildingFloor } from '@ascii-fort/worldgen/civilization/Builders';
import { MACRO, CELL } from '@ascii-fort/worldgen/constants';
import type { CircleCollider } from '@ascii-fort/worldgen/Chunk';
import { hashString } from '@ascii-fort/core/RNG';
import { C } from '@ascii-fort/ascii-engine/TextGrid';
import { M } from '@ascii-fort/ascii-engine/Materials';
import { SHAPE } from '@ascii-fort/ascii-engine/Shapes';
import { trsYawPitch, mat4 } from '@ascii-fort/core/math';
import type { InstanceBuffer, PointLight } from '@ascii-fort/ascii-engine/Renderer';
import type { Game, Focus } from './Game';

/** Incarnation : à moins d'ACTIVATE m du joueur, retirés au-delà de DEACTIVATE m (au plus MAX_LIVE à la fois). */
const ACTIVATE = 250, DEACTIVATE = 330, MAX_LIVE = 3;
/** Événements connus d'eux-mêmes à cette distance ; rayon des marqueurs de la carte. */
const KNOW_R = 900;
/** Exposition (minutes de jeu) entre deux risques de contagion, durée de la maladie sans remède. */
const EXPOSE = 15, SICK_DAYS = 2.5;
/** Malade : récupération d'endurance et soins (bonus de régénération) réduits. */
const SICK_FX = { stam: 0.5, regen: 0.4 } as const;

const e_ = (f: boolean) => (f ? 'e' : '');
const hash01 = (s: string) => hashString(s) / 4294967296;
/** « le Royaume de Belmorne », « la Guilde des… », « les Écorcheurs… » */
function leF(name: string): string {
  if (/^(Royaume|Ordre|Culte) /.test(name)) return 'le ' + name;
  if (/^(Guilde|Maison|Confrérie|Bande) /.test(name)) return 'la ' + name;
  if (/^Les /.test(name)) return 'les ' + name.slice(4);
  if (/^Le /.test(name)) return 'le ' + name.slice(3);
  if (/^La /.test(name)) return 'la ' + name.slice(3);
  return name;
}
/** « au Royaume de Lanaux », « à la Guilde… », « aux Écorcheurs… » */
function auF(name: string): string { const l = leF(name); return l.startsWith('le ') ? 'au ' + l.slice(3) : l.startsWith('les ') ? 'aux ' + l.slice(4) : 'à ' + l; }
/** Nom court d'une faction (« Belmorne » pour « Royaume de Belmorne »). */
export function shortFaction(name: string): string { return name.replace(/^(Royaume|Ordre|Guilde des \S+|Culte|Confrérie) (de la |de l'|du |des |de |d')/, '').replace(/^(Les|Le|La) /, ''); }
const RAIDERS: Record<Raider, { les: string; des: string; Des: string }> = {
  bandit: { les: 'les bandits', des: 'des bandits', Des: 'Des bandits' },
  gobelin: { les: 'les gobelins', des: 'des gobelins', Des: 'Des gobelins' },
  loup: { les: 'les loups', des: 'des loups', Des: 'Des loups' },
};
/** « 9 h », « 10 h 05 » */
function heure(t: number): string { const m = Math.floor(((t % DAY) + DAY) % DAY), h = Math.floor(m / 60), mm = m % 60; return mm ? `${h} h ${String(mm).padStart(2, '0')}` : `${h} h`; }

interface Inst { m: Float32Array; color: number; mat: number; shape: number }
interface Range { lx: number; ly: number; lz: number; dx: number; dz: number; len: number; targets: { x: number; y: number; z: number; nx: number; nz: number }[] }
/** Décor d'une fête sur une place (calculé une fois) : guirlandes, mât, étals, cibles du concours. */
interface Deco {
  inst: Inst[];
  lanterns: { x: number; y: number; z: number; m: Float32Array }[];
  stalls: { x: number; y: number; z: number; yaw: number; sx: number; sz: number }[];
  range: Range | null;
  mast: { x: number; z: number };
  cols: CircleCollider[];
}
interface Fire { b: Building; x: number; y: number; z: number; yaw: number; w: number; t: number; emitT: number }
interface LiveBase { zone: string; spawned: boolean; resolved: boolean }
interface LiveRaid extends LiveBase { kind: 'raid'; plan: RaidPlan; fires: Fire[]; igniteT: number; tolls: number; tollT: number; screamT: number; alarmed: boolean }
interface LiveBattle extends LiveBase { kind: 'bataille'; plan: BattlePlan; horn: boolean; crimed: Set<number> }
interface LiveFeast extends LiveBase { kind: 'fête'; plan: FeastPlan }
type Live = LiveRaid | LiveBattle | LiveFeast;
interface WarState { plan: WarPlan; results: BattleResult[]; peace: number | null; declared: boolean; ended: boolean }
interface Contest { ev: string; sid: number; shots: number; score: number; hits: number; pending: { pr: Projectile; x: number; y: number; z: number }[]; seen: WeakSet<Projectile> }
interface RemedyRec { ev: string; npc: string; need: number; q: Quest }

const NO_OTHERS: never[] = [];

/**
 * Événements vivants (logique pure : sim/gameplay/Calendar.ts, IA des soldats : sim/ai/WarAI.ts). Ici : application des
 * issues dans l'ordre (prix, morts, maisons brûlées, propriétaires des places), incarnation près du joueur (zones
 * « e<id> » : assaillants d'un raid, escouades d'une bataille, marchands de foire), décor des fêtes et concours de tir,
 * épidémie (toux, alités, boutiques fermées, contagion du joueur, remèdes de la guérisseuse), guerre (déclaration,
 * batailles, prises, paix, engagement, rang), rumeurs, dialogues, carte, journal, sauvegarde et console.
 * En ligne : issues observées et batailles résolues = faits partagés « evt:<id> » ; propriétaires = « flag:owner:<sid> ».
 */
export class Happenings implements EventHost {
  readonly cal: Calendar;
  readonly hooks: DialogueHooks;
  readonly live = new Map<string, Live>();
  /** issues observées (localement ou par un fait partagé) et batailles résolues ou prévues */
  private outcomes = new Map<string, Outcome>();
  /** événements dont les conséquences sont appliquées (id → jour) */
  private applied = new Map<string, number>();
  /** événements connus du joueur (carte, journal) */
  readonly known = new Set<string>();
  /** participations : « visite:<id> », « vu:<id> », « concours:<id> », « aide:<id> », « combat:<id>:<faction> »… */
  private done = new Set<string>();
  private wars = new Map<string, WarState>();
  private battles = new Map<number, BattlePlan | null>();
  private today: SlotPlan[] = [];
  private todayDay = -1e9;
  private dirty = true;
  private tmpList: SlotPlan[] = [];
  private due: EventPlan[] = [];
  private day: number;
  private doneDay: number;
  /** maladie du joueur (nom, fin en minutes absolues) et immunité (minute absolue) */
  sick: { nom: string; fin: number } | null = null;
  private immune = 0;
  /** victoires par faction servie ; camp choisi dans la guerre en cours [guerre, faction] */
  private ranks = new Map<number, number>();
  private side: [string, number] | null = null;
  private remedies = new Map<string, RemedyRec>();
  private journal: string[] = [];
  private crew = new Map<string, NPCData>();
  private models = new Map<string, ModelDef>();
  private decos = new Map<number, Deco | null>();
  private burnt = new Map<string, Inst[]>();
  private contest: Contest | null = null;
  private fleeing: { e: Entity; t: number }[] = [];
  private checkT = 0; private coughT = 3; private selfCoughT = 25; private coughs = 0; private expo = 0; private expoT = -1;
  private atCache = new Map<number, { t: number; ev: SlotPlan | null }>();
  private aictx: WarAICtx;
  private m4 = mat4();
  private lightPool: PointLight[] = Array.from({ length: 8 }, () => ({ x: 0, y: 0, z: 0, radius: 0, r: 0, g: 0, b: 0 }));
  private lightOut: PointLight[] = [];
  /** territoires (carte) : propriétaire par cellule macro, version des propriétaires */
  private ownerVer = 0;
  private terr: { cells: Int8Array; ver: number } | null = null;
  private nearSid: Int16Array | null = null;
  private markT = -1; private markCache: { x: number; z: number; glyph: string; color: number; name?: string }[] = [];

  constructor(private g: Game) {
    this.cal = new Calendar({ civ: g.world.civ, seed: g.seed, layouts: g.world.civWorld.layouts, lairs: g.entities.lairs });
    this.day = g.time.day; this.doneDay = this.day - 1;
    this.hooks = { menu: (e) => this.menu(e), talk: (e, t) => this.talk(e, t) };
    this.aictx = {
      player: g.player, combat: g.combat, get ents() { return g.entities.entities; },
      get others() { return g.coop ? g.coop.others() : NO_OTHERS; },
      hurtRemote: (id, a, src) => g.coop?.hurtRemote(id, a, src),
      ground: (x, z, y) => g.entities.ground(x, z, y), walk: (e, mx, mz) => g.entities.walk(e, mx, mz),
      enemyOf: (side) => this.enemyOf(side),
    };
    g.events.on('entity:damaged', (d) => this.onDamaged(d.targetId, d.sourceId));
    g.events.on('quest:completed', ({ questId }) => this.onQuestDone(questId));
    g.events.on('camp:cleared', () => { this.dirty = true; });
    // villageois tombés pendant un raid incarné
    g.events.on('entity:killed', (k) => {
      if (k.kind !== 'npc' || !k.victimId.startsWith('n') || k.settlementId === undefined) return;
      for (const L of this.live.values()) if (L.kind === 'raid' && L.plan.sid === k.settlementId && !L.resolved) { const n = g.entities.findNpc(k.victimId); if (n) this.mourn(L.plan.id, n); }
    });
  }

  private say(text: string, color: number = C.text) { this.g.events.emit('message', { text, color }); }
  private feed(text: string, color: number) { const f = this.g.lootFeed; f.push({ text, color, t: performance.now() }); if (f.length > 8) f.splice(0, f.length - 8); }
  private log(text: string) { this.journal.unshift(`Jour ${this.g.time.day} : ${text}`); if (this.journal.length > 6) this.journal.length = 6; }
  private place(sid: number) { return this.g.world.civ.settlements[sid]; }
  private fac(fid: number) { return this.g.world.civ.factions[fid]; }
  private owner(sid: number) { return this.g.ownerOf(sid); }
  outcome(id: string): Outcome | undefined { return this.outcomes.get(id); }
  /** Événement d'un lieu en cours (ou en séquelles), mis en cache une minute de jeu. */
  eventAt(sid: number): SlotPlan | null {
    const now = this.g.time.minutes, c = this.atCache.get(sid);
    if (c && Math.abs(c.t - now) < 1 && !this.dirty) return c.ev;
    const ev = this.cal.at(sid, now);
    if (c) { c.t = now; c.ev = ev; } else this.atCache.set(sid, { t: now, ev });
    return ev;
  }

  // ================================================================ calendrier du jour
  private todayList(): SlotPlan[] {
    const d = this.g.time.day;
    if (this.todayDay !== d || this.dirty) { this.cal.eventsOn(d, this.today); this.todayDay = d; this.dirty = false; this.atCache.clear(); }
    return this.today;
  }

  /** Instant où un événement se dénoue (issue observée ou abstraite). */
  private resolveTime(p: EventPlan): number {
    // mêmes règles que raidResult, epidemicEnd et battleResult (Calendar.ts), sans allocation : appelé à chaque image
    const o = this.outcomes.get(p.id);
    switch (p.kind) {
      case 'raid': return this.raidCancelled(p) ? p.start : o && (o.k === 'r' || o.k === 's') ? o.t : p.end;
      case 'fête': return feastEnd(p, o);
      case 'épidémie': return o && o.k === 'e' && o.t < p.end ? Math.max(p.start, o.t) : p.end;
      case 'bataille': return o && (o.k === 'a' || o.k === 'd') ? o.t : p.end;
    }
  }
  /** Issue d'un raid (observée, sinon tirée) : réussi « s » ou repoussé « r ». */
  private raidK(p: RaidPlan): string { const o = this.outcomes.get(p.id); return o && (o.k === 'r' || o.k === 's') ? o.k : p.succeeds ? 's' : 'r'; }
  /** Raid d'un camp de bandits démantelé avant l'assaut : il n'a pas lieu. */
  private raidCancelled(p: RaidPlan): boolean { return p.camp >= 0 && this.g.entities.clearedCamps.has(p.camp) && !this.outcomes.has(p.id); }

  /** État d'un événement à l'instant t. */
  phase(p: EventPlan, t: number): 'à venir' | 'en cours' | 'suites' | 'fini' {
    if (t < p.start) return 'à venir';
    const r = this.resolveTime(p);
    if (t < r && !this.applied.has(p.id)) return p.kind === 'raid' && this.raidCancelled(p) ? 'fini' : 'en cours';
    if (p.kind === 'raid' && this.raidK(p) === 's' && !this.raidCancelled(p) && t < r + RAID_RECOVER_DAYS * DAY) return 'suites';
    return 'fini';
  }

  // ================================================================ guerres
  private warState(w: WarPlan): WarState {
    let st = this.wars.get(w.id);
    if (!st) {
      st = { plan: w, results: [], peace: null, declared: w.start <= this.doneDay, ended: false };
      // batailles déjà résolues (sauvegarde, faits partagés)
      const prefix = `b${w.id.slice(1)}.`, civ = this.g.world.civ;
      for (const [id, o] of this.outcomes) {
        if (!id.startsWith(prefix) || (o.k !== 'a' && o.k !== 'd') || o.sid === undefined || o.atk === undefined) continue;
        const k = Number(id.slice(prefix.length)), T = civ.settlements[o.sid];
        if (!Number.isInteger(k) || !T) continue;
        st.results.push({ k, sid: o.sid, atk: o.atk, def: o.atk === w.a ? w.b : w.a, win: o.k, capture: o.k === 'a' && CAPTURABLE.has(T.type), t: o.t });
      }
      st.results.sort((a, b) => a.k - b.k);
      st.peace = peaceDay(w, st.results, (r) => Math.floor(r.t / DAY));
      const end = Math.min(w.end, st.peace ?? w.end);
      st.ended = end <= this.doneDay;
      this.wars.set(w.id, st);
    }
    return st;
  }
  /** Guerre active ce jour (paix anticipée comprise). */
  warOn(day: number): WarPlan | null {
    const w = this.cal.warOn(day);
    if (!w) return null;
    const st = this.warState(w);
    return st.peace !== null && day >= st.peace ? null : w;
  }
  /** Guerre en cours aujourd'hui (null : paix). */
  currentWar(): WarState | null { const w = this.warOn(this.g.time.day); return w ? this.warState(w) : null; }

  /** Bataille du jour (site selon les propriétaires du moment, ou site déjà connu). */
  battleOn(day: number): BattlePlan | null {
    if (this.battles.has(day)) return this.battles.get(day)!;
    const w = this.warOn(day);
    let b: BattlePlan | null = null;
    if (w) {
      const st = this.warState(w), id = `b${w.id.slice(1)}.${day - w.start - 1}`, memo = this.outcomes.get(id);
      if (memo?.k === 'n') b = null;
      else {
        b = memo && memo.sid !== undefined && memo.atk !== undefined && this.place(memo.sid)
          ? this.cal.battle(w, day, (s) => this.owner(s), st.results, { sid: memo.sid, atk: memo.atk })
          : this.cal.battle(w, day, (s) => this.owner(s), st.results);
        // site connu de tous : publié dès qu'il est tiré
        if (b && !memo) this.setOutcome(b.id, { k: 'p', t: b.start, sid: b.sid, atk: b.attacker }, true);
      }
    }
    this.battles.set(day, b);
    return b;
  }
  /** Le joueur combat-il ce camp ? (il a frappé ses soldats dans la bataille, ou sert l'ennemi) */
  private enemyOf(side: number): boolean {
    for (const L of this.live.values()) if (L.kind === 'bataille' && L.crimed.has(side)) return true;
    const w = this.currentWar();
    return !!w && !!this.side && this.side[0] === w.plan.id && this.side[1] !== side && (side === w.plan.a || side === w.plan.b);
  }

  // ================================================================ issues
  private setOutcome(id: string, o: Outcome, share: boolean): void {
    this.outcomes.set(id, o);
    if (this.outcomes.size > 400) { const first = this.outcomes.keys().next().value; if (first !== undefined) this.outcomes.delete(first); }
    if (share) this.g.coop?.fact('evt:' + id, outcomeValue(o));
  }
  /** Issue décidée ici (combat observé) : enregistrée, partagée, puis appliquée. */
  private resolve(p: EventPlan, k: string): void {
    if (this.applied.has(p.id)) return;
    const o: Outcome = p.kind === 'bataille' ? { k, t: Math.round(this.g.time.minutes), sid: p.sid, atk: p.attacker } : { k, t: Math.round(this.g.time.minutes) };
    this.setOutcome(p.id, o, true);
    this.apply(p, true);
  }
  /**
   * Fait partagé « evt:<id> » reçu (live) ou relu à la connexion : l'issue est retenue ; reçue en cours de partie, elle
   * s'applique tout de suite si l'événement est échu (sinon le calendrier l'appliquera à son heure, une seule fois).
   */
  applyFact(id: string, v: unknown, live = true): void {
    const o = parseOutcome(v);
    if (!o) return;
    const prev = this.outcomes.get(id);
    this.outcomes.set(id, o);
    if (o.k === 'p' || o.k === 'n') { if (!prev && !this.applied.has(id)) this.battles.clear(); return; }
    if (!live) { this.battles.clear(); return; }
    const p = this.planById(id);
    if (!p || this.applied.has(id)) return;
    if (this.g.time.minutes >= this.resolveTime(p) - 1) this.apply(p, true);
  }
  /** Propriétaire d'une place changé par un fait partagé : tabards, territoires. */
  onOwnerFact(sid: number): void { this.g.entities.refreshModels(sid); this.ownerVer++; this.battles.clear(); }

  /** Change le propriétaire d'une place (guerre, console) : drapeau partagé, tabards, territoires, annonce. */
  setOwner(sid: number, fid: number, tell = true): void {
    const g = this.g, s = this.place(sid), f = this.fac(fid);
    if (!s || this.owner(sid) === fid) return;
    g.state.flags.set('owner:' + sid, fid);
    g.coop?.fact('flag:owner:' + sid, fid);
    this.onOwnerFact(sid);
    if (tell && f) {
      this.say(`${s.name} passe aux mains ${deFaction(f.name)}.`, C.orange);
      if (Math.hypot(s.x - g.player.x, s.z - g.player.z) < s.radius + 400) g.banner = { text: s.name.toUpperCase(), sub: `La place passe aux mains ${deFaction(f.name)}.`, t: 6, color: C.orange };
    }
  }

  /** Applique les issues dues : jours entiers non traités, puis celles du jour échues. */
  private settle(now: number): void {
    const today = Math.floor(now / DAY);
    if (this.doneDay < today - 30) this.doneDay = today - 30;   // très long saut (vieille sauvegarde) : on ne rejoue pas tout
    while (this.doneDay < today - 1) { this.processDay(this.doneDay + 1, Infinity, false); this.doneDay++; }
    this.processDay(today, now, true);
  }

  private processDay(d: number, upTo: number, live: boolean): void {
    const g = this.g;
    const w = this.warOn(d);
    if (w) { const st = this.warState(w); if (!st.declared && d >= w.start) { st.declared = true; this.declare(st, live && d === g.time.day); } }
    const b = w ? this.battleOn(d) : null;
    const evs = d === this.todayDay && !this.dirty ? this.today : this.cal.eventsOn(d, this.tmpList);
    const due = this.due;
    due.length = 0;
    // dénoués ce jour-là (ceux des jours déjà traités l'ont été : la sauvegarde ne garde que les deux derniers jours appliqués)
    const isDue = (p: EventPlan) => {
      if (this.applied.has(p.id)) return false;
      const t = this.resolveTime(p), td = Math.floor(t / DAY);
      return td > this.doneDay && td <= d && t <= upTo && !this.waitLive(p, upTo);
    };
    for (const p of evs) if (isDue(p)) due.push(p);
    for (const p of this.cal.dev) if (p.kind === 'bataille' && isDue(p)) due.push(p);
    if (b && isDue(b)) due.push(b);
    if (due.length > 1) due.sort((a, c) => this.resolveTime(a) - this.resolveTime(c));
    for (const p of [...due]) this.apply(p, live);
    // paix
    for (const st of this.wars.values()) {
      if (st.ended || !st.declared) continue;
      const end = Math.min(st.plan.end, st.peace ?? st.plan.end);
      if (d >= end) { st.ended = true; this.peace(st, live && d === g.time.day); }
    }
    if (live) this.foretell(d);
  }
  /** Combat incarné et simulé ici : c'est lui qui décide (jusqu'à un peu après la fin de la fenêtre). */
  private waitLive(p: EventPlan, upTo: number): boolean {
    const L = this.live.get('e' + p.id);
    return !!L && L.spawned && !L.resolved && this.g.entities.simulates(L.zone) && upTo < p.end + 2;
  }

  private apply(p: EventPlan, live: boolean): void {
    if (this.applied.has(p.id)) return;
    this.applied.set(p.id, this.g.time.day);
    if (this.applied.size > 600) { const first = this.applied.keys().next().value; if (first !== undefined) this.applied.delete(first); }
    const L = this.live.get('e' + p.id);
    if (L) L.resolved = true;
    switch (p.kind) {
      case 'raid': this.applyRaid(p, live); break;
      case 'fête': this.applyFeast(p); break;
      case 'épidémie': this.applyEpidemic(p, live); break;
      case 'bataille': this.applyBattle(p, live); break;
    }
  }

  /** Épargnés par les morts abstraites : commerces et donneurs de quêtes. */
  private spare = (n: NPCData): boolean => this.g.quests.quests.some((q) => q.giver === n.id);
  private kill(n: NPCData, evId: string): void {
    const g = this.g;
    n.alive = false; n.hp = 0;
    g.coop?.fact('npc:' + n.id, 0);
    for (const e of g.entities.zones.get(n.sid)?.ents ?? []) if (e.npc === n && e.alive) { e.alive = false; e.hp = 0; e.deadT = 0; e.looted = true; }
    this.mourn(evId, n);
  }
  /** Victimes d'un événement (dialogues des habitants) : tuées sans témoin ou pendant un raid incarné. */
  private mourn(evId: string, n: NPCData): void {
    const l = this.victims.get(evId) ?? [], name = `${n.first} ${n.last}`;
    if (!l.includes(name)) l.push(name);
    this.victims.set(evId, l);
    if (this.victims.size > 40) { const first = this.victims.keys().next().value; if (first !== undefined) this.victims.delete(first); }
  }
  private victims = new Map<string, string[]>();
  private joinNames(n: string[]): string { return n.length > 1 ? `${n.slice(0, -1).join(', ')} et ${n[n.length - 1]}` : n[0] ?? ''; }
  private names(list: NPCData[]): string { return this.joinNames(list.map((x) => `${x.first} ${x.last}`)); }

  private applyRaid(p: RaidPlan, live: boolean): void {
    const g = this.g, s = this.place(p.sid), o = raidResult(p, this.outcomes.get(p.id)), L = this.live.get('e' + p.id) as LiveRaid | undefined;
    if (this.raidCancelled(p)) return;
    const near = Math.hypot(s.x - g.player.x, s.z - g.player.z) < s.radius + 250 && !g.dungeon;
    const R = RAIDERS[p.raider];
    if (L) this.scatter(L.zone);
    if (o.k === 's') {
      // pillage : vivres et marchandises volés (prix en hausse quelques jours), maisons brûlées, peut-être des morts
      const rec = g.economy.supply.get(p.sid);
      if (rec) { for (const gd of s.produces) rec[gd] = Math.max(0.3, rec[gd] - 0.35); rec.grain = Math.max(0.3, rec.grain - 0.3); }
      // combat observé (ici ou par un autre joueur) : les morts sont celles du combat, partagées par les faits « npc: » ;
      // sans témoin, victimes tirées (les mêmes chez tous les joueurs)
      const dead = this.outcomes.has(p.id) ? [] : pickVictims(g.entities.npcsOf(p.sid), p.deaths, g.seed, p.id, this.spare);
      for (const n of dead) this.kill(n, p.id);
      const all = this.victims.get(p.id) ?? [];
      const burnt = p.burn.length ? `${p.burn.length} maison${p.burn.length > 1 ? 's ont' : ' a'} brûlé` : 'des bêtes ont été égorgées';
      const tail = all.length ? `, et ${this.joinNames(all)} ${all.length > 1 ? 'y ont' : 'y a'} laissé la vie` : '';
      this.rumor(`${R.Des} ont attaqué ${s.name} ${this.nightly(p.start) ? 'en pleine nuit' : 'en plein jour'} : ${burnt}${tail}.`, p.sid, p.id);
      if (near && live) { this.say(`${cap(R.les)} s’enfuient avec leur butin. ${s.name} ${p.burn.length ? 'brûle' : 'compte ses pertes'}.`, C.red); this.log(`${R.des} ont pillé ${s.name}${tail}.`); }
      else if (this.known.has(p.id)) this.log(`${R.des} ont pillé ${s.name}.`);
    } else {
      const helped = this.done.has('aide:' + p.id);
      this.rumor(helped ? `${cap(R.les)} ont attaqué ${s.name} ${this.nightly(p.start) ? 'en pleine nuit' : 'en plein jour'}, mais un voyageur a aidé les gardes à les repousser !` : `Les gardes ${de(s.name)} ont repoussé ${R.des} venus piller le village.`, p.sid, p.id);
      if (helped && near) this.rewardRaid(p);
      else if (near && live) this.say(`${cap(R.les)} sont repoussés : ${s.name} est sauf.`, C.green);
    }
    if (L) for (const f of L.fires) f.t = o.k === 's' ? f.t : -1;   // repoussés : on éteint les toits
  }

  /** Le joueur a aidé à repousser le raid : or, expérience, réputation locale et auprès du seigneur du lieu. */
  private rewardRaid(p: RaidPlan): void {
    const g = this.g, s = this.place(p.sid), ch = g.character, fid = this.owner(p.sid), f = this.fac(fid);
    const gold = 15 + p.count * p.level * 3, xp = 20 * p.count;
    ch.inv.gold += gold;
    const ups = ch.gainXp(xp);
    g.rep.addLocal(p.sid, 10);
    if (f) g.rep.faction[fid] += 5;
    let who: NPCData | undefined;
    for (const prof of ['garde', 'noble', 'aubergiste', 'prêtre']) { who = g.entities.npcsOf(p.sid).find((n) => n.alive && n.profession === prof); if (who) break; }
    if (who) {
      g.events.emit('player:helped', { npcId: who.id, magnitude: 0.8, reason: 'Le voyageur a défendu le village contre les pillards.' });
      this.say(`${who.first} ${who.last} : « Sans toi, ils mettaient ${s.name} à sac ! Prends ça, c’est bien peu. »`, C.yellow);
    }
    this.feed(`+ ${gold} pièces d’or`, C.gold);
    g.audio.chime();
    g.banner = { text: 'RAID REPOUSSÉ', sub: [`+${gold} or`, `+${xp} XP`, '+10 réputation locale', f ? `+5 auprès ${deFaction(f.name)}` : ''].filter(Boolean).join(' · '), t: 6, color: C.gold };
    if (ups) this.say(`Niveau ${ch.level} !`, C.yellow);
    this.log(`vous avez aidé ${s.name} à repousser ${RAIDERS[p.raider].des}.`);
  }

  private applyFeast(p: FeastPlan): void {
    if (this.contest?.ev === p.id) { this.contest = null; this.say('La fête est finie : le concours de tir est clos.', C.dim); }
    const L = this.live.get('e' + p.id);
    if (L) this.deactivate(L, false);
  }

  private applyEpidemic(p: EpidemicPlan, live: boolean): void {
    const g = this.g, s = this.place(p.sid), end = epidemicEnd(p, this.outcomes.get(p.id));
    const near = Math.hypot(s.x - g.player.x, s.z - g.player.z) < s.radius + 200 && !g.dungeon;
    if (!end.stopped) {
      const dead = pickVictims(g.entities.npcsOf(p.sid), p.deaths, g.seed, p.id, this.spare, (n) => bedridden(n, p));
      for (const n of dead) this.kill(n, p.id);
      this.rumor(dead.length ? `${cap(p.disease)} a quitté ${s.name}, mais elle a emporté ${this.names(dead)}.` : `${cap(p.disease)} a quitté ${s.name} d’elle-même. On respire.`, p.sid, p.id);
      if (near && live) this.say(`${cap(p.disease)} quitte ${s.name}${dead.length ? ` : ${this.names(dead)} n’${dead.length > 1 ? 'ont' : 'a'} pas survécu` : ''}.`, dead.length ? C.orange : C.green);
      for (const r of [...this.remedies.values()]) if (r.ev === p.id) this.dropRemedy(r, `${cap(p.disease)} s’est éteinte d’elle-même : on n’attend plus vos remèdes à ${s.name}.`);
    }
  }

  private applyBattle(p: BattlePlan, live: boolean): void {
    const g = this.g, w = this.warOfBattle(p), r = battleResult(p, this.outcomes.get(p.id));
    const T = this.place(p.sid), A = this.fac(p.attacker), D = this.fac(p.defender);
    if (w) {
      const st = this.warState(w);
      if (!st.results.some((x) => x.k === r.k)) { st.results.push(r); st.results.sort((a, b) => a.k - b.k); }
      st.peace = peaceDay(w, st.results, (x) => Math.floor(x.t / DAY));
    }
    // issue connue de tous (fait partagé), même tirée sans témoin : les autres joueurs n'ont pas à la recalculer
    this.setOutcome(p.id, { k: r.win, t: r.t, sid: p.sid, atk: p.attacker }, true);
    const L = this.live.get('e' + p.id) as LiveBattle | undefined;
    if (L) this.routLosers(L, r.win === 'a' ? p.defender : p.attacker);
    const winner = r.win === 'a' ? A : D;
    if (r.capture) {
      this.setOwner(p.sid, p.attacker, live);
      const rec = g.economy.supply.get(p.sid);
      if (rec) rec.grain = Math.max(0.3, rec.grain - 0.3);
      this.rumor(`${T.name} passe aux mains ${A ? deFaction(A.name) : 'de l’ennemi'} après une bataille devant ses portes.`, p.sid, p.id);
      this.log(`${T.name} passe aux mains ${A ? deFaction(A.name) : 'de l’ennemi'}.`);
    } else if (winner) {
      const txt = r.win === 'a' ? `Les soldats ${A ? deFaction(A.name) : ''} ont battu les défenseurs ${de(T.name)}, mais la place a tenu.` : `Les défenseurs ${de(T.name)} ont repoussé ${A ? leF(A.name) : 'l’ennemi'}.`;
      this.rumor(txt, p.sid, p.id);
      if (live && Math.hypot(p.x - g.player.x, p.z - g.player.z) < 1500) this.say(txt, C.orange);
    }
    // le joueur a combattu : solde, réputation, rang
    for (const side of [p.attacker, p.defender]) {
      if (!this.done.has(`combat:${p.id}:${side}`)) continue;
      const won = (r.win === 'a' ? p.attacker : p.defender) === side;
      this.rewardBattle(p, side, won);
    }
  }
  private warOfBattle(p: BattlePlan): WarPlan | null {
    if (this.cal.devWar?.id === p.war) return this.cal.devWar;
    const per = Number(p.war.slice(1));
    return Number.isInteger(per) ? this.cal.war(per) : null;
  }

  /** Solde, réputation et rang du joueur qui a combattu pour un camp. */
  private rewardBattle(p: BattlePlan, side: number, won: boolean): void {
    const g = this.g, ch = g.character, f = this.fac(side);
    if (!f) return;
    if (!won) {
      g.rep.faction[side] += 2;
      this.say(`La bataille est perdue pour ${leF(f.name)}… On saluera tout de même votre courage (+2 réputation).`, C.orange);
      this.log(`défaite ${deFaction(f.name)} devant ${this.place(p.sid).name}, à vos côtés.`);
      return;
    }
    const wins = (this.ranks.get(side) ?? 0) + 1, before = rankOf(wins - 1, false), fem = false;
    this.ranks.set(side, wins);
    const rank = rankOf(wins, fem), idx = wins >= 6 ? 2 : wins >= 2 ? 1 : 0;
    const gold = 20 + 10 * idx, xp = 60;
    ch.inv.gold += gold;
    const ups = ch.gainXp(xp);
    g.rep.faction[side] += 8;
    this.feed(`+ ${gold} pièces d’or (solde)`, C.gold);
    g.audio.fanfare();
    g.banner = { text: 'VICTOIRE', sub: `Solde : +${gold} or · +${xp} XP · +8 réputation auprès ${deFaction(f.name)}`, sub2: rank !== before ? `◆ Nouveau rang : ${rank} ◆` : undefined, t: 7, color: C.gold };
    if (rank !== before) this.say(`${cap(leF(f.name))} vous élève au rang de ${rank}.`, C.yellow);
    if (ups) this.say(`Niveau ${ch.level} !`, C.yellow);
    this.log(`victoire ${deFaction(f.name)} devant ${this.place(p.sid).name} : solde de ${gold} or (rang : ${rank}).`);
  }

  // ---------------------------------------------------------------- annonces
  private declare(st: WarState, now: boolean): void {
    const g = this.g, A = this.fac(st.plan.a), B = this.fac(st.plan.b);
    if (!A || !B) return;
    this.known.add(st.plan.id);
    const text = `Les hérauts l’annoncent : ${leF(A.name)} déclare la guerre ${auF(B.name)} !`;
    this.log(`${leF(A.name)} déclare la guerre ${auF(B.name)}.`);
    for (const f of [A, B]) {
      const cap0 = g.world.civ.settlements[f.capitalId];
      if (cap0) this.rumor(`${cap(leF(A.name))} et ${leF(B.name)} sont en guerre : on se battra aux frontières.`, cap0.id, st.plan.id);
    }
    if (!now) return;
    this.say(text, C.red);
    g.audio.horn();
    if (!g.dungeon) g.banner = { text: 'GUERRE', sub: `${cap(leF(A.name))} contre ${leF(B.name)}.`, sub2: 'Les frontières vont bouger : on peut s’engager auprès des gardes.', t: 7, color: C.red };
  }
  private peace(st: WarState, now: boolean): void {
    const g = this.g, A = this.fac(st.plan.a), B = this.fac(st.plan.b);
    if (!A || !B) return;
    const caps = st.results.filter((r) => r.capture).map((r) => `${this.place(r.sid).name} (${shortFaction(this.fac(r.atk)?.name ?? '')})`);
    const text = `La paix est signée entre ${leF(A.name)} et ${leF(B.name)}.${caps.length ? ` Places prises : ${caps.join(', ')}.` : ' Les frontières ne bougent pas.'}`;
    this.log(text);
    for (const f of [A, B]) { const c0 = g.world.civ.settlements[f.capitalId]; if (c0) this.rumor(text, c0.id, st.plan.id + ':paix'); }
    if (this.side?.[0] === st.plan.id) this.side = null;
    if (!now) return;
    this.say(text, C.green);
    g.audio.fanfare();
    if (!g.dungeon) g.banner = { text: 'PAIX', sub: `${cap(leF(A.name))} et ${leF(B.name)} déposent les armes.`, sub2: caps.length ? `Places prises : ${caps.join(', ')}` : undefined, t: 7, color: C.green };
  }

  /** Rumeurs annoncées à l'avance (une fois par événement) : fêtes des deux jours qui viennent, épidémie, bataille du jour. */
  private foretell(d: number): void {
    const g = this.g;
    if (this.done.has('annonces:' + d)) return;
    this.done.add('annonces:' + d);
    for (let dd = d; dd <= d + 2; dd++) for (const p of this.cal.eventsOn(dd, this.tmpList)) {
      const s = this.place(p.sid);
      if (p.kind === 'fête' && Math.floor(p.start / DAY) === dd && dd > d) this.rumor(`On prépare ${this.feastName(p)} à ${s.name}, ${dd === d + 1 ? 'demain' : 'après-demain'} : musique, danses et concours de tir à l’arc !`, p.sid, p.id, -1);
      if (p.kind === 'épidémie' && Math.floor(p.start / DAY) === d && dd === d) this.rumor(`${cap(p.disease)} frappe ${s.name} : la guérisseuse cherche des remèdes.`, p.sid, p.id);
    }
    const b = this.battleOn(d);
    if (b) {
      const A = this.fac(b.attacker), T = this.place(b.sid);
      const txt = `Des soldats ${A ? deFaction(A.name) : ''} marchent sur ${T.name} : on se battra devant la place vers ${heure(b.start)}.`;
      this.rumor(txt, b.sid, b.id); this.rumor(txt, b.from, b.id);
      if (this.known.has(b.war)) this.known.add(b.id);
    }
    void g;
  }
  private rumor(text: string, sid: number, id: string, age = 0): void {
    if (sid < 0 || !this.place(sid)) return;
    const tag = 'évt:' + id;
    if (this.g.rumors.list.some((r) => r.tag === tag && r.origin === sid)) return;
    this.g.rumors.add(text, sid, tag, age);
  }

  // ================================================================ boucle
  tick(dt: number): void {
    const g = this.g, now = g.time.minutes;
    if (g.time.day !== this.day) this.newDay(g.time.day);
    this.tickFleeing(dt);
    this.tickSick(dt, now);
    if ((this.checkT -= dt) <= 0) {
      this.checkT = 1;
      this.settle(now);
      if (this.remedies.size) this.syncRemedies(true);
      if (!g.dungeon) { this.refresh(now); this.arrivals(now); }
    }
    if (g.dungeon) { if (this.live.size) this.deactivateAll(); if (this.contest) this.abortContest('Vous quittez la fête : le concours de tir est perdu.'); return; }
    for (const L of this.live.values()) this.updateLive(L, dt, now);
    this.tickContest();
    this.tickVillage(dt, now);
    this.pushColliders();
  }

  private newDay(day: number): void {
    this.day = day;
    this.cal.prune(day);
    for (const d of [...this.battles.keys()]) if (d < day - 3) this.battles.delete(d);
    for (const k of [...this.done]) if (k.startsWith('annonces:') && Number(k.slice(9)) < day - 2) this.done.delete(k);
    this.dirty = true;
  }

  private tickFleeing(dt: number): void {
    if (!this.fleeing.length) return;
    const g = this.g, p = g.player;
    for (const f of this.fleeing) f.t -= dt;
    const gone = this.fleeing.filter((f) => f.t <= 0 || !f.e.alive || !g.entities.has(f.e) || Math.hypot(f.e.x - p.x, f.e.z - p.z) > 45);
    for (const f of gone) if (f.e.alive && g.entities.has(f.e) && (!f.e.zoneKey || g.entities.simulates(f.e.zoneKey))) g.entities.dismiss(f.e);
    this.fleeing = this.fleeing.filter((f) => !gone.includes(f));
  }

  /** Une fois par seconde : événements à incarner ou à retirer. */
  private refresh(now: number): void {
    const g = this.g, p = g.player, want: { plan: EventPlan; d: number }[] = [];
    for (const ev of this.todayList()) {
      const d = Math.hypot(ev.x - p.x, ev.z - p.z);
      if (d > DEACTIVATE) continue;
      if (ev.kind === 'raid' && now >= ev.start && !this.applied.has(ev.id) && !this.raidCancelled(ev)) want.push({ plan: ev, d });
      else if (ev.kind === 'fête' && ev.merchants && this.feastOpen(ev, now)) want.push({ plan: ev, d });
    }
    const battles: BattlePlan[] = [];
    const b = this.battleOn(g.time.day);
    if (b) battles.push(b);
    for (const x of this.cal.dev) if (x.kind === 'bataille') battles.push(x);
    for (const x of battles) if (now >= x.start - 3 && !this.applied.has(x.id)) { const d = Math.hypot(x.x - p.x, x.z - p.z); if (d < DEACTIVATE) want.push({ plan: x, d }); }
    for (const L of [...this.live.values()]) {
      // (par identifiant : le plan d'une bataille peut être recalculé après un changement de propriétaire)
      const w = want.find((x) => x.plan.id === L.plan.id), d = Math.hypot(L.plan.x - p.x, L.plan.z - p.z);
      // un combat dénoué reste un moment (fuyards, cadavres) ; une foire fermée plie bagage
      const linger = L.resolved && L.kind !== 'fête' && now < L.plan.end + 30;
      if (d > DEACTIVATE || (!w && !linger)) this.deactivate(L, true);
    }
    want.sort((a, c) => (a.plan.id.startsWith('x') ? 0 : 1) - (c.plan.id.startsWith('x') ? 0 : 1) || a.d - c.d);
    for (const w of want) {
      if (w.d >= ACTIVATE || this.live.has('e' + w.plan.id) || this.live.size >= MAX_LIVE) continue;
      this.activate(w.plan);
    }
  }
  private feastOpen(p: FeastPlan, now: number): boolean {
    const h = (now % DAY) / 60;
    return now >= p.start && now < feastEnd(p, this.outcomes.get(p.id)) && h >= 8 && h < 22;
  }

  /** Arrivée sur les lieux : message, bandeau, réputation (une fois par événement) ; événements connus. */
  private arrivals(now: number): void {
    const g = this.g, p = g.player;
    const consider = (ev: EventPlan) => {
      const d = Math.hypot(ev.x - p.x, ev.z - p.z);
      if (d < KNOW_R && (ev.kind !== 'raid' || now >= ev.start)) this.known.add(ev.id);   // un raid ne se devine pas à l'avance
      const s = this.place(ev.sid), ph = this.phase(ev, now);
      if (ph === 'à venir' || ph === 'fini' || this.done.has('vu:' + ev.id) || d > (ev.kind === 'bataille' ? 170 : s.radius + 40)) return;
      this.done.add('vu:' + ev.id);
      this.welcome(ev, ph);
    };
    for (const ev of this.todayList()) consider(ev);
    const b = this.battleOn(g.time.day);
    if (b) consider(b);
    for (const x of this.cal.dev) if (x.kind === 'bataille') consider(x);
    // les rumeurs du lieu où l'on se trouve font connaître les événements
    const here = this.hereSid();
    if (here >= 0) for (const r of g.rumors.known(here)) if (r.tag.startsWith('évt:')) this.known.add(r.tag.slice(4).replace(/:paix$/, ''));
  }
  /** Implantation où se trouve le joueur (−1 : en pleine nature), recalculée cinq fois par seconde. */
  private hereSid(): number {
    const g = this.g, p = g.player;
    if (g.elapsed - this.hereT < 0.2 && this.hereT >= 0) return this.hereV;
    this.hereT = g.elapsed; this.hereV = -1;
    for (const s of g.world.civ.settlements) if (livingPlace(s) && Math.hypot(s.x - p.x, s.z - p.z) < s.radius + 25) { this.hereV = s.id; break; }
    return this.hereV;
  }
  private hereT = -1; private hereV = -1;

  private welcome(ev: EventPlan, ph: string): void {
    const g = this.g, s = this.place(ev.sid);
    if (ev.kind === 'fête') {
      if (!this.done.has('visite:' + ev.id)) { this.done.add('visite:' + ev.id); g.rep.addLocal(ev.sid, 3); }
      const extra = [ev.merchants > 1 ? 'Marchands de foire' : '', this.deco(ev.sid)?.range ? `concours de tir à l’arc (${ev.prize} or au vainqueur)` : ''].filter(Boolean).join(' · ');
      g.banner = { text: this.feastTitle(ev), sub: `${s.name} est en fête : musique et danses sur la place.`, sub2: extra ? cap(extra) : undefined, t: 6, color: C.gold };
      this.say(`C’est ${this.feastName(ev)} à ${s.name} ! Les habitants vous accueillent avec le sourire (+3 réputation locale).`, C.gold);
    } else if (ev.kind === 'raid') {
      if (ph === 'suites') this.say(`${s.name} panse ses plaies : ${RAIDERS[ev.raider].des} ont attaqué ${this.when(this.resolveTime(ev))}${ev.burn.length ? ` et ${ev.burn.length} maison${ev.burn.length > 1 ? 's ont' : ' a'} brûlé` : ''}.`, C.orange);
    } else if (ev.kind === 'épidémie') {
      if (ph === 'en cours') {
        g.banner = { text: 'ÉPIDÉMIE', sub: `${cap(ev.disease)} frappe ${s.name} : on tousse derrière les volets.`, sub2: 'Ne vous attardez pas sans remède contre la fièvre.', t: 6, color: C.orange };
        this.say(`${cap(ev.disease)} frappe ${s.name}. Un remède contre la fièvre protège de la contagion ; la guérisseuse en cherche.`, C.orange);
      }
    } else if (ev.kind === 'bataille' && ph === 'en cours') {
      const A = this.fac(ev.attacker), D = this.fac(ev.defender);
      g.banner = { text: 'BATAILLE', sub: `${cap(A ? leF(A.name) : 'l’ennemi')} attaque ${s.name}, que tient ${D ? leF(D.name) : 'son seigneur'}.`, sub2: 'Frappez les soldats d’un camp pour combattre aux côtés de l’autre.', t: 6, color: C.red };
    }
  }
  private when(t: number): string {
    const d = this.g.time.day - Math.floor(t / DAY), h = (((t % DAY) + DAY) % DAY) / 60;
    if (d <= 0) return h < 5 ? 'cette nuit' : 'aujourd’hui';
    if (d === 1) return h >= 20 ? 'hier soir' : h < 5 ? 'la nuit dernière' : 'hier';
    return d === 2 ? 'avant-hier' : `il y a ${d} jours`;
  }
  /** Instant de nuit (21 h – 5 h) ? */
  private nightly(t: number): boolean { const h = (((t % DAY) + DAY) % DAY) / 60; return h >= 21 || h < 5; }

  // ---------------------------------------------------------------- incarnation
  private activate(plan: EventPlan): void {
    const g = this.g, zone = 'e' + plan.id;
    let L: Live;
    if (plan.kind === 'raid') {
      L = { kind: 'raid', plan, zone, spawned: false, resolved: false, fires: [], igniteT: 6, tolls: 0, tollT: 0, screamT: 3, alarmed: false };
      g.entities.addEventZone(zone, this.raiders(plan));
    } else if (plan.kind === 'bataille') {
      L = { kind: 'bataille', plan, zone, spawned: false, resolved: false, horn: false, crimed: new Set() };
      g.entities.addEventZone(zone, this.squads(plan));
    } else if (plan.kind === 'fête') {
      L = { kind: 'fête', plan, zone, spawned: true, resolved: false };
      g.entities.addEventZone(zone, this.merchants(plan));
    } else return;
    this.live.set(zone, L);
  }

  /** Retire un événement ; en plein combat (et si on le simule), l'issue se décide sur les forces en présence. */
  private deactivate(L: Live, resolve: boolean): void {
    const g = this.g, list = g.entities.eventZones.get(L.zone) ?? [], now = g.time.minutes;
    if (resolve && !L.resolved && L.spawned && g.entities.simulates(L.zone) && !this.applied.has(L.plan.id)) {
      if (L.kind === 'raid') { const f = this.raidForces(L, list); if (now >= L.plan.start) this.resolve(L.plan, raidVerdict(f.raiders, f.defenders)); }
      else if (L.kind === 'bataille') { const f = this.battleForces(L, list); this.resolve(L.plan, battleVerdict(f.atk, f.def, L.plan.attackerWins)); }
    }
    this.fleeing = this.fleeing.filter((f) => f.e.zoneKey !== L.zone);
    g.entities.removeEventZone(L.zone);
    this.live.delete(L.zone);
  }
  deactivateAll(): void { for (const L of [...this.live.values()]) this.deactivate(L, true); }
  /** Souterrain : les événements quittent la simulation (un combat en cours se décide). */
  onWorldChange(): void { this.deactivateAll(); this.checkT = 0; }

  private updateLive(L: Live, dt: number, now: number): void {
    const g = this.g, list = g.entities.eventZones.get(L.zone);
    if (!list) { this.live.delete(L.zone); return; }
    const sim = g.entities.simulates(L.zone), pl = g.player;
    if (L.kind === 'raid') {
      const p = L.plan, s = this.place(p.sid);
      if (!L.spawned) for (const e of list) if (e.mon && e.alive) { L.spawned = true; break; }
      const pd = Math.hypot(s.x - pl.x, s.z - pl.z);
      // tocsin et cris : le village se réveille
      if (L.spawned && !L.alarmed && !L.resolved) {
        L.alarmed = true; L.tolls = 10; L.tollT = 0.2;
        if (pd < s.radius + 160) {
          this.say(`Le tocsin sonne ! ${RAIDERS[p.raider].Des} attaquent ${s.name} !`, C.red);
          if (pd < s.radius + 90) g.banner = { text: 'RAID !', sub: `${RAIDERS[p.raider].Des} attaquent ${s.name}.`, sub2: 'Aidez les gardes à les repousser : le village saura s’en souvenir.', t: 5, color: C.red };
          this.known.add(p.id); this.done.add('vu:' + p.id);
        }
      }
      if (L.tolls > 0 && (L.tollT -= dt) <= 0) { L.tolls--; L.tollT = 1.4; const c = this.belfry(p.sid); if (pd < 260) g.audio.bell(c, 0.9); }
      // pillards dans le village : les toits prennent feu (pas les loups), les villageois crient
      let inside = 0;
      for (const e of list) if (e.mon && e.alive && !e.mon.yielded && Math.hypot(e.x - s.x, e.z - s.z) < s.radius * 0.8) inside++;
      if (inside && !L.resolved && p.raider !== 'loup' && L.fires.length < p.burn.length && (L.igniteT -= dt) <= 0) {
        L.igniteT = 12 + (L.fires.length * 7) % 13;
        const b = this.cal.layout(p.sid)?.buildings[p.burn[L.fires.length]];
        if (b) { L.fires.push(this.fireOf(b)); if (pd < 200) this.say(`Un toit prend feu à ${s.name} !`, C.orange); }
      }
      if (inside && !L.resolved && (L.screamT -= dt) <= 0) {
        L.screamT = 4 + Math.random() * 5;
        const z = g.entities.zones.get(p.sid);
        if (z && z.ents.length && pd < 120) { const e = z.ents[Math.floor(Math.random() * z.ents.length)]; if (e.alive && e.npc && Math.hypot(e.x - pl.x, e.z - pl.z) < 60) g.audio.scream({ x: e.x, y: e.y + 1.5, z: e.z }, e.npc.sex === 'f'); }
      }
      for (const f of L.fires) {
        if (f.t < 0) continue;
        f.t += dt;
        if ((f.emitT -= dt) <= 0) {
          f.emitT = 0.22;
          if (Math.hypot(f.x - pl.x, f.z - pl.z) < 140) { g.particles.emit('flamme', f.x + (Math.random() - 0.5) * f.w, f.y, f.z + (Math.random() - 0.5) * f.w, 2); if (Math.random() < 0.6) g.particles.emit('suie', f.x, f.y + 0.6, f.z, 1); }
        }
      }
      if (sim && L.spawned && !L.resolved && !this.applied.has(p.id)) {
        const f = this.raidForces(L, list);
        if (f.raiders === 0) this.resolve(p, 'r');
        else if (now >= p.end) this.resolve(p, raidVerdict(f.raiders, f.defenders));
      }
    } else if (L.kind === 'bataille') {
      const p = L.plan;
      if (!L.spawned) for (const e of list) if (e.event && e.alive) { L.spawned = true; break; }
      if (!L.horn && L.spawned && now >= p.start) {
        L.horn = true;
        if (Math.hypot(p.x - pl.x, p.z - pl.z) < 240) { g.audio.horn({ x: p.x + p.dx * 40, y: g.world.heightAt(p.x, p.z) + 3, z: p.z + p.dz * 40 }); this.say(`Des cors sonnent : la bataille s’engage devant ${this.place(p.sid).name} !`, C.red); }
      }
      if (sim && L.spawned && !L.resolved && !this.applied.has(p.id)) {
        const f = this.battleForces(L, list);
        if (f.atk === 0 || f.def === 0) this.resolve(p, f.atk === 0 ? 'd' : 'a');
        else if (now >= p.end) this.resolve(p, battleVerdict(f.atk, f.def, p.attackerWins));
      }
    }
  }

  private forces = { raiders: 0, defenders: 0, atk: 0, def: 0 };
  private raidForces(L: LiveRaid, list: Entity[]): { raiders: number; defenders: number } {
    const g = this.g, s = this.place(L.plan.sid), pl = g.player, f = this.forces;
    let raiders = 0, defenders = 0;
    for (const e of list) if (e.mon && e.alive && !e.mon.yielded && Math.hypot(e.x - s.x, e.z - s.z) < s.radius + 90) raiders++;
    for (const e of g.entities.zones.get(L.plan.sid)?.ents ?? []) if (e.alive && e.npc && (e.npc.profession === 'garde' || e.npc.profession === 'soldat')) defenders++;
    if (!pl.dead && Math.hypot(s.x - pl.x, s.z - pl.z) < s.radius + 60) defenders += 2;
    f.raiders = raiders; f.defenders = defenders;
    return f;
  }
  private battleForces(L: LiveBattle, list: Entity[]): { atk: number; def: number } {
    let atk = 0, def = 0;
    const f = this.forces;
    for (const e of list) {
      const t = e.event;
      if (!t || !e.alive || t.routed || Math.hypot(e.x - L.plan.x, e.z - L.plan.z) > 95) continue;
      if (t.side === L.plan.attacker) atk++; else def++;
    }
    f.atk = atk; f.def = def;
    return f;
  }
  /** Assaillants qui détalent (raid dénoué). */
  private scatter(zone: string): void {
    for (const e of this.g.entities.eventZones.get(zone) ?? []) {
      const m = e.mon;
      if (!m || !e.alive || m.yielded) continue;
      m.yielded = true; m.state = 'fuite'; m.targetId = 'player'; m.alerted = false; m.windup = 0;
      this.fleeing.push({ e, t: 16 });
    }
  }
  /** Le camp vaincu rompt et fuit vers l'arrière. */
  private routLosers(L: LiveBattle, side: number): void {
    for (const e of this.g.entities.eventZones.get(L.zone) ?? []) {
      const t = e.event;
      if (!t || !e.alive || t.side !== side) continue;
      t.routed = true; e.foe = null; e.thinkT = 0;
      this.fleeing.push({ e, t: 20 });
    }
  }

  /** Assaillants d'un raid (ids déterministes : les marionnettes des autres joueurs ont les mêmes). */
  private raiders(p: RaidPlan): Entity[] {
    const g = this.g, s = this.place(p.sid), zone = 'e' + p.id, out: Entity[] = [];
    const d = Math.hypot(p.lx - s.x, p.lz - s.z) || 1, ux = (p.lx - s.x) / d, uz = (p.lz - s.z) / d;
    const late = g.time.minutes - p.start > 6;
    for (let i = 0; i < p.count; i++) {
      // en route depuis le repaire (bord du village, côté repaire) ; arrivé en retard, on les trouve déjà dans les rues
      const a = (i - (p.count - 1) / 2) * 0.12, r = late ? s.radius * (0.3 + ((i * 37) % 50) / 100) : s.radius + 38 + (i % 3) * 4;
      const ca = Math.cos(a), sa = Math.sin(a), x = s.x + (ux * ca - uz * sa) * r, z = s.z + (uz * ca + ux * sa) * r;
      const e = this.raider(zone, i, p, x, z);
      e.y = g.entities.ground(x, z, g.world.heightAt(x, z) + 2);
      e.heading = Math.atan2(s.x - x, -(s.z - z));
      out.push(e);
    }
    return out;
  }
  private raider(zone: string, i: number, p: RaidPlan, x: number, z: number): Entity {
    const s = this.place(p.sid);
    const e = makeMonster(`${zone}:r${i}`, p.raider, x, z, s.x, s.z, s.radius * 0.9, { level: p.level, lair: zone });
    const m = e.mon!;
    m.aggro = 1; m.alerted = true; m.perception = Math.max(m.perception, 30); m.state = 'retour';
    return e;
  }
  /** Clocher (chapelle ou temple), sinon la place : d'où sonne le tocsin. */
  private belfry(sid: number): { x: number; y: number; z: number } {
    const s = this.place(sid), L = this.cal.layout(sid);
    const b = L?.buildings.find((x) => x.kind === 'chapelle' || x.kind === 'temple');
    const x = b ? b.x : s.x, z = b ? b.z : s.z;
    return { x, y: this.g.world.heightAt(x, z) + 7, z };
  }

  // ---------------------------------------------------------------- escouades
  private squads(p: BattlePlan): Entity[] {
    const out: Entity[] = [], late = this.g.time.minutes - p.start > 8;
    for (let i = 0; i < p.atk; i++) out.push(this.soldier(p, 'a', i, late));
    for (let i = 0; i < p.def; i++) out.push(this.soldier(p, 'd', i, late));
    return out;
  }
  private soldierNpc(p: BattlePlan, tag: 'a' | 'd', i: number): NPCData {
    const id = `e${p.id}:${tag}${i}`;
    let n = this.crew.get(id);
    if (n) return n;
    const side = tag === 'a' ? p.attacker : p.defender, home = tag === 'a' ? p.from : p.sid;
    const q = this.g.seed.stream('événements', 'soldat', p.id, tag + i), fem = q.chance(0.22);
    const nm = new NameGen(q.fork('nom')).person(fem ? 'f' : 'm'), lead = i === 0;
    const hp = Math.round(60 * (1 + 0.15 * (p.level - 1)));
    n = {
      id, sid: home, first: nm.first, last: nm.last, sex: fem ? 'f' : 'm', age: q.int(19, 44), profession: 'soldat', home: -1, work: -1, factionId: side,
      traits: { bravery: 0.6 + q.next() * 0.4, kindness: q.next(), greed: q.next(), piety: q.next(), sociability: q.next(), honesty: q.next() },
      relations: [], wealth: q.int(5, 30), inventory: [], needs: { faim: 0.3, fatigue: 0.4, social: 0.3, sécurité: 0.8 }, knowledge: [],
      goal: 'revenir vivant de la guerre', schedule: [{ from: 0, to: DAY, act: 'garder', place: 'wild' }], shift: 'jour',
      colors: { skin: q.pick([0xe0b090, 0xc89870, 0xa87850, 0xf0c8a8, 0x8a6040]), shirt: 0x8a8a94, pants: q.pick([0x3a3a4a, 0x4a3a2a, 0x2a3a2a]), hair: q.pick([0x2a1a10, 0x5a3a20, 0x8a6a30, 0xc8a050, 0x1a1a1a]) },
      look: 'garde', alive: true, hp, memories: [], title: lead ? (fem ? 'sergente' : 'sergent') : 'soldat',
    };
    this.crew.set(id, n);
    return n;
  }
  private soldier(p: BattlePlan, tag: 'a' | 'd', i: number, late: boolean): Entity {
    const g = this.g, n = this.soldierNpc(p, tag, i), side = n.factionId, color = this.fac(side)?.color ?? 0x6a2a2a, zone = 'e' + p.id;
    const v = hashString(n.id) & 255, key = `${color}|${v % 6}|${n.sex}|${i === 0 ? 1 : 0}`;
    let model = this.models.get(key);
    if (!model) {
      model = humanoid({
        skin: n.colors.skin, shirt: 0x8a8a94, pants: n.colors.pants, hair: n.colors.hair, helmet: true, tabard: color, emblem: 0xe8d8a0,
        weapon: v % 3 === 0 ? 'épée' : 'lance', shield: true, face: true, scale: (n.sex === 'f' ? 0.9 : 0.96) + (v % 7) / 100, letter: '@',
        cape: i === 0 ? color : undefined, hairStyle: n.sex === 'f' ? 'chignon' : 'court',
      });
      this.models.set(key, model);
    }
    const e = new Entity(n.id, 'npc', 'soldat', `${n.first} ${n.last}`, model, n.hp);
    e.npc = n; e.sid = n.sid; e.speed = 1.6; e.thinkT = (v % 10) / 30; e.zoneKey = zone;
    // rangs face à face : l'attaquant arrive de son côté de la route, le défenseur sort de la place
    const sgn = tag === 'a' ? 1 : -1, rx = -p.dz, rz = p.dx, lat = (i - ((tag === 'a' ? p.atk : p.def) - 1) / 2) * 2.2;
    const front = late ? 4 : tag === 'a' ? 34 : 14, tx = p.x + p.dx * sgn * 3 + rx * lat, tz = p.z + p.dz * sgn * 3 + rz * lat;
    e.x = p.x + p.dx * sgn * front + rx * lat; e.z = p.z + p.dz * sgn * front + rz * lat;
    e.y = g.entities.ground(e.x, e.z, g.world.heightAt(e.x, e.z) + 2);
    e.heading = Math.atan2(-p.dx * sgn, p.dz * sgn);
    e.event = { id: p.id, role: 'soldat', side, dmg: Math.round(9 * (1 + 0.12 * (p.level - 1)) * 10) / 10, tx, tz, face: e.heading, routed: false, fx: p.x + p.dx * sgn * 80, fz: p.z + p.dz * sgn * 80, grudge: '' };
    if (!n.alive) { e.alive = false; e.hp = 0; }
    return e;
  }

  // ---------------------------------------------------------------- marchands de foire
  private static ROLES: Record<string, [string, string][]> = {
    foire: [['armurier', 'armurière'], ['épicier', 'épicière'], ['herboriste', 'herboriste']],
    moissons: [['épicier', 'épicière']], patron: [['herboriste', 'herboriste']],
  };
  private merchantNpc(p: FeastPlan, i: number): NPCData {
    const id = `e${p.id}:m${i}`;
    let n = this.crew.get(id);
    if (n) return n;
    const q = this.g.seed.stream('événements', 'marchand', p.id, i), fem = q.chance(0.45);
    const nm = new NameGen(q.fork('nom')).person(fem ? 'f' : 'm'), role = Happenings.ROLES[p.feast][i] ?? ['marchand', 'marchande'];
    n = {
      id, sid: p.sid, first: nm.first, last: nm.last, sex: fem ? 'f' : 'm', age: q.int(24, 62), profession: 'marchand', home: -1, work: -1, factionId: this.owner(p.sid),
      traits: { bravery: q.next() * 0.6, kindness: q.next(), greed: q.next(), piety: q.next(), sociability: 0.5 + q.next() * 0.5, honesty: q.next() },
      relations: [], wealth: 200 + q.int(0, 200), inventory: [], needs: { faim: 0.2, fatigue: 0.3, social: 0.2, sécurité: 0.2 }, knowledge: [],
      goal: 'vendre tout son étal avant la fin de la fête', schedule: [{ from: 0, to: DAY, act: 'travailler', place: 'plaza' }], shift: 'jour',
      colors: { skin: q.pick([0xe0b090, 0xc89870, 0xa87850, 0xf0c8a8, 0x8a6040]), shirt: q.pick([0x6a2a4a, 0x2a3a6a, 0x5a2a2a, 0x2a5a4a, 0x6a5a2a]), pants: q.pick([0x3a3a4a, 0x4a3a2a]), hair: q.pick([0x2a1a10, 0x5a3a20, 0x8a6a30, 0xc8a050, 0x6a6a6a]) },
      look: 'civil', alive: true, hp: 30, memories: [], title: fem ? role[1] : role[0],
    };
    this.crew.set(id, n);
    return n;
  }
  private merchants(p: FeastPlan): Entity[] {
    const d = this.deco(p.sid), out: Entity[] = [];
    if (!d) return out;
    for (let i = 0; i < Math.min(p.merchants, d.stalls.length); i++) out.push(this.merchant(p, i, d));
    return out;
  }
  private merchant(p: FeastPlan, i: number, d: Deco): Entity {
    const g = this.g, n = this.merchantNpc(p, i), st = d.stalls[i], v = hashString(n.id) & 255, key = `m|${n.id}`;
    let model = this.models.get(key);
    if (!model) {
      const f = n.sex === 'f';
      model = humanoid({ skin: n.colors.skin, shirt: n.colors.shirt, pants: n.colors.pants, hair: n.colors.hair, face: true, letter: '@', hat: v % 2 ? 'béret' : 'bonnet', hatColor: [0x8a2a2a, 0x2a4a7a, 0x4a6a3a][v % 3], apron: 0xd8d0c0, dress: f && v % 2 === 0, hairStyle: f ? 'chignon' : 'court', scale: (f ? 0.9 : 0.96) + (v % 6) / 100 });
      this.models.set(key, model);
    }
    const e = new Entity(n.id, 'npc', 'marchand', `${n.first} ${n.last}`, model, 30);
    e.npc = n; e.sid = p.sid; e.zoneKey = 'e' + p.id;
    e.x = st.sx; e.z = st.sz; e.y = g.entities.ground(st.sx, st.sz, g.world.heightAt(st.sx, st.sz) + 2); e.heading = st.yaw;
    e.event = { id: p.id, role: 'marchand', side: -1, dmg: 3, tx: st.sx, tz: st.sz, face: st.yaw, routed: false, fx: st.sx, fz: st.sz, grudge: '' };
    if (!n.alive) { e.alive = false; e.hp = 0; }
    return e;
  }
  private stepMerchant(e: Entity, dt: number): void {
    const t = e.event!, p = this.g.player;
    const d = Math.hypot(t.tx - e.x, t.tz - e.z);
    if (d > 0.2) { const st = Math.min(d, 1.4 * dt); this.g.entities.walk(e, ((t.tx - e.x) / d) * st, ((t.tz - e.z) / d) * st); e.heading = turn(e.heading, Math.atan2(t.tx - e.x, -(t.tz - e.z)), dt * 6); e.pose.walk += st * 4; }
    else {
      e.pose.walk *= 0.85;
      const pd = Math.hypot(p.x - e.x, p.z - e.z);
      e.heading = turn(e.heading, e.talkT > 0 || pd < 4 ? Math.atan2(p.x - e.x, -(p.z - e.z)) : t.face ?? e.heading, dt * 4);
    }
    e.pose.swing = Math.max(0, e.pose.swing - dt * 3);
    const gy = this.g.entities.ground(e.x, e.z, e.y + 0.4);
    e.y += (gy - e.y) * Math.min(1, dt * 12);
    if (e.talkT > 0) e.talkT -= dt;
  }
  /** Marchandises du jour d'un marchand de foire (null : pas un marchand de foire). Boutique fermée par l'épidémie : rien. */
  stockFor(e: Entity): { id: string; qty: number }[] | null {
    const t = e.event;
    if (t?.role === 'marchand' && e.npc) {
      const i = Number(e.id.slice(e.id.lastIndexOf(':') + 2)), rng = this.g.seed.stream('événements', 'étal', t.id, i, this.g.time.day);
      const role = e.npc.title ?? '';
      const pool: [string, number, number][] = role.startsWith('armuri')
        ? [['arc de concours', 1, 1], ['arc long', 1, 1], ['arc court', 1, 1], ['flèche', 20, 40], ['épée longue', 1, 1], ['bouclier de fer', 1, 1], ['casque de fer', 1, 1], ['dague', 1, 1]]
        : role.startsWith('épici')
          ? [['pain d’épices', 3, 8], ['cidre', 3, 8], ['hydromel', 2, 5], ['fromage', 2, 5], ['sel', 1, 3], ['élixir de foire', 1, 2], ['pomme', 3, 6], ['tourte à la viande', 1, 3]]
          : [['remède contre la fièvre', 2, 5], ['potion de soin', 2, 4], ['antidote', 1, 3], ['herbe médicinale', 3, 8], ['élixir de foire', 1, 2], ['potion de chaleur', 1, 2], ['parchemin : lumière', 1, 1], ['champignon', 2, 5]];
      const out: { id: string; qty: number }[] = [];
      for (const [id, a, b] of pool) if (out.length < 3 || rng.chance(0.7)) out.push({ id, qty: rng.int(a, b) });
      return out;
    }
    return this.closed(e) ? [] : null;
  }
  /** Boutique fermée : marchand alité, ou qui garde porte close tant que l'épidémie sévit. */
  closed(e: Entity): boolean {
    const n = e.npc;
    if (!n || n.road || e.event) return false;
    const ev = this.eventAt(n.sid);
    if (!ev || ev.kind !== 'épidémie' || this.phase(ev, this.g.time.minutes) !== 'en cours') return false;
    if (bedridden(n, ev)) return true;
    return (n.profession === 'marchand' || n.profession === 'forgeron') && hash01(`${ev.id}|fermé|${n.id}`) < 0.5;
  }

  // ================================================================ hôte des entités (EntityManager)
  npc(id: string): NPCData | undefined {
    const c = this.crew.get(id);
    if (c) return c;
    const i = id.lastIndexOf(':');
    if (i < 2) return undefined;
    const p = this.planById(id.slice(1, i)), tag = id.slice(i + 1), k = Number(tag.slice(1));
    if (!p || !Number.isInteger(k)) return undefined;
    if (p.kind === 'bataille' && (tag[0] === 'a' || tag[0] === 'd')) return this.soldierNpc(p, tag[0], k);
    if (p.kind === 'fête' && tag[0] === 'm') return this.merchantNpc(p, k);
    return undefined;
  }
  puppet(zone: string, id: string, type: string, x: number, z: number): Entity | null {
    const p = this.planById(zone.slice(1)), tag = id.slice(id.lastIndexOf(':') + 1), k = Number(tag.slice(1));
    if (!p || !Number.isInteger(k)) return null;
    const L = this.live.get(zone);
    if (p.kind === 'raid' && tag[0] === 'r') { if (L) L.spawned = true; return this.raider(zone, k, p, x, z); }
    if (p.kind === 'bataille' && (tag[0] === 'a' || tag[0] === 'd')) { if (L) L.spawned = true; return this.soldier(p, tag[0], k, true); }
    if (p.kind === 'fête' && tag[0] === 'm') { const d = this.deco(p.sid); return d && d.stalls[k] ? this.merchant(p, k, d) : null; }
    void type;
    return null;
  }
  step(e: Entity, dt: number): void { if (e.event?.role === 'soldat') updateSoldier(e, dt, this.aictx); else this.stepMerchant(e, dt); }

  /** Emploi du temps changé : fête (les villageois se rassemblent et dansent), raid (on se terre, les gardes tiennent la place), épidémie (alités). */
  override(n: NPCData, L: Layout, minute: number, hour: number): { spot: Spot; act: string } | null {
    if (n.road) return null;
    const ev = this.eventAt(n.sid);
    if (!ev) return null;
    const now = this.g.time.minutes;
    if (ev.kind === 'fête') {
      if (now < ev.start || now >= feastEnd(ev, this.outcomes.get(ev.id)) || hour < 9 || hour >= 23) return null;
      if (n.profession === 'garde' || n.profession === 'soldat' || n.profession === 'aubergiste' || hash01(`${ev.id}|fête|${n.id}`) > 0.8) return null;
      return this.festSpot(n, ev, L);
    }
    if (ev.kind === 'raid') {
      if (this.phase(ev, now) !== 'en cours') return null;
      if (n.profession === 'garde' || n.profession === 'soldat') return { spot: resolveSpot(n, { from: 0, to: DAY, act: 'garder', place: 'plaza' }, L, hour), act: 'garder' };
      if (blockAt(n, minute).act === 'dormir') return null;
      return { spot: resolveSpot(n, { from: 0, to: DAY, act: 'loisir', place: 'home' }, L, hour), act: 'fuir' };
    }
    if (ev.kind === 'épidémie' && this.phase(ev, now) === 'en cours' && bedridden(n, ev)) return { spot: resolveSpot(n, { from: 0, to: DAY, act: 'dormir', place: 'home' }, L, hour), act: 'dormir' };
    return null;
  }
  private festSpot(n: NPCData, ev: FeastPlan, L: Layout): { spot: Spot; act: string } | null {
    const d = this.deco(ev.sid), P = L.plaza;
    if (!d || !P) return null;
    const h = hash01(`${ev.id}|place|${n.id}`), dancer = h < 0.22;
    let a = hash01(`${n.id}|angle`) * Math.PI * 2, r = dancer ? 2.2 + h * 6 : P.r * (0.5 + hash01(`${n.id}|rayon`) * 0.45);
    const cx = dancer ? d.mast.x : P.x, cz = dancer ? d.mast.z : P.z;
    let x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    // pas dans l'axe du pas de tir
    for (let k = 0; k < 10 && this.inRange(d, x, z); k++) { a += 0.6; x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r; }
    return { spot: { x, z, building: -1, lying: false, face: dancer ? null : Math.atan2(P.x - x, -(P.z - z)), outdoor: true }, act: dancer ? 'danser' : 'loisir' };
  }
  private inRange(d: Deco, x: number, z: number): boolean {
    const r = d.range;
    if (!r) return false;
    const vx = x - r.lx, vz = z - r.lz, along = vx * r.dx + vz * r.dz;
    if (along < -2 || along > r.len + 8) return false;
    return Math.abs(vx * -r.dz + vz * r.dx) < 3;
  }

  /** Recherche d'un événement par identifiant (calendrier, bataille du jour, console). */
  private planById(id: string): EventPlan | null {
    for (const L of this.live.values()) if (L.plan.id === id) return L.plan;
    for (const p of this.cal.dev) if (p.id === id) return p;
    const m = /^([rfp])(\d+)\.(-?\d+)$/.exec(id);
    if (m) { const p = this.cal.slot(Number(m[2]), Number(m[3])); return p && p.id === id ? p : null; }
    const b = /^b(x?\d+)\.(\d+)$/.exec(id);
    if (b) {
      const w = b[1].startsWith('x') ? (this.cal.devWar?.id === 'g' + b[1] ? this.cal.devWar : null) : this.cal.war(Number(b[1]));
      if (!w) return null;
      const bp = this.battleOn(w.start + 1 + Number(b[2]));
      return bp && bp.id === id ? bp : null;
    }
    return null;
  }

  // ================================================================ dégâts, délits, prise de parti
  private onDamaged(targetId: string, sourceId: string | null): void {
    if (!targetId.startsWith('e') || !sourceId) return;
    const i = targetId.lastIndexOf(':'), zone = targetId.slice(0, i), L = this.live.get(zone);
    if (!L) return;
    const e = this.g.entities.eventZones.get(zone)?.find((x) => x.id === targetId);
    if (!e) return;
    const mine = sourceId === 'player' || sourceId.startsWith('ally:');
    if (L.kind === 'raid' && e.mon && mine) this.done.add('aide:' + L.plan.id);
    if (L.kind === 'bataille' && e.event?.role === 'soldat') {
      if (sourceId.startsWith('p:')) e.event.grudge = sourceId;
      if (mine) this.done.add(`combat:${L.plan.id}:${e.event.side === L.plan.attacker ? L.plan.defender : L.plan.attacker}`);
    }
  }
  isSoldier(id: string): boolean { return id.startsWith('e') && /:[ad]\d+$/.test(id); }

  /** Le joueur frappe un participant d'un événement : un soldat (prise de parti, délit envers sa faction). true : traité ici. */
  onHit(e: Entity): boolean {
    const t = e.event;
    if (!t || t.role !== 'soldat') return false;
    const L = this.live.get(e.zoneKey);
    const g = this.g, side = t.side, f = this.fac(side);
    if (L?.kind !== 'bataille' || L.crimed.has(side)) return true;
    L.crimed.add(side);
    const other = side === L.plan.attacker ? L.plan.defender : L.plan.attacker, of = this.fac(other);
    for (const x of g.entities.eventZones.get(L.zone) ?? []) if (x.event?.side === side) x.thinkT = 0;
    if (this.side && this.side[1] === side) { this.side = null; this.say(`Vous trahissez ${leF(f?.name ?? '')} : vous n’êtes plus de ses soldats.`, C.red); }
    else this.say(`Vous prenez parti pour ${of ? leF(of.name) : 'l’autre camp'} : les soldats ${f ? deFaction(f.name) : ''} vous tiennent pour un ennemi.`, C.orange);
    // délit envers la faction attaquée : réputation, amende dans sa place la plus proche
    let near = -1, nd = 2500;
    for (const s of g.world.civ.settlements) { if (!livingPlace(s) || this.owner(s.id) !== side) continue; const d = Math.hypot(s.x - e.x, s.z - e.z); if (d < nd) { nd = d; near = s.id; } }
    const witnesses: string[] = [];
    for (const x of g.entities.eventZones.get(L.zone) ?? []) if (x.alive && x.event?.side === side) witnesses.push(x.id);
    g.events.emit('player:crime', { type: 'agression', victimId: e.id, settlementId: near >= 0 ? near : undefined, factionId: side, witnesses });
    return true;
  }

  // ================================================================ maladie du joueur, village malade
  private tickSick(dt: number, now: number): void {
    const g = this.g, p = g.player;
    if (!this.sick) return;
    if (now >= this.sick.fin) { this.say(`${cap(this.sick.nom)} est passée : vous vous sentez mieux.`, C.green); this.sick = null; return; }
    if (p.dead || (this.selfCoughT -= dt) > 0) return;
    this.selfCoughT = 18 + Math.random() * 26;
    g.audio.cough();
    p.stamina = Math.max(0, p.stamina - 8);
    if (this.coughs++ % 3 === 0) this.say(`Vous toussez (${this.sick.nom}).`, C.dim);
  }
  /** Effets de la maladie : endurance et soins réduits (null : bien portant). */
  sickness(): { stam: number; regen: number } | null { return this.sick ? SICK_FX : null; }
  /** Remède bu : guérison, puis une journée sans contagion. */
  cure(): void {
    const g = this.g;
    if (this.sick) { this.say(`Le remède fait son effet : ${this.sick.nom} recule.`, C.green); this.sick = null; }
    this.immune = g.time.minutes + DAY;
    this.say('Vous voilà protégé de la contagion pour une journée.', C.green);
  }
  /** Contagion (console, tests) : le joueur tombe malade. */
  catchSickness(name: string): void {
    const g = this.g;
    this.sick = { nom: name, fin: g.time.minutes + SICK_DAYS * DAY };
    this.selfCoughT = 6;
    g.audio.cough();
    g.banner = { text: 'MALADE', sub: `Vous avez attrapé ${name} : endurance et soins réduits.`, sub2: 'Remède : établi ou âtre de guérisseuse (2 herbes médicinales + 1 écorce)', t: 7, color: C.orange };
    this.say(`Vous avez attrapé ${name} ! Un remède contre la fièvre vous guérira.`, C.orange);
  }
  /** Toux des malades, contagion du joueur qui s'attarde sans protection. */
  private tickVillage(dt: number, now: number): void {
    const g = this.g, p = g.player;
    const here = this.hereSid(), ev = here >= 0 ? this.eventAt(here) : null;
    // minutes de jeu écoulées depuis l'image précédente (en ligne, l'heure vient du salon), bornées
    const gm = this.expoT < 0 ? 0 : Math.max(0, Math.min(5, now - this.expoT));
    this.expoT = now;
    if (!ev || ev.kind !== 'épidémie' || this.phase(ev, now) !== 'en cours') { this.expo = 0; return; }
    if ((this.coughT -= dt) <= 0) {
      this.coughT = 2.5 + Math.random() * 4;
      const z = g.entities.zones.get(here);
      if (z && z.ents.length) {
        const e = z.ents[Math.floor(Math.random() * z.ents.length)];
        if (e.alive && e.npc && Math.hypot(e.x - p.x, e.z - p.z) < 35) g.audio.cough({ x: e.x, y: e.y + 1.4, z: e.z }, e.npc.sex === 'f');
      }
    }
    if (this.sick || now < this.immune || g.god || p.dead) return;
    this.expo += gm;
    if (this.expo < EXPOSE) return;
    this.expo -= EXPOSE;
    if (Math.random() < 0.15 + 0.35 * ev.severity) this.catchSickness(ev.disease);
  }

  // ================================================================ quêtes de la guérisseuse
  /** Guérisseuse du lieu (sinon prêtre, moine). */
  private healer(sid: number): NPCData | undefined {
    const npcs = this.g.entities.npcsOf(sid);
    for (const prof of ['guérisseuse', 'prêtre', 'moine']) { const n = npcs.find((x) => x.alive && x.profession === prof); if (n) return n; }
    return undefined;
  }
  private remedyQuest(id: string, ev: EpidemicPlan, n: NPCData, need: number): Quest {
    const s = this.place(ev.sid), have = this.g.character.inv.count('remède contre la fièvre');
    return {
      id, kind: 'épidémie', giver: n.id, sid: ev.sid, title: `Des remèdes pour ${s.name}`,
      summary: `${n.first} ${n.last} a besoin de ${need} remèdes contre la fièvre pour enrayer ${ev.disease} à ${s.name}. Établi ou âtre de la guérisseuse : 2 herbes médicinales + 1 écorce.`,
      stage: have >= need ? 1 : 0, status: 'active',
      stages: [`Rapporter ${need} remèdes contre la fièvre à ${n.first} (${Math.min(have, need)}/${need})`, `Remettre les remèdes à ${n.first} (${s.name})`],
      target: { x: s.x, z: s.z, label: `${n.first} (${s.name})` }, reward: { gold: 15 * need, xp: 30 * need },
      data: { item: 'remède contre la fièvre', count: need, thanks: `Merci ! Avec ça, ${ev.disease} ne passera pas l’hiver. Tout ${s.name} te doit une fière chandelle.` },
    };
  }
  private takeRemedy(ev: EpidemicPlan, n: NPCData): void {
    const g = this.g, id = `épidémie:${ev.id}`, q = this.remedyQuest(id, ev, n, ev.remedies);
    q.status = 'disponible';
    g.quests.quests.push(q);
    g.quests.accept(q);
    this.remedies.set(id, { ev: ev.id, npc: n.id, need: ev.remedies, q });
    this.syncRemedies(false);
  }
  /** Avancement des quêtes de remèdes selon l'inventaire (une fois par seconde). */
  private syncRemedies(tell: boolean): void {
    const have = this.g.character.inv.count('remède contre la fièvre');
    for (const r of this.remedies.values()) {
      const q = r.q, n = this.g.entities.findNpc(r.npc);
      if (q.status !== 'active' || !n) continue;
      q.stages[0] = `Rapporter ${r.need} remèdes contre la fièvre à ${n.first} (${Math.min(have, r.need)}/${r.need})`;
      if (have >= r.need && q.stage === 0) { if (tell) this.g.quests.setStage(q, 1); else q.stage = 1; }
      else if (have < r.need && q.stage === 1) q.stage = 0;
    }
  }
  private dropRemedy(r: RemedyRec, why: string): void {
    const g = this.g;
    this.remedies.delete(r.q.id);
    g.quests.quests = g.quests.quests.filter((q) => q !== r.q);
    if (g.quests.tracked === r.q.id) g.quests.tracked = null;
    this.say(why, C.dim);
  }
  /** Remèdes remis : l'épidémie est enrayée maintenant (fait partagé), réputation. */
  private onQuestDone(questId: string): void {
    const r = this.remedies.get(questId);
    if (!r) return;
    this.remedies.delete(questId);
    const g = this.g, ch = g.character, p = this.planById(r.ev) as EpidemicPlan | null;
    ch.inv.remove('remède contre la fièvre', Math.min(ch.inv.count('remède contre la fièvre'), r.need - 1));   // la quête en a retiré un
    if (!p) return;
    const s = this.place(p.sid), fid = this.owner(p.sid);
    g.rep.addLocal(p.sid, 10);
    if (this.fac(fid)) g.rep.faction[fid] += 4;
    if (!this.applied.has(p.id)) this.resolve(p, 'e');
    this.rumor(`Grâce aux remèdes d’un voyageur, ${p.disease} recule à ${s.name} !`, p.sid, p.id + ':enrayée');
    g.banner = { text: 'ÉPIDÉMIE ENRAYÉE', sub: `${cap(p.disease)} recule à ${s.name} · +10 réputation locale`, t: 6, color: C.green };
    this.log(`vos remèdes ont enrayé ${p.disease} à ${s.name}.`);
  }

  // ================================================================ dialogues
  private menu(e: Entity): DialogueOption[] {
    const g = this.g, n = e.npc, d = g.dialogue, back = () => d.again(e);
    if (!n || n.road) return [];
    if (e.event?.role === 'soldat') return [{ label: 'Comment se passe la bataille ?', go: () => d.node(e, this.battleTalk(e), back) }];
    if (e.event) return [];
    const out: DialogueOption[] = [], now = g.time.minutes, ev = this.eventAt(n.sid);
    if (ev && this.phase(ev, now) !== 'fini') {
      const label = ev.kind === 'fête' ? 'Quelle est cette fête ?' : ev.kind === 'épidémie' ? 'On tousse beaucoup, par ici…' : this.phase(ev, now) === 'suites' ? 'Que s’est-il passé ici ?' : 'Que se passe-t-il ?';
      out.push({ label, go: () => d.node(e, this.eventTalk(n, ev), back) });
      if (ev.kind === 'épidémie' && this.phase(ev, now) === 'en cours' && this.healer(n.sid)?.id === n.id) out.unshift(...this.healerOptions(e, ev));
    } else {
      // une fête demain ou après-demain, ici
      const day = g.time.day, soon = this.cal.at(n.sid, (day + 1) * DAY + 12 * 60) ?? this.cal.at(n.sid, (day + 2) * DAY + 12 * 60);
      if (soon?.kind === 'fête' && soon.start > now) out.push({ label: 'On parle d’une fête ?', go: () => d.node(e, this.eventTalk(n, soon), back) });
    }
    const w = this.currentWar();
    if (w) {
      out.push({ label: 'Et cette guerre ?', go: () => d.node(e, this.warTalk(n, w), back) });
      const own = this.owner(n.sid);
      if ((own === w.plan.a || own === w.plan.b) && ['garde', 'soldat', 'noble'].includes(n.profession) && !(this.side && this.side[0] === w.plan.id && this.side[1] === own)) {
        const f = this.fac(own)!;
        out.push({ label: `Je veux servir ${leF(f.name)}.`, go: () => this.enlist(e, w, own) });
      }
    }
    return out;
  }

  private healerOptions(e: Entity, ev: EpidemicPlan): DialogueOption[] {
    const g = this.g, n = e.npc!, d = g.dialogue, back = () => d.again(e), id = `épidémie:${ev.id}`;
    if (this.remedies.has(id) || g.quests.quests.some((q) => q.id === id)) return [];
    const have = g.character.inv.count('remède contre la fièvre');
    return [{
      label: 'Comment enrayer cette fièvre ?', go: () => ({
        ...d.head(e, g.rep.mood(n)),
        lines: [`Il me faudrait ${ev.remedies} remèdes contre la fièvre, au plus vite : je n’ai plus de quoi en préparer.`, `Deux herbes médicinales et un peu d’écorce, à l’établi d’une forge ou à mon âtre, et le tour est joué.`, have >= ev.remedies ? `Tu en as déjà ${have} sur toi ? Alors donne, et vite !` : `Rapporte-les-moi : je les distribuerai, et ${ev.disease} reculera.`],
        options: [
          { label: `Accepter : rapporter ${ev.remedies} remèdes (${15 * ev.remedies} or)`, go: () => { this.takeRemedy(ev, n); return d.node(e, [have >= ev.remedies ? 'Parfait ! Donne-les-moi tout de suite.' : 'Merci. Fais vite : chaque jour compte.'], back); } },
          { label: 'Pas maintenant.', go: back },
        ],
      }),
    }];
  }

  /** Ce que dit un habitant de l'événement en cours chez lui. */
  private eventTalk(n: NPCData, ev: SlotPlan): string[] {
    const g = this.g, s = this.place(ev.sid), now = g.time.minutes, out: string[] = [];
    if (ev.kind === 'fête') {
      const d = this.deco(ev.sid), soon = ev.start > now;
      out.push(soon ? `${cap(this.feastName(ev))} commence ${Math.floor(ev.start / DAY) === g.time.day ? 'ce matin' : Math.floor(ev.start / DAY) === g.time.day + 1 ? 'demain' : 'après-demain'} : tout ${s.name} s’y prépare.`
        : ev.feast === 'patron' ? `C’est la ${ev.fem ? 'Sainte' : 'Saint'}-${ev.saint}, notre ${ev.fem ? 'sainte patronne' : 'saint patron'} ! On danse sur la place jusqu’au soir.`
          : ev.feast === 'moissons' ? 'Les blés sont rentrés : c’est la fête des moissons ! Cidre, pain d’épices et danses jusqu’à la nuit.'
            : `C’est jour de foire : des marchands sont venus de loin, il y en a pour toutes les bourses.`);
      if (d?.range) {
        const best = [...ev.rivals].sort((a, b) => b.score - a.score)[0];
        out.push(`Le concours de tir à l’arc se tient sur la place, ${direction(s.x, s.z, d.range.lx, d.range.lz).replace(/^au /, 'côté ').replace(/^à l'/, 'côté ')} : ${CONTEST_FEE} pièces l’inscription, ${ev.prize} au vainqueur.`);
        if (best) out.push(`${best.first} ${best.last} a fait ${best.score} points : ${best.fem ? 'elle sera dure' : 'il sera dur'} à battre !`);
      }
      if (ev.merchants > 1) out.push('Va voir les étals : on y trouve des choses qu’on ne voit jamais ici.');
    } else if (ev.kind === 'raid') {
      const res = raidResult(ev, this.outcomes.get(ev.id)), R = RAIDERS[ev.raider];
      if (this.phase(ev, now) === 'en cours') out.push(`${R.Des} attaquent ! Cache-toi, ou prends une arme !`);
      else if (res.k === 's') {
        out.push(`${R.Des} sont venus ${this.when(res.t)}, ${direction(s.x, s.z, ev.lx, ev.lz).replace(/^au /, 'du ').replace(/^à l'/, 'de l’')}. Ils ont tout pris.`);
        if (ev.burn.length) out.push(`${ev.burn.length > 1 ? `${ev.burn.length} maisons ont` : 'Une maison a'} brûlé. On rebâtira, comme toujours.`);
        const dead = this.victims.get(ev.id) ?? [];
        if (dead.length) out.push(`${this.joinNames(dead)} n’${dead.length > 1 ? 'ont' : 'a'} pas survécu. Que les saints ${dead.length > 1 ? 'les accueillent' : 'l’accueillent'}.`);
        out.push('Les vivres ont été volés : tout est hors de prix pour quelques jours.');
      } else out.push(`${R.Des} ont voulu nous piller, mais on les a repoussés.`);
    } else {
      const sickHere = bedridden(n, ev);
      out.push(sickHere ? `*tousse* ${cap(ev.disease)}… Je tiens à peine debout.` : `${cap(ev.disease)} est sur nous : la moitié du village garde le lit.`);
      const h = this.healer(ev.sid);
      out.push(h ? (h.id === n.id ? 'Je fais ce que je peux, mais les remèdes me manquent.' : `${h.first} ${h.last} cherche des remèdes contre la fièvre : va ${h.sex === 'f' ? 'la' : 'le'} voir, si tu veux aider.`) : 'Personne ici ne sait soigner ça. On prie.');
      out.push('Et ne traîne pas ici sans remède : ça s’attrape.');
    }
    return out;
  }

  private warTalk(n: NPCData, st: WarState): string[] {
    const A = this.fac(st.plan.a), B = this.fac(st.plan.b), out: string[] = [];
    if (!A || !B) return ['La guerre… Que les saints nous en préservent.'];
    out.push(`${cap(leF(A.name))} et ${leF(B.name)} se font la guerre depuis le jour ${st.plan.start}.`);
    const last = st.results[st.results.length - 1];
    if (last) {
      const T = this.place(last.sid), win = this.fac(last.win === 'a' ? last.atk : last.def);
      out.push(last.capture ? `${T.name} a changé de mains : la place est désormais ${win ? auF(win.name) : 'à l’ennemi'}.` : `On s’est battu devant ${T.name} : ${win ? leF(win.name) : 'personne'} l’a emporté.`);
    }
    const b = this.battleOn(this.g.time.day);
    if (b && this.phase(b, this.g.time.minutes) !== 'fini') out.push(`Aujourd’hui, on se bat devant ${this.place(b.sid).name}, ${direction(this.place(n.sid).x, this.place(n.sid).z, b.x, b.z)}, vers ${heure(b.start)}.`);
    const own = this.owner(n.sid);
    out.push(own === st.plan.a || own === st.plan.b ? 'Si tu sais te battre, nos soldats ne refuseront pas ton bras.' : 'Pourvu que ça ne vienne pas jusqu’ici.');
    return out;
  }
  private battleTalk(e: Entity): string[] {
    const t = e.event!, f = this.fac(t.side), L = this.live.get(e.zoneKey) as LiveBattle | undefined;
    if (L?.resolved) return t.routed ? ['C’est fini… On rentre.'] : ['La place est à nous ! Enfin, pour aujourd’hui.'];
    return [`Pour ${f ? leF(f.name) : 'le seigneur'} ! Ne reste pas planté là : prends une arme ou file !`];
  }
  private enlist(e: Entity, st: WarState, fid: number): DialogueNode {
    const g = this.g, f = this.fac(fid)!, d = g.dialogue, back = () => d.again(e);
    this.side = [st.plan.id, fid];
    g.rep.faction[fid] += 2;
    const wins = this.ranks.get(fid) ?? 0;
    this.say(`Vous vous engagez auprès ${deFaction(f.name)} (rang : ${rankOf(wins, false)}). Ses soldats vous tiennent pour l’un des leurs ; ceux de l’ennemi vous attaqueront à vue.`, C.yellow);
    this.log(`engagement auprès ${deFaction(f.name)} pour la guerre.`);
    return d.node(e, [`Bienvenue dans nos rangs ! Va aux combats : nos soldats sauront que tu es des nôtres.`, `Chaque victoire te vaudra une solde, et du galon si tu tiens bon.`], back);
  }

  /** « Parle-moi de toi », « Comment vont les affaires ? » : marchands de foire, soldats, boutiques fermées. */
  private talk(e: Entity, topic: 'about' | 'job'): string[] | undefined {
    const n = e.npc, t = e.event;
    if (!n) return undefined;
    if (t?.role === 'marchand') {
      const p = this.planById(t.id) as FeastPlan | null, s = this.place(n.sid);
      return topic === 'about' ? [`Je vais de foire en foire avec mon étal ; me voici à ${s.name} pour ${p ? this.feastName(p) : 'la fête'}.`, n.title?.startsWith('armuri') ? 'Mes arcs viennent de loin : regarde-moi ce bois d’if !' : n.title?.startsWith('épici') ? 'Goûte mon pain d’épices : tu m’en diras des nouvelles.' : 'Herbes, remèdes, élixirs : de quoi soigner tous les maux.']
        : ['Les jours de fête, les bourses se délient : je ne me plains pas.'];
    }
    if (t?.role === 'soldat') return this.battleTalk(e);
    if (topic === 'job' && this.closed(e)) {
      const ev = this.eventAt(n.sid) as EpidemicPlan;
      return bedridden(n, ev) ? ['*tousse* Je suis bien trop malade pour tenir boutique…', 'Reviens quand la fièvre sera passée.'] : [`Boutique fermée tant que ${ev.disease} est là : je ne veux voir personne.`, 'Reviens quand elle sera passée.'];
    }
    return undefined;
  }

  // ================================================================ fêtes : décor, concours de tir
  feastName(p: FeastPlan): string { return p.feast === 'patron' ? `la fête de la ${p.fem ? 'Sainte' : 'Saint'}-${p.saint}` : p.feast === 'moissons' ? 'la fête des moissons' : 'la foire'; }
  private feastTitle(p: FeastPlan): string { return p.feast === 'foire' ? 'JOUR DE FOIRE' : this.feastName(p).replace(/^la /, '').toUpperCase(); }

  /** Pas de tir du concours d'une place (piquet, direction, cibles) ; null : pas de concours possible ici. */
  contestRange(sid: number): Readonly<Range> | null { return this.deco(sid)?.range ?? null; }
  /** Étals de foire d'une place (emplacements des marchands). */
  stallCount(sid: number): number { return this.deco(sid)?.stalls.length ?? 0; }

  /** Décor d'une fête (une fois par place) : null sans place. */
  private deco(sid: number): Deco | null {
    let d = this.decos.get(sid);
    if (d !== undefined) return d;
    d = this.buildDeco(sid);
    if (d || this.g.world.chunks.chunkAt(this.place(sid).x, this.place(sid).z)) this.decos.set(sid, d);   // hauteurs exactes une fois le terrain chargé
    return d;
  }
  private buildDeco(sid: number): Deco | null {
    const g = this.g, L = this.cal.layout(sid), P = L?.plaza;
    if (!L || !P) return null;
    const h = (x: number, z: number) => g.world.heightAt(x, z);
    const inst: Inst[] = [], cols: CircleCollider[] = [];
    const add = (x: number, y: number, z: number, yaw: number, pitch: number, sx: number, sy: number, sz: number, color: number, mat: number, shape = 0) => {
      inst.push({ m: trsYawPitch(new Float32Array(16), x, y, z, yaw, pitch, sx, sy, sz), color, mat, shape });
    };
    // obstacles de la place : décors, bâtiments, tableau des primes et bannière (Exploits, Game)
    const obs: Obstacle[] = obstaclesOf(L);
    obs.push({ t: 'c', x: P.x - P.r * 0.6, z: P.z + P.r * 0.25, r: 1.4 }, { t: 'c', x: P.x + P.r * 0.55, z: P.z, r: 0.6 });
    const clear = (x: number, z: number, m: number) => { for (const o of obs) if (pushOut(o, x, z, m)) return false; return true; };
    // mât de fête
    let mast = { x: P.x, z: P.z };
    for (const [fx, fz] of [[-0.3, -0.45], [0.2, 0.5], [-0.45, 0.4], [0.45, -0.2], [0, -0.6], [-0.6, -0.1]]) {
      const x = P.x + fx * P.r, z = P.z + fz * P.r;
      if (clear(x, z, 1.4)) { mast = { x, z }; break; }
    }
    const my = h(mast.x, mast.z), top = my + 7.5;
    add(mast.x, my + 3.75, mast.z, 0, 0, 0.16, 7.5, 0.16, 0xc8b080, M.WOOD, SHAPE.CYL);
    add(mast.x, top + 0.2, mast.z, 0, 0, 0.5, 0.4, 0.5, 0x5a8a3a, M.FOLIAGE, SHAPE.SPHERE);   // couronne de feuillage
    for (let i = 0; i < 4; i++) add(mast.x, top - 0.6 - i * 0.25, mast.z, (i * Math.PI) / 2, 0.5, 0.05, 1.6, 0.05, [0xc83a2a, 0xe8c040, 0x3a6ac8, 0xe8e0d0][i], M.CLOTH);   // rubans
    obs.push({ t: 'c', x: mast.x, z: mast.z, r: 0.6 });
    cols.push({ x: mast.x, z: mast.z, r: 0.25, bottom: my, top: top, dyn: true });
    // ancrages : les maisons qui bordent la place, au niveau de l'égout du toit, du côté de la place
    const anchors: { x: number; y: number; z: number; a: number }[] = [];
    for (const b of L.buildings) {
      if (b.ruined || Math.hypot(b.x - P.x, b.z - P.z) > P.r + 18) continue;
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = P.x - b.x, dz = P.z - b.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c, k = Math.min(b.w / 2 / (Math.abs(lx) || 1e-6), b.d / 2 / (Math.abs(lz) || 1e-6));
      const ax = lx * k * 1.04, az = lz * k * 1.04, x = b.x + ax * c + az * s, z = b.z - ax * s + az * c;
      anchors.push({ x, y: buildingFloor(b, g.world.sampler) + b.wallH - 0.15, z, a: Math.atan2(z - P.z, x - P.x) });
    }
    anchors.sort((a, b) => a.a - b.a);
    const lanterns: Deco['lanterns'] = [];
    const COL = [0xc83a2a, 0xe8c040, 0x3a6ac8, 0x5a9a3a, 0xe8e0d0];
    const garland = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az), sag = 0.5 + len * 0.05, yaw = Math.atan2(bx - ax, bz - az), n = Math.max(2, Math.floor(len / 0.7));
      let px = ax, py = ay, pz = az;
      for (let i = 1; i <= n; i++) {
        const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ay + (by - ay) * t - sag * 4 * t * (1 - t);
        const dx = x - px, dy = y - py, dz = z - pz;
        add((x + px) / 2, (y + py) / 2, (z + pz) / 2, Math.atan2(dx, dz), Math.atan2(Math.hypot(dx, dz), dy), 0.025, Math.hypot(dx, dy, dz), 0.025, 0x8a7a5a, M.CLOTH, SHAPE.CYL);
        if (i < n) add(x, y - 0.17, z, yaw + Math.PI / 2, 0, 0.3, 0.32, 0.03, COL[i % COL.length], M.CLOTH);
        if (i % 6 === 3 && lanterns.length < 24) lanterns.push({ x, y: y - 0.35, z, m: trsYawPitch(new Float32Array(16), x, y - 0.35, z, 0, 0, 0.18, 0.24, 0.18) });
        px = x; py = y; pz = z;
      }
    };
    for (let i = 0; i < anchors.length && anchors.length > 1; i++) {
      const a = anchors[i], b = anchors[(i + 1) % anchors.length], d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d > 3 && d < 26 && (anchors.length > 2 || i === 0)) garland(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    // guirlandes rayonnant du mât vers une maison sur deux
    for (let i = 0; i < anchors.length; i += 2) { const a = anchors[i]; if (Math.hypot(a.x - mast.x, a.z - mast.z) < 26) garland(mast.x, top - 0.4, mast.z, a.x, a.y, a.z); }
    // pas de tir et cibles : la plus longue ligne dégagée qui part de la place
    let range: Range | null = null, bestLen = 0;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), ox = P.x + dx * P.r * 0.15, oz = P.z + dz * P.r * 0.15, oy = h(ox, oz);
      if (!clear(ox, oz, 1.2)) continue;
      let len = 0;
      for (let s = 1; s <= 26; s++) {
        const x = ox + dx * s, z = oz + dz * s, wt = g.world.waterAt(x, z);
        if (!clear(x, z, 1.1) || Math.abs(h(x, z) - oy) > 2 || (!Number.isNaN(wt) && wt > h(x, z) - 0.2)) break;
        len = s;
      }
      if (len > bestLen + 0.5) { bestLen = len; range = { lx: ox, ly: oy, lz: oz, dx, dz, len, targets: [] }; }
    }
    if (range && bestLen >= 12) {
      const r = range;
      obs.push({ t: 's', ax: r.lx, az: r.lz, bx: r.lx + r.dx * r.len, bz: r.lz + r.dz * r.len, r: 1.5 });
      add(r.lx, r.ly + 0.5, r.lz, 0, 0, 0.12, 1, 0.12, 0xd8c8a0, M.WOOD, SHAPE.CYL);   // piquet du pas de tir
      add(r.lx, r.ly + 1.05, r.lz, 0, 0, 0.3, 0.12, 0.3, 0xc83a2a, M.CLOTH);
      const rx = -r.dz, rz = r.dx;
      for (const [f, lat] of [[0.48, -1.2], [0.72, 1.4], [0.96, -0.3]]) {
        const x = r.lx + r.dx * r.len * f + rx * lat, z = r.lz + r.dz * r.len * f + rz * lat, y = h(x, z) + 1.25;
        const nx = r.lx - x, nz = r.lz - z, nl = Math.hypot(nx, nz) || 1;
        r.targets.push({ x, y, z, nx: nx / nl, nz: nz / nl });
        const yaw = Math.atan2(nx / nl, nz / nl);
        // botte de paille sur trépied, cercles peints
        for (const s of [-1, 1]) add(x - (nz / nl) * 0.45 * s, y - 0.65, z + (nx / nl) * 0.45 * s, yaw, 0.15 * s, 0.06, 1.35, 0.06, 0x6a4a2a, M.WOOD);
        add(x - (nx / nl) * 0.25, y - 0.6, z - (nz / nl) * 0.25, yaw, -0.35, 0.06, 1.3, 0.06, 0x6a4a2a, M.WOOD);
        add(x, y, z, yaw, Math.PI / 2, 1.3, 0.22, 1.3, 0xd8c070, M.THATCH, SHAPE.CYL);
        for (const [rad, col] of [[0.62, 0xe8e0d0], [0.34, 0x3a5ac8], [0.16, 0xd8302a]] as [number, number][]) add(x + (nx / nl) * 0.12, y, z + (nz / nl) * 0.12, yaw, Math.PI / 2, rad * 2, 0.02, rad * 2, col, M.CLOTH, SHAPE.CYL);
        cols.push({ x, z, r: 0.55, bottom: y - 1.3, top: y + 0.7, dyn: true });
      }
    } else range = null;
    // étals de foire : sur le pourtour de la place, tournés vers son centre
    const stalls: Deco['stalls'] = [];
    for (let k = 0; k < 16 && stalls.length < 3; k++) {
      const a = (k / 16) * Math.PI * 2 + 0.2, rr = Math.max(P.r * 0.82, P.r - 2.2), x = P.x + Math.cos(a) * rr, z = P.z + Math.sin(a) * rr;
      if (!clear(x, z, 2) || stalls.some((s) => Math.hypot(s.x - x, s.z - z) < 6) || Math.hypot(mast.x - x, mast.z - z) < 4) continue;
      if (range && Math.abs((x - range.lx) * -range.dz + (z - range.lz) * range.dx) < 3.5 && (x - range.lx) * range.dx + (z - range.lz) * range.dz > -3) continue;
      const y = h(x, z), yaw = Math.atan2(P.x - x, -(P.z - z)), fx = Math.sin(yaw), fz = -Math.cos(yaw), rx2 = Math.cos(yaw), rz2 = Math.sin(yaw);
      // l'étal : comptoir côté place, quatre poteaux, auvent rayé ; le marchand derrière
      const ry = -yaw;
      add(x + fx * 0.4, y + 0.5, z + fz * 0.4, ry, 0, 2.4, 1, 0.7, 0x7a5a36, M.PLANKS);
      for (const [lf, lr] of [[0.75, 1.15], [0.75, -1.15], [-0.9, 1.15], [-0.9, -1.15]]) add(x + fx * lf + rx2 * lr, y + 1.2, z + fz * lf + rz2 * lr, 0, 0, 0.08, 2.4, 0.08, 0x5a4030, M.WOOD);
      for (let i = 0; i < 5; i++) add(x + rx2 * (i - 2) * 0.5 - fx * 0.07, y + 2.45, z + rz2 * (i - 2) * 0.5 - fz * 0.07, ry, 0.18, 0.5, 0.05, 1.9, i % 2 ? 0xe8dcc0 : [0xc83a2a, 0x3a6ac8, 0x4a8a3a][stalls.length % 3], M.CLOTH);
      for (let i = 0; i < 3; i++) add(x + fx * 0.45 + rx2 * (i - 1) * 0.65, y + 1.1, z + fz * 0.45 + rz2 * (i - 1) * 0.65, 0, 0, 0.3, 0.2, 0.3, [0xd8a040, 0x8a3a2a, 0x6a8a3a][(i + stalls.length) % 3], M.ITEM, SHAPE.SPHERE);
      stalls.push({ x, y, z, yaw, sx: x - fx * 0.8, sz: z - fz * 0.8 });
      cols.push({ x: x + fx * 0.4, z: z + fz * 0.4, r: 0.9, bottom: y, top: y + 1.1, dyn: true });
      obs.push({ t: 'c', x, z, r: 2 });
    }
    return { inst, lanterns, stalls, range, mast, cols };
  }

  /** Le concours de tir : inscription au piquet, six flèches, cibles, classement contre les rivaux. */
  focus(): { f: Focus; d: number } | null {
    const g = this.g, p = g.player;
    if (g.dungeon) return null;
    const here = this.hereSid(), ev = here >= 0 ? this.eventAt(here) : null;
    if (!ev || ev.kind !== 'fête' || this.phase(ev, g.time.minutes) !== 'en cours') return null;
    const r = this.deco(here)?.range;
    if (!r) return null;
    const dx = r.lx - p.x, dz = r.lz - p.z, d = Math.hypot(dx, dz);
    if (d > 2.6 || Math.abs(r.ly - p.y) > 2.5) return null;
    const h = (g.time.minutes % DAY) / 60, best = [...ev.rivals].sort((a, b) => b.score - a.score)[0];
    const c = this.contest;
    if (c?.ev === ev.id) return { d: d - 1, f: { t: 'action', label: `Concours de tir : flèche ${Math.min(CONTEST_ARROWS, c.shots + 1)}/${CONTEST_ARROWS} · ${c.score} points`, hint: `À battre : ${best.score} points (${best.first} ${best.last}) · tirez d’ici`, muted: true, go: () => this.say(`Tirez sur les cibles depuis le piquet : ${CONTEST_ARROWS - c.shots} flèche${CONTEST_ARROWS - c.shots > 1 ? 's' : ''} à tirer.`, C.dim) } };
    if (this.done.has('concours:' + ev.id)) return { d: d - 1, f: { t: 'action', label: 'Concours de tir à l’arc : déjà disputé', muted: true, go: () => this.say('Une seule participation par fête.', C.dim) } };
    if (h < 9 || h >= 20) return { d: d - 1, f: { t: 'action', label: 'Concours de tir à l’arc : de 9 h à 20 h', muted: true, go: () => this.say('Le concours reprendra demain matin.', C.dim) } };
    return { d: d - 1, f: { t: 'action', label: `Concours de tir à l’arc : s’inscrire (${CONTEST_FEE} or)`, hint: `${CONTEST_ARROWS} flèches, trois cibles · à battre : ${best.score} points (${best.first} ${best.last}) · prix : ${ev.prize} or`, go: () => this.register(ev) } };
  }
  private register(ev: FeastPlan): void {
    const g = this.g, ch = g.character;
    const bows = [...ch.inv.items.keys()].filter((k) => item(k).weapon?.kind === 'arc' && (item(k).dur ?? 100) > 0).sort((a, b) => item(b).weapon!.damage - item(a).weapon!.damage);
    if (!bows.length) { this.say('Il vous faut un arc : le chasseur en vend, et parfois les marchands de foire.', C.orange); return; }
    if (ch.inv.gold < CONTEST_FEE) { this.say(`L’inscription coûte ${CONTEST_FEE} pièces.`, C.orange); return; }
    ch.inv.gold -= CONTEST_FEE;
    ch.inv.add('flèche', CONTEST_ARROWS);
    if (item(ch.equip.arme ?? '').weapon?.kind !== 'arc') ch.equipItem(bows[0]);
    this.contest = { ev: ev.id, sid: ev.sid, shots: 0, score: 0, hits: 0, pending: [], seen: new WeakSet() };
    for (const pr of g.fight.projectiles) this.contest.seen.add(pr);
    const best = [...ev.rivals].sort((a, b) => b.score - a.score)[0];
    g.audio.coin();
    this.say(`Inscrit au concours ! ${CONTEST_ARROWS} flèches (offertes), trois cibles de plus en plus loin : 10 points au cœur, bonus pour les cibles lointaines. À battre : ${best.score} points (${best.first} ${best.last}).`, C.yellow);
  }
  private abortContest(why: string): void { this.contest = null; this.say(why, C.dim); }
  private tickContest(): void {
    const c = this.contest, g = this.g;
    if (!c) return;
    const d = this.deco(c.sid), r = d?.range, p = g.player;
    if (!r) { this.contest = null; return; }
    if (Math.hypot(r.lx - p.x, r.lz - p.z) > 40 && !c.pending.length) { this.abortContest('Vous vous éloignez du pas de tir : votre inscription au concours est perdue.'); return; }
    // nouvelles flèches tirées depuis le piquet
    for (const pr of g.fight.projectiles) {
      if (c.seen.has(pr)) continue;
      c.seen.add(pr);
      if (pr.kind !== 'flèche' || pr.owner !== 'player' || c.shots >= CONTEST_ARROWS) continue;
      if (Math.hypot(r.lx - p.x, r.lz - p.z) > 3.5) { this.say('Tirez depuis le piquet du pas de tir pour que la flèche compte.', C.dim); continue; }
      c.shots++;
      c.pending.push({ pr, x: pr.x, y: pr.y, z: pr.z });
    }
    // flèches en vol : traversée du plan d'une cible
    for (let i = c.pending.length - 1; i >= 0; i--) {
      const a = c.pending[i], pr = a.pr;
      let hit = -1, pts = 0;
      for (let k = 0; k < r.targets.length && hit < 0; k++) {
        const t = r.targets[k];
        const s0 = (a.x - t.x) * t.nx + (a.z - t.z) * t.nz, s1 = (pr.x - t.x) * t.nx + (pr.z - t.z) * t.nz;
        if (!(s0 > 0 && s1 <= 0)) continue;
        const f = s0 / (s0 - s1), hx = a.x + (pr.x - a.x) * f, hy = a.y + (pr.y - a.y) * f, hz = a.z + (pr.z - a.z) * f;
        const rad = Math.hypot(hx - t.x, hy - t.y, hz - t.z), ring = ringScore(rad);
        if (!ring) continue;
        hit = k; pts = ring + TARGET_BONUS[k];
        pr.x = hx + t.nx * 0.05; pr.y = hy; pr.z = hz + t.nz * 0.05; pr.stuck = true; pr.life = Math.min(pr.life, 25);
      }
      if (hit >= 0) {
        c.pending.splice(i, 1); c.score += pts; c.hits++;
        const t = r.targets[hit];
        g.audio.thud({ x: t.x, y: t.y, z: t.z });
        if (pts >= 10) g.audio.cheer({ x: r.lx, y: r.ly + 1.5, z: r.lz });
        this.say(`${pts >= 12 ? 'En plein cœur ! ' : ''}+${pts} points (cible ${hit + 1}) · total ${c.score}`, pts >= 10 ? C.green : C.text);
        continue;
      }
      if (pr.stuck || pr.life <= 0 || !g.fight.projectiles.includes(pr)) { c.pending.splice(i, 1); this.say(`Manqué ! · total ${c.score}`, C.dim); continue; }
      a.x = pr.x; a.y = pr.y; a.z = pr.z;
    }
    if (c.shots >= CONTEST_ARROWS && !c.pending.length) this.finishContest(c);
  }
  private finishContest(c: Contest): void {
    const g = this.g, ev = this.planById(c.ev) as FeastPlan | null;
    this.contest = null;
    this.done.add('concours:' + c.ev);
    if (!ev) return;
    const s = this.place(ev.sid), rank = contestRank(c.score, ev.rivals), ch = g.character;
    const best = [...ev.rivals].sort((a, b) => b.score - a.score)[0];
    if (rank === 1) {
      const town = s.type === 'ville' || s.type === 'capitale' || ev.feast === 'foire';
      ch.inv.gold += ev.prize;
      if (town) ch.inv.add('arc de concours'); else { ch.inv.add('ruban de vainqueur'); ch.inv.add('flèche', 10); }
      g.rep.addLocal(ev.sid, 8);
      this.feed(`+ ${ev.prize} pièces d’or`, C.gold);
      this.feed(`+ ${town ? 'Arc de concours' : 'Ruban de vainqueur, 10 flèches'}`, 0x5a9ae8);
      g.audio.fanfare(); g.audio.cheer();
      g.banner = { text: 'VAINQUEUR DU CONCOURS', sub: `${c.score} points contre ${best.score} (${best.first} ${best.last}) · +${ev.prize} or · +8 réputation locale`, t: 7, color: C.gold };
      this.rumor(`Un voyageur a remporté le concours de tir de ${this.feastName(ev)} à ${s.name}, avec ${c.score} points !`, ev.sid, ev.id + ':concours');
      this.log(`vainqueur du concours de tir à ${s.name} (${c.score} points).`);
    } else if (rank === 2) {
      const gold = Math.max(5, Math.round(ev.prize / 3));
      ch.inv.gold += gold;
      g.rep.addLocal(ev.sid, 4);
      this.feed(`+ ${gold} pièces d’or`, C.gold);
      g.audio.cheer();
      this.say(`Deuxième place au concours (${c.score} points) : ${best.first} ${best.last} l’emporte avec ${best.score}. Vous gagnez ${gold} pièces (+4 réputation locale).`, C.yellow);
    } else {
      g.rep.addLocal(ev.sid, 1);
      this.say(`${rank}e place au concours (${c.score} points). Le public applaudit poliment (+1 réputation locale).`, C.dim);
    }
  }

  // ================================================================ rendu
  private fireOf(b: Building): Fire {
    const y = buildingFloor(b, this.g.world.sampler) + b.wallH + b.roofH * 0.55;
    return { b, x: b.x, y, z: b.z, yaw: b.yaw, w: Math.max(2, b.w * 0.8), t: 0, emitT: 0 };
  }
  /** Carcasse noircie d'une maison brûlée (rendu par le jeu, sans toucher à la génération). */
  private burntOf(sid: number, bid: number): Inst[] {
    const key = `${sid}:${bid}`;
    let list = this.burnt.get(key);
    if (list) return list;
    list = [];
    const b = this.cal.layout(sid)?.buildings[bid];
    if (!b) return list;
    const y0 = buildingFloor(b, this.g.world.sampler), H = b.wallH, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const W = (lx: number, lz: number) => [b.x + lx * c + lz * s, b.z - lx * s + lz * c] as const;
    const add = (x: number, y: number, z: number, yaw: number, pitch: number, sx: number, sy: number, sz: number, color: number, mat: number) =>
      list!.push({ m: trsYawPitch(new Float32Array(16), x, y, z, yaw, pitch, sx, sy, sz), color, mat, shape: 0 });
    // suie sur le haut des murs (juste devant les façades)
    const hw = b.w / 2 + 0.06, hd = b.d / 2 + 0.06;
    for (const [lx, lz, along] of [[0, -hd, true], [0, hd, true], [-hw, 0, false], [hw, 0, false]] as [number, number, boolean][]) {
      const [x, z] = W(lx, lz);
      add(x, y0 + H * 0.68, z, b.yaw, 0, along ? b.w + 0.1 : 0.05, H * 0.62, along ? 0.05 : b.d + 0.1, 0x1c1816, M.RUBBLE);
    }
    // toit calciné : deux pans noircis par-dessus le chaume, chevrons à nu
    const rw = (b.d + 0.8) / 2, rh = b.roofH, L = Math.hypot(rw, rh), slope = Math.atan2(rh, rw);
    for (const side of [-1, 1]) {
      const nzl = side * (rh / L), nyl = rw / L, [x, z] = W(0, side * rw / 2 + nzl * 0.08);
      add(x, y0 + H + rh / 2 + nyl * 0.08, z, b.yaw, side * slope, b.w + 0.9, 0.06, L + 0.05, 0x161210, M.RUBBLE);
      for (const lx of [-b.w / 3, 0, b.w / 3]) { const [cx, cz] = W(lx, side * rw / 2 + nzl * 0.2); add(cx, y0 + H + rh / 2 + nyl * 0.2, cz, b.yaw, side * slope, 0.14, 0.14, L * 0.9, 0x2a1e16, M.WOOD); }
    }
    this.burnt.set(key, list);
    return list;
  }

  render(ib: InstanceBuffer, cx: number, cz: number): void {
    const g = this.g;
    if (g.dungeon) return;
    const now = g.time.minutes, night = g.night() > 0.45, m = this.m4, t = g.elapsed;
    for (const ev of this.todayList()) {
      if (Math.abs(ev.x - cx) > 230 || Math.abs(ev.z - cz) > 230) continue;
      if (ev.kind === 'fête') {
        if (now < ev.start - 120 || now > feastEnd(ev, this.outcomes.get(ev.id)) + 60) continue;
        const d = this.deco(ev.sid);
        if (!d) continue;
        for (const it of d.inst) ib.add(it.m, it.color, it.mat, 0, 0, 1, it.shape);
        for (const l of d.lanterns) ib.add(l.m, night ? 0xffc860 : 0x8a6a3a, night ? M.GLOW : M.WOOD, 0, 0, 1, SHAPE.SPHERE);
      } else if (ev.kind === 'raid' && this.phase(ev, now) === 'suites') {
        for (const bid of ev.burn) for (const it of this.burntOf(ev.sid, bid)) ib.add(it.m, it.color, it.mat, 0, 0, 1, it.shape);
      }
    }
    // toits en flammes (raid incarné)
    for (const L of this.live.values()) {
      if (L.kind !== 'raid') continue;
      for (const f of L.fires) {
        if (f.t < 0 || Math.hypot(f.x - cx, f.z - cz) > 180) continue;
        const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
        for (let i = 0; i < 4; i++) {
          const lx = (i / 3 - 0.5) * f.w, k = 0.75 + 0.25 * Math.sin(t * (9 + i) + i * 1.7), grow = Math.min(1, f.t / 8);
          const x = f.x + lx * c, z = f.z - lx * s;
          ib.add(trsYawPitch(m, x, f.y + 0.7 * k * grow, z, t * 0.8 + i, 0, 1.1 * grow, 1.8 * k * grow, 1.1 * grow), 0xff7a20, M.FIRE, 0, 0, 1, SHAPE.CONE);
          ib.add(trsYawPitch(m, x, f.y + 0.5 * k * grow, z, -t + i, 0, 0.6 * grow, 1.1 * k * grow, 0.6 * grow), 0xffd060, M.GLOW, 0, 0, 1, SHAPE.CONE);
        }
      }
    }
  }

  /** Lumières : toits en feu, lanternes des fêtes la nuit (objets réutilisés d'une image à l'autre). */
  lights(): PointLight[] {
    const g = this.g, out = this.lightOut, p = g.player, t = g.elapsed, put = this.putLight;
    out.length = 0;
    if (g.dungeon) return out;
    for (const L of this.live.values()) if (L.kind === 'raid') for (const f of L.fires) {
      if (f.t < 0 || Math.hypot(f.x - p.x, f.z - p.z) > 120) continue;
      const k = (0.8 + 0.2 * Math.sin(t * 11 + f.x) * Math.sin(t * 7 + f.z)) * Math.min(1, f.t / 6);
      put(f.x, f.y + 1.5, f.z, 18, 2.4 * k, 1.1 * k, 0.4 * k);
    }
    if (g.night() > 0.45) {
      const here = this.hereSid(), ev = here >= 0 ? this.eventAt(here) : null;
      if (ev?.kind === 'fête' && this.phase(ev, g.time.minutes) === 'en cours') {
        const d = this.deco(here);
        if (d) for (const l of d.lanterns) { if (out.length >= 6) break; if (Math.hypot(l.x - p.x, l.z - p.z) < 45) put(l.x, l.y - 0.2, l.z, 7, 1.4, 1.0, 0.45); }
      }
    }
    return out;
  }

  private putLight = (x: number, y: number, z: number, radius: number, r: number, gg: number, b: number): void => {
    const out = this.lightOut, pool = this.lightPool;
    if (out.length >= pool.length) return;
    const l = pool[out.length]; l.x = x; l.y = y; l.z = z; l.radius = radius; l.r = r; l.g = gg; l.b = b; out.push(l);
  };

  /** Étals et cibles : obstacles (les mêmes objets à chaque image). */
  private pushColliders(): void {
    const g = this.g, here = this.hereSid();
    if (here < 0) return;
    const ev = this.eventAt(here);
    if (ev?.kind !== 'fête' || g.time.minutes < ev.start - 120 || g.time.minutes > feastEnd(ev, this.outcomes.get(ev.id)) + 60) return;
    const d = this.deco(here);
    if (d) for (const c of d.cols) if (Math.hypot(c.x - g.player.x, c.z - g.player.z) < 20) g.entities.dynamic.push(c);
  }

  /** Musique de fête : le joueur est sur la place d'une fête en cours, le jour. */
  festive(): boolean {
    const g = this.g, here = this.hereSid();
    if (here < 0 || g.dungeon) return false;
    const ev = this.eventAt(here), h = g.time.hour;
    return ev?.kind === 'fête' && this.phase(ev, g.time.minutes) === 'en cours' && h >= 8 && h < 23;
  }

  /** Ligne d'état du concours (HUD) ; null hors concours. */
  hudLine(): { text: string; color: number } | null {
    const c = this.contest;
    if (!c) return null;
    const ev = this.planById(c.ev) as FeastPlan | null, best = ev ? [...ev.rivals].sort((a, b) => b.score - a.score)[0] : null;
    return { text: `Concours de tir · flèches ${c.shots}/${CONTEST_ARROWS} · ${c.score} points${best ? ` · à battre : ${best.score}` : ''}`, color: C.yellow };
  }

  // ================================================================ carte et journal
  /** Propriétaire de chaque cellule macro : celui de l'implantation vivante la plus proche (1,1 km), sinon de la région. */
  territory(): { cells: Int8Array; ver: number } {
    if (this.terr && this.terr.ver === this.ownerVer) return this.terr;
    const civ = this.g.world.civ, N = MACRO;
    if (!this.nearSid) {
      const near = new Int16Array(N * N).fill(-1), dist = new Float32Array(N * N).fill(Infinity), R = Math.ceil(1100 / CELL);
      for (const s of civ.settlements) {
        if (!livingPlace(s)) continue;
        for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
          const i = s.ci + di, j = s.cj + dj;
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          const d = Math.hypot(di, dj);
          if (d > R) continue;
          const c = j * N + i;
          if (d < dist[c]) { dist[c] = d; near[c] = s.id; }
        }
      }
      this.nearSid = near;
    }
    const cells = this.terr?.cells ?? new Int8Array(N * N), near = this.nearSid;
    for (let c = 0; c < N * N; c++) cells[c] = near[c] >= 0 ? this.owner(near[c]) : civ.factionOfCell(c);
    this.terr = { cells, ver: this.ownerVer };
    return this.terr;
  }

  /** Marqueurs de la carte (M) : événements connus du jour (☼ raid, ♫ fête, † épidémie, ± bataille). */
  markers(): { x: number; z: number; glyph: string; color: number; name?: string }[] {
    const g = this.g;
    if (g.elapsed - this.markT < 0.5) return this.markCache;
    this.markT = g.elapsed;
    const out: { x: number; z: number; glyph: string; color: number; name?: string }[] = [], now = g.time.minutes;
    for (const ev of this.todayList()) {
      if (!this.known.has(ev.id)) continue;
      const ph = this.phase(ev, now);
      if (ph === 'fini' || (ev.kind === 'raid' && ph === 'à venir')) continue;
      const s = this.place(ev.sid);
      if (ev.kind === 'fête') out.push({ x: ev.x, z: ev.z, glyph: '♫', color: C.gold, name: `${ev.feast === 'foire' ? 'foire' : 'fête'} ${de(s.name).replace("d'", 'd’')}` });
      else if (ev.kind === 'raid') out.push({ x: ev.x, z: ev.z, glyph: '☼', color: ph === 'suites' ? 0xc06040 : C.red, name: ph === 'suites' ? 'village pillé' : 'raid' });
      else out.push({ x: ev.x, z: ev.z, glyph: '†', color: 0x80c060, name: 'épidémie' });
    }
    const b = this.battleOn(g.time.day);
    if (b && (this.known.has(b.id) || this.known.has(b.war)) && this.phase(b, now) !== 'fini') out.push({ x: b.x, z: b.z, glyph: '±', color: C.red, name: 'bataille' });
    for (const x of this.cal.dev) if (x.kind === 'bataille' && this.phase(x, now) !== 'fini') out.push({ x: x.x, z: x.z, glyph: '±', color: C.red, name: 'bataille' });
    this.markCache = out;
    return out;
  }

  /** Journal (J), section « Événements » : guerre, rangs, maladie, concours, événements connus, derniers faits. */
  journalLines(): { text: string; color: number }[] {
    const g = this.g, out: { text: string; color: number }[] = [], now = g.time.minutes, day = g.time.day;
    const w = this.currentWar();
    if (w) {
      const A = this.fac(w.plan.a), B = this.fac(w.plan.b);
      if (A && B) {
        out.push({ text: `Guerre : ${leF(A.name)} contre ${leF(B.name)}, depuis le jour ${w.plan.start}.`, color: C.red });
        const wa = w.results.filter((r) => (r.win === 'a' ? r.atk : r.def) === w.plan.a).length, wb = w.results.length - wa;
        const caps = w.results.filter((r) => r.capture).map((r) => `${this.place(r.sid).name} (${shortFaction(this.fac(r.atk)?.name ?? '')}, jour ${Math.floor(r.t / DAY)})`);
        if (w.results.length) out.push({ text: `Batailles : ${w.results.length} · victoires : ${shortFaction(A.name)} ${wa}, ${shortFaction(B.name)} ${wb}${caps.length ? ` · places prises : ${caps.join(', ')}` : ''}.`, color: C.text });
        const b = this.battleOn(day);
        if (b && this.phase(b, now) !== 'fini') out.push({ text: `Aujourd’hui : combats devant ${this.place(b.sid).name}, vers ${heure(b.start)} (${shortFaction(this.fac(b.attacker)?.name ?? '')} attaque).`, color: C.orange });
        if (this.side && this.side[0] === w.plan.id) { const f = this.fac(this.side[1]); if (f) out.push({ text: `Vous servez ${leF(f.name)} : ses soldats sont vos alliés, ceux de l’ennemi vous attaquent à vue.`, color: C.yellow }); }
      }
    }
    for (const [fid, wins] of this.ranks) { const f = this.fac(fid); if (f && wins > 0) out.push({ text: `${f.name} : rang ${rankOf(wins, false)} (${wins} victoire${wins > 1 ? 's' : ''}).`, color: C.green }); }
    if (this.sick) out.push({ text: `Malade : ${this.sick.nom} (endurance et soins réduits) jusqu’au jour ${Math.floor(this.sick.fin / DAY)}. Remède contre la fièvre : établi ou âtre de la guérisseuse (2 herbes médicinales + 1 écorce).`, color: C.orange });
    else if (now < this.immune) out.push({ text: `Protégé de la contagion jusqu’au jour ${Math.floor(this.immune / DAY)}, ${heure(this.immune)}.`, color: C.green });
    const hl = this.hudLine();
    if (hl) out.push(hl);
    const list: SlotPlan[] = [];
    for (let d = day - 1; d <= day + 2; d++) for (const p of this.cal.eventsOn(d, [])) if (this.known.has(p.id) && !list.includes(p) && this.phase(p, now) !== 'fini') list.push(p);
    list.sort((a, b) => a.start - b.start);
    for (const p of list.slice(0, 8)) {
      const s = this.place(p.sid), d0 = Math.floor(p.start / DAY), ph = this.phase(p, now);
      if (p.kind === 'raid' && ph === 'à venir') continue;   // un raid ne s'annonce pas
      if (p.kind === 'fête') out.push({ text: `${cap(this.feastName(p))} à ${s.name} : ${ph === 'à venir' ? `jour ${d0}` : 'en ce moment'}${this.deco(p.sid)?.range ? ` · concours de tir (${p.prize} or au vainqueur)` : ''}${p.merchants > 1 ? ' · marchands de foire' : ''}.`, color: C.gold });
      else if (p.kind === 'épidémie') out.push({ text: `Épidémie (${p.disease}) à ${s.name} depuis le jour ${d0} : la guérisseuse cherche des remèdes.`, color: 0x80c060 });
      else if (p.kind === 'raid') {
        const r = raidResult(p, this.outcomes.get(p.id));
        out.push({ text: ph === 'en cours' ? `Raid ${RAIDERS[p.raider].des.replace(/^des /, 'de ')} sur ${s.name} en ce moment !` : `${cap(RAIDERS[p.raider].des)} ont pillé ${s.name} ${this.when(r.t)}${p.burn.length ? ` : ${p.burn.length} maison${p.burn.length > 1 ? 's' : ''} brûlée${p.burn.length > 1 ? 's' : ''}` : ''}.`, color: C.orange });
      }
    }
    for (const l of this.journal) out.push({ text: l, color: C.dim });
    return out;
  }

  // ================================================================ sauvegarde
  toSave(): EventSave | undefined {
    const day = this.g.time.day, out: EventSave = { jour: this.doneDay };
    if (this.outcomes.size) out.out = [...this.outcomes].slice(-300).map(([id, o]) => [id, outcomeValue(o)] as [string, string]);
    if (this.known.size) out.vus = [...this.known].slice(-250);
    const fait = [...this.done].filter((k) => !k.startsWith('annonces:')).slice(-250);
    for (const [id, d] of this.applied) if (d >= day - 1) fait.push('ok:' + id);
    if (fait.length) out.fait = fait.slice(-300);
    if (this.sick) out.malade = { ...this.sick };
    if (this.immune > this.g.time.minutes) out.immun = this.immune;
    if (this.ranks.size) out.rangs = [...this.ranks];
    if (this.side) out.camp = [...this.side] as [string, number];
    if (this.remedies.size) out.remedes = [...this.remedies].map(([id, r]) => [id, r.ev, r.npc, r.need]);
    if (this.journal.length) out.journal = [...this.journal];
    return out;
  }
  /** Remise à zéro (chargement : le Game est réutilisé si la seed est la même). */
  reset(): void {
    const g = this.g;
    for (const L of [...this.live.values()]) this.deactivate(L, false);
    this.outcomes.clear(); this.applied.clear(); this.known.clear(); this.done.clear(); this.wars.clear(); this.battles.clear();
    this.ranks.clear(); this.side = null; this.sick = null; this.immune = 0; this.journal = []; this.contest = null; this.fleeing = [];
    g.quests.quests = g.quests.quests.filter((q) => q.kind !== 'épidémie');
    if (g.quests.tracked?.startsWith('épidémie:')) g.quests.tracked = null;
    this.remedies.clear(); this.crew.clear(); this.atCache.clear(); this.victims.clear();
    this.cal.forget();
    this.day = g.time.day; this.doneDay = this.day - 1; this.checkT = 0; this.markT = -1; this.dirty = true; this.ownerVer++; this.expo = 0; this.expoT = -1;
  }
  /** Restaure depuis une sauvegarde assainie, après les quêtes ; champ absent = état par défaut. */
  load(raw: unknown): void {
    const g = this.g, s = sanitizeEventSave(raw), day = g.time.day;
    for (const [id, v] of s.out) { const o = parseOutcome(v); if (o) this.outcomes.set(id, o); }
    for (const id of s.vus) this.known.add(id);
    for (const k of s.fait) { if (k.startsWith('ok:')) this.applied.set(k.slice(3), day); else this.done.add(k); }
    this.sick = s.malade; this.immune = s.immun;
    for (const [f, w] of s.rangs) if (this.fac(f)) this.ranks.set(f, w);
    this.side = s.camp;
    this.journal = s.journal;
    this.day = day;
    this.doneDay = s.jour >= 0 ? Math.min(s.jour, day - 1) : day - 1;
    // déjà traités : batailles résolues et événements des jours passés
    for (const [id, o] of this.outcomes) if (o.k === 'a' || o.k === 'd') this.applied.set(id, Math.floor(o.t / DAY));
    for (const [id, evId, npc, need] of s.remedes) {
      const p = this.planById(evId), n = g.entities.findNpc(npc);
      if (!p || p.kind !== 'épidémie' || !n?.alive || this.remedies.has(id)) continue;
      const q = this.remedyQuest(id, p, n, need);
      g.quests.quests.push(q);
      this.remedies.set(id, { ev: evId, npc, need, q });
    }
    this.ownerVer++; this.checkT = 0; this.dirty = true;
  }

  // ================================================================ console de développement
  dev(cmd: string, args: string[]): { text: string; err?: boolean }[] {
    const g = this.g, p = g.player, out: { text: string; err?: boolean }[] = [], say = (text: string, err = false) => out.push({ text, err });
    const civ = g.world.civ, now = g.time.minutes, a0 = (args[0] ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const nearest = (ok: (sid: number) => boolean) => {
      let best = -1, bd = Infinity;
      for (const s of civ.settlements) { if (!livingPlace(s) || !ok(s.id)) continue; const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; best = s.id; } }
      return best;
    };
    const label = (ev: EventPlan) => {
      const s = this.place(ev.sid), d = Math.round(Math.hypot(ev.x - p.x, ev.z - p.z)), o = this.outcomes.get(ev.id);
      const extra = ev.kind === 'raid' ? ` ${ev.count} ${ev.raider}s niv. ${ev.level}${ev.succeeds ? ' (réussit sans aide)' : ' (repoussé sans aide)'}${ev.burn.length ? ` · ${ev.burn.length} maison${ev.burn.length > 1 ? 's' : ''}` : ''}`
        : ev.kind === 'fête' ? ` ${ev.feast}${ev.merchants > 1 ? ` · ${ev.merchants} marchands` : ''}` : ev.kind === 'épidémie' ? ` ${ev.disease} (gravité ${ev.severity.toFixed(2)})`
          : ` ${shortFaction(this.fac(ev.attacker)?.name ?? '?')} → ${shortFaction(this.fac(ev.defender)?.name ?? '?')} (${ev.atk} contre ${ev.def}${ev.attackerWins ? ', l’attaquant gagne sans aide' : ''})`;
      return `${ev.id} ${ev.kind} · ${s.name} · ${this.phase(ev, now)} · j${Math.floor(ev.start / DAY)} ${heure(ev.start)} · ${d} m${extra}${o ? ` · issue ${o.k}` : ''}${this.live.has('e' + ev.id) ? ' · incarné' : ''}`;
    };
    if (g.dungeon && cmd !== 'evenements' && cmd !== 'événements' && cmd !== 'guerre' && cmd !== 'malade') { say('sortez du souterrain d’abord', true); return out; }
    switch (cmd) {
      case 'evenements': case 'événements': {
        const R = +args[0] || 3000, list: EventPlan[] = [];
        for (let d = g.time.day - 1; d <= g.time.day + 2; d++) for (const ev of this.cal.eventsOn(d, [])) if (!list.includes(ev) && Math.hypot(ev.x - p.x, ev.z - p.z) < R) list.push(ev);
        const b = this.battleOn(g.time.day);
        if (b) list.push(b);
        for (const x of this.cal.dev) if (x.kind === 'bataille' && !list.includes(x)) list.push(x);
        list.sort((a, b2) => a.start - b2.start);
        if (!list.length) say(`aucun événement à moins de ${R} m (hier à après-demain)`, true);
        for (const ev of list.slice(0, 16)) say(label(ev));
        const w = this.currentWar();
        say(w ? `guerre ${w.plan.id} : ${shortFaction(this.fac(w.plan.a)?.name ?? '')} contre ${shortFaction(this.fac(w.plan.b)?.name ?? '')}, jours ${w.plan.start}-${w.plan.end}${w.peace !== null ? ` (paix le jour ${w.peace})` : ''} · ${w.results.length} bataille(s)` : 'paix');
        say(`${this.live.size} incarné(s) · malade : ${this.sick ? this.sick.nom : 'non'} · saison : ${['printemps', 'été', 'automne', 'hiver'][Math.floor((((g.time.day % 40) + 40) % 40) / 10)]}`);
        break;
      }
      case 'evenement': case 'événement': {
        const kind = a0.startsWith('fe') || a0.startsWith('foi') || a0.startsWith('moi') || a0.startsWith('pat') ? 'fête' : a0.startsWith('ep') ? 'épidémie' : a0.startsWith('ba') || a0.startsWith('gu') ? 'bataille' : a0.startsWith('ra') || !a0 ? 'raid' : '';
        if (!kind) { say('usage : evenement <raid|fete|epidemie|bataille> [bandit|gobelin|loup|foire|moissons|patron]', true); break; }
        const a1 = (args[1] ?? '').toLowerCase();
        if (kind === 'bataille') { this.devBattle(say); break; }
        const sid = nearest((s) => kind !== 'fête' || !!this.cal.layout(s)?.plaza);
        if (sid < 0) { say('aucune implantation éligible', true); break; }
        const opt = kind === 'raid' ? { raider: (['bandit', 'gobelin', 'loup'].includes(a1) ? a1 : a0.includes('gob') ? 'gobelin' : a0.includes('loup') ? 'loup' : undefined) as Raider | undefined }
          : { feast: (a0.startsWith('foi') ? 'foire' : a0.startsWith('moi') ? 'moissons' : a0.startsWith('pat') ? 'patron' : ['foire', 'moissons', 'patron'].includes(a1) ? a1 : 'foire') as FeastPlan['feast'] };
        const ev = this.cal.spawnDev(kind as 'raid' | 'fête' | 'épidémie', sid, now, opt);
        if (!ev) { say('impossible ici', true); break; }
        this.dirty = true; this.checkT = 0; this.known.add(ev.id); this.decos.delete(sid);
        say(`${label(ev)}`);
        break;
      }
      case 'finir': {
        const id = args[0] && !['r', 's', 'a', 'd'].includes(args[0]) ? args[0] : '';
        const k = args.find((x) => ['r', 's', 'a', 'd'].includes(x));
        let ev: EventPlan | null = id ? this.planById(id) : null;
        if (!ev) {
          let bd = Infinity;
          const cands: EventPlan[] = [...this.todayList()];
          const b = this.battleOn(g.time.day); if (b) cands.push(b);
          for (const x of this.cal.dev) if (!cands.includes(x)) cands.push(x);
          for (const x of cands) { if (this.applied.has(x.id) || this.phase(x, now) !== 'en cours') continue; const d = Math.hypot(x.x - p.x, x.z - p.z); if (d < bd) { bd = d; ev = x; } }
        }
        if (!ev || this.applied.has(ev.id)) { say('aucun événement en cours à finir', true); break; }
        const kk = ev.kind === 'raid' ? (k === 's' ? 's' : 'r') : ev.kind === 'bataille' ? (k === 'd' ? 'd' : k === 'a' ? 'a' : ev.attackerWins ? 'a' : 'd') : ev.kind === 'épidémie' ? 'e' : 'f';
        this.resolve(ev, kk);
        say(`${ev.id} fini (${kk})`);
        break;
      }
      case 'proprietaire': case 'propriétaire': {
        const q = (args[0] ?? '').toLowerCase();
        const s = !q ? civ.settlements[nearest(() => true)] : civ.settlements.find((x) => String(x.id) === q || x.name.toLowerCase().includes(q));
        if (!s) { say('lieu inconnu (nom ou id)', true); break; }
        const fq = (args[1] ?? '').toLowerCase();
        if (fq === 'reset' || fq === 'origine') { g.state.flags.delete('owner:' + s.id); g.coop?.fact('flag:owner:' + s.id, null); this.onOwnerFact(s.id); say(`${s.name} : retour au propriétaire d’origine (${this.fac(s.factionId)?.name ?? '—'})`); break; }
        const f = civ.factions.find((x) => String(x.id) === fq || (fq && x.name.toLowerCase().includes(fq)))
          ?? civ.factions.find((x) => x.kind === 'royaume' && x.id !== this.owner(s.id));
        if (!f) { say('faction inconnue (id ou nom)', true); break; }
        this.setOwner(s.id, f.id);
        say(`${s.name} appartient maintenant à ${f.name} (tabards, bannières, prix, carte)`);
        break;
      }
      case 'guerre': {
        if (a0 === 'paix') {
          const w = this.currentWar();
          if (!w) { say('aucune guerre en cours', true); break; }
          w.peace = g.time.day; w.ended = true; this.peace(w, true); this.battles.clear(); this.dirty = true;
          if (this.cal.devWar?.id === w.plan.id) this.cal.devWar = null;
          say('paix signée');
          break;
        }
        if (a0 === 'declarer' || a0 === 'declare') {
          if (this.currentWar()) { say('une guerre est déjà en cours (guerre paix)', true); break; }
          const sid = nearest(() => true), own = sid >= 0 ? this.owner(sid) : -1;
          const pair = this.cal.hostile().find(([a, b]) => a === own || b === own) ?? this.cal.hostile()[0];
          const enemy = pair ? (pair[0] === own ? pair[1] : pair[0]) : civ.factions.find((f) => f.kind === 'royaume' && f.id !== own)?.id ?? -1;
          if (own < 0 || enemy < 0) { say('pas de faction ennemie', true); break; }
          const w = this.cal.declareDev(enemy, own, g.time.day);
          this.battles.clear();
          this.declare(this.warState(w), true);
          say(`guerre ${w.id} : ${this.fac(enemy)?.name} contre ${this.fac(own)?.name}, jours ${w.start}-${w.end}`);
          break;
        }
        const w = this.currentWar();
        say(w ? `guerre ${w.plan.id} : ${this.fac(w.plan.a)?.name} contre ${this.fac(w.plan.b)?.name}, jours ${w.plan.start}-${w.plan.end} · ${w.results.length} bataille(s) · camp : ${this.side ? this.fac(this.side[1])?.name : 'aucun'}` : 'paix (guerre declarer : en déclarer une)');
        break;
      }
      case 'malade': {
        if (a0.startsWith('gu')) { this.cure(); say('guéri'); break; }
        this.catchSickness(a0 ? args.join(' ') : 'la fièvre des marais');
        say('malade');
        break;
      }
    }
    return out;
  }
  /** Bataille immédiate devant la place la plus proche (déclare une guerre de console si besoin). */
  private devBattle(say: (t: string, err?: boolean) => void): void {
    const g = this.g, civ = g.world.civ, p = g.player;
    let target = -1, bd = Infinity;
    for (const s of civ.settlements) { if (!livingPlace(s)) continue; const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; target = s.id; } }
    if (target < 0) { say('aucune implantation', true); return; }
    const own = this.owner(target);
    let w = this.currentWar()?.plan ?? null;
    if (!w || (w.a !== own && w.b !== own)) {
      const pair = this.cal.hostile().find(([a, b]) => a === own || b === own);
      const enemy = pair ? (pair[0] === own ? pair[1] : pair[0]) : civ.factions.find((f) => f.kind === 'royaume' && f.id !== own)?.id ?? -1;
      if (enemy < 0) { say('pas de faction ennemie', true); return; }
      w = this.cal.declareDev(enemy, own, g.time.day);
      this.battles.clear();
      this.declare(this.warState(w), true);
    }
    const atk = w.a === own ? w.b : w.a;
    // point de départ : une voisine par la route (de préférence à l'attaquant), sinon la route la plus proche
    let road = -1, from = -1;
    for (const r of civ.roads) {
      const o = r.a === target ? r.b : r.b === target ? r.a : -1;
      if (o < 0 || !livingPlace(civ.settlements[o])) continue;
      if (from < 0 || (this.owner(o) === atk && this.owner(from) !== atk)) { from = o; road = r.id; }
    }
    if (from < 0) { say('aucune route vers cette place', true); return; }
    const plan = this.cal.spawnDevBattle({ ...w, a: atk, b: own }, target, from, road, g.time.minutes);
    plan.war = w.id;
    this.known.add(plan.id); this.checkT = 0;
    say(`bataille ${plan.id} devant ${civ.settlements[target].name} : ${shortFaction(this.fac(atk)?.name ?? '')} (${plan.atk}) contre ${shortFaction(this.fac(own)?.name ?? '')} (${plan.def}), à ${Math.round(Math.hypot(plan.x - p.x, plan.z - p.z))} m`);
  }
}
