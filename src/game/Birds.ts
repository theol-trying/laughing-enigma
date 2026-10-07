import { M } from '@ascii-fort/ascii-engine/Materials';
import { SHAPE } from '@ascii-fort/ascii-engine/Shapes';
import { trsYawPitch, mat4 } from '@ascii-fort/core/math';
import type { InstanceBuffer } from '@ascii-fort/ascii-engine/Renderer';

// Volées d'oiseaux dans le ciel (pur décor) : corbeaux au-dessus des terres, mouettes près de la mer.
// Chaque volée dérive lentement en tournoyant ; les ailes battent.

interface Bird { a: number; r: number; h: number; ph: number; sp: number }
interface Flock { cx: number; cz: number; y: number; vx: number; vz: number; life: number; color: number; birds: Bird[] }

const r = (a: number, b: number) => a + Math.random() * (b - a);

export class Birds {
  private flocks: Flock[] = [];
  private m4 = mat4();
  private t = 0;

  update(dt: number, on: boolean, px: number, pz: number, ground: (x: number, z: number) => number, sea: boolean): void {
    this.t += dt;
    if (!on) { this.flocks.length = 0; return; }
    this.flocks = this.flocks.filter((f) => (f.life -= dt) > 0 && Math.hypot(f.cx - px, f.cz - pz) < 280);
    while (this.flocks.length < 2) {
      const a = r(0, Math.PI * 2), d = r(70, 170), cx = px + Math.cos(a) * d, cz = pz + Math.sin(a) * d, dir = r(0, Math.PI * 2), sp = r(1.5, 4);
      const birds: Bird[] = [];
      for (let i = 0, n = Math.floor(r(4, 10)); i < n; i++) birds.push({ a: r(0, Math.PI * 2), r: r(4, 13), h: r(-2, 2), ph: r(0, 6.28), sp: r(0.25, 0.45) * (Math.random() < 0.8 ? 1 : -1) });
      this.flocks.push({ cx, cz, y: Math.max(ground(cx, cz), 0) + r(24, 42), vx: Math.cos(dir) * sp, vz: Math.sin(dir) * sp, life: r(60, 140), color: sea ? 0xe8e8e0 : 0x26262a, birds });
    }
    for (const f of this.flocks) {
      f.cx += f.vx * dt; f.cz += f.vz * dt;
      for (const b of f.birds) b.a += b.sp * dt;
    }
  }

  render(ib: InstanceBuffer, cx: number, cz: number): void {
    for (const f of this.flocks) {
      if (Math.hypot(f.cx - cx, f.cz - cz) > 260) continue;
      for (const b of f.birds) {
        const x = f.cx + Math.cos(b.a) * b.r, z = f.cz + Math.sin(b.a) * b.r, y = f.y + b.h + Math.sin(this.t * 0.8 + b.ph) * 1.5;
        // cap : tangente au cercle ; ailes de part et d'autre, qui montent et descendent
        const hx = -Math.sin(b.a) * Math.sign(b.sp), hz = Math.cos(b.a) * Math.sign(b.sp), yaw = Math.atan2(hx, -hz);
        const flap = Math.sin(this.t * 9 + b.ph * 5) * 0.35, wx = -hz, wz = hx;
        trsYawPitch(this.m4, x, y, z, -yaw, 0, 0.45, 0.24, 0.9);
        ib.add(this.m4, f.color, M.FUR, 0, 0, 1, SHAPE.SPHERE);
        for (const s of [-1, 1]) {
          trsYawPitch(this.m4, x + wx * s * 0.8, y + flap, z + wz * s * 0.8, -yaw, 0, 1.3, 0.09, 0.45);
          ib.add(this.m4, f.color, M.FUR, 0, 0, 1, SHAPE.BOX);
        }
      }
    }
  }
}
