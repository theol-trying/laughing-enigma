import type { Input } from '@ascii-fort/ascii-engine/Input';
import type { World } from '@ascii-fort/worldgen/World';
import type { CircleCollider, SegCollider, Platform } from '@ascii-fort/worldgen/Chunk';
import { clamp, segDist } from '@ascii-fort/core/math';
import { WORLD } from '@ascii-fort/worldgen/constants';

/** Joueur : contrôleur à la première personne, gravité, pentes, nage, collisions. */
/** hauteur franchie d'un pas (marches, pierres basses) */
const STEP = 0.45;

export class Player {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  heading = 0; pitch = 0;
  onGround = false; swimming = false; crouch = false; sprinting = false;
  /** surface de l'eau sous le joueur (NaN : pas d'eau) et profondeur d'eau au sol */
  water = NaN; depth = 0;
  /** souffle sous l'eau (0..1) ; dégâts reçus récemment (effet visuel) */
  breath = 1;
  /** pas feutrés (sort) : presque aucun bruit */
  quiet = false;
  /** invisible (sort) */
  invisible = false;
  hitAmount = 0; hitDir: number | null = null; hitT = 0;
  /** plongée : accroupi en nageant */
  get diving(): boolean { return this.swimming && this.crouch; }
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
  /** sous un toit (plancher de bâtiment) : pas de pluie à l'écran */
  underRoof = false;

