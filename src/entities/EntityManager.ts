import { Entity } from './Entity';
import { generateNPCs, type NPCData } from './NPC';
import { humanoid, drawModel, type ModelDef } from './Models';
import { NavGrid } from '../ai/Pathfinding';
import { blockAt, resolveSpot, patrolRoute, type Spot } from '../ai/Schedule';
import type { World } from '../world/World';
import type { GameTime } from '../core/Time';
import type { EventBus } from '../core/Events';
import type { Player } from './Player';
import type { Layout } from '../world/civilization/Layout';
import type { InstanceBuffer } from '../rendering/Renderer';
import type { CircleCollider, SegCollider, Platform } from '../world/Chunk';

/** Ce dont le gestionnaire a besoin du jeu (évite une dépendance circulaire). */
export interface EntityHost {
  world: World<any>;
  time: GameTime;
  player: Player;
  events: EventBus;
  inDungeon(): boolean;
  rain(): number;
}

interface ActiveZone { sid: number; L: Layout; grid: NavGrid; ents: Entity[]; patrol: { x: number; z: number }[] }

const ACTIVATE = 250, DEACTIVATE = 330, DRAW = 170;

/**
 * Simulation par niveaux : les implantations proches sont « actives » (PNJ incarnés, chemins,
 * IA complète) ; au loin, les PNJ ne sont que des données dont la position découle de leur
 * emploi du temps. L'état important (vie, mémoire) vit dans NPCData et survit au déchargement.
 */
export class EntityManager {
  entities: Entity[] = [];
  readonly zones = new Map<number, ActiveZone>();
  private npcData = new Map<number, NPCData[]>();
  private pathQueue: Entity[] = [];
  private checkT = 0;
  private circles: CircleCollider[] = [];
  private segs: SegCollider[] = [];
  private plats: Platform[] = [];
  readonly dynamic: CircleCollider[] = [];
  private models = new Map<string, ModelDef>();

  constructor(private host: EntityHost) {}

  /** PNJ d'une implantation (générés une fois, conservés). */
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
  findNpc(id: string): NPCData | undefined {
    const sid = parseInt(id.slice(1), 10);
    return this.npcsOf(sid).find((n) => n.id === id);
  }

  private modelFor(n: NPCData): ModelDef {
    const key = n.id;
    let m = this.models.get(key);
    if (!m) {
      const c = n.colors;
      m = humanoid({
        skin: c.skin, shirt: n.look === 'garde' ? 0x8a8a94 : n.look === 'noble' ? 0x6a2a6a : c.shirt, pants: c.pants, hair: c.hair,
        helmet: n.look === 'garde', robe: n.look === 'moine', weapon: n.look === 'garde' ? 'lance' : n.profession === 'forgeron' ? 'massue' : null,
        shield: n.look === 'garde', scale: 0.92 + ((n.age * 13) % 17) / 100, letter: '@',
      });
      this.models.set(key, m);
    }
    return m;
  }

  private activate(sid: number) {
    const w = this.host.world, s = w.civ.settlements[sid];
    const L = w.civWorld.layouts.find((x) => x.sid === sid);
    if (!L || !w.chunks.chunkAt(s.x, s.z)) return;
    const grid = NavGrid.build(w.chunks, s.x, s.z, s.radius + 55, doorPassages(L));
    const zone: ActiveZone = { sid, L, grid, ents: [], patrol: patrolRoute(L) };
    const minute = this.host.time.minuteOfDay, hour = this.host.time.hour;
    for (const n of this.npcsOf(sid)) {
      if (!n.alive) continue;
      const e = new Entity(n.id, 'npc', n.look, `${n.first} ${n.last}`, this.modelFor(n), n.hp);
      e.npc = n; e.sid = sid;
      e.speed = n.profession === 'garde' ? 1.6 : 1.3 + n.traits.sociability * 0.3;
      const sp = this.spotFor(e, zone, minute, hour);
      e.spot = sp;
      const free = grid.nearestFree(sp.x, sp.z, 4);
      e.x = free >= 0 ? grid.x0 + (free % grid.w) + 0.5 : sp.x;
      e.z = free >= 0 ? grid.z0 + Math.floor(free / grid.w) + 0.5 : sp.z;
      if (sp.lying) { e.x = sp.x; e.z = sp.z; }
      e.y = this.ground(e.x, e.z, 1000);
      e.thinkT = ((n.id.charCodeAt(n.id.length - 1) * 37) % 80) / 100; // désynchronise les décisions
      zone.ents.push(e); this.entities.push(e);
    }
    this.zones.set(sid, zone);
  }

  private deactivate(sid: number) {
    const z = this.zones.get(sid);
    if (!z) return;
    for (const e of z.ents) if (e.npc) e.npc.hp = e.hp;
    this.entities = this.entities.filter((e) => !z.ents.includes(e));
    this.pathQueue = this.pathQueue.filter((e) => !z.ents.includes(e));
    this.zones.delete(sid);
  }

  clear(): void { for (const sid of [...this.zones.keys()]) this.deactivate(sid); }

