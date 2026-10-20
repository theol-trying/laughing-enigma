import { Entity } from '@ascii-fort/sim/entities/Entity';
import type { NPCData } from '@ascii-fort/sim/entities/NPC';
import { humanoid, drawModel, wagonModel, draughtModel, WAGON_WHEEL, type ModelDef, type Pose } from '@ascii-fort/sim/entities/Models';
import { makeMonster } from '@ascii-fort/sim/entities/Monster';
import type { ConvoyHost } from '@ascii-fort/sim/entities/EntityManager';
import { updateConvoyMember, type ConvoyAICtx } from '@ascii-fort/sim/ai/ConvoyAI';
import { turn } from '@ascii-fort/sim/ai/MonsterAI';
import {
  Traffic, memberLook, convoyStock, wreckLoot, partitif, parseOutcome, outcomeValue, sanitizeConvoySave, emptyState, MAX_COURSES, WRECK_DAYS,
  type ConvoyPlan, type ConvoyState, type ConvoyKind, type Outcome, type MemberSpec, type ConvoySave, type SavedCourse, type Nearby,
} from '@ascii-fort/sim/gameplay/Caravans';
import type { Quest } from '@ascii-fort/sim/gameplay/QuestSystem';
import { direction, type DialogueHooks, type DialogueNode, type DialogueOption } from '@ascii-fort/sim/gameplay/Dialogue';
import { GOOD_NAMES } from '@ascii-fort/sim/gameplay/Economy';
import { deFaction, cap } from '@ascii-fort/sim/gameplay/Chains';
import { de } from '@ascii-fort/worldgen/civilization/Names';
import type { Good } from '@ascii-fort/worldgen/civilization/types';
import { MACRO, CELL } from '@ascii-fort/worldgen/constants';
import { C } from '@ascii-fort/ascii-engine/TextGrid';
import { M } from '@ascii-fort/ascii-engine/Materials';
import { SHAPE } from '@ascii-fort/ascii-engine/Shapes';
import { trsYawPitch, mat4 } from '@ascii-fort/core/math';
import type { InstanceBuffer } from '@ascii-fort/ascii-engine/Renderer';
import type { CircleCollider } from '@ascii-fort/worldgen/Chunk';
import type { Game, Focus } from './Game';

