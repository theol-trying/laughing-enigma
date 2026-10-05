// Construction de maillages côté CPU (pur TS, utilisable dans les tests).
// Format de sommet entrelacé, 24 octets :
//   0  pos     float32 ×3
//   12 normale int8 ×4 (normalisée)
//   16 couleur uint8 ×4 (rgb + lumière du ciel / occlusion)
//   20 matière uint8, drapeaux uint8, 2 octets libres
export const VERTEX_STRIDE = 24;

export interface MeshData {
  vertices: ArrayBuffer;
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

export class MeshBuilder {
  private buf: ArrayBuffer;
  private f32: Float32Array;
  private i8: Int8Array;
  private u8: Uint8Array;
  private idx: Uint32Array;
  vcount = 0;
  icount = 0;
  /** lumière du ciel par défaut (0 = intérieur fermé, 1 = plein air) */
  sky = 1;
  /** drapeaux de sommet par défaut (1 = balancement au vent) */
  vflags = 0;

  constructor(initialVerts = 1024) {
    this.buf = new ArrayBuffer(initialVerts * VERTEX_STRIDE);
    this.f32 = new Float32Array(this.buf); this.i8 = new Int8Array(this.buf); this.u8 = new Uint8Array(this.buf);
    this.idx = new Uint32Array(initialVerts * 2);
  }

  private growV(n: number) {
    if ((this.vcount + n) * VERTEX_STRIDE <= this.buf.byteLength) return;
    let cap = this.buf.byteLength / VERTEX_STRIDE;
    while (cap < this.vcount + n) cap *= 2;
    const nb = new ArrayBuffer(cap * VERTEX_STRIDE);
    new Uint8Array(nb).set(this.u8);
    this.buf = nb; this.f32 = new Float32Array(nb); this.i8 = new Int8Array(nb); this.u8 = new Uint8Array(nb);
  }
  private growI(n: number) {
    if (this.icount + n <= this.idx.length) return;
    let cap = this.idx.length;
    while (cap < this.icount + n) cap *= 2;
    const ni = new Uint32Array(cap); ni.set(this.idx); this.idx = ni;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, color: number, mat: number, sky = this.sky, flags = this.vflags): number {
    this.growV(1);
    const v = this.vcount++, f = v * 6, b = v * VERTEX_STRIDE;
    this.f32[f] = x; this.f32[f + 1] = y; this.f32[f + 2] = z;
    this.i8[b + 12] = Math.round(nx * 127); this.i8[b + 13] = Math.round(ny * 127); this.i8[b + 14] = Math.round(nz * 127);
    this.u8[b + 16] = (color >> 16) & 255; this.u8[b + 17] = (color >> 8) & 255; this.u8[b + 18] = color & 255;
    this.u8[b + 19] = Math.round(Math.max(0, Math.min(1, sky)) * 255);
    this.u8[b + 20] = mat; this.u8[b + 21] = flags;
    return v;
  }

  tri(a: number, b: number, c: number) {
    this.growI(3);
    this.idx[this.icount++] = a; this.idx[this.icount++] = b; this.idx[this.icount++] = c;
  }
  quad(a: number, b: number, c: number, d: number) { this.tri(a, b, c); this.tri(a, c, d); }

  /** Quadrilatère plan à normale calculée. */
  face(p: number[][], color: number, mat: number) {
    const [a, b, c] = p;
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const ids = p.map((q) => this.vertex(q[0], q[1], q[2], nx, ny, nz, color, mat));
    if (ids.length === 3) this.tri(ids[0], ids[1], ids[2]);
    else this.quad(ids[0], ids[1], ids[2], ids[3]);
  }

