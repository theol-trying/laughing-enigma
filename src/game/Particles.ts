import { M } from '@ascii-fort/ascii-engine/Materials';
import { SHAPE } from '@ascii-fort/ascii-engine/Shapes';
import { trsYawPitch, mat4 } from '@ascii-fort/core/math';
import type { InstanceBuffer } from '@ascii-fort/ascii-engine/Renderer';

// Particules en caractères : étincelles de forge, sang, poussière, fumée des cheminées, copeaux,
// éclats de roche, brume, et lucioles la nuit. Chaque particule est une petite forme instanciée
// dont la matière choisit les glyphes (« * » pour les étincelles, « ° o » pour la fumée…).

export type ParticleKind = 'étincelle' | 'sang' | 'os' | 'brume' | 'poussière' | 'fumée' | 'copeau' | 'éclat' | 'gouttes' | 'plume';

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; grow: number; color: number; mat: number; grav: number; drag: number; wind: number }
interface Firefly { x: number; y: number; z: number; vx: number; vz: number; phase: number; base: number }

const r = (a: number, b: number) => a + Math.random() * (b - a);

interface Preset { color: number; mat: number; size: [number, number]; grow: number; life: [number, number]; vy: [number, number]; spread: number; grav: number; drag: number; wind: number }
const PRESETS: Record<ParticleKind, Preset> = {
  étincelle: { color: 0xffb040, mat: M.SPARK, size: [0.06, 0.09], grow: 0, life: [0.4, 0.8], vy: [2, 4.5], spread: 1.6, grav: 9.8, drag: 0.4, wind: 0 },
  sang: { color: 0x8a1010, mat: M.BLOOD, size: [0.07, 0.11], grow: 0, life: [0.6, 1.0], vy: [0.5, 2.4], spread: 1.3, grav: 9.8, drag: 0.6, wind: 0 },
  os: { color: 0xe0d8c0, mat: M.DUST, size: [0.06, 0.1], grow: 0, life: [0.5, 0.9], vy: [0.5, 2], spread: 1.2, grav: 9.8, drag: 0.6, wind: 0 },
  brume: { color: 0x9ab0c8, mat: M.SMOKE, size: [0.2, 0.3], grow: 0.5, life: [0.8, 1.4], vy: [0.2, 0.6], spread: 0.5, grav: -0.2, drag: 1.5, wind: 0.3 },
  poussière: { color: 0xa89878, mat: M.DUST, size: [0.14, 0.2], grow: 0.35, life: [0.5, 0.9], vy: [0.2, 0.7], spread: 0.7, grav: 1.2, drag: 2.5, wind: 0.4 },
  fumée: { color: 0x8a8a86, mat: M.SMOKE, size: [0.3, 0.45], grow: 0.22, life: [4, 6], vy: [0.55, 0.85], spread: 0.15, grav: -0.04, drag: 0.25, wind: 0.6 },
  copeau: { color: 0x8a6a40, mat: M.WOOD, size: [0.06, 0.1], grow: 0, life: [0.6, 1.1], vy: [1.5, 3.5], spread: 1.8, grav: 9.8, drag: 0.5, wind: 0 },
  gouttes: { color: 0xb8d8f0, mat: M.DUST, size: [0.05, 0.08], grow: 0, life: [0.4, 0.7], vy: [1.5, 3], spread: 0.8, grav: 9.8, drag: 0.5, wind: 0 },
  plume: { color: 0xa89070, mat: M.DUST, size: [0.05, 0.08], grow: 0, life: [1.2, 2], vy: [0.5, 1.5], spread: 0.8, grav: 0.6, drag: 1.5, wind: 0.5 },
  éclat: { color: 0x8a867c, mat: M.ROCK, size: [0.06, 0.1], grow: 0, life: [0.6, 1.1], vy: [1.5, 3.5], spread: 1.8, grav: 9.8, drag: 0.5, wind: 0 },
};

export class Particles {
  private list: Particle[] = [];
  private flies: Firefly[] = [];
  private m4 = mat4();
  private t = 0;

  emit(kind: ParticleKind, x: number, y: number, z: number, n = 6): void {
    const p = PRESETS[kind];
    for (let i = 0; i < n && this.list.length < 700; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * p.spread;
      const life = r(...p.life);
      this.list.push({ x: x + r(-0.1, 0.1), y, z: z + r(-0.1, 0.1), vx: Math.cos(a) * s, vy: r(...p.vy), vz: Math.sin(a) * s, life, max: life, size: r(...p.size), grow: p.grow, color: p.color, mat: p.mat, grav: p.grav, drag: p.drag, wind: p.wind });
    }
  }

  /** Lucioles : une nuée autour du joueur quand les conditions s'y prêtent. */
  fireflies(on: boolean, x: number, z: number, ground: (x: number, z: number) => number): void {
    if (!on) { this.flies.length = 0; return; }
    while (this.flies.length < 18) {
      const fx = x + r(-18, 18), fz = z + r(-18, 18);
      this.flies.push({ x: fx, y: ground(fx, fz) + r(0.4, 2), z: fz, vx: 0, vz: 0, phase: r(0, 6.28), base: 0 });
    }
    for (const f of this.flies) {
      if (Math.hypot(f.x - x, f.z - z) > 24) { f.x = x + r(-18, 18); f.z = z + r(-18, 18); }
      f.base = ground(f.x, f.z);
    }
  }

  update(dt: number, windX: number, windZ: number): void {
    this.t += dt;
    for (const p of this.list) {
      p.life -= dt;
      p.vy -= p.grav * dt;
      const k = Math.exp(-p.drag * dt);
      p.vx = p.vx * k + windX * p.wind * dt; p.vz = p.vz * k + windZ * p.wind * dt; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.size += p.grow * dt;
    }
    if (this.list.some((p) => p.life <= 0)) this.list = this.list.filter((p) => p.life > 0);
    for (const f of this.flies) {
      f.vx += r(-1, 1) * dt * 2; f.vz += r(-1, 1) * dt * 2;
      f.vx *= 0.98; f.vz *= 0.98;
      f.x += f.vx * dt; f.z += f.vz * dt;
      f.y += (f.base + 0.6 + Math.sin(this.t * 0.7 + f.phase) * 0.5 - f.y) * dt;
    }
  }

  render(ib: InstanceBuffer, cx: number, cz: number): void {
    for (const p of this.list) {
      if (Math.abs(p.x - cx) > 70 || Math.abs(p.z - cz) > 70) continue;
      const s = p.size * (p.grow > 0 ? 1 : Math.min(1, p.life / (p.max * 0.3) + 0.3));
      trsYawPitch(this.m4, p.x, p.y, p.z, 0, 0, s, s, s);
      ib.add(this.m4, p.color, p.mat, 0, 0, 1, SHAPE.SPHERE);
    }
    for (const f of this.flies) {
      if (Math.sin(this.t * 2.3 + f.phase * 3) < 0.15) continue; // elles clignotent
      trsYawPitch(this.m4, f.x, f.y, f.z, 0, 0, 0.07, 0.07, 0.07);
      ib.add(this.m4, 0xd8ff70, M.FIREFLY, 0, 0, 1, SHAPE.SPHERE);
    }
  }

  /** Lumières des lucioles (quelques-unes seulement, pour l'ambiance). */
  lights(): { x: number; y: number; z: number; radius: number; r: number; g: number; b: number }[] {
    return this.flies.slice(0, 3).filter((f) => Math.sin(this.t * 2.3 + f.phase * 3) >= 0.15).map((f) => ({ x: f.x, y: f.y, z: f.z, radius: 3, r: 0.5, g: 0.7, b: 0.2 }));
  }
}
