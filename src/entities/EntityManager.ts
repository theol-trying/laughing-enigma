import { Entity } from './Entity';
import { generateNPCs, type NPCData } from './NPC';
import { humanoid, drawModel, type ModelDef } from './Models';
import { buildLairs, makeMonster, type Lair } from './Monster';
import { NavGrid } from '../ai/Pathfinding';
import { blockAt, resolveSpot, patrolRoute, type Spot } from '../ai/Schedule';
import { thinkMonster, moveMonster, turn, type MonsterCtx } from '../ai/MonsterAI';
import { hitEntity, hitPlayer, type CombatHost } from '../gameplay/Combat';
import { hash2i } from '../core/RNG';
import type { World } from '../world/World';
import type { GameTime } from '../core/Time';
import type { EventBus } from '../core/Events';
import type { Player } from './Player';
import type { Layout } from '../world/civilization/Layout';
import type { InstanceBuffer } from '../rendering/Renderer';
import type { CircleCollider, SegCollider, Platform } from '../world/Chunk';
import type { DungeonLayout } from '../world/dungeons/DungeonGenerator';

/** Ce dont le gestionnaire a besoin du jeu (évite une dépendance circulaire). */
export interface EntityHost {
  world: World<any>;
  time: GameTime;
  player: Player;
  events: EventBus;
  combat: CombatHost;
  inDungeon(): boolean;
  rain(): number;
  night(): number;
  fog(): number;
}

interface ActiveZone { sid: number; L: Layout; grid: NavGrid; ents: Entity[]; patrol: { x: number; z: number }[] }

const ACTIVATE = 250, DEACTIVATE = 330, DRAW = 170, LAIR_ON = 230, LAIR_OFF = 320;

/**
 * Simulation par niveaux : implantations et repaires proches « actifs » (créatures incarnées,
 * chemins, IA complète) ; au loin, seules des données agrégées évoluent (populations, emplois
 * du temps). L'état important (vie, mémoire, populations) survit au déchargement.
 */
export class EntityManager {
  entities: Entity[] = [];
  readonly zones = new Map<number, ActiveZone>();
  readonly lairs: Lair[];
  private activeLairs = new Map<string, Entity[]>();
  private npcData = new Map<number, NPCData[]>();
  private pathQueue: Entity[] = [];
  private checkT = 0;
  private circles: CircleCollider[] = [];
  private segs: SegCollider[] = [];
  private plats: Platform[] = [];
  readonly dynamic: CircleCollider[] = [];
  private models = new Map<string, ModelDef>();
  /** monstres uniques et créatures de donjon tués (clé) */
  readonly killed = new Set<string>();
  readonly clearedCamps = new Set<number>();
  private mctx: MonsterCtx;

  constructor(private host: EntityHost) {
    this.lairs = buildLairs(host.world.civ, host.world.seed);
    this.mctx = {
      chunks: host.world.chunks, player: host.player, ents: this.entities, env: { night: 0, fog: 0 }, combat: host.combat,
      ground: (x, z, y) => this.ground(x, z, y),
      hash: (e, k) => hash2i(e.id.length * 131 + e.id.charCodeAt(e.id.length - 1) * 17 + e.id.charCodeAt(0), k, e.id.length) / 4294967296,
    };
    host.events.on('entity:killed', (ev) => this.onKilled(ev.victimId));
  }

  // ---------------------------------------------------------------- PNJ (données)
  npcsOf(sid: number): NPCData[] {
    let l = this.npcData.get(sid);
    if (!l) {
      const civ = this.host.world.civ;
      const L = this.host.world.civWorld.layouts.find((x) => x.sid === sid);
      l = L ? generateNPCs(civ, civ.settlements[sid], L) : [];
      this.npcData.set(sid, l);
    }
    return l;
  }
  allNpcData(): Map<number, NPCData[]> { return this.npcData; }
  findNpc(id: string): NPCData | undefined { return this.npcsOf(parseInt(id.slice(1), 10)).find((n) => n.id === id); }