  /** Boîte orientée (rotation θ autour de Y). cy = base. Tailles complètes. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw: number, color: number, mat: number, topColor = color) {
    const c = Math.cos(yaw), s = Math.sin(yaw), hx = sx / 2, hz = sz / 2;
    const P = (lx: number, y: number, lz: number) => [cx + lx * c + lz * s, cy + y, cz - lx * s + lz * c];
    const p000 = P(-hx, 0, -hz), p100 = P(hx, 0, -hz), p101 = P(hx, 0, hz), p001 = P(-hx, 0, hz);
    const p010 = P(-hx, sy, -hz), p110 = P(hx, sy, -hz), p111 = P(hx, sy, hz), p011 = P(-hx, sy, hz);
    this.face([p010, p011, p111, p110], topColor, mat);      // dessus
    this.face([p000, p100, p101, p001], color, mat);         // dessous
    this.face([p001, p101, p111, p011], color, mat);         // +z
    this.face([p100, p000, p010, p110], color, mat);         // -z
    this.face([p101, p100, p110, p111], color, mat);         // +x
    this.face([p000, p001, p011, p010], color, mat);         // -x
  }

  /** Toit à deux pans : faîte le long de l'axe local X. cy = bas du toit. */
  gable(cx: number, cy: number, cz: number, length: number, width: number, height: number, yaw: number, color: number, mat: number, gableColor = color, gableMat = mat) {
    const c = Math.cos(yaw), s = Math.sin(yaw), hl = length / 2, hw = width / 2;
    const P = (lx: number, y: number, lz: number) => [cx + lx * c + lz * s, cy + y, cz - lx * s + lz * c];
    const a = P(-hl, 0, -hw), b = P(hl, 0, -hw), d = P(-hl, 0, hw), e = P(hl, 0, hw);
    const r0 = P(-hl, height, 0), r1 = P(hl, height, 0);
    this.face([a, r0, r1, b], color, mat);
    this.face([e, r1, r0, d], color, mat);
    this.face([d, r0, a], gableColor, gableMat);
    this.face([b, r1, e], gableColor, gableMat);
  }

  /** Pyramide à base rectangulaire. */
  pyramid(cx: number, cy: number, cz: number, sx: number, sz: number, h: number, yaw: number, color: number, mat: number) {
    const c = Math.cos(yaw), s = Math.sin(yaw), hx = sx / 2, hz = sz / 2;
    const P = (lx: number, y: number, lz: number) => [cx + lx * c + lz * s, cy + y, cz - lx * s + lz * c];
    const a = P(-hx, 0, -hz), b = P(hx, 0, -hz), d = P(hx, 0, hz), e = P(-hx, 0, hz), t = P(0, h, 0);
    this.face([a, t, b], color, mat); this.face([b, t, d], color, mat);
    this.face([d, t, e], color, mat); this.face([e, t, a], color, mat);
  }

  /** Prisme à n côtés (tour, tronc, colonne). */
  cylinder(cx: number, cy: number, cz: number, r: number, h: number, n: number, color: number, mat: number, cap = true, r2 = r) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r];
      const q0 = [cx + Math.cos(a0) * r2, cy + h, cz + Math.sin(a0) * r2], q1 = [cx + Math.cos(a1) * r2, cy + h, cz + Math.sin(a1) * r2];
      this.face([p0, q0, q1, p1], color, mat);
      if (cap && r2 > 0.01) this.face([q0, [cx, cy + h, cz], q1], color, mat);
    }
  }

  cone(cx: number, cy: number, cz: number, r: number, h: number, n: number, color: number, mat: number) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      this.face([[cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r], [cx, cy + h, cz], [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r]], color, mat);
      this.face([[cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r], [cx, cy, cz], [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r]], color, mat);
    }
  }

  /** Ellipsoïde low-poly (feuillage, rochers). */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: number, mat: number, seg = 6, rings = 4) {
    const base = this.vcount;
    for (let j = 0; j <= rings; j++) {
      const v = (j / rings) * Math.PI, sv = Math.sin(v), cv = Math.cos(v);
      for (let i = 0; i <= seg; i++) {
        const u = (i / seg) * Math.PI * 2, nx = Math.cos(u) * sv, nz = Math.sin(u) * sv;
        this.vertex(cx + nx * rx, cy + cv * ry, cz + nz * rz, nx, cv, nz, color, mat);
      }
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
      const a = base + j * (seg + 1) + i, b = a + seg + 1;
      this.quad(a, b, b + 1, a + 1);
    }
  }

  finish(): MeshData {
    return {
      vertices: this.buf.slice(0, this.vcount * VERTEX_STRIDE),
      indices: this.idx.slice(0, this.icount),
      vertexCount: this.vcount,
      indexCount: this.icount,
    };
  }
}
