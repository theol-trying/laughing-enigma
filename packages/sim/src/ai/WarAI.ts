import type { Entity, RemoteTarget } from '../entities/Entity';
import type { Player } from '../entities/Player';
import { MONSTERS } from '../entities/Monster';
import { hitEntity, hitPlayer, type CombatHost } from '../gameplay/Combat';
import { turn } from './MonsterAI';

// IA des soldats d'une bataille (guerre entre factions) : chacun marche vers le front (sa place, recalculée par le jeu),
// s'en prend au soldat ennemi le plus proche de la même bataille, à une créature qui l'attaque, au joueur s'il combat
// dans l'autre camp, ou à l'autre joueur qui l'a frappé. Très blessé, il rompt et fuit vers l'arrière de son camp.

export interface WarAICtx {
  player: Player;
  ents: Entity[];
  combat: CombatHost;
  /** autres joueurs (multijoueur) et coups qui leur sont portés */
  others: RemoteTarget[];
  hurtRemote(id: string, amount: number, src: Entity): void;
  ground(x: number, z: number, fromY: number): number;
  /** pas sans franchir de mur ni entrer dans l'eau profonde ; false : bloqué */
  walk(e: Entity, mx: number, mz: number): boolean;
  /** le joueur local combat-il ce camp (il l'a attaqué, ou sert l'ennemi) ? */
  enemyOf(side: number): boolean;
}

const SEE = 42, PLAYER_SEE = 30, REACH = 1.9, ROUT = 0.22;

/** Adversaire le plus proche : soldat de l'autre camp (même bataille), créature qui le vise. */
function nearestFoe(e: Entity, ctx: WarAICtx): { ent: Entity | null; d: number } {
  const t = e.event!, prefix = `e${t.id}:`;
  let best: Entity | null = null, bd = SEE;
  for (const o of ctx.ents) {
    if (o === e || !o.alive) continue;
    const ot = o.event;
    let enemy = false;
    if (ot) enemy = ot.role === 'soldat' && ot.id === t.id && ot.side !== t.side && !ot.routed;
    else if (o.mon) { const m = o.mon; enemy = !m.yielded && !MONSTERS[m.def]?.prey && !!m.targetId && (m.targetId === e.id || m.targetId.startsWith(prefix)); }
    if (!enemy) continue;
    const d = Math.hypot(o.x - e.x, o.z - e.z);
    if (d < bd) { bd = d; best = o; }
  }
  return { ent: best, d: bd };
}

function goTo(e: Entity, tx: number, tz: number, speed: number, dt: number, ctx: WarAICtx): number {
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
  if (d < 0.05) return 0;
  const st = Math.min(d, speed * dt);
  const moved = ctx.walk(e, (dx / d) * st, (dz / d) * st) ? st : 0;
  e.heading = turn(e.heading, Math.atan2(dx, -dz), dt * 7);
  return moved;
}

/** Une image de la vie d'un soldat (zone simulée ici). */
export function updateSoldier(e: Entity, dt: number, ctx: WarAICtx): void {
  const t = e.event!, p = ctx.player;
  e.thinkT -= dt;
  if (e.thinkT <= 0) {
    e.thinkT = 0.35;
    if (!t.routed && e.hp < e.maxHp * ROUT) { t.routed = true; e.foe = null; }
    if (t.routed) e.action = 'fuir';
    else {
      const f = nearestFoe(e, ctx);
      e.foe = f.ent; e.action = f.ent ? 'combattre' : 'marcher';
      // le joueur, s'il est de l'autre camp et plus proche que tout autre adversaire
      const pd = Math.hypot(p.x - e.x, p.z - e.z);
      if (!p.dead && ctx.enemyOf(t.side) && pd < Math.min(f.d, PLAYER_SEE)) { e.foe = null; e.action = 'joueur'; }
      // un autre joueur qui l'a frappé
      if (t.grudge && e.action !== 'joueur') {
        const o = ctx.others.find((r) => r.id === t.grudge && !r.dead);
        if (o && Math.hypot(o.x - e.x, o.z - e.z) < Math.min(f.d, PLAYER_SEE)) { e.foe = null; e.action = 'distant'; }
        else if (!o) t.grudge = '';
      }
    }
  }
  if (e.action !== 'dormir') e.pose.dead = Math.max(0, e.pose.dead - dt * 4);
  let moved = 0, run = false;
  if (e.action === 'combattre' || e.action === 'joueur' || e.action === 'distant') {
    const foe = e.foe, other = e.action === 'distant' ? ctx.others.find((r) => r.id === t.grudge) : undefined;
    const tx = foe ? foe.x : other ? other.x : p.x, tz = foe ? foe.z : other ? other.z : p.z;
    const d = Math.hypot(tx - e.x, tz - e.z), reach = REACH + (foe ? foe.radius * 0.5 : 0);
    e.heading = turn(e.heading, Math.atan2(tx - e.x, -(tz - e.z)), dt * 8);
    if (d > reach) { moved = goTo(e, tx, tz, 3.3, dt, ctx); run = true; }
    else {
      e.cooldown -= dt;
      e.pose.swing = Math.max(0, e.cooldown - 0.6);
      if (e.cooldown <= 0) {
        e.cooldown = 1.25;
        if (foe) { if (foe.alive) hitEntity(ctx.combat, foe, t.dmg, e.id); }
        else if (other) ctx.hurtRemote(other.id, t.dmg, e);
        else hitPlayer(ctx.combat, t.dmg, e);
      }
    }
    if (foe && !foe.alive) { e.foe = null; e.thinkT = 0; }
  } else if (e.action === 'fuir') {
    moved = goTo(e, t.fx, t.fz, 3.6, dt, ctx); run = true;
    e.pose.swing = Math.max(0, e.pose.swing - dt * 3);
  } else if (e.talkT > 0) {
    e.heading = turn(e.heading, Math.atan2(p.x - e.x, -(p.z - e.z)), dt * 5);
    e.pose.swing = Math.max(0, e.pose.swing - dt * 3);
  } else {
    // en marche vers le front, ou en position
    const d = Math.hypot(t.tx - e.x, t.tz - e.z);
    if (d > 0.3) { const sp = Math.min(2.8, 1.5 + d * 0.15); moved = goTo(e, t.tx, t.tz, sp, dt, ctx); run = sp > 2.2; }
    else if (t.face !== null) e.heading = turn(e.heading, t.face, dt * 3);
    e.pose.swing = Math.max(0, e.pose.swing - dt * 3);
  }
  if (moved > 0) e.pose.walk += moved * (run ? 3.4 : 4.2);
  else e.pose.walk *= 0.85;
  const gy = ctx.ground(e.x, e.z, e.y + 0.4);
  e.y += (gy - e.y) * Math.min(1, dt * 12);
  if (e.talkT > 0) e.talkT -= dt;
}
