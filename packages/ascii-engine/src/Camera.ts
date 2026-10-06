import { mat4, perspective, lookAt, multiply, type Mat4 } from '@ascii-fort/core/math';

/**
 * Caméra à la première personne. heading = cap en radians, sens horaire depuis le nord (-Z) ;
 * pitch > 0 = regarder vers le haut. Les matrices sont relatives à la caméra (origine = œil),
 * les shaders soustraient uCamPos : précision float stable partout dans le monde.
 */
export class Camera {
  x = 0; y = 0; z = 0;
  heading = 0;
  pitch = 0;
  fovY = (68 * Math.PI) / 180;
  near = 0.12;
  far = 3200;
  aspect = 1;
  readonly view: Mat4 = mat4();
  readonly proj: Mat4 = mat4();
  readonly viewProj: Mat4 = mat4();
  readonly viewRot = new Float32Array(9);
  readonly invViewRot = new Float32Array(9);

  forward(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [Math.sin(this.heading) * cp, Math.sin(this.pitch), -Math.cos(this.heading) * cp];
  }

  update(aspect: number): void {
    this.aspect = aspect;
    const [fx, fy, fz] = this.forward();
    lookAt(this.view, 0, 0, 0, fx, fy, fz);
    perspective(this.proj, this.fovY, aspect, this.near, this.far);
    multiply(this.viewProj, this.proj, this.view);
    const v = this.view;
    const r = this.viewRot;
    r[0] = v[0]; r[1] = v[1]; r[2] = v[2]; r[3] = v[4]; r[4] = v[5]; r[5] = v[6]; r[6] = v[8]; r[7] = v[9]; r[8] = v[10];
    const t = this.invViewRot;
    t[0] = r[0]; t[1] = r[3]; t[2] = r[6]; t[3] = r[1]; t[4] = r[4]; t[5] = r[7]; t[6] = r[2]; t[7] = r[5]; t[8] = r[8];
  }

  /** Projette un point monde → coordonnées normalisées [0,1] (y vers le bas) + profondeur ; null si derrière. */
  project(wx: number, wy: number, wz: number): { u: number; v: number; dist: number } | null {
    const x = wx - this.x, y = wy - this.y, z = wz - this.z;
    const m = this.viewProj;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.05) return null;
    return { u: (cx / cw) * 0.5 + 0.5, v: 1 - ((cy / cw) * 0.5 + 0.5), dist: cw };
  }
}