  private modelFor(n: NPCData): ModelDef {
    let m = this.models.get(n.id);
    if (!m) {
      const c = n.colors;
      m = humanoid({
        skin: c.skin, shirt: n.look === 'garde' ? 0x8a8a94 : n.look === 'noble' ? 0x6a2a6a : c.shirt, pants: c.pants, hair: c.hair,
        helmet: n.look === 'garde', robe: n.look === 'moine', weapon: n.look === 'garde' ? 'lance' : n.profession === 'forgeron' ? 'massue' : null,
        shield: n.look === 'garde', scale: 0.92 + ((n.age * 13) % 17) / 100, letter: '@',
      });
      this.models.set(n.id, m);
    }
    return m;
  }

  // ---------------------------------------------------------------- activation
  private activate(sid: number) {
    const w = this.host.world, s = w.civ.settlements[sid];
    const L = w.civWorld.layouts.find((x) => x.sid === sid);
    if (!L || !w.chunks.chunkAt(s.x, s.z)) return;
    const grid = NavGrid.build(w.chunks, s.x, s.z, s.radius + 55, doorPassages(L));
    const zone: ActiveZone = { sid, L, grid, ents: [], patrol: patrolRoute(L) };
    const minute = this.host.time.minuteOfDay, hour = this.host.time.hour;
    for (const n of this.npcsOf(sid)) {
      if (!n.alive) continue;
      const e = new Entity(n.id, 'npc', n.look, `${n.first} ${n.last}`, this.modelFor(n), n.profession === 'garde' || n.profession === 'soldat' ? 60 : 30);
      e.hp = Math.max(1, Math.min(e.maxHp, n.hp));
      e.npc = n; e.sid = sid;
      e.speed = n.profession === 'garde' ? 1.6 : 1.3 + n.traits.sociability * 0.3;
      const sp = this.spotFor(e, zone, minute, hour);
      e.spot = sp;
      const free = grid.nearestFree(sp.x, sp.z, 4);
      e.x = sp.lying || free < 0 ? sp.x : grid.x0 + (free % grid.w) + 0.5;
      e.z = sp.lying || free < 0 ? sp.z : grid.z0 + Math.floor(free / grid.w) + 0.5;
      e.y = this.ground(e.x, e.z, 1000);
      e.thinkT = ((n.id.charCodeAt(n.id.length - 1) * 37) % 80) / 100;
      zone.ents.push(e); this.entities.push(e);
    }
    this.zones.set(sid, zone);
  }

  private deactivate(sid: number) {
    const z = this.zones.get(sid);
    if (!z) return;
    for (const e of z.ents) if (e.npc) e.npc.hp = e.alive ? e.hp : 0;
    this.remove(z.ents);
    this.zones.delete(sid);
  }

  private remove(list: Entity[]) {
    const set = new Set(list);
    for (let i = this.entities.length - 1; i >= 0; i--) if (set.has(this.entities[i])) this.entities.splice(i, 1);
    this.pathQueue = this.pathQueue.filter((e) => !set.has(e));
  }

  private activateLair(l: Lair) {
    const ents: Entity[] = [];
    const n = l.alive + (l.leaderAlive ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const isLeader = l.leaderAlive && i === n - 1;
      const type = isLeader && l.leader ? l.leader : l.type;
      const a = (i / Math.max(1, n)) * Math.PI * 2, r = 3 + (i % 3) * 2;
      const e = makeMonster(`${l.key}:${i}`, type, l.x + Math.cos(a) * r, l.z + Math.sin(a) * r, l.x, l.z, l.territory, {
        lair: l.key, poiId: l.poiId, campId: l.sid, leader: isLeader, unique: isLeader ? `${l.key}:chef` : '',
      });
      if (isLeader) e.name = `${e.name} (${this.host.world.civ.settlements[l.sid]?.name.replace('Camp ', '') ?? ''})`;
      e.y = this.ground(e.x, e.z, 1000);
      e.heading = a;
      ents.push(e); this.entities.push(e);
    }
    this.activeLairs.set(l.key, ents);
  }

  private deactivateLair(l: Lair) {
    const ents = this.activeLairs.get(l.key) ?? [];
    l.alive = ents.filter((e) => e.alive && !e.mon?.leader).length;
    l.leaderAlive = ents.some((e) => e.alive && e.mon?.leader);
    this.remove(ents);
    this.activeLairs.delete(l.key);
  }