/** Incarnation des convois : à moins d'ACTIVATE m du joueur, retirés au-delà de DEACTIVATE m (au plus MAX_LIVE à la fois). */
const ACTIVATE = 220, DEACTIVATE = 300, MAX_LIVE = 4;
/** Rayon des convois signalés sur la carte, distance entre le chariot et sa bête de trait (m). */
const MARK_R = 650, HITCH = 3.3;
const DAY = 1440;
const KIND_NAME: Record<ConvoyKind, string> = { caravane: 'caravane', pèlerins: 'pèlerins', colporteur: 'colporteur', messager: 'messager', patrouille: 'patrouille' };
const e_ = (f: boolean) => (f ? 'e' : '');
/** « d’Aubin », « de Mathieu » : élision devant une voyelle ou un h muet. */
const deNom = (n: string) => (/^[AEIOUYÉÈÊÂÎÔŒH]/i.test(n) ? `d’${n}` : `de ${n}`);
/** « de grain », « d’étoffe », « d’herbes » (après « manquer »). */
const deBien = (g: Good) => { const n = GOOD_NAMES[g].replace(/^(le |la |les |l')/, ''); return /^[aeiouyéèêâîôœh]/i.test(n) ? `d’${n}` : `de ${n}`; };

interface Live {
  plan: ConvoyPlan; zone: string; st: ConvoyState;
  /** bandits apparus, le joueur a aidé (coup porté à un brigand), secondes de pillage sans défenseur, vague de bandits */
  spawned: boolean; helped: boolean; loot: number; wave: number;
  /** pose visible du chariot (ou du meneur) : position, cap, hauteur ; prête après la première image */
  x: number; z: number; h: number; y: number; ready: boolean;
  pose: Pose; apose: Pose;
  /** bêtes de trait (deux mules côte à côte, ou un cheval) */
  bx: number; bz: number; by: number;
  /** campement (feu) et place du bas-côté choisie pour la nuit ou l'épave */
  fire: { x: number; y: number; z: number } | null; camp: { u: number; x: number; z: number } | null; smokeT: number;
  /** obstacles du chariot et des bêtes (réutilisés d'une image à l'autre) ; saut de position (temps qui file) : les membres suivent */
  cols: CircleCollider[]; snap: boolean;
}
interface Wreck { x: number; y: number; z: number; h: number }
interface CourseRec { c: SavedCourse; q: Quest; late: boolean }

const pose = (): Pose => ({ walk: 0, swing: 0, dead: 0, hover: 0, block: 0 });

/**
 * Convois des routes : caravanes, pèlerins, colporteurs, messagers et patrouilles (logique pure : sim/gameplay/Caravans.ts,
 * IA des membres : sim/ai/ConvoyAI.ts). Ici : incarnation près du joueur (zones d'autorité « v<id> »), chariot et bêtes de
 * trait, campement, embuscades (bandits, issue, récompense), épaves, prix et rumeurs, dialogues, courses de messager,
 * carte, journal, sauvegarde et console. En ligne, l'issue d'une embuscade est un fait partagé « conv:<id> ».
 */
export class Convoys implements ConvoyHost {
  readonly traffic: Traffic;
  readonly hooks: DialogueHooks;
  readonly live = new Map<string, Live>();
  /** issues observées (localement ou par un fait partagé) ; les autres se déduisent du temps */
  private outcomes = new Map<string, Outcome>();
  /** conséquences déjà appliquées (prix, rumeurs, récompense) par convoi */
  private applied = new Set<string>();
  /** membres tués (sauvegarde) */
  private dead = new Set<string>();
  /** remises durables par maison de négoce « m<lieu>:<maison> » */
  readonly remises = new Map<string, number>();
  private courses = new Map<string, CourseRec>();
  /** convois rencontrés (carte) */
  private met = new Set<string>();
  /** pillages connus (observés ou rapportés) : épaves et nouvelles de la route */
  private pillages: { plan: ConvoyPlan; t: number; x: number; z: number }[] = [];
  private wrecks: Nearby[] = [];
  private wreckAt = new Map<string, Wreck>();
  private models = new Map<string, ModelDef>();
  private decks = new Map<number, { x: number; z: number; s: number; c: number; hl: number; hw: number; y: number }[]>();
  private fleeing: { e: Entity; t: number }[] = [];
  private day: number;
  /** dernier jour dont les pillages sans témoin ont été traités (prix, rumeurs) */
  private doneDay: number;
  private checkT = 0;
  private markT = -1; private markCache: { x: number; z: number; glyph: string; color: number; name?: string }[] = [];
  private journal: string[] = [];
  private actx: ConvoyAICtx;
  private m4 = mat4();
  private wreckPose: Pose = { walk: 0, swing: 0, dead: 1, hover: 0.9, block: 0 };

  constructor(private g: Game) {
    this.traffic = new Traffic(g.world.civ, g.seed, g.world.civWorld.layouts, (sid) => !g.entities.clearedCamps.has(sid));
    this.day = g.time.day; this.doneDay = this.day - 1;
    this.hooks = { menu: (e) => this.menu(e), road: (e, t) => this.roadTalk(e, t) };
    this.actx = {
      player: g.player, combat: g.combat, get ents() { return g.entities.entities; },
      ground: (x, z, y) => g.entities.ground(x, z, y), walk: (e, mx, mz) => g.entities.walk(e, mx, mz),
    };
    g.rep.lasting = (n) => this.priceMult(n);
    g.events.on('entity:damaged', (d) => {
      if (!d.sourceId || (d.sourceId !== 'player' && !d.sourceId.startsWith('ally:'))) return;
      const m = /^(v[^:]+):b\d+$/.exec(d.targetId), L = m ? this.live.get(m[1]) : undefined;
      if (L) L.helped = true;
    });
    g.events.on('entity:killed', (k) => { if (k.kind === 'npc' && /^v[^:]+:\d+$/.test(k.victimId)) this.dead.add(k.victimId); });
    g.events.on('player:crime', (c) => this.onCrime(c));
    // camp démantelé : plus d'embuscade près de lui dans les jours qui viennent
    g.events.on('camp:cleared', ({ campId }) => { const poi = g.world.civ.pois.find((x) => x.settlementId === campId && x.kind === 'camp de bandits'); if (poi && poi.roadId >= 0) this.traffic.forgetRoad(poi.roadId, g.time.day + 1); });
    g.events.on('quest:completed', ({ questId }) => {
      const r = this.courses.get(questId);
      if (!r) return;
      this.courses.delete(questId);
      this.log(`Pli remis à ${r.q.target?.label ?? 'son destinataire'}.`);
    });
  }

  private say(text: string, color: number = C.text) { this.g.events.emit('message', { text, color }); }
  private feed(text: string, color: number) { const f = this.g.lootFeed; f.push({ text, color, t: performance.now() }); if (f.length > 8) f.splice(0, f.length - 8); }
  private log(text: string) { this.journal.unshift(`Jour ${this.g.time.day} : ${text}`); if (this.journal.length > 5) this.journal.length = 5; }
  outcome(id: string): Outcome | undefined { return this.outcomes.get(id); }
  private planOf(n: NPCData | undefined): ConvoyPlan | undefined { return n?.road ? this.traffic.plan(n.road.convoy) : undefined; }
  private specOf(n: NPCData): MemberSpec | undefined { const p = this.planOf(n); return p ? this.traffic.members(p).find((m) => m.id === n.id) : undefined; }

  // ================================================================ hôte des entités (EntityManager)
  npc(id: string): NPCData | undefined {
    const i = id.lastIndexOf(':');
    if (i < 2 || !/^\d+$/.test(id.slice(i + 1))) return undefined;
    const p = this.traffic.plan(id.slice(1, i));
    return p ? this.traffic.members(p).find((m) => m.id === id)?.npc : undefined;
  }
  puppet(zone: string, id: string, type: string, x: number, z: number): Entity | null {
    const L = this.live.get(zone), p = L?.plan ?? this.traffic.plan(zone.slice(1));
    if (!p) return null;
    if (type === 'bandit' || type === 'chef bandit') {
      if (L) L.spawned = true;
      return makeMonster(id, type, x, z, x, z, 60, { level: p.ambush?.level ?? p.level, lair: zone });
    }
    const m = this.traffic.members(p).find((q) => q.id === id);
    return m ? this.memberEntity(p, m) : null;
  }
  step(e: Entity, dt: number): void { updateConvoyMember(e, dt, this.actx); }

  private factionColor(sid: number): number { return this.g.world.civ.factions[this.g.ownerOf(sid)]?.color ?? 0x6a2a2a; }
  private memberEntity(p: ConvoyPlan, m: MemberSpec): Entity {
    const key = `${m.id}|${this.factionColor(p.from)}`;
    let model = this.models.get(key);
    if (!model) { model = humanoid(memberLook(m, this.factionColor(p.from), 0x3a2a4a)); this.models.set(key, model); }
    const e = new Entity(m.id, 'npc', m.role, `${m.npc.first} ${m.npc.last}`, model, m.max);
    e.hp = Math.max(1, Math.min(m.max, m.npc.hp));
    e.npc = m.npc; e.sid = m.npc.sid; e.speed = p.speed;
    e.thinkT = (m.v % 10) / 25;
    e.convoy = { id: p.id, role: m.role, slot: Number(m.id.slice(m.id.lastIndexOf(':') + 1)), dmg: m.dmg, fighter: m.fighter, tx: 0, tz: 0, face: null, speed: p.speed, lie: false, watch: false, threat: null, fx: 0, fz: 0 };
    return e;
  }

  // ================================================================ boucle
  tick(dt: number): void {
    const g = this.g, now = g.time.minutes;
    if (g.time.day !== this.day) this.newDay(g.time.day);
    // brigands en fuite (embuscade terminée) : ils quittent la partie une fois loin
    if (this.fleeing.length) {
      const p = g.player;
      for (const f of this.fleeing) f.t -= dt;
      const gone = this.fleeing.filter((f) => f.t <= 0 || !f.e.alive || !g.entities.has(f.e) || Math.hypot(f.e.x - p.x, f.e.z - p.z) > 40);
      for (const f of gone) if (f.e.alive && g.entities.has(f.e) && (!f.e.zoneKey || g.entities.simulates(f.e.zoneKey))) g.entities.dismiss(f.e);
      this.fleeing = this.fleeing.filter((f) => !gone.includes(f));
    }
    if (g.dungeon) { if (this.live.size) this.deactivateAll(); return; }
    if ((this.checkT -= dt) <= 0) { this.checkT = 1; this.refresh(now); }
    for (const L of this.live.values()) this.updateLive(L, dt, now);
  }

  /** Une fois par seconde : convois à incarner ou à retirer, épaves proches, convois rencontrés. */
  private refresh(now: number): void {
    const g = this.g, p = g.player;
    const near = this.traffic.near(p.x, p.z, now, DEACTIVATE + 40, (id) => this.outcomes.get(id));
    this.wrecks = near.filter((n) => n.st.mode === 'épave' && n.d < 200);
    // les plus proches d'abord (les convois de la console avant tout) ; MAX_LIVE au plus
    const want = near.filter((n) => n.st.mode !== 'épave' && n.d < ACTIVATE).sort((a, b) => (a.plan.id.startsWith('d') ? 0 : 1) - (b.plan.id.startsWith('d') ? 0 : 1) || a.d - b.d).slice(0, MAX_LIVE);
    for (const n of near) if (n.d < 120 && n.st.mode !== 'épave') this.met.add(n.plan.id);
    for (const L of [...this.live.values()]) {
      const n = near.find((x) => x.plan === L.plan);
      // incarné jusqu'à DEACTIVATE m (un convoi pillé aussi : survivants, cadavres) ; arrivé, à l'auberge ou parti : retiré
      if (!n || n.d > DEACTIVATE) this.deactivate(L, true);
    }
    for (const n of want) {
      if (this.live.has('v' + n.plan.id)) continue;
      if (this.live.size >= MAX_LIVE) {
        // place prise par un convoi plus lointain qui n'est plus voulu (jamais en plein combat)
        let far: Live | null = null, fd = -1;
        for (const L of this.live.values()) {
          if (want.some((w) => w.plan === L.plan) || L.st.mode === 'embuscade') continue;
          const d = Math.hypot(L.x - p.x, L.z - p.z);
          if (d > fd) { fd = d; far = L; }
        }
        if (!far) continue;
        this.deactivate(far, true);
      }
      this.activate(n);
    }
  }

  private activate(n: Nearby): void {
    const g = this.g, p = n.plan, zone = 'v' + p.id;
    const L: Live = {
      plan: p, zone, st: emptyState(), spawned: false, helped: false, loot: 0, wave: 0,
      x: n.st.x, z: n.st.z, h: n.st.h, y: 0, ready: false, pose: pose(), apose: pose(), bx: 0, bz: 0, by: 0, fire: null, camp: null, smokeT: 0,
      cols: [0, 1, 2, 3].map(() => ({ x: 0, z: 0, r: 1, bottom: 0, top: 0, dyn: true })), snap: false,
    };
    this.live.set(zone, L);
    const ents = this.traffic.members(p).filter((m) => m.npc.alive && !this.dead.has(m.id)).map((m) => this.memberEntity(p, m));
    g.entities.addConvoy(zone, ents);
    this.updateLive(L, 0, g.time.minutes);
    for (const e of ents) {
      const c = e.convoy!;
      e.x = c.tx; e.z = c.tz; e.heading = c.face ?? L.h;
      e.y = g.entities.ground(e.x, e.z, g.world.heightAt(e.x, e.z) + 2);
      if (c.lie) e.pose.dead = 1;
    }
  }

  /** Retire un convoi ; en plein combat (et si on le simule), l'issue se décide sur les forces en présence. */
  private deactivate(L: Live, resolve: boolean): void {
    const g = this.g, list = g.entities.convoys.get(L.zone) ?? [];
    if (resolve && L.st.mode === 'embuscade' && L.spawned && g.entities.simulates(L.zone) && !this.outcomes.has(L.plan.id)) {
      let bandits = 0, guard = 0;
      for (const e of list) {
        if (!e.alive) continue;
        if (e.mon && !e.mon.yielded) bandits++;
        else if (e.convoy) guard += e.convoy.fighter ? 1.5 : 0.3;
      }
      this.resolve(L.plan, bandits === 0 || guard >= bandits ? 's' : 'p', g.time.minutes);
    }
    for (const e of list) if (e.npc && e.convoy) e.npc.hp = e.alive ? Math.round(e.hp) : 0;
    this.fleeing = this.fleeing.filter((f) => f.e.zoneKey !== L.zone);
    g.entities.removeConvoy(L.zone);
    this.live.delete(L.zone);
  }
  deactivateAll(): void { for (const L of [...this.live.values()]) this.deactivate(L, true); }
  /** Souterrain : les convois quittent la simulation (l'issue d'un combat en cours se décide). */
  onWorldChange(): void { this.deactivateAll(); this.checkT = 0; }

  // ---------------------------------------------------------------- un convoi incarné, à chaque image
  private updateLive(L: Live, dt: number, now: number): void {
    const g = this.g, p = L.plan, st = this.traffic.stateAt(p, now, this.outcomes.get(p.id), L.st), mode = st.mode;
    const list = g.entities.convoys.get(L.zone);
    if (!list) { this.live.delete(L.zone); return; }   // zone retirée par ailleurs (sécurité)
    const sim = g.entities.simulates(L.zone);
    if (mode === 'embuscade') {
      if (!L.spawned) for (const e of list) if (e.mon && e.alive && !e.mon.yielded) { L.spawned = true; break; }
      if (!L.spawned && sim && !this.outcomes.has(p.id)) this.ambush(L, list);
      else if (L.spawned && sim && !this.outcomes.has(p.id)) this.judge(L, list, dt, now);
    }
    // cible : sur la route, ou sur le bas-côté (campement de nuit, épave)
    let tx = st.x, tz = st.z;
    if (mode === 'halte' || mode === 'épave') {
      if (!L.camp || Math.abs(L.camp.u - st.u) > 2) { const s = this.shoulder(p, st.x, st.z, st.h); L.camp = { u: st.u, x: s.x, z: s.z }; }
      tx = L.camp.x; tz = L.camp.z;
    }
    const dx = tx - L.x, dz = tz - L.z, d = Math.hypot(dx, dz);
    let moved = 0;
    if (!L.ready || d > 40) { L.snap = L.ready; L.x = tx; L.z = tz; L.h = st.h; L.ready = true; }
    else if (d > 0.005) { const k = Math.min(1, (Math.max(p.speed * 1.6, 2.4) * dt) / d); L.x += dx * k; L.z += dz * k; moved = d * k; }
    L.h = turn(L.h, st.h, Math.min(1, dt * 2.5));
    const fx = Math.sin(L.h), fz = -Math.cos(L.h), rx = Math.cos(L.h), rz = Math.sin(L.h);
    if (p.animal) {
      const yF = this.yAt(p.road, L.x + fx, L.z + fz), yB = this.yAt(p.road, L.x - fx, L.z - fz);
      L.y = (yF + yB) / 2;
      L.pose.block = Math.max(-0.35, Math.min(0.35, Math.atan2(yF - yB, 2)));
      L.pose.walk += moved / WAGON_WHEEL.rear;
      const wreck = mode === 'épave';
      L.pose.dead = wreck ? Math.min(1, L.pose.dead + dt / 1.2) : Math.max(0, L.pose.dead - dt);
      L.pose.hover = L.pose.dead * 0.9;
      L.bx = L.x + fx * HITCH; L.bz = L.z + fz * HITCH; L.by = this.yAt(p.road, L.bx, L.bz);
      if (moved > 0) L.apose.walk += moved * 2.2; else L.apose.walk *= 0.85;
    } else L.y = this.yAt(p.road, L.x, L.z);
    // campement : un feu derrière le chariot (ou au milieu des marcheurs), sur le bas-côté
    if (mode === 'halte') {
      const back = p.animal ? 4.6 : 1.5, x = L.x - fx * back, z = L.z - fz * back;
      if (!L.fire || Math.hypot(L.fire.x - x, L.fire.z - z) > 0.5) L.fire = { x, z, y: this.yAt(p.road, x, z) };
      if ((L.smokeT -= dt) <= 0) {
        L.smokeT = 0.7;
        if (Math.hypot(L.fire.x - g.player.x, L.fire.z - g.player.z) < 80) { g.particles.emit('fumée', L.fire.x, L.fire.y + 1.1, L.fire.z, 1); if (Math.random() < 0.3) g.particles.emit('étincelle', L.fire.x, L.fire.y + 0.5, L.fire.z, 2); }
      }
    } else L.fire = null;
    this.slots(L, list, mode, fx, fz, rx, rz);
    // obstacles : le chariot et ses bêtes arrêtent le joueur (et les créatures)
    const pl = g.player;
    if (p.animal && Math.hypot(L.x - pl.x, L.z - pl.z) < 16) {
      const dyn = g.entities.dynamic, c = L.cols, set = (k: number, x: number, z: number, r: number, y: number, h: number) => { const o = c[k]; o.x = x; o.z = z; o.r = r; o.bottom = y; o.top = y + h; dyn.push(o); };
      if (L.pose.dead > 0.5) set(0, L.x, L.z, 1.3, L.y, 1.4);
      else {
        set(0, L.x + fx * 0.85, L.z + fz * 0.85, 1.0, L.y, 2.3); set(1, L.x - fx * 0.85, L.z - fz * 0.85, 1.0, L.y, 2.3);
        if (p.animal === 'mules') { set(2, L.bx + rx * 0.45, L.bz + rz * 0.45, 0.45, L.by, 1.4); set(3, L.bx - rx * 0.45, L.bz - rz * 0.45, 0.45, L.by, 1.4); }
        else set(2, L.bx, L.bz, 0.55, L.by, 2);
      }
    }
  }

  /** Places des membres : formation autour du chariot (ou en colonne), campement autour du feu la nuit. */
  private slots(L: Live, list: Entity[], mode: string, fx: number, fz: number, rx: number, rz: number): void {
    const p = L.plan;
    let watcher: Entity | null = null;
    if (mode === 'halte') for (const e of list) if (e.convoy && e.alive && e.convoy.fighter) { watcher = e; break; }
    let esc = 0, k = 0;
    for (const e of list) {
      const c = e.convoy;
      if (!c) continue;
      c.speed = mode === 'route' ? p.speed : 1.3; c.lie = false; c.watch = false;
      if (mode === 'halte' && L.fire) {
        const f = L.fire, side = Math.sign((L.st.x - f.x) * rx + (L.st.z - f.z) * rz) || 1;
        if (e === watcher) { c.tx = f.x + rx * side * 1.7; c.tz = f.z + rz * side * 1.7; c.watch = true; c.face = Math.atan2(rx * side, -rz * side); continue; }
        const along = [-1.8, 1.8, -3.3, 3.3, -4.8][k++ % 5];
        c.tx = f.x + fx * along - rx * side * 0.5; c.tz = f.z + fz * along - rz * side * 0.5; c.lie = true; c.face = null;
        continue;
      }
      let ox = 0, oz = 0;
      if (p.kind === 'caravane') {
        if (c.role === 'marchand') { ox = 0.4; oz = -1.6; }
        else if (c.role === 'charretier') { ox = HITCH + 0.5; oz = p.animal === 'mules' ? -1.4 : -1.05; }
        else { ox = esc === 0 ? HITCH + 3.4 : -3.2; oz = esc === 2 ? -1.0 : esc === 1 ? 0.6 : 0.2; esc++; }
      } else if (p.size > 1) { ox = -1.5 * Math.floor(c.slot / 2); oz = c.slot % 2 ? 0.55 : -0.55; }
      c.tx = L.x + fx * ox + rx * oz; c.tz = L.z + fz * ox + rz * oz;
      c.face = mode === 'route' ? null : L.h;
    }
    if (L.snap) {
      L.snap = false;
      for (const e of list) if (e.convoy && e.alive && !e.remote && !e.hostile) { e.x = e.convoy.tx; e.z = e.convoy.tz; e.y = this.g.entities.ground(e.x, e.z, this.g.world.heightAt(e.x, e.z) + 2); }
    }
  }

  /** Bas-côté praticable (au sec, sans grand dénivelé) à droite ou à gauche de la route ; à défaut, la route elle-même. */
  private shoulder(p: ConvoyPlan, x: number, z: number, h: number): { x: number; z: number } {
    const w = this.g.world, off = this.g.world.civ.roads[p.road].width / 2 + 1.1, rx = Math.cos(h), rz = Math.sin(h), y0 = w.heightAt(x, z);
    for (const s of [p.side, -p.side]) {
      const cx = x + rx * off * s, cz = z + rz * off * s, wt = w.waterAt(cx, cz), y = w.heightAt(cx, cz);
      if ((Number.isNaN(wt) || wt < y - 0.2) && Math.abs(y - y0) < 1.2) return { x: cx, z: cz };
    }
    return { x, z };
  }

  /** Hauteur du sol sous un convoi : relief, ou tablier d'un pont de sa route. */
  private yAt(road: number, x: number, z: number): number {
    let decks = this.decks.get(road);
    if (!decks) {
      const sm = this.g.world.sampler;
      decks = this.g.world.civ.roads[road].bridges.map((b) => {
        const s = Math.sin(b.yaw), c = Math.cos(b.yaw), hl = b.length / 2;
        const e1 = sm.height(b.x - s * (hl + 1), b.z - c * (hl + 1)), e2 = sm.height(b.x + s * (hl + 1), b.z + c * (hl + 1));
        return { x: b.x, z: b.z, s, c, hl: hl + 0.5, hw: b.width / 2 + 0.5, y: Math.max(b.y - 0.7, (e1 + e2) / 2 + 0.15) };
      });
      this.decks.set(road, decks);
    }
    let y = this.g.world.heightAt(x, z);
    for (const d of decks) {
      const dx = x - d.x, dz = z - d.z;
      if (Math.abs(dx * d.s + dz * d.c) <= d.hl && Math.abs(dx * d.c - dz * d.s) <= d.hw) y = Math.max(y, d.y);
    }
    return y;
  }

  // ================================================================ embuscades
  /** Les brigands surgissent des fourrés de part et d'autre de la route et foncent sur le convoi. */
  private ambush(L: Live, list: Entity[]): void {
    const g = this.g, p = L.plan, am = p.ambush!, w = g.world;
    const fx = Math.sin(L.h), fz = -Math.cos(L.h), rx = Math.cos(L.h), rz = Math.sin(L.h);
    const dry = (x: number, z: number) => { const wt = w.waterAt(x, z); return Number.isNaN(wt) || wt < w.heightAt(x, z) - 0.2; };
    const wave = L.wave++;
    for (let i = 0; i < am.bandits; i++) {
      const side = i % 2 ? 1 : -1, along = 7 - i * 3.5;
      let x = L.x + rx * side * 15 + fx * along, z = L.z + rz * side * 15 + fz * along;
      if (!dry(x, z)) { x = L.x - rx * side * 9 + fx * along; z = L.z - rz * side * 9 + fz * along; }
      const e = makeMonster(`${L.zone}:b${wave}${i}`, 'bandit', x, z, L.x, L.z, 60, { level: am.level, lair: L.zone });
      e.y = g.entities.ground(x, z, w.heightAt(x, z) + 2);
      e.heading = Math.atan2(L.x - x, -(L.z - z));
      let best: Entity | null = null, bd = Infinity;
      for (const o of list) if (o.convoy && o.alive) { const d = Math.hypot(o.x - x, o.z - z) - (o.convoy.fighter ? 4 : 0); if (d < bd) { bd = d; best = o; } }
      const m = e.mon!;
      if (best) { m.targetId = best.id; m.alerted = true; m.state = 'chasse'; }
      g.entities.addToConvoy(L.zone, e);
    }
    L.spawned = true; L.loot = 0;
    const pl = g.player, d = Math.hypot(L.x - pl.x, L.z - pl.z);
    if (d < 160) {
      const who = this.victim(p);
      this.say(`Embuscade ! Des brigands surgissent des fourrés et attaquent ${who}${d > 60 ? `, ${direction(pl.x, pl.z, L.x, L.z)}` : ''} !`, C.orange);
      const boss = this.traffic.members(p)[0]?.npc.sex === 'f' ? 'la marchande' : 'le marchand';
      const help = p.kind !== 'caravane' ? 'Ils ne se défendront pas seuls.' : p.size > 2 ? `Aidez les gardes : ${boss} saura vous remercier.` : `Défendez-les : ${boss} saura vous remercier.`;
      if (d < 90) g.banner = { text: 'EMBUSCADE !', sub: `Des brigands attaquent ${who}.`, sub2: help, t: 5, color: C.orange };
      g.audio.creature('bandit', 'alerte', { x: L.x, y: L.y + 1.5, z: L.z });
    }
  }

  /** Issue d'une embuscade observée : plus de brigands (sauvé), plus de défenseurs et le chariot fouillé, ou plus personne (pillé). */
  private judge(L: Live, list: Entity[], dt: number, now: number): void {
    const pl = this.g.player;
    let bandits = 0, members = 0, fighters = 0, looting = false;
    for (const e of list) {
      if (!e.alive) continue;
      if (e.mon) {
        if (e.mon.yielded) { if (Math.hypot(e.x - pl.x, e.z - pl.z) < 12) L.helped = true; continue; }   // rendu sous la menace du joueur
        const d = Math.hypot(e.x - L.x, e.z - L.z);
        if (d < 45) bandits++;
        if (d < 6) looting = true;
      } else if (e.convoy) { members++; if (e.convoy.fighter) fighters++; }
    }
    if (!bandits) { this.resolve(L.plan, 's', now); return; }
    if (!members) { this.resolve(L.plan, 'p', now); return; }
    if (!fighters && looting) { L.loot += dt; if (L.loot > 10) this.resolve(L.plan, 'p', now); }
  }

  /** Issue décidée ici : enregistrée, partagée (en ligne), puis ses conséquences. */
  private resolve(plan: ConvoyPlan, k: 'p' | 's', now: number): void {
    if (this.outcomes.has(plan.id)) return;
    const o: Outcome = { k, t: Math.round(now) + (k === 's' ? 2 : 0) };
    this.outcomes.set(plan.id, o);
    this.g.coop?.fact('conv:' + plan.id, outcomeValue(o));
    this.consequences(plan, o);
  }

  /** Fait partagé « conv:<id> » reçu (ou relu à la connexion). */
  applyFact(id: string, v: unknown): void {
    const o = parseOutcome(v);
    if (!o) return;
    this.outcomes.set(id, o);
    const p = this.traffic.plan(id);
    if (p) this.consequences(p, o);
  }

  /** Conséquences d'une issue (une seule fois) : brigands qui détalent, récompense, prix, rumeurs, épave. */
  private consequences(p: ConvoyPlan, o: Outcome): void {
    if (this.applied.has(p.id)) return;
    this.applied.add(p.id);
    const g = this.g, L = this.live.get('v' + p.id), pl = g.player;
    const near = !!L && Math.hypot(L.x - pl.x, L.z - pl.z) < 150;
    if (L) for (const e of g.entities.convoys.get(L.zone) ?? []) {
      const m = e.mon;
      if (!m || !e.alive || m.yielded) continue;
      m.yielded = true; m.state = 'fuite'; m.targetId = 'player'; m.alerted = false; m.windup = 0;
      this.fleeing.push({ e, t: 15 });
    }
    if (o.k === 'p') {
      if (near) this.say(`Les brigands ont ${p.kind === 'caravane' ? 'pillé' : 'détroussé'} ${this.victim(p)} et filent avec le butin !`, C.red);
      if (near) this.log(`${this.pillageClause(p)} sous vos yeux.`);
      this.pillaged(p, o.t);
    } else if (L?.helped) this.reward(L);
    else if (near) this.say(`${cap(this.victim(p))} ${p.kind === 'pèlerins' ? 'ont' : 'a'} repoussé les brigands.`, C.green);
  }

  /** Pillage (observé ou sans témoin) : épave connue, prix du bien en hausse à destination, rumeur. */
  private pillaged(p: ConvoyPlan, t: number, rumor = true): void {
    const g = this.g, at = { x: 0, z: 0, h: 0 };
    this.traffic.at(p, p.ambush?.u ?? 0, at);
    if (!this.pillages.some((x) => x.plan === p)) this.pillages.push({ plan: p, t, x: at.x, z: at.z });
    const rec = g.economy.supply.get(p.to);
    if (rec && p.cargo) rec[p.cargo] = Math.max(0.3, rec[p.cargo] - 0.45);
    if (!rumor) return;
    g.rumors.add(`${cap(this.pillageClause(p))} ${this.where(at.x, at.z, p)}.`, p.to, 'convoi:' + p.id);
    g.rumors.add(`${cap(this.pillageClause(p))} ${this.where(at.x, at.z, p)}.`, p.from, 'convoi:' + p.id);
    // plusieurs pillages en quelques jours sur la même route : les embuscadeurs sont connus
    const recent = this.pillages.filter((x) => x.plan.road === p.road && t - x.t < 6 * DAY && x.t <= t);
    const tag = `embuscades:${p.road}`;
    if (recent.length >= 2 && !g.rumors.list.some((r) => r.tag === tag && g.time.day - r.day < 6)) {
      const r = g.world.civ.roads[p.road], A = g.world.civ.settlements[r.a].name, B = g.world.civ.settlements[r.b].name;
      g.rumors.add(`Des brigands guettent les convois sur la route entre ${A} et ${B} : ${recent.length} attaques en quelques jours. Ne la prenez pas sans escorte.`, r.a, tag);
      g.rumors.add(`Des brigands guettent les convois sur la route entre ${A} et ${B}. On cherche des gens d’armes pour les en déloger.`, r.b, tag);
    }
  }

  /** Le joueur a aidé et le convoi a survécu : le marchand (ou les survivants) le récompensent. */
  private reward(L: Live): void {
    const g = this.g, p = L.plan, am = p.ambush, civ = g.world.civ, list = g.entities.convoys.get(L.zone) ?? [];
    L.helped = false;
    let merchant: Entity | null = null, who: Entity | null = null;
    for (const e of list) if (e.convoy && e.alive) { who = who ?? e; if (e.convoy.role === 'marchand') merchant = e; }
    if (!who) return;
    const n = am?.bandits ?? 2, lvl = am?.level ?? p.level, town = civ.settlements[p.from], ch = g.character;
    const sub: string[] = [];
    let gold = 0;
    if (p.kind === 'caravane') {
      gold = Math.round((15 + n * lvl * 4) * (merchant ? 1 : 0.5));
      if (merchant) {
        const key = `m${p.from}:${p.house}`, mn = merchant.npc!;
        this.remises.set(key, Math.min(this.remises.get(key) ?? 1, 0.85));
        const fid = g.ownerOf(p.from), f = civ.factions[fid];
        if (f) { g.rep.faction[fid] += 6; sub.push('+6 réputation'); this.say(`Réputation : +6 auprès ${deFaction(f.name)}.`, C.green); }
        g.rep.addLocal(p.from, 4);
        sub.push('prix d’ami : -15 %');
        this.say(`${mn.first} ${mn.last} : « Sans toi, on y passait tous ! Prends ça. Et passe me voir à ${town.name} : chez moi comme sur la route, tu auras toujours un prix d’ami. »`, C.yellow);
        this.log(`vous avez sauvé la caravane ${deNom(`${mn.first} ${mn.last}`)} : prix d’ami chez ${mn.sex === 'f' ? 'elle' : 'lui'}, à ${town.name} et sur la route.`);
      } else {
        this.say(`${who.name} : « Le patron n’a pas survécu… Prends ça quand même, tu l’as mérité. »`, C.yellow);
        this.log(`vous avez sauvé ce qui restait d’une caravane de ${town.name}.`);
      }
    } else if (p.kind === 'pèlerins') {
      gold = 4 * list.filter((e) => e.convoy && e.alive).length + 2;
      g.addBuff({ id: 'béni', name: 'Béni', t: 300, dmg: 0.15, armor: 3, regen: 1 });
      const ordre = civ.factions.find((f) => f.kind === 'ordre');
      if (ordre) { g.rep.faction[ordre.id] += 3; sub.push('+3 réputation'); }
      g.rep.addLocal(p.from, 3);
      sub.push('béni (5 min)');
      this.say(`${who.name} : « Que les saints te gardent, voyageur ! Nous prierons pour toi. » Vous êtes béni (5 min).`, C.yellow);
      this.log(`vous avez sauvé des pèlerins des brigands.`);
    } else {
      gold = 8 + lvl * 3;
      ch.inv.add('crochet', 2);
      this.feed('+ 2 Crochet de serrurier', 0xe8e8e0);
      g.rep.addLocal(p.from, 2);
      this.say(`${who.name} : « Sans toi, ils me prenaient jusqu’à ma hotte ! Tiens, deux crochets, et quelques pièces. »`, C.yellow);
      this.log(`vous avez sauvé ${p.kind === 'colporteur' && who.npc?.sex === 'f' ? 'une colporteuse' : 'un colporteur'} des brigands.`);
    }
    ch.inv.gold += gold;
    const ups = ch.gainXp(15 * n);
    this.feed(`+ ${gold} pièces d’or`, C.gold);
    g.audio.chime();
    g.banner = { text: p.kind === 'caravane' ? 'CARAVANE SAUVÉE' : 'CONVOI SAUVÉ', sub: [`+${gold} or`, `+${15 * n} XP`, ...sub].join(' · '), t: 6, color: C.gold };
    if (ups) this.say(`Niveau ${ch.level} !`, C.yellow);
    if (who.npc) g.events.emit('player:helped', { npcId: who.npc.id, magnitude: 0.6, reason: 'Le voyageur nous a sauvés des brigands.' });
    const at = { x: 0, z: 0, h: 0 };
    this.traffic.at(p, am?.u ?? 0, at);
    const saved = p.kind === 'caravane' ? `la caravane ${deNom(this.merchantName(p))}` : p.kind === 'pèlerins' ? 'des pèlerins' : (who.npc?.sex === 'f' ? 'une colporteuse' : 'un colporteur');
    g.rumors.add(`Un voyageur a sauvé ${saved} des brigands, ${this.where(at.x, at.z, p)} !`, p.to, 'convoi-sauvé:' + p.id);
  }

  /** Délit : une patrouille qui en est témoin s'en mêle (amende à son lieu d'attache), les gardes d'un convoi agressé ripostent. */
  private onCrime(c: { type: 'vol' | 'agression' | 'meurtre'; victimId?: string; settlementId?: number; witnesses: string[]; value?: number }): void {
    const g = this.g;
    for (const L of this.live.values()) {
      const list = g.entities.convoys.get(L.zone) ?? [];
      const victim = !!c.victimId && c.victimId.startsWith(L.zone + ':');
      const seen = L.plan.kind === 'patrouille' && c.witnesses.some((id) => id.startsWith(L.zone + ':'));
      if (!victim && !seen) continue;
      let shout: Entity | null = null;
      for (const e of list) if (e.convoy?.fighter && e.alive && !e.hostile) { e.hostile = true; e.thinkT = 0; shout = shout ?? e; }
      if (seen && c.settlementId !== L.plan.from) {
        const fine = c.type === 'meurtre' ? 400 : c.type === 'agression' ? 60 : (c.value ?? 10) * 3;
        g.rep.bounty.set(L.plan.from, (g.rep.bounty.get(L.plan.from) ?? 0) + fine);
      }
      if (shout && seen) {
        const f = g.world.civ.factions[g.ownerOf(L.plan.from)];
        this.say(`${shout.label} : « Halte ! Au nom ${f ? deFaction(f.name) : 'de la loi'} ! »`, C.red);
      }
    }
  }

  // ================================================================ jours
  private newDay(day: number): void {
    this.day = day;
    this.traffic.prune(day);
    // pillages sans témoin des jours écoulés : prix et rumeurs (trois rumeurs par jour au plus)
    for (let d = Math.max(this.doneDay + 1, day - 5); d < day; d++) {
      let told = 0;
      for (const { plan, t } of this.traffic.pillagedOn(d, (id) => this.outcomes.get(id))) {
        if (this.applied.has(plan.id)) continue;
        this.applied.add(plan.id);
        this.pillaged(plan, t, told++ < 3);
      }
    }
    this.doneDay = day - 1;
    for (const id of [...this.met]) { const d = Number(id.split('.')[0]); if (Number.isFinite(d) && d < day - 12) this.met.delete(id); }
    this.pillages = this.pillages.filter((x) => day - Math.floor(x.t / DAY) <= WRECK_DAYS + 2);
    // courses : en retard (récompense réduite), destinataire mort (lettre sans objet)
    for (const r of [...this.courses.values()]) {
      const n = this.g.entities.findNpc(r.c.npc);
      if (n && !n.alive) { this.dropCourse(r, `${n.first} ${n.last} est mort${e_(n.sex === 'f')} : votre lettre ne trouvera plus son destinataire.`); continue; }
      if (!r.late && day > r.c.due) this.markLate(r, true);
    }
  }

  // ================================================================ textes
  private merchantName(p: ConvoyPlan): string { const m = this.traffic.members(p)[0]; return `${m.npc.first} ${m.npc.last}`; }
  /** « la caravane d’Aubin Lefèvre », « des pèlerins », « un colporteur », « une messagère »… */
  private victim(p: ConvoyPlan): string {
    const m = this.traffic.members(p)[0], f = m?.npc.sex === 'f';
    return p.kind === 'caravane' ? `la caravane ${deNom(this.merchantName(p))}` : p.kind === 'pèlerins' ? 'les pèlerins' : p.kind === 'colporteur' ? (f ? 'la colporteuse' : 'le colporteur') : p.kind === 'messager' ? (f ? 'la messagère' : 'le messager') : 'la patrouille';
  }
  /** « la caravane de X a été pillée », « des pèlerins ont été détroussés », « un colporteur a été dépouillé ». */
  private pillageClause(p: ConvoyPlan): string {
    const f = this.traffic.members(p)[0]?.npc.sex === 'f';
    return p.kind === 'caravane' ? `la caravane ${deNom(this.merchantName(p))} a été pillée` : p.kind === 'pèlerins' ? 'des pèlerins ont été détroussés' : `${f ? 'une colporteuse' : 'un colporteur'} a été dépouillé${e_(f)}`;
  }
  /** « près de Rochecourt », sinon « sur la route entre A et B ». */
  private where(x: number, z: number, p: ConvoyPlan): string {
    const civ = this.g.world.civ;
    let best = -1, bd = 900;
    for (const s of civ.settlements) { if (s.abandoned || s.type === 'camp') continue; const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s.id; } }
    if (best >= 0) return `près ${de(civ.settlements[best].name)}`;
    const r = civ.roads[p.road];
    return `sur la route entre ${civ.settlements[r.a].name} et ${civ.settlements[r.b].name}`;
  }
  private when(t: number): string {
    const d = this.g.time.day - Math.floor(t / DAY);
    return d <= 0 ? 'Aujourd’hui' : d === 1 ? 'Hier' : d === 2 ? 'Avant-hier' : `Il y a ${d} jours`;
  }

  // ================================================================ dialogues
  private menu(e: Entity): DialogueOption[] {
    const n = e.npc, p = this.planOf(n);
    if (!n || !p) return [];
    const d = this.g.dialogue, out: DialogueOption[] = [{ label: 'Des nouvelles de la route ?', go: () => d.node(e, this.roadNews(e, p), () => d.again(e)) }];
    if (n.profession === 'messager') out.unshift({ label: 'As-tu un pli à confier ?', go: () => this.courseNode(e, p) });
    return out;
  }

  /** « Parle-moi de toi » et « Comment vont les affaires ? » pour un voyageur des routes. */
  private roadTalk(e: Entity, topic: 'about' | 'job'): string[] | undefined {
    const g = this.g, n = e.npc, p = this.planOf(n);
    if (!n || !p) return undefined;
    const civ = g.world.civ, A = civ.settlements[p.from].name, B = civ.settlements[p.to].name, f = n.sex === 'f';
    const boss = this.traffic.members(p)[0]?.npc, bossF = boss?.sex === 'f';
    const years = Math.max(1, Math.min(n.age - 16, (n.age * 7) % 25 + 2));
    if (topic === 'job') {
      if (n.profession === 'marchand' && p.cargo) {
        const short = g.economy.supplyOf(p.to, p.cargo) < 0.75;
        return [short ? `À ${B}, on manque ${deBien(p.cargo)} : j’en tirerai un bon prix.` : `Je porte ${partitif(p.cargo)} à ${B}. Les prix y sont honnêtes, sans plus.`, 'Tant que les brigands nous laissent passer, les affaires vont bien.'];
      }
      if (n.profession === 'colporteur') return ['Un peu de tout, pour pas cher : la route ne me laisse pas le temps de m’enrichir.', 'Jette un œil à ma hotte, tu y trouveras peut-être ton bonheur.'];
      if (n.profession === 'messager') return ['Plus vite je cours, mieux je suis payé' + e_(f) + '.', 'Et je cours beaucoup.'];
      return this.roadNews(e, p);
    }
    switch (n.profession) {
      case 'marchand': return [`Je mène mes chariots de ${A} à ${B} depuis ${years} ans.`, p.cargo ? `Cette fois, je transporte ${partitif(p.cargo)}.` : 'Cette fois, le chargement est léger.', 'Mon souhait ? Arriver à bon port avec ma marchandise.'];
      case 'charretier': return [`Je conduis l’attelage ${deNom(boss?.first ?? 'mon maître')}.`, p.animal === 'mules' ? 'Mes mules sont têtues, mais elles tirent.' : 'Mon cheval connaît la route mieux que moi.'];
      case 'escorte': return [`${boss ? `${boss.first} ${boss.last}` : 'Le marchand'} m’a engagé${e_(f)} pour escorter la caravane jusqu’à ${B}.`, `Tant qu’${bossF ? 'elle' : 'il'} paie, je veille.`];
      case 'pèlerin': { const holy = civ.settlements[p.to]; return [`Nous marchons vers ${B}, pour prier ${holy.type === 'monastère' ? 'au monastère' : 'au temple'}.`, 'La route est longue, mais la foi l’est davantage.']; }
      case 'colporteur': return ['Je vais de village en village, tout mon fonds dans ma hotte : aiguilles, crochets, remèdes…', `Après ${B}, je verrai bien où me mène la route.`];
      case 'messager': return [`Je porte des plis de ${A} à ${B}, et je suis en retard !`];
      case 'soldat': { const fac = civ.factions[g.ownerOf(p.from)]; return [`Nous patrouillons sur les terres ${fac ? deFaction(fac.name) : 'du seigneur'}, entre ${A} et ${B}.`, 'Les brigands nous évitent, et c’est bien le but.']; }
      default: return undefined;
    }
  }

  /** Ce que sait un voyageur de sa route : brigands, épave récente, rumeur de sa destination. */
  private roadNews(e: Entity, p: ConvoyPlan): string[] {
    const g = this.g, civ = g.world.civ, B = civ.settlements[p.to], out: string[] = [];
    const camp = civ.pois.find((x) => x.kind === 'camp de bandits' && x.roadId === p.road && !g.entities.clearedCamps.has(x.settlementId));
    if (p.kind === 'patrouille') out.push(camp ? `Des brigands tiennent un camp près de la route, ${direction(e.x, e.z, camp.x, camp.z)}. Nous ne sommes pas assez nombreux pour les en déloger.` : 'Tant que nous tenons la route, les brigands se tiennent à carreau.');
    else if (camp) out.push(`Méfie-toi : des brigands tiennent un camp près de la route, ${direction(e.x, e.z, camp.x, camp.z)}. On y passe la peur au ventre.`);
    else if (p.level >= 5) out.push('La route est mauvaise, par ici : les brigands guettent les convois.');
    else if (p.level >= 3) out.push('On dit qu’il traîne des brigands dans les bois, plus loin. Je n’en ai pas vu, et c’est tant mieux.');
    else out.push('La route est sûre : on n’a pas vu un brigand depuis des semaines.');
    const w = this.pillages.filter((x) => x.plan.road === p.road && x.plan !== p).sort((a, b) => b.t - a.t)[0];
    if (w) out.push(`${this.when(w.t)}, ${this.pillageClause(w.plan)} ${this.where(w.x, w.z, w.plan)}. Il en reste l’épave au bord de la route.`);
    const r = g.rumors.known(p.to).filter((x) => !x.tag.startsWith('convoi'))[0];
    if (r) out.push(`À ${B.name}, on raconte que… ${r.text}`);
    return out;
  }

  // ---------------------------------------------------------------- courses de messager
  private courseNode(e: Entity, p: ConvoyPlan): DialogueNode {
    const g = this.g, n = e.npc!, d = g.dialogue, back = () => d.again(e), sid = this.traffic.letterTo(p), id = `course:${sid}:${p.id}`, f = n.sex === 'f';
    if (this.courses.has(id) || g.quests.quests.some((q) => q.id === id)) return d.node(e, ['Je t’ai déjà confié mon pli. File, il est attendu !'], back);
    const mood = g.rep.mood(n);
    if (mood === 'hostile' || mood === 'méfiant') return d.node(e, ['À toi ? Certainement pas. Ces plis-là, je les porte moi-même.'], back);
    if (!p.letter) return d.node(e, ['Non, rien pour toi : tout ce que je porte, je le remets en mains propres.'], back);
    if (this.courses.size >= MAX_COURSES) return d.node(e, [`Tu portes déjà ${this.courses.size} lettres : je ne veux pas que la mienne s’égare.`], back);
    const town = g.world.civ.settlements[sid], rn = this.recipient(sid);
    if (!rn) return d.node(e, [`J’avais un pli pour ${town.name}, mais son destinataire n’est plus de ce monde.`], back);
    const dist = Math.hypot(town.x - e.x, town.z - e.z), gold = Math.max(20, Math.min(90, Math.round(15 + dist / 90))), xp = Math.round(25 + dist / 60);
    const due = g.time.day + 1 + Math.ceil(dist / 1800);
    const role = rn.title ?? rn.profession;
    return {
      ...d.head(e, mood),
      lines: [`J’ai un pli pour ${rn.first} ${rn.last}, ${role} à ${town.name}, ${direction(e.x, e.z, town.x, town.z)}. Je n’ai pas le temps de faire le détour.`,
        `Porte-le avant le jour ${due} : ${rn.sex === 'f' ? 'elle' : 'il'} te paiera ${gold} pièces à la remise. Je compte sur toi.`],
      options: [
        { label: `Accepter : porter la lettre à ${town.name} (${gold} or)`, go: () => {
          this.takeCourse({ id, item: `quête:lettre:${p.id}:${town.name}`, from: p.from, to: sid, npc: rn.id, due, gold, xp }, `${n.first} ${n.last}, ${f ? 'messagère' : 'messager'}`);
          return d.node(e, ['Merci ! Et surtout, ne l’ouvre pas.'], back);
        } },
        { label: 'Refuser : je ne vais pas par là.', go: () => d.node(e, ['Tant pis, je trouverai quelqu’un d’autre.'], back) },
      ],
    };
  }
  /** Destinataire d'un pli : un notable vivant du lieu, qui n'attend pas déjà autre chose du joueur. */
  private recipient(sid: number): NPCData | undefined {
    const g = this.g, npcs = g.entities.baseNpcsOf(sid).filter((n) => n.alive && !g.quests.quests.some((q) => q.giver === n.id));
    for (const prof of ['noble', 'marchand', 'aubergiste', 'prêtre', 'forgeron', 'garde']) { const n = npcs.find((x) => x.profession === prof); if (n) return n; }
    return npcs[0];
  }
  private courseQuest(c: SavedCourse, from: string): Quest {
    const g = this.g, town = g.world.civ.settlements[c.to], rn = g.entities.findNpc(c.npc);
    const who = rn ? `${rn.first} ${rn.last}` : 'son destinataire', first = rn?.first ?? 'le destinataire';
    return {
      id: c.id, kind: 'course', giver: c.npc, sid: c.to, title: `Un pli pour ${town.name}`,
      summary: `${from} vous a confié une lettre cachetée pour ${who}${rn ? ` (${rn.title ?? rn.profession})` : ''}, à ${town.name}.`,
      stage: 0, status: 'disponible', stages: [`Remettre la lettre à ${first} (${town.name}) avant le jour ${c.due}`],
      target: { x: town.x, z: town.z, label: `${first} (${town.name})` }, reward: { gold: c.gold, xp: c.xp },
      data: { item: c.item, thanks: 'Une lettre pour moi ? Enfin ! Tiens, pour ta peine. Merci, voyageur.' },
    };
  }
  private takeCourse(c: SavedCourse, from: string): void {
    const g = this.g, q = this.courseQuest(c, from);
    g.character.inv.add(c.item);
    this.feed(`+ ${q.title.replace('Un pli', 'Lettre cachetée')}`, C.yellow);
    g.quests.quests.push(q);
    g.quests.accept(q);
    this.courses.set(c.id, { c, q, late: false });
  }
  private markLate(r: CourseRec, tell: boolean): void {
    r.late = true;
    r.q.reward.gold = Math.max(5, Math.round(r.c.gold / 2));
    r.q.stages[0] = `${r.q.stages[0].replace(/ avant le jour \d+$/, '')} (en retard : récompense réduite)`;
    if (tell) this.say(`Le pli pour ${this.g.world.civ.settlements[r.c.to].name} arrivera en retard : la récompense sera moindre.`, C.orange);
  }
  private dropCourse(r: CourseRec, why: string): void {
    const g = this.g;
    this.courses.delete(r.c.id);
    g.quests.quests = g.quests.quests.filter((q) => q !== r.q);
    if (g.quests.tracked === r.c.id) g.quests.tracked = null;
    g.character.inv.remove(r.c.item, g.character.inv.count(r.c.item));
    this.say(why, C.dim);
  }

  // ================================================================ commerce
  /** Marchandises du jour d'un voyageur (null : pas un voyageur des routes). */
  stockFor(e: Entity): { id: string; qty: number }[] | null {
    const n = e.npc;
    if (!n?.road) return null;
    const p = this.planOf(n), m = n && this.specOf(n);
    return p && m ? convoyStock(this.g.world.civ, this.g.seed, p, m, this.g.time.day) : [];
  }
  /** Prix : les marchands de caravane font des prix bas ; une maison de négoce sauvée accorde une remise durable (ses caravanes et sa boutique). */
  private priceMult(n: NPCData): number {
    if (n.road) {
      const p = this.planOf(n);
      if (n.profession === 'marchand' && p) return 0.85 * (this.remises.get(`m${p.from}:${p.house}`) ?? 1);
      return n.profession === 'colporteur' ? 0.95 : 1;
    }
    if (n.profession !== 'marchand' || !this.remises.size) return 1;
    let best = 1;
    for (const [k, v] of this.remises) if (k.startsWith(`m${n.sid}:`)) best = Math.min(best, v);
    return best;
  }

  // ================================================================ épaves : rendu et fouille
  private wreckOf(p: ConvoyPlan): Wreck {
    let w = this.wreckAt.get(p.id);
    if (!w) {
      const at = { x: 0, z: 0, h: 0 };
      this.traffic.at(p, p.ambush?.u ?? 0, at);
      const s = this.shoulder(p, at.x, at.z, at.h);
      w = { x: s.x, z: s.z, h: at.h, y: this.yAt(p.road, s.x, s.z) };
      if (this.g.world.chunks.chunkAt(s.x, s.z)) this.wreckAt.set(p.id, w);
    }
    return w;
  }
  /** Épave à fouiller devant le joueur ; d : score de proximité (comparé aux autres objets). */
  focus(): { f: Focus; d: number } | null {
    const g = this.g, pl = g.player, fx = Math.sin(pl.heading), fz = -Math.cos(pl.heading);
    if (g.dungeon) return null;
    let best: { f: Focus; d: number } | null = null;
    const cands = [...this.wrecks.map((n) => n.plan)];
    for (const L of this.live.values()) if (L.st.mode === 'épave' && !cands.includes(L.plan)) cands.push(L.plan);
    for (const p of cands) {
      if (g.state.opened.has('épave:' + p.id)) continue;
      const L = this.live.get('v' + p.id), w = L && L.ready ? { x: L.x, z: L.z, y: L.y } : this.wreckOf(p);
      const dx = w.x - pl.x, dz = w.z - pl.z, d = Math.hypot(dx, dz), facing = d < 0.8 ? 1 : (dx * fx + dz * fz) / d;
      if (d > 3.4 || facing < 0.3 || Math.abs(w.y - pl.y) > 2.5) continue;
      const sc = d - facing;
      if (!best || sc < best.d) best = { d: sc, f: { t: 'action', label: `Fouiller l’épave${p.kind === 'caravane' ? ' du chariot' : ''}`, hint: cap(this.pillageClause(p)) + '.', muted: true, go: () => this.loot(p) } };
    }
    return best;
  }
  private loot(p: ConvoyPlan): void {
    const g = this.g, key = 'épave:' + p.id;
    if (g.state.opened.has(key)) return;
    const give = () => { g.state.opened.add(key); g.giveLoot(wreckLoot(g.world.civ, g.seed, p), 'Épave'); };
    if (g.coop) g.coop.claimOnce('open:' + key, give); else give();
  }

  render(ib: InstanceBuffer, cx: number, cz: number): void {
    const g = this.g;
    if (g.dungeon) return;
    for (const L of this.live.values()) {
      if (!L.ready || Math.hypot(L.x - cx, L.z - cz) > 170) continue;
      const p = L.plan;
      if (p.animal) {
        drawModel(ib, wagonModel(p.cover, p.crate, p.animal === 'mules'), L.x, L.y, L.z, L.h, L.pose);
        if (L.st.mode !== 'épave') {
          if (p.animal === 'mules') { const rx = Math.cos(L.h), rz = Math.sin(L.h); for (const s of [-1, 1]) drawModel(ib, draughtModel('mule', p.coat + (s > 0 ? 1 : 0)), L.bx + rx * s * 0.45, L.by, L.bz + rz * s * 0.45, L.h, L.apose); }
          else drawModel(ib, draughtModel('cheval', p.coat), L.bx, L.by, L.bz, L.h, L.apose);
        } else this.debris(ib, L.x, L.y, L.z, L.h, p);
      } else if (L.st.mode === 'épave') this.debris(ib, L.x, L.y, L.z, L.h, p);
      if (L.fire) this.campfire(ib, L.fire.x, L.fire.y, L.fire.z);
    }
    const dead = this.wreckPose;
    for (const n of this.wrecks) {
      if (this.live.has('v' + n.plan.id)) continue;
      const w = this.wreckOf(n.plan);
      if (Math.hypot(w.x - cx, w.z - cz) > 170) continue;
      if (n.plan.animal) drawModel(ib, wagonModel(n.plan.cover, n.plan.crate, n.plan.animal === 'mules'), w.x, w.y, w.z, w.h, dead);
      this.debris(ib, w.x, w.y, w.z, w.h, n.plan);
    }
  }
  /** Caisses éventrées, roue arrachée, ballots : ce qu'il reste d'un convoi pillé. */
  private debris(ib: InstanceBuffer, x: number, y: number, z: number, h: number, p: ConvoyPlan): void {
    const m = this.m4, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const at = (f: number, r: number) => [x + fx * f + rx * r, z + fz * f + rz * r] as const;
    const pieces: [number, number, number, number][] = p.animal ? [[2.4, 1.6, 0.5, 0.4], [-2.2, 1.9, 0.44, 1.1], [0.8, 2.5, 0.38, 2.0]] : [[0.6, 0.8, 0.4, 0.3], [-0.7, 1.1, 0.34, 1.2]];
    for (const [f, r, s, yaw] of pieces) { const [px, pz] = at(f, r); ib.add(trsYawPitch(m, px, y + s / 2 - 0.05, pz, h + yaw, 0.2, s, s * 0.85, s), p.crate, M.WOOD, 0, 0, 1); }
    if (p.animal) { const [wx, wz] = at(-1.0, 2.6); ib.add(trsYawPitch(m, wx, y + 0.05, wz, h + 0.7, 0, 1.05, 0.08, 1.05), 0x3a2a1c, M.WOOD, 0, 0, 1, SHAPE.CYL); }
    else { const [bx, bz] = at(0, 1.6); ib.add(trsYawPitch(m, bx, y + 0.12, bz, h, 0, 0.9, 0.22, 0.6), 0x7a6a50, M.CLOTH, 0, 0, 1, SHAPE.SPHERE); }
  }
  private campfire(ib: InstanceBuffer, x: number, y: number, z: number): void {
    const m = this.m4, t = this.g.elapsed;
    for (let i = 0; i < 3; i++) ib.add(trsYawPitch(m, x, y + 0.08, z, (i / 3) * Math.PI, Math.PI / 2, 0.12, 1.0, 0.12), 0x4a3020, M.WOOD, 0, 0, 1, SHAPE.CYL);
    const k = 0.85 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.07;
    ib.add(trsYawPitch(m, x, y + 0.42 * k, z, t * 0.7, 0, 0.5, 0.7 * k, 0.5), 0xff8a30, M.GLOW, 0, 0, 1, SHAPE.CONE);
    ib.add(trsYawPitch(m, x, y + 0.36 * k, z, -t, 0, 0.28, 0.45 * k, 0.28), 0xffd060, M.GLOW, 0, 0, 1, SHAPE.CONE);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ib.add(trsYawPitch(m, x + Math.cos(a) * 0.55, y + 0.06, z + Math.sin(a) * 0.55, a, 0, 0.2, 0.14, 0.18), 0x7a7a72, M.STONE, 0, 0, 1, SHAPE.SPHERE); }
  }
  /** Feux de camp des convois proches (lumières). */
  lights(): { x: number; y: number; z: number; radius: number; r: number; g: number; b: number }[] {
    const out: { x: number; y: number; z: number; radius: number; r: number; g: number; b: number }[] = [], t = this.g.elapsed, pl = this.g.player;
    for (const L of this.live.values()) {
      const f = L.fire;
      if (!f || Math.hypot(f.x - pl.x, f.z - pl.z) > 90) continue;
      const k = 0.85 + 0.15 * Math.sin(t * 11 + f.x) * Math.sin(t * 7 + f.z);
      out.push({ x: f.x, y: f.y + 0.9, z: f.z, radius: 13, r: 1.7 * k, g: 0.95 * k, b: 0.45 * k });
    }
    return out;
  }

  // ================================================================ carte et journal
  /** Carte (M) : convois rencontrés ou proches (♦), épaves récentes dans les terres explorées (×). */
  markers(): { x: number; z: number; glyph: string; color: number; name?: string }[] {
    const g = this.g;
    if (g.elapsed - this.markT < 0.5) return this.markCache;
    this.markT = g.elapsed;
    const out: { x: number; z: number; glyph: string; color: number; name?: string }[] = [], now = g.time.minutes, pl = g.player;
    const seen = new Set<string>(), st = emptyState();
    const put = (p: ConvoyPlan, s: ConvoyState) => {
      if (seen.has(p.id)) return;
      seen.add(p.id);
      if (s.mode === 'épave') { out.push({ x: s.x, z: s.z, glyph: '×', color: 0xc06040, name: 'épave' }); return; }
      out.push({ x: s.x, z: s.z, glyph: '♦', color: p.kind === 'patrouille' ? this.factionColor(p.from) : p.kind === 'caravane' ? C.gold : 0xd8c8a0, name: p.kind === 'caravane' ? `caravane ${deNom(this.merchantName(p))}` : KIND_NAME[p.kind] });
    };
    if (!g.dungeon) for (const n of this.traffic.near(pl.x, pl.z, now, MARK_R, (id) => this.outcomes.get(id))) put(n.plan, n.st);
    for (const id of [...this.met]) {
      const p = this.traffic.plan(id);
      if (!p) { this.met.delete(id); continue; }
      this.traffic.stateAt(p, now, this.outcomes.get(id), st);
      if (st.mode === 'absent') { this.met.delete(id); continue; }
      if (st.mode !== 'auberge') put(p, st);
    }
    const ex = g.state.explored;
    for (const w of this.pillages) {
      if (seen.has(w.plan.id) || now - w.t > WRECK_DAYS * DAY) continue;
      const i = Math.floor(w.x / CELL), j = Math.floor(w.z / CELL);
      if (i < 0 || j < 0 || i >= MACRO || j >= MACRO || !ex[j * MACRO + i]) continue;
      seen.add(w.plan.id);
      out.push({ x: w.x, z: w.z, glyph: '×', color: 0xc06040, name: 'épave' });
    }
    this.markCache = out;
    return out;
  }
  /** Journal : remises durables et derniers faits marquants des routes. */
  journalLines(): { text: string; color: number }[] {
    const g = this.g, out: { text: string; color: number }[] = [];
    for (const [k, v] of this.remises) {
      const [sid, house] = k.slice(1).split(':').map(Number), s = g.world.civ.settlements[sid];
      if (!s) continue;
      const m = this.traffic.merchant(sid, house);
      out.push({ text: `Prix d’ami chez ${m.first} ${m.last}, ${m.sex === 'f' ? 'marchande' : 'marchand'} de ${s.name} : -${Math.round((1 - v) * 100)} % (ses caravanes et les boutiques de ${s.name})`, color: C.green });
    }
    for (const l of this.journal) out.push({ text: l, color: C.dim });
    return out;
  }

  // ================================================================ sauvegarde
  toSave(): ConvoySave | undefined {
    const day = this.g.time.day, recent = (id: string) => { const d = Number(id.split('.')[0]); return Number.isFinite(d) && d >= day - 12; };
    const out: ConvoySave = { jour: this.doneDay };
    const o = [...this.outcomes].filter(([id]) => recent(id)).map(([id, v]) => [id, outcomeValue(v)] as [string, string]);
    if (o.length) out.out = o;
    const dead = [...this.dead].filter((id) => recent(id.slice(1)));
    if (dead.length) out.dead = dead;
    if (this.courses.size) out.courses = [...this.courses.values()].map((r) => r.c);
    if (this.remises.size) out.remises = [...this.remises];
    const vus = [...this.met].filter(recent);
    if (vus.length) out.vus = vus;
    return out;
  }
  /** Remise à zéro (chargement : le Game est réutilisé si la seed est la même). */
  reset(): void {
    const g = this.g;
    for (const L of [...this.live.values()]) this.deactivate(L, false);
    this.outcomes.clear(); this.applied.clear(); this.dead.clear(); this.remises.clear(); this.met.clear();
    this.pillages = []; this.wrecks = []; this.wreckAt.clear(); this.fleeing = []; this.journal = [];
    g.quests.quests = g.quests.quests.filter((q) => q.kind !== 'course');
    if (g.quests.tracked?.startsWith('course:')) g.quests.tracked = null;
    this.courses.clear();
    this.traffic.forget();
    this.day = g.time.day; this.doneDay = this.day - 1; this.checkT = 0; this.markT = -1;
  }
  /** Restaure depuis une sauvegarde assainie, après les quêtes ; champ absent = état par défaut. */
  load(raw: unknown): void {
    const g = this.g, s = sanitizeConvoySave(raw), day = g.time.day;
    for (const [id, v] of s.out) { const o = parseOutcome(v); if (o) { this.outcomes.set(id, o); this.applied.add(id); } }
    for (const id of s.dead) { this.dead.add(id); const n = this.npc(id); if (n) { n.alive = false; n.hp = 0; } }
    for (const [k, v] of s.remises) this.remises.set(k, v);
    for (const id of s.vus) this.met.add(id);
    for (const c of s.courses) {
      const town = g.world.civ.settlements[c.to], rn = g.entities.findNpc(c.npc);
      if (!town || !rn?.alive || this.courses.has(c.id)) continue;
      const q = this.courseQuest(c, 'Un messager');
      q.status = 'active';
      g.quests.quests.push(q);
      const r: CourseRec = { c, q, late: false };
      this.courses.set(c.id, r);
      if (day > c.due) this.markLate(r, false);
    }
    this.day = day;
    this.doneDay = s.jour >= 0 ? Math.min(s.jour, day - 1) : day - 1;
    // épaves connues des jours précédents (rumeurs déjà diffusées, prix déjà touchés)
    for (let d = day - WRECK_DAYS; d <= this.doneDay; d++) for (const { plan, t } of this.traffic.pillagedOn(d, (id) => this.outcomes.get(id))) {
      this.applied.add(plan.id);
      const at = { x: 0, z: 0, h: 0 };
      this.traffic.at(plan, plan.ambush?.u ?? 0, at);
      if (!this.pillages.some((x) => x.plan === plan)) this.pillages.push({ plan, t, x: at.x, z: at.z });
    }
    this.checkT = 0;
  }

  // ================================================================ console de développement
  dev(cmd: string, args: string[]): { text: string; err?: boolean }[] {
    const g = this.g, p = g.player, out: { text: string; err?: boolean }[] = [], say = (text: string, err = false) => out.push({ text, err });
    const now = g.time.minutes, civ = g.world.civ, a0 = (args[0] ?? '').toLowerCase();
    const label = (n: Nearby) => {
      const pl = n.plan, am = pl.ambush, o = this.outcomes.get(pl.id);
      const amb = am ? ` · embuscade ${String(Math.floor((am.t % DAY) / 60)).padStart(2, '0')}:${String(Math.floor(am.t % 60)).padStart(2, '0')} j${Math.floor(am.t / DAY)} (${am.bandits} brigands niv. ${am.level}, ${o ? (o.k === 'p' ? 'pillé' : 'sauvé') : am.loses ? 'pillé sans aide' : 'repoussée'})` : '';
      return `${pl.id} ${pl.kind} ${civ.settlements[pl.from].name} → ${civ.settlements[pl.to].name} · ${n.st.mode} · ${Math.round(n.d)} m${amb}${this.live.has('v' + pl.id) ? ' · incarné' : ''}`;
    };
    if (g.dungeon && cmd !== 'convois') { say('sortez du souterrain d’abord', true); return out; }
    switch (cmd) {
      case 'convois': {
        const list = this.traffic.near(p.x, p.z, now, +args[0] || 1500, (id) => this.outcomes.get(id));
        if (!list.length) say('aucun convoi à proximité', true);
        for (const n of list.slice(0, 14)) say(label(n));
        say(`${this.live.size} incarné(s) · remises : ${this.remises.size} · courses : ${this.courses.size}/${MAX_COURSES}`);
        break;
      }
      case 'convoi': {
        if (a0 === 'aller') {
          const n = this.traffic.near(p.x, p.z, now, 6000, (id) => this.outcomes.get(id)).find((x) => x.st.mode !== 'épave');
          if (!n) { say('aucun convoi sur les routes alentour', true); break; }
          const x = n.st.x + Math.sin(n.st.h) * 14, z = n.st.z - Math.cos(n.st.h) * 14;
          p.x = x; p.z = z; p.heading = n.st.h + Math.PI; g.world.chunks.update(x, z, -1); p.y = g.world.heightAt(x, z) + 0.3; p.vy = 0;
          this.checkT = 0;
          say(`téléporté devant : ${label(n)}`);
          break;
        }
        const kinds: ConvoyKind[] = ['caravane', 'pèlerins', 'colporteur', 'messager', 'patrouille'];
        const kind = kinds.find((k) => k.startsWith(a0.replace('pelerin', 'pèlerin'))) ?? 'caravane';
        const pl = this.traffic.spawnDev(p.x, p.z, now, kind);
        if (!pl) { say('aucune route à moins de 400 m', true); break; }
        this.checkT = 0;
        say(`convoi ${pl.id} (${pl.kind}) : ${civ.settlements[pl.from].name} → ${civ.settlements[pl.to].name}, il arrive sur la route la plus proche`);
        break;
      }
      case 'embuscade': {
        const id = args[1] ?? '';
        const n = this.traffic.near(p.x, p.z, now, 400, (k) => this.outcomes.get(k)).find((x) => x.st.mode !== 'épave' && x.st.mode !== 'départ' && x.st.mode !== 'arrivée' && (!id || x.plan.id === id));
        if (!n) { say('aucun convoi sur la route à moins de 400 m (convoi pour en créer un)', true); break; }
        const pl = n.plan;
        this.outcomes.delete(pl.id); this.applied.delete(pl.id);
        this.traffic.forceAmbush(pl, now, n.st.u, Math.max(1, Math.min(6, +args[0] || 3)));
        const L = this.live.get('v' + pl.id);
        if (L) { L.spawned = false; L.helped = false; }
        this.checkT = 0;
        say(`embuscade sur ${pl.id} (${pl.kind}, ${Math.round(n.d)} m) : ${pl.ambush!.bandits} brigands niv. ${pl.ambush!.level}`);
        break;
      }
    }
    return out;
  }
}