  /** Effets dans le temps : poison, brûlure, givre (ralentit), régénération d'endurance. */
  /** multiplicateur de récupération d'endurance (bonus temporaires) */
  staminaRegen = 1;
  tickStatus(dt: number): number {
    let dmg = 0;
    if (this.poison > 0) { this.poison -= dt; dmg += 2.2 * dt; }
    if (this.burn > 0) { this.burn -= dt; dmg += 4 * dt; }
    if (this.frost > 0) this.frost -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurt > 0) this.hurt -= dt;
    if (this.hitT > 0) this.hitT -= dt;
    const regen = this.blocking ? 4 : this.sprinting ? -14 : 16 * this.staminaRegen;
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
    this.underRoof = false;
    for (const p of this.plats) {
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = x - p.cx, dz = z - p.cz;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) <= p.hw && Math.abs(lz) <= p.hd && p.top <= fromY + 0.65 && p.top > g) { g = p.top; this.underRoof = p.hw > 2 && p.hd > 2 && p.top > 0.5 + world.heightAt(x, z) - 3; }
    }
    // rochers, souches, murets, parapets : on peut monter dessus (en sautant, ou d'un pas s'ils sont bas)
    for (const c of this.circles) if (!c.dyn && c.top <= fromY + STEP && c.top > g && Math.hypot(x - c.x, z - c.z) <= c.r * 0.9 + 0.2) g = c.top;
    for (const s of this.segs) if (s.top <= fromY + STEP && s.top > g && segDist(x, z, s.ax, s.az, s.bx, s.bz).d <= s.r + 0.22) g = s.top;
    return g;
  }

  update(dt: number, input: Input, world: World<any>, speedMul = 1): void {
    const f = input.isDown('KeyW') ? 1 : 0, b = input.isDown('KeyS') ? 1 : 0;
    const l = input.isDown('KeyA') ? 1 : 0, r = input.isDown('KeyD') ? 1 : 0;
    if (input.pressed('KeyC') && !this.noclip) this.crouch = !this.crouch;
    if (input.isDown('ShiftLeft') && f > 0) this.crouch = false;
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
      if (input.isDown('KeyC')) this.y -= sp;
      this.vx = this.vy = this.vz = 0;
      return;
    }

    // dans l'eau jusqu'aux genoux ou à la taille : on avance difficilement
    const wade = !this.swimming && this.depth > 0.2 ? 1 - Math.min(1, this.depth) * 0.45 : 1;
    const speed = (this.swimming ? 2.4 : this.sprinting ? 7 : this.crouch ? 2 : 4.2) * speedMul * wade * (this.frost > 0 ? 0.6 : 1) * (this.blocking ? 0.55 : 1);
    const acc = this.onGround || this.swimming ? 12 : 2.5;
    const k = Math.min(1, acc * dt);
    this.vx += (mx * speed - this.vx) * k;
    this.vz += (mz * speed - this.vz) * k;
    if (this.dashT > 0) { this.vx = this.dashX; this.vz = this.dashZ; this.dashT -= dt; }
    if (input.pressed('Space') && (this.onGround || this.swimming)) { this.vy = this.swimming ? 3 : 6.8; this.onGround = false; if (this.swimming) this.crouch = false; }

    world.chunks.collidersNear(this.x, this.z, this.circles, this.segs, this.plats);
    const ox = this.x, oz = this.z;
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;

    // pentes : la montée ralentit, au-delà d'environ 42° le terrain ne se gravit plus (on glisse le long),
    // et sur une pente trop forte on dévale. Les planchers et escaliers ne sont pas concernés.
    if (this.onGround && !this.swimming && !this.noclip) {
      const t0 = world.heightAt(ox, oz);
      if (this.y - t0 < 0.15) {
        const gx = world.heightAt(ox + 0.5, oz) - world.heightAt(ox - 0.5, oz), gz = world.heightAt(ox, oz + 0.5) - world.heightAt(ox, oz - 0.5);
        const grade = Math.hypot(gx, gz), ex = gx / (grade || 1), ez = gz / (grade || 1);
        const run = Math.hypot(nx - ox, nz - oz);
        if (run > 1e-4) {
          const ux = (nx - ox) / run, uz = (nz - oz) / run;
          const slope = (world.heightAt(ox + ux * 0.7, oz + uz * 0.7) - t0) / 0.7;
          if (slope > 0.9) {
            const up = (nx - ox) * ex + (nz - oz) * ez;
            if (up > 0) { nx -= ex * up; nz -= ez * up; const vu = this.vx * ex + this.vz * ez; if (vu > 0) { this.vx -= ex * vu; this.vz -= ez * vu; } }
          } else if (slope > 0.3) {
            const k = 1 - (slope - 0.3) * 0.6;
            nx = ox + (nx - ox) * k; nz = oz + (nz - oz) * k;
          }
        }
        if (grade > 1.15) { this.vx -= ex * 9 * dt; this.vz -= ez * 9 * dt; nx -= ex * 1.5 * dt; nz -= ez * 1.5 * dt; }
      }
    }
    // collisions horizontales (troncs, rochers, murs)
    for (let it = 0; it < 2; it++) {
      for (const c of this.circles) {
        if (this.y + 1.7 < c.bottom || this.y > c.top - 0.2 || c.top - this.y <= STEP) continue;
        const dx = nx - c.x, dz = nz - c.z, d = Math.hypot(dx, dz), min = c.r + this.radius;
        if (d < min && d > 1e-5) { nx = c.x + (dx / d) * min; nz = c.z + (dz / d) * min; }
      }
      for (const s of this.segs) {
        if (this.y + 1.7 < s.bottom || this.y > s.top - 0.3 || s.top - this.y <= STEP) continue;
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
    this.water = water;
    this.depth = Number.isNaN(water) ? 0 : Math.max(0, water - ground);
    this.swimming = !Number.isNaN(water) && water - ground > 1.3 && this.y < water - 1.1;
    if (this.swimming) {
      // flotte en surface ; accroupi (C), on plonge vers le fond
      const target = this.crouch ? Math.max(ground + 0.3, water - 3.4) : water - 1.35;
      this.vy += (target - this.y) * 4 * dt - this.vy * 2 * dt;
      if (this.burn > 0) this.burn = 0;
    } else this.vy -= 18 * dt;
    if (this.depth > 0.6 && this.burn > 0) this.burn = 0;
    this.y += this.vy * dt;
    this.lastFall = 0;
    if (this.y <= ground) {
      if (!this.onGround && this.vy < -11) this.lastFall = -this.vy;
      this.y = ground; this.vy = 0; this.onGround = true;
    } else this.onGround = this.y - ground < 0.08 && this.vy <= 0;
    if (this.onGround && this.y - ground < 0.6) this.y = ground; // colle au sol en descente
  }
}