  private spotFor(e: Entity, zone: ActiveZone, minute: number, hour: number): Spot {
    const n = e.npc!;
    const b = blockAt(n, minute);
    if (b.place === 'patrol') {
      const i = (Math.floor(minute / 6) + parseInt(n.id.split(':')[1], 10)) % zone.patrol.length;
      const p = zone.patrol[i];
      return { x: p.x, z: p.z, building: -1, lying: false, face: null, outdoor: true };
    }
    // sous la pluie, ceux qui devraient être dehors (hors gardes) s'abritent
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
    let g = w.heightAt(x, z);
    w.chunks.collidersNear(x, z, this.circles, this.segs, this.plats);
    for (const p of this.plats) {
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = x - p.cx, dz = z - p.cz;
      if (Math.abs(dx * c - dz * s) <= p.hw && Math.abs(dx * s + dz * c) <= p.hd && p.top <= fromY + 0.7 && p.top > g) g = p.top;
    }
    return g;
  }

  private think(e: Entity, zone: ActiveZone) {
    const n = e.npc!;
    const p = this.host.player;
    const minute = this.host.time.minuteOfDay, hour = this.host.time.hour;
    const dPlayer = Math.hypot(p.x - e.x, p.z - e.z);
    // utilité : parler (le joueur vient d'interagir), suivre l'emploi du temps
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
    // saluer du regard un joueur tout proche
    e.faceTo = dPlayer < 3 && !e.path ? Math.atan2(p.x - e.x, -(p.z - e.z)) : sp.face;
  }

  private move(e: Entity, dt: number) {
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
    if (moving && !blocked) {
      const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1;
      const step = Math.min(d, e.speed * dt);
      e.x += (dx / d) * step; e.z += (dz / d) * step;
      e.heading = turn(e.heading, Math.atan2(dx, -dz), dt * 6);
      e.pose.walk += dt * e.speed * 4.2;
    } else {
      e.pose.walk *= 0.8;
      if (e.faceTo !== null) e.heading = turn(e.heading, e.faceTo, dt * 4);
      if (e.path && e.pathI >= e.path.length) { e.path = null; e.target = null; }
    }
    const lying = !moving && e.spot?.lying && Math.hypot(e.spot.x - e.x, e.spot.z - e.z) < 0.6 && e.action === 'dormir';
    e.pose.dead += ((lying ? 1 : 0) - e.pose.dead) * Math.min(1, dt * 3);
    const working = !moving && e.action === 'travailler' && (e.npc?.profession === 'forgeron' || e.npc?.profession === 'meunier' || e.npc?.profession === 'artisan');
    e.pose.swing = working ? Math.max(0, Math.sin(performance.now() / 160)) * 0.9 : Math.max(0, e.pose.swing - dt * 3);
    const gy = this.ground(e.x, e.z, e.y + 0.3);
    e.y += (gy + (lying ? 0.5 : 0) - e.y) * Math.min(1, dt * 12);
    if (e.talkT > 0) e.talkT -= dt;
    if (e.flash > 0) e.flash -= dt;
  }

  update(dt: number): void {
    const h = this.host, p = h.player;
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 1;
      if (h.inDungeon()) this.clear();
      else {
        for (const s of h.world.civ.settlements) {
          if (s.abandoned || s.type === 'camp') continue;
          const d = Math.hypot(s.x - p.x, s.z - p.z);
          if (d < ACTIVATE && !this.zones.has(s.id)) this.activate(s.id);
          else if (d > DEACTIVATE && this.zones.has(s.id)) this.deactivate(s.id);
        }
      }
    }
    // chemins : quelques requêtes par image
    for (let k = 0; k < 4 && this.pathQueue.length; k++) {
      const e = this.pathQueue.shift()!;
      e.pathPending = false;
      const zone = this.zones.get(e.sid);
      if (!zone || !e.target) continue;
      e.path = zone.grid.findPath(e.x, e.z, e.target.x, e.target.z) ?? [{ x: e.target.x, z: e.target.z }];
      e.pathI = 0;
    }
    for (const zone of this.zones.values()) for (const e of zone.ents) {
      if (!e.alive) continue;
      e.thinkT -= dt;
      if (e.thinkT <= 0) { e.thinkT = 0.8; this.think(e, zone); }
      this.move(e, dt);
    }
    this.dynamic.length = 0;
    for (const e of this.entities) if (e.alive && Math.hypot(e.x - p.x, e.z - p.z) < 12) this.dynamic.push({ x: e.x, z: e.z, r: e.radius, bottom: e.y, top: e.y + e.model.height });
  }

  render(ib: InstanceBuffer, cx: number, cz: number): void {
    for (const e of this.entities) {
      if (Math.hypot(e.x - cx, e.z - cz) > DRAW) continue;
      drawModel(ib, e.model, e.x, e.y, e.z, e.heading, e.pose, e.flash > 0 ? 1 : 0);
    }
  }

  /** Entité visée devant le joueur (≤ 3,2 m). */
  pick(x: number, z: number, heading: number, maxD = 3.2): Entity | null {
    const fx = Math.sin(heading), fz = -Math.cos(heading);
    let best: Entity | null = null, bs = Infinity;
    for (const e of this.entities) {
      const dx = e.x - x, dz = e.z - z, d = Math.hypot(dx, dz);
      if (d > maxD || d < 0.01) continue;
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

function turn(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}
