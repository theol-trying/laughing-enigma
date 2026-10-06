import type { Input } from '@ascii-fort/ascii-engine/Input';
import type { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import type { Character } from './Character';
import type { EventBus } from '@ascii-fort/core/Events';
import { hitEntity, type CombatHost } from './Combat';
import type { InstanceBuffer } from '@ascii-fort/ascii-engine/Renderer';
import type { Camera } from '@ascii-fort/ascii-engine/Camera';
import { M } from '@ascii-fort/ascii-engine/Materials';
import { trsYawPitch, mat4 } from '@ascii-fort/core/math';
import type { Element } from './Items';

// Combat du joueur : attaques légère / lourde (maintenir), blocage, esquive, arc, sorts.

export interface Projectile { x: number; y: number; z: number; vx: number; vy: number; vz: number; dmg: number; element?: Element; kind: 'flèche' | 'feu'; life: number; stuck: boolean; owner: string }

export interface CombatWorld {
  player: Player;
  character: Character;
  events: EventBus;
  combat: CombatHost;
  entities: Entity[];
  heightAt(x: number, z: number): number;
  onHit(e: Entity): void;
}

const tmp = mat4();

export class PlayerCombat {
  charge = 0;           // temps de maintien du clic (attaque lourde / bander l'arc)
  swing = 0;            // animation d'attaque 1 → 0
  private swingHeavy = false;
  private hitPending = 0;
  private cooldown = 0;
  dashT = 0;
  projectiles: Projectile[] = [];
  lastTarget: Entity | null = null;

  update(dt: number, input: Input, w: CombatWorld): void {
    const p = w.player, ch = w.character;
    const weapon = ch.weapon?.weapon ?? { kind: 'poings' as const, damage: 4, speed: 1.3, reach: 1.5, stamina: 5 };
    this.cooldown -= dt;
    this.swing = Math.max(0, this.swing - dt * 2.4 * weapon.speed);
    p.mana = Math.min(p.maxMana, p.mana + dt * 1.5);
    p.shield = !!ch.shield;
    // esquive : V ou double appui d'une direction
    if ((input.key('v') || input.doubleTapped) && p.stamina >= 20 && this.dashT <= 0 && p.onGround) {
      let dx = 0, dz = 0;
      const sh = Math.sin(p.heading), chh = Math.cos(p.heading);
      const code = input.doubleTapped ?? (input.isDown('KeyA') ? 'KeyA' : input.isDown('KeyD') ? 'KeyD' : input.isDown('KeyW') ? 'KeyW' : 'KeyS');
      if (code === 'KeyW') { dx = sh; dz = -chh; } else if (code === 'KeyS') { dx = -sh; dz = chh; }
      else if (code === 'KeyA') { dx = -chh; dz = -sh; } else { dx = chh; dz = sh; }
      p.dashX = dx * 9; p.dashZ = dz * 9; p.dashT = 0.22; this.dashT = 0.6;
      p.invuln = 0.32; p.stamina -= 20;
      ch.practice('furtivité', 0.5);
    }
    this.dashT -= dt;
    if (!input.locked) { this.charge = 0; return; }

    const bow = weapon.kind === 'arc';
    if (input.mouseDown(0)) this.charge += dt;
    if (input.mouseReleased(0) && this.cooldown <= 0) {
      if (bow) this.fireArrow(w, Math.min(1, this.charge / (0.8 / weapon.speed)));
      else {
        const heavy = this.charge > 0.42;
        const cost = weapon.stamina * (heavy ? 2 : 1);
        if (p.stamina >= cost * 0.5) {
          p.stamina = Math.max(0, p.stamina - cost);
          this.swing = 1; this.swingHeavy = heavy;
          this.hitPending = 0.16 / weapon.speed;
          this.cooldown = (heavy ? 0.85 : 0.5) / weapon.speed;
        }
      }
      this.charge = 0;
    }
    if (!input.mouseDown(0) && !input.mouseReleased(0)) this.charge = 0;
    // impact au milieu du geste
    if (this.hitPending > 0) {
      this.hitPending -= dt;
      if (this.hitPending <= 0) this.meleeImpact(w, weapon.damage, weapon.reach, this.swingHeavy, (weapon as any).element);
    }
    // sorts
    if (input.key('r') && p.mana >= 15) {
      p.mana -= 15;
      const f = this.aim(p);
      this.projectiles.push({ x: p.x + f[0] * 0.8, y: p.eyeY - 0.2, z: p.z + f[2] * 0.8, vx: f[0] * 24, vy: f[1] * 24, vz: f[2] * 24, dmg: 16 * ch.spellMult(), element: 'feu', kind: 'feu', life: 3, stuck: false, owner: 'player' });
      if (ch.practice('magie', 2)) w.events.emit('message', { text: `Magie : ${ch.skills.magie}`, color: 0x9a7ae0 });
    }
    if (input.key('f') && p.mana >= 20 && p.hp < p.maxHp) {
      p.mana -= 20; p.hp = Math.min(p.maxHp, p.hp + 25 * ch.spellMult()); p.poison = 0;
      w.events.emit('message', { text: 'Une chaleur douce referme vos plaies.', color: 0x60d070 });
      ch.practice('magie', 2);
    }
    this.updateProjectiles(dt, w);
  }

  aim(p: Player): [number, number, number] {
    const cp = Math.cos(p.pitch);
    return [Math.sin(p.heading) * cp, Math.sin(p.pitch), -Math.cos(p.heading) * cp];
  }

  private meleeImpact(w: CombatWorld, damage: number, reach: number, heavy: boolean, element?: Element) {
    const p = w.player, ch = w.character;
    const fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
    let best: Entity | null = null, bd = Infinity;
    for (const e of w.entities) {
      if (!e.alive) continue;
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
      if (d > reach + e.radius || d < 0.01) continue;
      if ((dx * fx + dz * fz) / d < 0.62) continue;
      if (Math.abs(e.y - p.y) > 2.2) continue;
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return;
    let dmg = damage * ch.meleeMult() * (heavy ? 1.8 : 1);
    if (ch.weapon?.weapon?.kind === 'masse' && (best.type === 'squelette' || best.mon?.def === 'roi-squelette')) dmg *= 1.4;
    const done = hitEntity(w.combat, best, dmg, 'player', element);
    if (heavy && best.mon) { best.mon.windup = 0; best.x += fx * 0.9; best.z += fz * 0.9; } // étourdi, repoussé
    if (element && best.alive) applyElement(best, element);
    this.lastTarget = best;
    w.onHit(best);
    if (ch.practice('armes', heavy ? 1.6 : 1)) w.events.emit('message', { text: `Armes : ${ch.skills.armes}`, color: 0xe8c050 });
    void done;
  }

  private fireArrow(w: CombatWorld, draw: number) {
    const p = w.player, ch = w.character, wd = ch.weapon?.weapon;
    if (!wd || draw < 0.15) return;
    if (!ch.inv.remove('flèche', 1)) { w.events.emit('message', { text: 'Plus de flèches !', color: 0xe05040 }); return; }
    const f = this.aim(p), v = 22 + 38 * draw;
    p.stamina = Math.max(0, p.stamina - wd.stamina);
    this.projectiles.push({ x: p.x + f[0] * 0.6, y: p.eyeY - 0.1, z: p.z + f[2] * 0.6, vx: f[0] * v, vy: f[1] * v, vz: f[2] * v, dmg: wd.damage * ch.bowMult() * (0.3 + 0.7 * draw), element: wd.element, kind: 'flèche', life: 6, stuck: false, owner: 'player' });
    this.cooldown = 0.35;
  }

  private updateProjectiles(dt: number, w: CombatWorld) {
    const ch = w.character;
    for (const pr of this.projectiles) {
      pr.life -= dt;
      if (pr.stuck) continue;
      if (pr.kind === 'flèche') pr.vy -= 9.8 * dt;
      const nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt, nz = pr.z + pr.vz * dt;
      for (const e of w.entities) {
        if (!e.alive) continue;
        // distance du segment parcouru à l'axe vertical de l'entité
        const ex = e.x - pr.x, ez = e.z - pr.z, sx = nx - pr.x, sz = nz - pr.z, l2 = sx * sx + sz * sz || 1;
        const t = Math.max(0, Math.min(1, (ex * sx + ez * sz) / l2));
        const px = pr.x + sx * t, pz = pr.z + sz * t, py = pr.y + (ny - pr.y) * t;
        if (Math.hypot(e.x - px, e.z - pz) < e.radius + 0.15 && py > e.y && py < e.y + e.model.height) {
          hitEntity(w.combat, e, pr.dmg, pr.owner, pr.element);
          if (pr.element && e.alive) applyElement(e, pr.element);
          this.lastTarget = e; w.onHit(e);
          ch.practice(pr.kind === 'flèche' ? 'tir' : 'magie', 1.5);
          pr.life = 0;
          break;
        }
      }
      if (pr.life <= 0) continue;
      pr.x = nx; pr.y = ny; pr.z = nz;
      if (pr.y < w.heightAt(pr.x, pr.z)) { pr.stuck = true; pr.life = Math.min(pr.life, pr.kind === 'feu' ? 0 : 20); }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  /** Arme en vue subjective + projectiles. */
  render(ib: InstanceBuffer, cam: Camera, ch: Character, blocking: boolean): void {
    const h = cam.heading, pt = cam.pitch;
    const f = [Math.sin(h) * Math.cos(pt), Math.sin(pt), -Math.cos(h) * Math.cos(pt)];
    const r = [Math.cos(h), 0, Math.sin(h)];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const at = (fw: number, rt: number, up: number): [number, number, number] => [cam.x + f[0] * fw + r[0] * rt + u[0] * up, cam.y + f[1] * fw + r[1] * rt + u[1] * up, cam.z + f[2] * fw + r[2] * rt + u[2] * up];
    const wd = ch.weapon?.weapon;
    const s = this.swing;
    const bob = Math.sin(performance.now() / 300) * 0.006;
    if (wd?.kind === 'arc') {
      const dr = Math.min(1, this.charge / 0.8);
      const [x, y, z] = at(0.55, 0.05, -0.12 + bob);
      trsYawPitch(tmp, x, y, z, -h, pt, 0.04, 0.75, 0.05); ib.add(tmp, 0x6a4a2a, M.WOOD, 0, 0, 1);
      if (dr > 0.05) { const [ax, ay, az] = at(0.75 - dr * 0.25, 0.05, -0.12); trsYawPitch(tmp, ax, ay, az, -h, pt, 0.02, 0.02, 0.7); ib.add(tmp, 0xb8b8b0, M.METAL, 0, 0, 1); }
    } else {
      const len = wd ? (wd.kind === 'dague' ? 0.35 : wd.kind === 'lance' || wd.kind === 'bâton' ? 1.2 : 0.8) : 0.15;
      const [x, y, z] = at(0.55 - s * 0.1, 0.3 - s * 0.25, -0.3 + s * 0.15 + bob);
      const col = wd ? (wd.kind === 'bâton' ? 0x6a4a2a : wd.element === 'feu' ? 0xff8a40 : wd.element === 'givre' ? 0x9ad8ff : 0xc8c8d0) : 0xd0a080;
      trsYawPitch(tmp, x, y, z, -h + 0.25 - s * 0.9, pt + 0.5 - s * 1.4, wd ? 0.05 : 0.12, wd ? 0.05 : 0.12, len);
      ib.add(tmp, col, wd ? (wd.kind === 'bâton' ? M.WOOD : M.METAL) : M.SKIN, 0, 0, 1);
    }
    if (ch.shield && (blocking || wd?.kind !== 'arc')) {
      const [x, y, z] = at(0.5, blocking ? -0.08 : -0.38, blocking ? -0.1 : -0.42);
      trsYawPitch(tmp, x, y, z, -h, pt, 0.4, 0.5, 0.05); ib.add(tmp, ch.shield.id === 'bouclier de fer' ? 0x8a8a94 : 0x7a5a3a, ch.shield.id === 'bouclier de fer' ? M.METAL : M.WOOD, 0, 0, 1);
    }
    for (const pr of this.projectiles) {
      const sp = Math.hypot(pr.vx, pr.vz) || 1;
      trsYawPitch(tmp, pr.x, pr.y, pr.z, -Math.atan2(pr.vx, -pr.vz), Math.atan2(pr.vy, sp), pr.kind === 'feu' ? 0.35 : 0.03, pr.kind === 'feu' ? 0.35 : 0.03, pr.kind === 'feu' ? 0.35 : 0.8);
      ib.add(tmp, pr.kind === 'feu' ? 0xff7a20 : 0xb8a070, pr.kind === 'feu' ? M.FIRE : M.WOOD, 0, 0, 1);
    }
  }
}

/** Effets élémentaires sur une créature (gérés dans le temps par le gestionnaire d'entités). */
export function applyElement(e: Entity, el: Element) {
  e.status ??= { burn: 0, frost: 0, poison: 0 };
  if (el === 'feu') e.status.burn = 4;
  if (el === 'givre') e.status.frost = 4;
  if (el === 'poison') e.status.poison = 6;
}