  clear(): void {
    for (const sid of [...this.zones.keys()]) this.deactivate(sid);
    for (const l of this.lairs) if (this.activeLairs.has(l.key)) this.deactivateLair(l);
  }

  /** Créatures d'un donjon (celles déjà tuées ne reviennent pas). */
  spawnDungeon(L: DungeonLayout): void {
    L.spawns.forEach((s, i) => {
      const key = `dj${L.id}:m${i}`;
      if (this.killed.has(key)) return;
      const e = makeMonster(key, s.type, s.x, s.z, s.x, s.z, s.boss ? 10 : 14, { unique: key, leader: s.boss, perception: s.boss ? 20 : 16 });
      e.y = 0;
      this.entities.push(e);
    });
  }
  clearDungeon(): void { this.remove(this.entities.filter((e) => e.id.startsWith('dj'))); }

  private onKilled(id: string) {
    const e = this.entities.find((x) => x.id === id);
    if (!e?.mon) return;
    if (e.mon.unique) this.killed.add(e.mon.unique);
    if (e.id.startsWith('dj')) this.killed.add(e.id);
    const l = this.lairs.find((x) => x.key === e.mon!.lair);
    if (!l) return;
    const ents = this.activeLairs.get(l.key) ?? [];
    if (l.sid >= 0 && ents.every((x) => !x.alive) && !this.clearedCamps.has(l.sid)) {
      this.clearedCamps.add(l.sid);
      l.alive = 0; l.leaderAlive = false;
      this.host.events.emit('camp:cleared', { campId: l.sid });
    }
  }

  /** Une fois par jour : les repaires se repeuplent selon une écologie simple. */
  dailyTick(): void {
    const civ = this.host.world.civ;
    for (const l of this.lairs) {
      if (this.activeLairs.has(l.key)) continue;
      if (l.sid >= 0 && this.clearedCamps.has(l.sid)) continue;     // camp démantelé : il ne revient pas
      if (l.type === 'troll') continue;                               // créature unique
      if (l.type === 'loup') {
        // des proies (fermes, troupeaux) à proximité : la meute prospère ; sinon elle décline
        const prey = civ.settlements.some((s) => !s.abandoned && Math.hypot(s.x - l.x, s.z - l.z) < 900);
        l.alive = Math.max(0, Math.min(l.max + 1, l.alive + (prey ? 1 : -1)));
      } else if (l.alive < l.max) l.alive++;
    }
  }

  // ---------------------------------------------------------------- PNJ (comportement)
  private spotFor(e: Entity, zone: ActiveZone, minute: number, hour: number): Spot {
    const n = e.npc!;
    const b = blockAt(n, minute);
    if (b.place === 'patrol') {
      const i = (Math.floor(minute / 6) + parseInt(n.id.split(':')[1], 10)) % zone.patrol.length;
      const p = zone.patrol[i];
      return { x: p.x, z: p.z, building: -1, lying: false, face: null, outdoor: true };
    }
    const sp = resolveSpot(n, b, zone.L, hour);
    if (sp.outdoor && this.host.rain() > 0.35 && n.profession !== 'garde' && n.profession !== 'soldat') {
      const inn = zone.L.buildings.find((x) => x.kind === 'auberge');
      return resolveSpot(n, { ...b, place: inn ? 'inn' : 'home', act: 'loisir' }, zone.L, hour);
    }
    return sp;
  }

  /** Sol sous (x, z) : terrain ou plancher accessible. */
  ground(x: number, z: number, fromY: number): number {
    const w = this.host.world;
    let g = this.host.inDungeon() ? -50 : w.heightAt(x, z);
    w.chunks.collidersNear(x, z, this.circles, this.segs, this.plats);
    for (const p of this.plats) {
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = x - p.cx, dz = z - p.cz;
      if (Math.abs(dx * c - dz * s) <= p.hw && Math.abs(dx * s + dz * c) <= p.hd && p.top <= fromY + 0.7 && p.top > g) g = p.top;
    }
    return g;
  }

