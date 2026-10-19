import type { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import { MONSTERS } from '../entities/Monster';
import { hitEntity, hitPlayer, type CombatHost } from '../gameplay/Combat';
import { turn } from './MonsterAI';

// IA des membres d'un convoi : chacun tient sa place dans la colonne (le jeu la recalcule à chaque image, autour du
// chariot ou du meneur), rattrape le convoi s'il s'est attardé, dort au campement. Face à une créature hostile, les gardes
// et les soldats combattent (comme les gardes des villages) ; les autres s'écartent de la menace sans quitter le convoi.
// Hostiles au joueur (agression, délit vu par une patrouille) : les combattants le prennent en chasse, les autres fuient.

export interface ConvoyAICtx {
  player: Player;
  ents: Entity[];
  combat: CombatHost;
  ground(x: number, z: number, fromY: number): number;
  /** pas sans franchir de mur ni entrer dans l'eau profonde ; false : bloqué */
  walk(e: Entity, mx: number, mz: number): boolean;
}

const THREAT_R = 24, CHASE_R = 45, FLEE_R = 9, LEASH = 26;

/** Créature hostile qui menace ce membre : elle le vise, vise un autre membre du convoi, ou rôde tout près en chasse. */
function threatOf(e: Entity, ctx: ConvoyAICtx): Entity | null {
  const prefix = `v${e.convoy!.id}:`;
  let best: Entity | null = null, bd = THREAT_R;
  for (const o of ctx.ents) {
    const m = o.mon;
    if (!m || !o.alive || m.yielded || MONSTERS[m.def]?.prey || (m.aggro <= 0.3 && m.targetId !== e.id)) continue;
    const d = Math.hypot(o.x - e.x, o.z - e.z);
    if (d >= bd) continue;
    const aimed = m.targetId === e.id || (!!m.targetId && m.targetId.startsWith(prefix));
    if (aimed || ((m.alerted || m.state === 'chasse') && d < 14)) { bd = d; best = o; }
  }
  return best;
}

function goTo(e: Entity, tx: number, tz: number, speed: number, dt: number, ctx: ConvoyAICtx): number {
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
  if (d < 0.05) return 0;
  const st = Math.min(d, speed * dt);
  const moved = ctx.walk(e, (dx / d) * st, (dz / d) * st) ? st : 0;
  e.heading = turn(e.heading, Math.atan2(dx, -dz), dt * 7);
  return moved;
}

/** Une image de la vie d'un membre (zone simulée ici). */
export function updateConvoyMember(e: Entity, dt: number, ctx: ConvoyAICtx): void {
  const c = e.convoy!, p = ctx.player;
  const pd = Math.hypot(p.x - e.x, p.z - e.z);
  e.thinkT -= dt;
  if (e.thinkT <= 0) {
    e.thinkT = 0.4;
    c.threat = threatOf(e, ctx);
    const angry = e.hostile && !p.dead && pd < CHASE_R;
    if (angry) { e.action = c.fighter ? 'combattre' : 'fuir'; e.foe = null; }
    else if (c.threat) { e.action = c.fighter ? 'combattre' : 'fuir'; e.foe = c.fighter ? c.threat : null; }
    else { e.action = c.lie ? 'dormir' : c.watch ? 'garder' : 'voyager'; e.foe = null; }
    if (e.action === 'fuir') {
      // s'écarter de la menace (créature ou joueur), sans trop s'éloigner de sa place dans le convoi
      const sx = angry ? p.x : c.threat!.x, sz = angry ? p.z : c.threat!.z;
      const ax = e.x - sx, az = e.z - sz, l = Math.hypot(ax, az) || 1;
      let fx = e.x + (ax / l) * FLEE_R, fz = e.z + (az / l) * FLEE_R;
      const lx = fx - c.tx, lz = fz - c.tz, ll = Math.hypot(lx, lz);
      if (ll > LEASH && !angry) { fx = c.tx + (lx / ll) * LEASH; fz = c.tz + (lz / ll) * LEASH; }
      c.fx = fx; c.fz = fz;
    }
  }
  if (e.action !== 'dormir') e.pose.dead = Math.max(0, e.pose.dead - dt * 4);
  let moved = 0, run = false;
  if (e.action === 'combattre') {
    const foe = e.foe, tx = foe ? foe.x : p.x, tz = foe ? foe.z : p.z, d = Math.hypot(tx - e.x, tz - e.z), reach = foe ? 1.8 : 1.9;
    e.heading = turn(e.heading, Math.atan2(tx - e.x, -(tz - e.z)), dt * 8);
    if (d > reach) { moved = goTo(e, tx, tz, 3.4, dt, ctx); run = true; }
    else {
      e.cooldown -= dt;
      e.pose.swing = Math.max(0, e.cooldown - 0.6);
      if (e.cooldown <= 0) {
        e.cooldown = 1.3;
        if (foe) { if (foe.alive) hitEntity(ctx.combat, foe, c.dmg, e.id); }
        else hitPlayer(ctx.combat, c.dmg, e);
      }
    }
    if (foe && !foe.alive) { e.foe = null; e.thinkT = 0; }
  } else if (e.action === 'fuir') {
    moved = goTo(e, c.fx, c.fz, 3.6, dt, ctx); run = true;
    e.pose.swing = Math.max(0, e.pose.swing - dt * 3);
  } else if (e.talkT > 0) {
    e.heading = turn(e.heading, Math.atan2(p.x - e.x, -(p.z - e.z)), dt * 5);
    e.pose.swing = Math.max(0, e.pose.swing - dt * 3);
  } else {
    // sa place dans la colonne : on y va à l'allure du convoi, plus vite si l'on s'est laissé distancer
    const d = Math.hypot(c.tx - e.x, c.tz - e.z);
    if (d > 0.2) {
      const sp = Math.min(3.2, c.speed + d * 0.8);
      moved = goTo(e, c.tx, c.tz, sp, dt, ctx);
      run = sp > 2.2;
    } else if (c.face !== null) e.heading = turn(e.heading, c.face, dt * 3);
    const lying = c.lie && d < 0.8;
    e.pose.dead += ((lying ? 1 : 0) - e.pose.dead) * Math.min(1, dt * 2.5);
    e.pose.swing = Math.max(0, e.pose.swing - dt * 3);
  }
  if (moved > 0) e.pose.walk += moved * (run ? 3.4 : 4.2);
  else e.pose.walk *= 0.85;
  const gy = ctx.ground(e.x, e.z, e.y + 0.4);
  e.y += (gy - e.y) * Math.min(1, dt * 12);
  if (e.talkT > 0) e.talkT -= dt;
}
