import type { Input } from '../core/Input';
import type { World } from '../world/World';
import type { CircleCollider, SegCollider, Platform } from '../world/Chunk';
import { clamp, segDist } from '../core/math';
import { WORLD } from '../world/constants';

/** Joueur : contrôleur à la première personne, gravité, pentes, nage, collisions. */
export class Player {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  heading = 0; pitch = 0;
  onGround = false; swimming = false; crouch = false; sprinting = false;
  radius = 0.35; eye = 1.65;
  noclip = false;
  /** borne le joueur au monde (désactivé dans les donjons, hors de la carte) */
  bounded = true;
  lastFall = 0;           // vitesse verticale à l'atterrissage (dégâts de chute)
  moving = false;
  // état de combat (étendu à l'étape 7 : équipement, compétences)
  hp = 100; maxHp = 100;
  stamina = 100; maxStamina = 100;
  mana = 50; maxMana = 50;
  dead = false;
  invuln = 0;         // fenêtre d'invulnérabilité (esquive)
  blocking = false;
  shield = false;
  hurt = 0;           // flash rouge à l'écran
  poison = 0; frost = 0; burn = 0;
  /** esquive : vitesse imposée pendant dashT secondes */
  dashT = 0; dashX = 0; dashZ = 0;

  /** Effets dans le temps : poison, brûlure, givre (ralentit), régénération d'endurance. */
  tickStatus(dt: number): number {
    let dmg = 0;
    if (this.poison > 0) { this.poison -= dt; dmg += 2.2 * dt; }
    if (this.burn > 0) { this.burn -= dt; dmg += 4 * dt; }
    if (this.frost > 0) this.frost -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurt > 0) this.hurt -= dt;
    const regen = this.blocking ? 4 : this.sprinting ? -14 : 16;
    this.stamina = Math.max(0, Math.min(this.maxStamina, this.stamina + regen * dt));
    if (dmg > 0) { this.hp -= dmg; if (this.hp <= 0) { this.hp = 0; this.dead = true; } }
    return dmg;
  }
  private circles: CircleCollider[] = [];
  private segs: SegCollider[] = [];
  private plats: Platform[] = [];

  get eyeY(): number { return this.y + (this.crouch ? 1.05 : this.eye); }

  look(input: Input, sens = 0.0022): void {
    if (!input.locked) return;
    this.heading += input.mouseDX * sens;
    this.pitch = clamp(this.pitch - input.mouseDY * sens, -1.45, 1.45);
  }

  /** Sol sous (x, z) : terrain ou plateforme (plancher, pont) accessible. */
  groundAt(world: World<any>, x: number, z: number, fromY: number): number {
    let g = world.heightAt(x, z);
    for (const p of this.plats) {
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = x - p.cx, dz = z - p.cz;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) <= p.hw && Math.abs(lz) <= p.hd && p.top <= fromY + 0.65 && p.top > g) g = p.top;
    }
    return g;
  }

  update(dt: number, input: Input, world: World<any>, speedMul = 1): void {
    const f = input.isDown('KeyW') ? 1 : 0, b = input.isDown('KeyS') ? 1 : 0;
    const l = input.isDown('KeyA') ? 1 : 0, r = input.isDown('KeyD') ? 1 : 0;
    this.crouch = input.isDown('KeyC');
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    let mx = (f - b) * sh + (r - l) * ch, mz = -(f - b) * ch + (r - l) * sh;
    const ml = Math.hypot(mx, mz);
    if (ml > 0) { mx /= ml; mz /= ml; }
    this.moving = ml > 0;
    this.sprinting = input.isDown('ShiftLeft') && f > 0 && !this.crouch && this.stamina > 2;

    if (this.noclip) {
      const sp = (this.sprinting ? 60 : 15) * dt;
      this.x += mx * sp; this.z += mz * sp;
      if (input.isDown('Space')) this.y += sp;
      if (this.crouch) this.y -= sp;
      this.vx = this.vy = this.vz = 0;
      return;
    }

    const speed = (this.swimming ? 2.4 : this.sprinting ? 7 : this.crouch ? 2 : 4.2) * speedMul * (this.frost > 0 ? 0.6 : 1) * (this.blocking ? 0.55 : 1);
    const acc = this.onGround || this.swimming ? 12 : 2.5;
    const k = Math.min(1, acc * dt);
    this.vx += (mx * speed - this.vx) * k;
    this.vz += (mz * speed - this.vz) * k;
    if (this.dashT > 0) { this.vx = this.dashX; this.vz = this.dashZ; this.dashT -= dt; }
    if (input.pressed('Space') && (this.onGround || this.swimming)) { this.vy = this.swimming ? 3 : 5.3; this.onGround = false; }

    world.chunks.collidersNear(this.x, this.z, this.circles, this.segs, this.plats);
    const ox = this.x, oz = this.z;
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;

    // pentes trop raides : on refuse la montée
    if (this.onGround) {
      const g0 = this.groundAt(world, ox, oz, this.y), g1 = this.groundAt(world, nx, nz, this.y);
      const run = Math.hypot(nx - ox, nz - oz);
      if (run > 1e-4 && (g1 - g0) / run > 1.05 && g1 - this.y > 0.25) { nx = ox; nz = oz; this.vx *= 0.2; this.vz *= 0.2; }
    }
    // collisions horizontales (troncs, rochers, murs)
    for (let it = 0; it < 2; it++) {
      for (const c of this.circles) {
        if (this.y + 1.7 < c.bottom || this.y > c.top - 0.2) continue;
        const dx = nx - c.x, dz = nz - c.z, d = Math.hypot(dx, dz), min = c.r + this.radius;
        if (d < min && d > 1e-5) { nx = c.x + (dx / d) * min; nz = c.z + (dz / d) * min; }
      }
      for (const s of this.segs) {
        if (this.y + 1.7 < s.bottom || this.y > s.top - 0.3) continue;
        const { d, t } = segDist(nx, nz, s.ax, s.az, s.bx, s.bz);
        const min = s.r + this.radius;
        if (d < min) {
          const px = s.ax + (s.bx - s.ax) * t, pz = s.az + (s.bz - s.az) * t;
          const dx = nx - px, dz = nz - pz, dl = Math.hypot(dx, dz) || 1;
          nx = px + (dx / dl) * min; nz = pz + (dz / dl) * min;
        }
      }
    }
    if (this.bounded) { this.x = clamp(nx, 2, WORLD - 2); this.z = clamp(nz, 2, WORLD - 2); } else { this.x = nx; this.z = nz; }

    // vertical : gravité, nage, atterrissage
    const ground = this.groundAt(world, this.x, this.z, this.y);
    const water = world.waterAt(this.x, this.z);
    this.swimming = !Number.isNaN(water) && water - ground > 1.3 && this.y < water - 1.1;
    if (this.swimming) this.vy += ((water - 1.35) - this.y) * 4 * dt - this.vy * 2 * dt;
    else this.vy -= 20 * dt;
    this.y += this.vy * dt;
    this.lastFall = 0;
    if (this.y <= ground) {
      if (!this.onGround && this.vy < -11) this.lastFall = -this.vy;
      this.y = ground; this.vy = 0; this.onGround = true;
    } else this.onGround = this.y - ground < 0.08 && this.vy <= 0;
    if (this.onGround && this.y - ground < 0.6) this.y = ground; // colle au sol en descente
  }
}