  private nearestThreat(e: Entity, r: number): Entity | null {
    let best: Entity | null = null, bd = r;
    for (const o of this.entities) {
      if (!o.mon || !o.alive) continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z);
      if (d < bd && (o.mon.alerted || o.mon.state === 'chasse' || d < 10)) { bd = d; best = o; }
    }
    return best;
  }

  private think(e: Entity, zone: ActiveZone) {
    const n = e.npc!, p = this.host.player;
    const minute = this.host.time.minuteOfDay, hour = this.host.time.hour;
    // hostile au joueur (délit) : les gardes le prennent en chasse
    if (e.hostile && !p.dead && Math.hypot(p.x - e.x, p.z - e.z) < 45 && (n.profession === 'garde' || n.profession === 'soldat')) { e.action = 'combattre'; e.foe = null; e.path = null; return; }
    // menace : les gardes (et les plus braves) combattent, les autres fuient chez eux
    const threat = this.nearestThreat(e, 24);
    if (threat) {
      const fighter = n.profession === 'garde' || n.profession === 'soldat' || (n.traits.bravery > 0.85 && n.profession === 'forgeron');
      if (fighter) { e.action = 'combattre'; e.foe = threat; e.path = null; return; }
      e.action = 'fuir';
      const home = resolveSpot(n, { from: 0, to: 0, act: 'loisir', place: 'home' }, zone.L, hour);
      if (!e.target || Math.hypot(e.target.x - home.x, e.target.z - home.z) > 1) {
        e.target = { x: home.x, z: home.z }; e.path = null;
        if (!e.pathPending) { e.pathPending = true; this.pathQueue.push(e); }
      }
      return;
    }
    e.foe = null;
    if (e.talkT > 0) { e.action = 'parler'; e.faceTo = Math.atan2(p.x - e.x, -(p.z - e.z)); e.target = null; return; }
    const sp = this.spotFor(e, zone, minute, hour);
    const moved = !e.spot || Math.hypot(sp.x - e.spot.x, sp.z - e.spot.z) > 1.5;
    e.spot = sp;
    e.action = blockAt(n, minute).act;
    if (moved || (!e.target && Math.hypot(sp.x - e.x, sp.z - e.z) > 1.2)) {
      e.target = { x: sp.x, z: sp.z };
      e.path = null; e.pathI = 0;
      if (!e.pathPending) { e.pathPending = true; this.pathQueue.push(e); }
    }
    e.faceTo = Math.hypot(p.x - e.x, p.z - e.z) < 3 && !e.path ? Math.atan2(p.x - e.x, -(p.z - e.z)) : sp.face;
  }

  private moveNpc(e: Entity, dt: number) {
    const foe = e.foe;
    if (e.action === 'combattre' && !foe && e.hostile) {
      const p = this.host.player, dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz);
      e.heading = turn(e.heading, Math.atan2(dx, -dz), dt * 8);
      if (d > 1.9) { e.x += (dx / d) * e.speed * 2.6 * dt; e.z += (dz / d) * e.speed * 2.6 * dt; e.pose.walk += dt * 10; }
      else {
        e.cooldown -= dt;
        e.pose.swing = Math.max(0, e.cooldown - 0.6);
        if (e.cooldown <= 0) { e.cooldown = 1.4; hitPlayer(this.host.combat, 10, e); }
      }
      const gy0 = this.ground(e.x, e.z, e.y + 0.3);
      e.y += (gy0 - e.y) * Math.min(1, dt * 12);
      return;
    }
    if (e.action === 'combattre' && foe) {
      const dx = foe.x - e.x, dz = foe.z - e.z, d = Math.hypot(dx, dz);
      e.heading = turn(e.heading, Math.atan2(dx, -dz), dt * 8);
      if (d > 1.8) { e.x += (dx / d) * e.speed * 2.2 * dt; e.z += (dz / d) * e.speed * 2.2 * dt; e.pose.walk += dt * 9; }
      else {
        e.cooldown -= dt;
        e.pose.swing = Math.max(0, e.cooldown - 0.6);
        if (e.cooldown <= 0) { e.cooldown = 1.3; if (foe.alive) hitEntity(this.host.combat, foe, 9, e.id); }
      }
      if (!foe.alive) e.foe = null;
    } else {
      let tx = e.x, tz = e.z, moving = false;
      if (e.path && e.pathI < e.path.length) {
        const wp = e.path[e.pathI];
        tx = wp.x; tz = wp.z;
        if (Math.hypot(tx - e.x, tz - e.z) < 0.35) e.pathI++;
        moving = true;
      } else if (e.target && !e.pathPending && !e.path) {
        tx = e.target.x; tz = e.target.z; moving = Math.hypot(tx - e.x, tz - e.z) > 0.3;
      }
      const p = this.host.player;
      const blocked = Math.hypot(p.x - e.x, p.z - e.z) < 0.9 && moving;
      const speed = e.speed * (e.action === 'fuir' ? 2.4 : 1);
      if (moving && !blocked) {
        const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1;
        const step = Math.min(d, speed * dt);
        e.x += (dx / d) * step; e.z += (dz / d) * step;
        e.heading = turn(e.heading, Math.atan2(dx, -dz), dt * 6);
        e.pose.walk += dt * speed * 4.2;
      } else {
        e.pose.walk *= 0.8;
        if (e.faceTo !== null) e.heading = turn(e.heading, e.faceTo, dt * 4);
        if (e.path && e.pathI >= e.path.length) { e.path = null; e.target = null; }
      }
      const lying = !moving && e.spot?.lying && Math.hypot(e.spot.x - e.x, e.spot.z - e.z) < 0.6 && e.action === 'dormir';
      e.pose.dead += ((lying ? 1 : 0) - e.pose.dead) * Math.min(1, dt * 3);
      const working = !moving && e.action === 'travailler' && (e.npc?.profession === 'forgeron' || e.npc?.profession === 'meunier' || e.npc?.profession === 'artisan');
      e.pose.swing = working ? Math.max(0, Math.sin(performance.now() / 160)) * 0.9 : Math.max(0, e.pose.swing - dt * 3);
    }
    const gy = this.ground(e.x, e.z, e.y + 0.3);
    e.y += (gy + (e.pose.dead > 0.5 ? 0.5 : 0) - e.y) * Math.min(1, dt * 12);
    if (e.talkT > 0) e.talkT -= dt;
  }

  // ---------------------------------------------------------------- boucle
  /** IA figée (outil de développement) */
  frozen = false;

  update(dt: number): void {
    const h = this.host, p = h.player;
    if (this.frozen) return;
    this.mctx.env.night = h.night(); this.mctx.env.fog = h.fog();
    this.mctx.ents = this.entities;
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 1;
      if (h.inDungeon()) {
        for (const sid of [...this.zones.keys()]) this.deactivate(sid);
        for (const l of this.lairs) if (this.activeLairs.has(l.key)) this.deactivateLair(l);
      } else {
        for (const s of h.world.civ.settlements) {
          if (s.abandoned || s.type === 'camp') continue;
          const d = Math.hypot(s.x - p.x, s.z - p.z);
          if (d < ACTIVATE && !this.zones.has(s.id)) this.activate(s.id);
          else if (d > DEACTIVATE && this.zones.has(s.id)) this.deactivate(s.id);
        }
        for (const l of this.lairs) {
          const d = Math.hypot(l.x - p.x, l.z - p.z);
          if (d < LAIR_ON && !this.activeLairs.has(l.key) && h.world.chunks.chunkAt(l.x, l.z)) this.activateLair(l);
          else if (d > LAIR_OFF && this.activeLairs.has(l.key)) this.deactivateLair(l);
        }
      }
    }
    for (let k = 0; k < 4 && this.pathQueue.length; k++) {
      const e = this.pathQueue.shift()!;
      e.pathPending = false;
      const zone = this.zones.get(e.sid);
      if (!zone || !e.target) continue;
      e.path = zone.grid.findPath(e.x, e.z, e.target.x, e.target.z) ?? [{ x: e.target.x, z: e.target.z }];
      e.pathI = 0;
    }
    for (const e of this.entities) {
      if (e.flash > 0) e.flash -= dt;
      if (!e.alive) {
        e.deadT += dt;
        e.pose.dead = Math.min(1, e.pose.dead + dt * 2.5);
        e.pose.swing = 0;
        continue;
      }
      if (e.status) {
        const s = e.status;
        s.burn = Math.max(0, s.burn - dt); s.frost = Math.max(0, s.frost - dt); s.poison = Math.max(0, s.poison - dt);
        s.tick = (s.tick ?? 0) + dt;
        if (s.tick >= 0.5) { s.tick -= 0.5; const dot = (s.burn > 0 ? 2.5 : 0) + (s.poison > 0 ? 1.5 : 0); if (dot > 0) hitEntity(this.host.combat, e, dot, 'player'); }
        if (!e.alive) continue;
      }
      if (e.mon) {
        e.thinkT -= dt;
        if (e.thinkT <= 0) { e.thinkT = 0.3; thinkMonster(e, this.mctx); }
        moveMonster(e, dt, this.mctx);
      } else if (e.npc) {
        const zone = this.zones.get(e.sid);
        if (!zone) continue;
        e.thinkT -= dt;
        if (e.thinkT <= 0) { e.thinkT = 0.8; this.think(e, zone); }
        this.moveNpc(e, dt);
      }
    }
    // les cadavres de créatures disparaissent après un moment
    const gone = this.entities.filter((e) => !e.alive && e.mon && e.deadT > 150);
    if (gone.length) this.remove(gone);
    this.dynamic.length = 0;
    for (const e of this.entities) if (e.alive && Math.hypot(e.x - p.x, e.z - p.z) < 12) this.dynamic.push({ x: e.x, z: e.z, r: e.radius, bottom: e.y, top: e.y + e.model.height });
  }

  /** Met à jour les populations des repaires actifs (avant une sauvegarde). */
  syncLairs(): void {
    for (const l of this.lairs) {
      const ents = this.activeLairs.get(l.key);
      if (!ents) continue;
      l.alive = ents.filter((e) => e.alive && !e.mon?.leader).length;
      l.leaderAlive = ents.some((e) => e.alive && e.mon?.leader);
    }
  }

  /** Lanternes des gardes la nuit (lumières mobiles). */
  lanterns(night: number): { x: number; y: number; z: number; radius: number; r: number; g: number; b: number }[] {
    if (night < 0.4) return [];
    return this.entities.filter((e) => e.alive && e.npc && (e.npc.profession === 'garde' || e.npc.profession === 'soldat') && (e.action === 'patrouiller' || e.action === 'garder'))
      .map((e) => ({ x: e.x + Math.cos(e.heading) * 0.4, y: e.y + 1.2, z: e.z + Math.sin(e.heading) * 0.4, radius: 10, r: 1.5, g: 0.95, b: 0.5 }));
  }

  render(ib: InstanceBuffer, cx: number, cz: number, targetId: string | null): void {
    for (const e of this.entities) {
      if (Math.hypot(e.x - cx, e.z - cz) > DRAW) continue;
      drawModel(ib, e.model, e.x, e.y, e.z, e.heading, e.pose, (e.flash > 0 ? 1 : 0) | (e.id === targetId ? 2 : 0));
    }
  }

  /** Entité visée devant le joueur. */
  pick(x: number, z: number, heading: number, maxD = 3.2, alive = true): Entity | null {
    const fx = Math.sin(heading), fz = -Math.cos(heading);
    let best: Entity | null = null, bs = Infinity;
    for (const e of this.entities) {
      if (alive && !e.alive) continue;
      const dx = e.x - x, dz = e.z - z, d = Math.hypot(dx, dz);
      if (d > maxD + e.radius || d < 0.01) continue;
      const facing = (dx * fx + dz * fz) / d;
      if (facing < 0.6) continue;
      const sc = d - facing * 2;
      if (sc < bs) { bs = sc; best = e; }
    }
    return best;
  }
}

/** Passages de porte (intérieur → extérieur) de tous les bâtiments d'un plan. */
export function doorPassages(L: Layout): [number, number, number, number][] {
  return L.buildings.filter((b) => !b.ruined).map((b) => {
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const P = (lx: number, lz: number) => [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
    const [ax, az] = P(b.doorX, b.d / 2 - 1.3), [bx, bz] = P(b.doorX, b.d / 2 + 1.6);
    return [ax, az, bx, bz] as [number, number, number, number];
  });
}
