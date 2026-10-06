import type { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import { MONSTERS } from '../entities/Monster';
import { perceives, type Env } from './Perception';
import { hitEntity, hitPlayer, type CombatHost } from '../gameplay/Combat';
import type { ChunkManager } from '../world/ChunkManager';
import type { CircleCollider, SegCollider, Platform } from '../world/Chunk';
import { segDist } from '../core/math';

// IA des créatures par fonctions d'utilité : repos, errance, patrouille, garde, chasse,
// attaque, fuite, retour au territoire. Les membres d'un même repaire s'alertent entre eux.

export interface MonsterCtx {
  chunks: ChunkManager<any>;
  player: Player;
  ents: Entity[];
  env: Env;
  combat: CombatHost;
  ground(x: number, z: number, fromY: number): number;
  hash(e: Entity, k: number): number; // pseudo-aléa stable (errance)
}

const HOSTILE_TO_VILLAGERS = new Set(['loup', 'bandit', 'chef bandit', 'gobelin', 'chef gobelin', 'squelette', 'spectre', 'troll', 'araignée', 'roi-squelette', 'gardien des tombes']);

function targetPos(id: string, ctx: MonsterCtx): { x: number; z: number; y: number; alive: boolean; ent: Entity | null } | null {
  if (id === 'player') { const p = ctx.player; return { x: p.x, z: p.z, y: p.y, alive: !p.dead, ent: null }; }
  const t = ctx.ents.find((e) => e.id === id);
  return t ? { x: t.x, z: t.z, y: t.y, alive: t.alive, ent: t } : null;
}

export function thinkMonster(e: Entity, ctx: MonsterCtx): void {
  const m = e.mon!, d = MONSTERS[m.def];
  const p = ctx.player;
  const homeD = Math.hypot(e.x - m.homeX, e.z - m.homeZ);
  const roam = m.territory * (m.def === 'loup' && ctx.env.night > 0.5 ? 2.5 : 1);
  // fuite quand la vie est basse (les morts-vivants ne fuient pas)
  if (d.flee > 0 && e.hp < e.maxHp * d.flee) { m.state = 'fuite'; return; }
  // trop loin du territoire : on rentre et on oublie la proie
  if (homeD > roam * 1.8 && m.state !== 'fuite') { m.state = 'retour'; m.targetId = null; m.alerted = false; return; }
  const asleep = m.nocturnal && ctx.env.night < 0.3 && !m.alerted && homeD < 20;
  // cible actuelle encore valable ?
  if (m.targetId) {
    const t = targetPos(m.targetId, ctx);
    if (!t || !t.alive || Math.hypot(t.x - e.x, t.z - e.z) > m.perception * 1.8) { m.targetId = null; m.alerted = false; }
  }
  if (!m.targetId) {
    // candidats : le joueur, et les villageois pour les créatures hostiles
    const cands: { id: string; x: number; z: number; y: number; stealth: number; noise: number }[] = [];
    if (!p.dead) cands.push({ id: 'player', x: p.x, z: p.z, y: p.y, stealth: p.crouch ? 1 : 0, noise: p.sprinting ? 1 : 0 });
    if (HOSTILE_TO_VILLAGERS.has(m.def)) for (const o of ctx.ents) if (o.npc && o.alive && Math.hypot(o.x - e.x, o.z - e.z) < m.perception) cands.push({ id: o.id, x: o.x, z: o.z, y: o.y, stealth: 0, noise: 0.2 });
    cands.sort((a, b) => Math.hypot(a.x - e.x, a.z - e.z) - Math.hypot(b.x - e.x, b.z - e.z));
    for (const c of cands) {
      if (Math.hypot(c.x - e.x, c.z - e.z) > m.perception * 1.2) break;
      if (!perceives(ctx.chunks, { x: e.x, z: e.z, y: e.y, heading: e.heading, range: m.perception, nocturnal: m.nocturnal, asleep }, c, ctx.env)) continue;
      if (ctx.hash(e, 7) > m.aggro && c.id === 'player' && !m.alerted) continue; // créature peu agressive : laisse passer
      m.targetId = c.id; m.alerted = true;
      // appel des alliés du même repaire
      for (const o of ctx.ents) if (o.mon && o.alive && o.mon.lair === m.lair && m.lair && !o.mon.targetId && Math.hypot(o.x - e.x, o.z - e.z) < 35) { o.mon.targetId = c.id; o.mon.alerted = true; }
      break;
    }
  }
  if (m.targetId) { m.state = 'chasse'; return; }
  if (asleep) { m.state = 'repos'; return; }
  m.state = m.def === 'bandit' || m.def === 'chef bandit' ? 'patrouille' : m.def === 'squelette' || m.def === 'spectre' ? 'garde' : 'errance';
}

const tmpC: CircleCollider[] = [], tmpS: SegCollider[] = [], tmpP: Platform[] = [];

function slide(ctx: MonsterCtx, e: Entity, nx: number, nz: number): [number, number] {
  ctx.chunks.collidersNear(nx, nz, tmpC, tmpS, tmpP);
  for (const c of tmpC) {
    if (Math.abs(c.x - e.x) < 0.01 && Math.abs(c.z - e.z) < 0.01) continue; // soi-même (collision dynamique)
    if (e.y + 1.5 < c.bottom || e.y > c.top - 0.2) continue;
    const dx = nx - c.x, dz = nz - c.z, dd = Math.hypot(dx, dz), min = c.r + e.radius;
    if (dd < min && dd > 1e-5) { nx = c.x + (dx / dd) * min; nz = c.z + (dz / dd) * min; }
  }
  for (const s of tmpS) {
    if (e.y + 1.5 < s.bottom || e.y > s.top - 0.3) continue;
    const { d, t } = segDist(nx, nz, s.ax, s.az, s.bx, s.bz);
    const min = s.r + e.radius;
    if (d < min) {
      const px = s.ax + (s.bx - s.ax) * t, pz = s.az + (s.bz - s.az) * t;
      const dx = nx - px, dz = nz - pz, l = Math.hypot(dx, dz) || 1;
      nx = px + (dx / l) * min; nz = pz + (dz / l) * min;
    }
  }
  return [nx, nz];
}

export function moveMonster(e: Entity, dt: number, ctx: MonsterCtx): void {
  const m = e.mon!, d = MONSTERS[m.def];
  m.cooldown -= dt;
  let tx = e.x, tz = e.z, speed = d.walk, go = true;
  switch (m.state) {
    case 'repos': go = false; break;
    case 'fuite': {
      const t = m.targetId ? targetPos(m.targetId, ctx) : null;
      const ax = t ? e.x - t.x : e.x - m.homeX, az = t ? e.z - t.z : e.z - m.homeZ, l = Math.hypot(ax, az) || 1;
      tx = e.x + (ax / l) * 10; tz = e.z + (az / l) * 10; speed = d.run;
      if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + dt * 0.5);
      if (t && Math.hypot(t.x - e.x, t.z - e.z) > m.perception * 1.5) { m.state = 'retour'; m.targetId = null; }
      break;
    }
    case 'retour':
      tx = m.homeX; tz = m.homeZ;
      if (Math.hypot(tx - e.x, tz - e.z) < 4) { m.state = 'repos'; e.hp = Math.min(e.maxHp, e.hp + dt * 4); }
      break;
    case 'chasse': {
      const t = m.targetId ? targetPos(m.targetId, ctx) : null;
      if (!t) { m.state = 'retour'; break; }
      const dist = Math.hypot(t.x - e.x, t.z - e.z);
      tx = t.x; tz = t.z; speed = d.run;
      e.heading = turn(e.heading, Math.atan2(t.x - e.x, -(t.z - e.z)), dt * 8);
      // deux assaillants au plus par cible : les autres tournent autour et attendent leur tour
      let busy = 0;
      for (const o of ctx.ents) if (o !== e && o.alive && o.mon && o.mon.targetId === m.targetId && (o.mon.windup > 0 || Math.hypot(o.x - t.x, o.z - t.z) < MONSTERS[o.mon.def].reach + 0.5)) busy++;
      if (busy >= 2 && dist < 5) {
        const a = Math.atan2(e.x - t.x, e.z - t.z) + dt * 0.8;
        tx = t.x + Math.sin(a) * 4; tz = t.z + Math.cos(a) * 4; speed = d.walk * 1.4;
        break;
      }
      if (dist < d.reach + (t.ent ? t.ent.radius : 0.35)) {
        go = false;
        if (m.windup > 0) {
          m.windup -= dt;
          e.pose.swing = 1 - Math.max(0, m.windup) / 0.4;
          if (m.windup <= 0) {
            m.cooldown = d.attackCd;
            if (dist < d.reach + 0.6) {
              if (t.ent) hitEntity(ctx.combat, t.ent, d.damage * 0.8, e.id, d.element);
              else hitPlayer(ctx.combat, d.damage, e, d.element);
            }
          }
        } else if (m.cooldown <= 0) m.windup = 0.4;
      }
      break;
    }
    default: {
      // errance / patrouille / garde : points du territoire (plus loin la nuit pour les loups)
      const roam = m.territory * (m.def === 'loup' && ctx.env.night > 0.5 ? 2.5 : 1) * (m.state === 'garde' ? 0.3 : 0.7);
      const slot = Math.floor(performance.now() / 9000);
      const a = ctx.hash(e, slot) * Math.PI * 2, r = ctx.hash(e, slot + 101) * roam;
      tx = m.homeX + Math.cos(a) * r; tz = m.homeZ + Math.sin(a) * r;
      if (Math.hypot(tx - e.x, tz - e.z) < 1.5) go = false;
    }
  }
  if (m.windup <= 0) e.pose.swing = Math.max(0, e.pose.swing - dt * 4);
  if (e.status && e.status.frost > 0) speed *= 0.5; // le givre ralentit
  if (go) {
    const dx = tx - e.x, dz = tz - e.z, l = Math.hypot(dx, dz);
    if (l > 0.3) {
      const step = Math.min(l, speed * dt);
      const [nx, nz] = slide(ctx, e, e.x + (dx / l) * step, e.z + (dz / l) * step);
      e.x = nx; e.z = nz;
      if (m.state !== 'chasse') e.heading = turn(e.heading, Math.atan2(dx, -dz), dt * 5);
      e.pose.walk += dt * speed * 3.2;
    }
  } else e.pose.walk *= 0.85;
  const g = ctx.ground(e.x, e.z, e.y + 0.4);
  e.y += (g - e.y) * Math.min(1, dt * 10);
}

export function turn(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}
