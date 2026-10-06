import type { ChunkManager } from '../world/ChunkManager';

// Perception : vue (portée × lumière × météo × discrétion), cône de vision, ligne de vue
// (les murs bloquent) et ouïe (course, combat).

export interface Observer { x: number; z: number; y: number; heading: number; range: number; nocturnal: boolean; asleep: boolean }
export interface Stimulus { x: number; z: number; y: number; stealth: number; noise: number }
export interface Env { night: number; fog: number }

function segIntersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d;
  const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

export function lineOfSight(chunks: ChunkManager<any>, ax: number, az: number, bx: number, bz: number, y: number): boolean {
  const { segs } = chunks.collidersInRect(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
  for (const s of segs) {
    if (s.top < y + 1.2 || s.bottom > y + 1.6) continue;
    if (segIntersect(ax, az, bx, bz, s.ax, s.az, s.bx, s.bz)) return false;
  }
  return true;
}

export function perceives(chunks: ChunkManager<any>, o: Observer, s: Stimulus, env: Env): boolean {
  const dx = s.x - o.x, dz = s.z - o.z, d = Math.hypot(dx, dz);
  // ouïe : on entend courir et se battre
  const hear = (o.asleep ? 4 : 10) + s.noise * 16;
  if (d < hear) return true;
  const light = o.nocturnal ? 1 : 1 - env.night * 0.45;
  const range = o.range * light * (1 - env.fog * 0.5) * (1 - s.stealth * 0.55) * (o.asleep ? 0.25 : 1);
  if (d > range) return false;
  if (d > 3) {
    const fx = Math.sin(o.heading), fz = -Math.cos(o.heading);
    if ((dx * fx + dz * fz) / d < 0.34) return false; // cône d'environ 140°
  }
  return lineOfSight(chunks, o.x, o.z, s.x, s.z, o.y);
}
