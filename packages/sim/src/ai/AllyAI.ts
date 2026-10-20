import type { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import type { EventBus } from '@ascii-fort/core/Events';
import { MONSTERS } from '../entities/Monster';
import { hitEntity, type CombatHost } from '../gameplay/Combat';
import { HORSE_GRADES, MERC, MOUNT, gaitOf, tickHorse, worldOf } from '../gameplay/Companions';
import { turn } from './MonsterAI';

// IA des compagnons du joueur (Entity.ally) : le cheval (monté il suit le joueur ; à pied il attend, accourt au sifflet,
// fuit s'il est blessé) et le mercenaire (suit ou attend, combat les monstres qui menacent le joueur, tombe à terre puis se relève).
// Le déplacement (A* en ville, ligne droite en extérieur, sans eau profonde) est fourni par EntityManager via AllyCtx.

export interface AllyCtx {
  player: Player; ents: Entity[]; combat: CombatHost; events: EventBus;
  ground(x: number, z: number, fromY: number): number;
  /** déplace l'entité de (mx, mz) sans franchir un mur ni entrer dans l'eau profonde ; false si bloquée */
  step(e: Entity, mx: number, mz: number): boolean;
  /** marche vers (tx, tz) (A* si l'entité et la cible sont dans la grille d'une zone active, sinon ligne droite) ; renvoie la distance restante */
  goto(e: Entity, tx: number, tz: number, speed: number, dt: number): number;
  /** l'entité et (x, z) sont dans la même grille de navigation (ville) */
  navigable(e: Entity, x: number, z: number): boolean;
  /** monstre que le joueur a frappé dans les 8 dernières secondes */
  playerFoe(): string | null;
}

const BARKS = ['Ils arrivent !', 'À moi !', 'Je m’en occupe !', 'En garde !'];
const say = (c: AllyCtx, text: string, color = 0xa8d0f0) => c.events.emit('message', { text, color });
const snapGround = (e: Entity, dt: number, c: AllyCtx) => { const g = c.ground(e.x, e.z, e.y + 0.4); if (g > -20) e.y += (g - e.y) * Math.min(1, dt * 10); };

export function updateAlly(e: Entity, dt: number, c: AllyCtx): void {
  const a = e.ally!;
  a.lastHurt += dt; a.barkT -= dt; e.thinkT -= dt;
  if (a.kind === 'horse') updateHorse(e, dt, c); else updateMerc(e, dt, c);
}

// ---------------------------------------------------------------- cheval

/** menace proche du cheval : monstre qui le vise, ou alerté / en chasse */
function threatNear(e: Entity, c: AllyCtx, r: number): Entity | null {
  let best: Entity | null = null, bd = r;
  for (const o of c.ents) {
    if (!o.mon || !o.alive || MONSTERS[o.mon.def]?.prey) continue;
    const d = Math.hypot(o.x - e.x, o.z - e.z);
    if (d < bd && (o.mon.targetId === e.id || o.mon.alerted || o.mon.state === 'chasse')) { bd = d; best = o; }
  }
  return best;
}

function updateHorse(e: Entity, dt: number, c: AllyCtx): void {
  const a = e.ally!, p = c.player, g = HORSE_GRADES[a.grade];
  if (a.lastHurt > MOUNT.calm && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + MOUNT.hpRegen * dt);
  if (a.mounted) {
    // monté : le cheval est sous le joueur (sa position, son sol) ; le cap suit la direction réelle, l'endurance se vide au galop
    const v = Math.hypot(p.vx, p.vz), gait = gaitOf(v, p.sprinting), was = a.winded;
    a.dormant = false;
    e.x = p.x; e.y = p.y; e.z = p.z; e.pose.dead = 0;
    if (v > 0.8) e.heading = turn(e.heading, Math.atan2(p.vx, -p.vz), dt * 5);
    e.pose.walk = gait === 'arret' ? e.pose.walk * 0.9 : e.pose.walk + v * dt * (gait === 'galop' ? 2 : 2.3);
    e.pose.swing = gait === 'galop' ? 0.3 : 0;
    tickHorse(a, g, dt, gait);
    if (a.winded && !was) say(c, `${e.name} s’essouffle : relâchez Maj, au trot !`, 0xf09040);
    return;
  }
  // à pied : gelé hors du monde du joueur ou à plus de 200 m (ni simulé, ni ciblable)
  a.dormant = worldOf(e.x, e.z) !== worldOf(p.x, p.z) || Math.hypot(e.x - p.x, e.z - p.z) > MOUNT.farFreeze;
  if (a.dormant) return;
  tickHorse(a, g, dt, 'arret');
  const limp = e.hp < e.maxHp * MOUNT.limpHp ? MOUNT.limpMul : 1;
  const threat = a.mode === 'fuite' ? null : threatNear(e, c, 14);
  if (threat && e.hp < e.maxHp * MOUNT.fleeHp) {
    // blessé et menacé : il fuit à l'opposé du monstre, un peu vers le joueur s'il est à moins de 50 m
    const ax = e.x - threat.x, az = e.z - threat.z, l = Math.hypot(ax, az) || 1, dp = Math.hypot(p.x - e.x, p.z - e.z) || 1;
    const bias = dp < 50 ? 0.6 : 0, fx = ax / l + ((p.x - e.x) / dp) * bias, fz = az / l + ((p.z - e.z) / dp) * bias, fl = Math.hypot(fx, fz) || 1;
    a.mode = 'fuite'; a.fleeT = MOUNT.fleeSeconds; a.fleeDx = fx / fl; a.fleeDz = fz / fl;
    say(c, `${e.name} prend la fuite !`, 0xf09040);
  }
  switch (a.mode) {
    case 'fuite': {
      a.fleeT -= dt;
      const sp = g.gallop * limp;
      c.step(e, a.fleeDx * sp * dt, a.fleeDz * sp * dt);
      e.heading = turn(e.heading, Math.atan2(a.fleeDx, -a.fleeDz), dt * 6);
      e.pose.walk += dt * sp * 2.2;
      if (a.fleeT <= 0) a.mode = 'attendre';
      break;
    }
    case 'siffle': {
      // accourt vers le joueur (ou vers la porte du bâtiment où il se trouve : a.post) au galop
      const tx = a.post?.x ?? p.x, tz = a.post?.z ?? p.z;
      const d = c.goto(e, tx, tz, g.gallop * limp, dt);
      if (d <= MOUNT.stopDist) { a.mode = 'attendre'; a.stuck = 0; a.post = null; }
      else if (a.stuck > MOUNT.stuckGiveUp) { a.mode = 'attendre'; a.stuck = 0; a.post = null; say(c, `${e.name} est bloqué : approchez-vous.`, 0xf0d060); }
      break;
    }
    default:
      e.pose.walk *= 0.85;
      e.pose.swing = 0.12 + 0.12 * Math.sin(performance.now() / 1500);
  }
  snapGround(e, dt, c);
}

// ---------------------------------------------------------------- mercenaire

/** Monstre à combattre : jamais un PNJ (un meurtre déclencherait un crime), jamais le gibier ; il doit menacer le joueur ou le mercenaire. */
function pickFoe(e: Entity, c: AllyCtx): Entity | null {
  const a = e.ally!, p = c.player, wait = a.mode === 'attendre', pf = c.playerFoe();
  let best: Entity | null = null, bd = Infinity;
  for (const o of c.ents) {
    if (!o.mon || !o.alive || MONSTERS[o.mon.def]?.prey) continue;
    const dm = Math.hypot(o.x - e.x, o.z - e.z);
    if (dm > (wait ? MERC.waitRange : MERC.engageRange + 4)) continue;
    if (!wait && Math.hypot(o.x - p.x, o.z - p.z) > MERC.engageRange) continue;
    const m = o.mon, t = m.targetId;
    const threat = t === 'player' || t === 'ally:merc' || t === 'ally:horse' || o.id === pf || ((m.alerted || m.state === 'chasse' || m.state === 'attaque') && dm < 12);
    if (threat && dm < bd) { bd = dm; best = o; }
  }
  return best;
}

/** Téléportation derrière le joueur (il a trop de retard, ou n'est pas dans le même monde : donjon / surface). */
function placeBehind(e: Entity, p: Player, c: AllyCtx): void {
  const a = e.ally!, sh = Math.sin(p.heading), ch = Math.cos(p.heading);
  e.x = p.x - sh * 1.2 + ch * 0.6; e.z = p.z + ch * 1.2 + sh * 0.6;
  const g = c.ground(e.x, e.z, p.y + 1);
  e.y = g > -20 ? g : p.y;
  e.path = null; e.target = null; e.foe = null; e.pose.dead = 0; a.trail.length = 0; a.stuck = 0; a.following = false; a.dormant = false;
}

function updateMerc(e: Entity, dt: number, c: AllyCtx): void {
  const a = e.ally!, p = c.player;
  // à terre : il se relève seul avec 30 % de ses PV
  if (a.ko > 0) {
    a.ko -= dt; e.pose.dead = Math.min(1, e.pose.dead + dt * 2.5); e.pose.walk *= 0.8; e.pose.swing = 0; e.foe = null;
    if (a.ko <= 0) { a.ko = 0; e.hp = Math.max(1, Math.ceil(e.maxHp * MERC.reviveFrac)); say(c, `${e.name} se relève, hagard${a.sex === 'f' ? 'e' : ''}.`); }
    snapGround(e, dt, c);
    return;
  }
  e.pose.dead = Math.max(0, e.pose.dead - dt * 4);
  // hors du monde du joueur (donjon) ou trop loin : il rejoint le joueur s'il le suit ; en « attendre » il reste gelé
  // (sauf s'il est resté dans un souterrain : alors il rejoint)
  const wm = worldOf(e.x, e.z), wp = worldOf(p.x, p.z), far = Math.hypot(e.x - p.x, e.z - p.z);
  if (a.mode === 'suivre') {
    if (wm !== wp || far > MERC.teleportDist) { placeBehind(e, p, c); return; }
    a.dormant = false;
  } else {
    if (wm >= 0 && wm !== wp) { a.mode = 'suivre'; say(c, `${e.name} vous rejoint.`); placeBehind(e, p, c); return; }
    a.dormant = wm !== wp || far > MOUNT.farFreeze;
    if (a.dormant) return;
  }
  // en dialogue (talkT, comme les PNJ) : il reste là, face au joueur
  if (e.talkT > 0) { e.talkT -= dt; e.pose.walk *= 0.85; e.foe = null; e.heading = turn(e.heading, Math.atan2(p.x - e.x, -(p.z - e.z)), dt * 4); return; }
  a.cooldown = Math.max(0, a.cooldown - dt);
  e.pose.swing = Math.max(0, e.pose.swing - dt * 3);
  if (a.mode === 'suivre') {
    // miettes : le chemin réellement parcouru par le joueur (couloirs, souterrains, hors des villes)
    const l = a.trail[a.trail.length - 1];
    if (!l || Math.hypot(p.x - l.x, p.z - l.z) > 1.2) { a.trail.push({ x: p.x, z: p.z }); if (a.trail.length > 40) a.trail.shift(); }
  }
  // cible, réévaluée 2,5 fois par seconde
  if (e.foe && (!e.foe.alive || !e.foe.mon)) e.foe = null;
  a.scanT -= dt;
  if (a.scanT <= 0) {
    a.scanT = 0.4;
    const f = pickFoe(e, c);
    if (f && f !== e.foe && a.barkT <= 0) { a.barkT = 12; say(c, `${a.first} : « ${BARKS[Math.floor(performance.now() / 1000) % BARKS.length]} »`); }
    e.foe = f;
  }
  const foe = e.foe;
  if (foe) {
    const dx = foe.x - e.x, dz = foe.z - e.z, d = Math.hypot(dx, dz), reach = a.reach + foe.radius;
    e.heading = turn(e.heading, Math.atan2(dx, -dz), dt * 8);
    if (d > reach) {
      const k = Math.min(d, MERC.run * dt) / d;
      a.stuck = c.step(e, dx * k, dz * k) ? 0 : a.stuck + dt;
      e.pose.walk += dt * MERC.run * 4.2;
      if (a.stuck > 2.5) { e.foe = null; a.stuck = 0; }      // bloqué derrière un mur : il lâche
    } else {
      e.pose.walk *= 0.85;
      if (a.cooldown <= 0) { a.cooldown = a.atkCd; e.pose.swing = 1; hitEntity(c.combat, foe, a.damage, e.id); if (!foe.alive) e.foe = null; }
    }
    snapGround(e, dt, c);
    return;
  }
  // hors combat : soins lents, puis ordre en cours
  if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * MERC.regen * dt);
  if (a.mode === 'attendre') {
    const post = a.post ?? (a.post = { x: e.x, z: e.z });
    if (Math.hypot(post.x - e.x, post.z - e.z) > 2) c.goto(e, post.x, post.z, MERC.walk, dt);
    else { e.pose.walk *= 0.85; if (far < 8) e.heading = turn(e.heading, Math.atan2(p.x - e.x, -(p.z - e.z)), dt * 3); }
  } else {
    // il suit : se met en route à plus de 4,5 m, s'arrête à 2,6 m ; court s'il a du retard
    if (!a.following && far > MERC.followStart) a.following = true;
    if (a.following && far < MERC.followStop) a.following = false;
    if (!a.following) {
      e.pose.walk *= 0.85; a.trail.length = 0;
      e.heading = turn(e.heading, Math.atan2(p.x - e.x, -(p.z - e.z)), dt * 3);
    } else {
      let tx = p.x, tz = p.z;
      if (!c.navigable(e, p.x, p.z) && a.trail.length) {
        while (a.trail.length && Math.hypot(a.trail[0].x - e.x, a.trail[0].z - e.z) < 1.2) a.trail.shift();
        if (a.trail.length) { tx = a.trail[0].x; tz = a.trail[0].z; }
      }
      c.goto(e, tx, tz, far > 9 ? MERC.run : MERC.walk, dt);
    }
  }
  snapGround(e, dt, c);
}
