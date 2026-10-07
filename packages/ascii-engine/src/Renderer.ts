import { Shader, makeTexture, makeFramebuffer } from './gl';
import { STATIC_VS, INSTANCED_VS, SCENE_FS, SHADOW_VS, SHADOW_INST_VS, SHADOW_FS, FULLSCREEN_VS, CELL_FS, PRESENT_FS, MAX_LIGHTS , POINT_SHADOW_VS, POINT_SHADOW_INST_VS, POINT_SHADOW_FS } from './shaders';
import { buildAtlas, measureCell, ATLAS_COLS } from './GlyphAtlas';
import { buildMaterialTable, TABLE_W, TABLE_H } from './Materials';
import { TextGrid } from './TextGrid';
import { VERTEX_STRIDE, type MeshData } from './Mesh';
import { buildShapes, SHAPE_COUNT } from './Shapes';
import type { Camera } from './Camera';
import type { AtmosphereState } from './Atmosphere';
import { mat4, ortho, lookAt, multiply, perspective, type Mat4 } from '@ascii-fort/core/math';

export interface PointLight { x: number; y: number; z: number; radius: number; r: number; g: number; b: number }

export interface GpuMesh { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer; count: number }

export interface DrawItem { mesh: GpuMesh; clip?: 0 | 1 | 2; shadow?: boolean; /** centre (chunks) pour l'ombre des torches */ cx?: number; cz?: number }

/** Tampon d'instances d'entités (pièces animées : boîtes, cylindres, sphères, cônes…). */
export class InstanceBuffer {
  floats = new Float32Array(20 * 512);
  ints = new Uint8Array(4 * 512);
  count = 0;
  /** regroupement par forme, calculé à l'envoi au GPU : [début, nombre] par forme */
  groups: [number, number][] = [];
  private sortedF = new Float32Array(0); private sortedI = new Uint8Array(0);
  reset() { this.count = 0; }
  /** Trie les instances par forme (tri par comptage, stable) ; renvoie les tableaux triés. */
  sorted(): [Float32Array, Uint8Array] {
    const n = this.count, cnt = new Array(SHAPE_COUNT).fill(0);
    for (let i = 0; i < n; i++) cnt[Math.min(SHAPE_COUNT - 1, this.ints[i * 4 + 3])]++;
    this.groups = []; let o = 0;
    for (let k = 0; k < SHAPE_COUNT; k++) { this.groups.push([o, cnt[k]]); cnt[k] = o; o += this.groups[k][1]; }
    if (this.sortedF.length < n * 20) { this.sortedF = new Float32Array(this.floats.length); this.sortedI = new Uint8Array(this.ints.length); }
    for (let i = 0; i < n; i++) {
      const j = cnt[Math.min(SHAPE_COUNT - 1, this.ints[i * 4 + 3])]++;
      this.sortedF.set(this.floats.subarray(i * 20, i * 20 + 20), j * 20);
      this.sortedI.set(this.ints.subarray(i * 4, i * 4 + 4), j * 4);
    }
    return [this.sortedF.subarray(0, n * 20), this.sortedI.subarray(0, n * 4)];
  }
  add(m: Mat4, color: number, mat: number, letter = 0, flags = 0, sky = 1, shape = 0) {
    if (this.count * 20 >= this.floats.length) {
      const f = new Float32Array(this.floats.length * 2); f.set(this.floats); this.floats = f;
      const i = new Uint8Array(this.ints.length * 2); i.set(this.ints); this.ints = i;
    }
    const o = this.count * 20;
    this.floats.set(m, o);
    this.floats[o + 16] = ((color >> 16) & 255) / 255; this.floats[o + 17] = ((color >> 8) & 255) / 255;
    this.floats[o + 18] = (color & 255) / 255; this.floats[o + 19] = sky;
    const k = this.count * 4;
    this.ints[k] = mat; this.ints[k + 1] = letter; this.ints[k + 2] = flags; this.ints[k + 3] = shape;
    this.count++;
  }
}

export interface FrameInput {
  camera: Camera;
  atmo: AtmosphereState;
  time: number;
  items: DrawItem[];
  clipRadius: number;
  instances: InstanceBuffer;
  lights: PointLight[];
  viewMode: number;
  sceneOn: boolean;
  /** 0..1 : liseré rouge de douleur */
  hurt?: number;
  /** lumière ponctuelle qui projette des ombres (la torche la plus proche) */
  pointShadow?: { x: number; y: number; z: number; radius: number } | null;
  /** teinte du monde [r, g, b, force] (eau, magie…) */
  tint?: [number, number, number, number];
  /** 0..1 : ondulation de l'image (sous l'eau) */
  wobble?: number;
}

const SHADOW_SIZE = 2048, SHADOW_RANGE = 110, POINT_SIZE = 256;

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly ui = new TextGrid();
  /** grille de l'interface (taille de lecture) */
  cols = 0; rows = 0; cellW = 8; cellH = 16; originX = 0; originY = 0;
  cssCellH = 16;
  /** grille du monde, plus fine : cellule = interface × detail (police plus petite → plus de finesse) */
  wcols = 0; wrows = 0; wcellW = 8; wcellH = 16; worigX = 0; worigY = 0;
  detail = 0.75;
  /** palette : 0 couleurs, 1 ambre, 2 vert terminal (s'applique aussi à l'interface) */
  palette = 0;
  drawCalls = 0;

  private staticSh: Shader; private instSh: Shader; private cellSh: Shader; private presentSh: Shader;
  private shadowSh: Shader; private shadowInstSh: Shader;
  private matTable: WebGLTexture;
  private atlasTex: WebGLTexture | null = null; private uiAtlasTex: WebGLTexture | null = null;
  private sceneTex: WebGLTexture[] = []; private sceneDepth: WebGLTexture | null = null; private sceneFbo: WebGLFramebuffer | null = null;
  private cellTex: WebGLTexture[] = []; private cellFbo: WebGLFramebuffer | null = null;
  private uiGlyphTex: WebGLTexture | null = null; private uiFgTex: WebGLTexture | null = null; private uiBgTex: WebGLTexture | null = null;
  private shadowTex: WebGLTexture; private shadowFbo: WebGLFramebuffer;
  private pointTex: WebGLTexture; private pointFbos: WebGLFramebuffer[] = [];
  private pointSh: Shader; private pointInstSh: Shader;
  private shapes: GpuMesh[];
  private instF: WebGLBuffer; private instI: WebGLBuffer;
  private emptyVao: WebGLVertexArrayObject;
  private shadowMat: Mat4 = mat4();
  private lightPos = new Float32Array(MAX_LIGHTS * 4);
  private lightCol = new Float32Array(MAX_LIGHTS * 4);

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 indisponible sur ce navigateur.');
    this.gl = gl;
    this.staticSh = new Shader(gl, STATIC_VS, SCENE_FS, 'static');
    this.instSh = new Shader(gl, INSTANCED_VS, SCENE_FS, 'instanced');
    this.cellSh = new Shader(gl, FULLSCREEN_VS, CELL_FS, 'cell');
    this.presentSh = new Shader(gl, FULLSCREEN_VS, PRESENT_FS, 'present');
    this.shadowSh = new Shader(gl, SHADOW_VS, SHADOW_FS, 'shadow');
    this.shadowInstSh = new Shader(gl, SHADOW_INST_VS, SHADOW_FS, 'shadowInst');
    this.matTable = makeTexture(gl, TABLE_W, TABLE_H, gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, buildMaterialTable());
    this.emptyVao = gl.createVertexArray()!;

    this.shadowTex = makeTexture(gl, SHADOW_SIZE, SHADOW_SIZE, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    const dummy = makeTexture(gl, SHADOW_SIZE, SHADOW_SIZE, gl.R8, gl.RED, gl.UNSIGNED_BYTE);
    this.shadowFbo = makeFramebuffer(gl, [dummy], this.shadowTex);
    // cube de profondeur pour l'ombre de la torche la plus proche
    this.pointSh = new Shader(gl, POINT_SHADOW_VS, POINT_SHADOW_FS, 'pointShadow');
    this.pointInstSh = new Shader(gl, POINT_SHADOW_INST_VS, POINT_SHADOW_FS, 'pointShadowInst');
    this.pointTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.pointTex);
    for (let i = 0; i < 6; i++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.DEPTH_COMPONENT24, POINT_SIZE, POINT_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (let i = 0; i < 6; i++) {
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, this.pointTex, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      this.pointFbos.push(fb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.instF = gl.createBuffer()!; this.instI = gl.createBuffer()!;
    this.shapes = buildShapes().map((d) => {
      const m = this.createMesh(d);
      gl.bindVertexArray(m.vao);
      for (let i = 0; i < 5; i++) { gl.enableVertexAttribArray(4 + i); gl.vertexAttribDivisor(4 + i, 1); }
      gl.enableVertexAttribArray(9); gl.vertexAttribDivisor(9, 1);
      gl.bindVertexArray(null);
      return m;
    });
  }

  /** Dessine les instances, forme par forme (les pointeurs d'instance sont décalés au début du groupe). */
  private drawInstances(ib: InstanceBuffer) {
    const gl = this.gl;
    ib.groups.forEach(([start, n], k) => {
      if (!n) return;
      const m = this.shapes[k];
      gl.bindVertexArray(m.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instF);
      for (let i = 0; i < 5; i++) gl.vertexAttribPointer(4 + i, 4, gl.FLOAT, false, 80, start * 80 + i * 16);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instI);
      gl.vertexAttribIPointer(9, 4, gl.UNSIGNED_BYTE, 4, start * 4);
      gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0, n);
      this.drawCalls++;
    });
  }

  createMesh(data: MeshData): GpuMesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_STRIDE, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.BYTE, true, VERTEX_STRIDE, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, VERTEX_STRIDE, 16);
    gl.enableVertexAttribArray(3); gl.vertexAttribIPointer(3, 4, gl.UNSIGNED_BYTE, VERTEX_STRIDE, 20);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, count: data.indexCount };
  }

  deleteMesh(m: GpuMesh): void {
    const gl = this.gl;
    gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.vbo); gl.deleteBuffer(m.ibo);
  }

  /** Recalcule la grille de caractères (taille de cellule en px CSS). */
  resize(cssCellH = this.cssCellH, detail = this.detail): void {
    const gl = this.gl;
    this.cssCellH = cssCellH; this.detail = detail;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(64, Math.round(window.innerWidth * dpr)), H = Math.max(64, Math.round(window.innerHeight * dpr));
    this.canvas.width = W; this.canvas.height = H;
    this.cellH = Math.max(8, Math.round(cssCellH * dpr));
    const { cellW, fontPx } = measureCell(this.cellH);
    this.cellW = cellW;
    this.cols = Math.max(20, Math.floor(W / this.cellW));
    this.rows = Math.max(10, Math.floor(H / this.cellH));
    this.originX = Math.floor((W - this.cols * this.cellW) / 2);
    this.originY = Math.floor((H - this.rows * this.cellH) / 2);

    const uiAtlas = buildAtlas(this.cellW, this.cellH, fontPx);
    if (this.uiAtlasTex) gl.deleteTexture(this.uiAtlasTex);
    this.uiAtlasTex = makeTexture(gl, uiAtlas.width, uiAtlas.height, gl.R8, gl.RED, gl.UNSIGNED_BYTE, uiAtlas.data);
    // monde : même police en plus petit (jamais sous 8 px, pour que les glyphes restent des glyphes)
    this.wcellH = Math.max(8, Math.round(this.cellH * Math.min(1, Math.max(0.5, detail))));
    const wm = measureCell(this.wcellH);
    this.wcellW = wm.cellW;
    this.wcols = Math.max(20, Math.floor(W / this.wcellW));
    this.wrows = Math.max(10, Math.floor(H / this.wcellH));
    this.worigX = Math.floor((W - this.wcols * this.wcellW) / 2);
    this.worigY = Math.floor((H - this.wrows * this.wcellH) / 2);
    const atlas = this.wcellH === this.cellH ? uiAtlas : buildAtlas(this.wcellW, this.wcellH, wm.fontPx);
    if (this.atlasTex && this.atlasTex !== this.uiAtlasTex) gl.deleteTexture(this.atlasTex);
    this.atlasTex = atlas === uiAtlas ? this.uiAtlasTex : makeTexture(gl, atlas.width, atlas.height, gl.R8, gl.RED, gl.UNSIGNED_BYTE, atlas.data);

    for (const t of [...this.sceneTex, ...this.cellTex, this.sceneDepth, this.uiGlyphTex, this.uiFgTex, this.uiBgTex]) if (t) gl.deleteTexture(t);
    if (this.sceneFbo) gl.deleteFramebuffer(this.sceneFbo);
    if (this.cellFbo) gl.deleteFramebuffer(this.cellFbo);
    const sw = this.wcols * 2, sh = this.wrows * 2;
    this.sceneTex = [0, 1, 2].map(() => makeTexture(gl, sw, sh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE));
    this.sceneDepth = makeTexture(gl, sw, sh, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    this.sceneFbo = makeFramebuffer(gl, this.sceneTex, this.sceneDepth);
    this.cellTex = [0, 1].map(() => makeTexture(gl, this.wcols, this.wrows, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE));
    this.cellFbo = makeFramebuffer(gl, this.cellTex, null);
    this.ui.resize(this.cols, this.rows);
    this.uiGlyphTex = makeTexture(gl, this.cols, this.rows, gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, this.ui.glyph);
    this.uiFgTex = makeTexture(gl, this.cols, this.rows, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.ui.fg);
    this.uiBgTex = makeTexture(gl, this.cols, this.rows, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.ui.bg);
  }

  /** Rapport largeur/hauteur de la zone de grille (pour la projection). */
  get aspect(): number { return (this.wcols * this.wcellW) / (this.wrows * this.wcellH); }

  /** Cellule sous la souris (coordonnées écran device). */
  cellAt(px: number, py: number): { x: number; y: number } {
    return { x: Math.floor((px - this.originX) / this.cellW), y: Math.floor((py - this.originY) / this.cellH) };
  }

  private setSceneUniforms(sh: Shader, f: FrameInput) {
    const a = f.atmo, c = f.camera;
    sh.m4('uViewProj', c.viewProj).v3('uCamPos', [c.x, c.y, c.z]).f('uTime', f.time)
      .v3('uSunDir', a.lightDir).v3('uSunColor', a.sunColor).v3('uAmbSky', a.ambSky).v3('uAmbGround', a.ambGround)
      .v3('uSkyHorizon', a.skyHorizon).f('uNight', a.night)
      .tex('uMatTable', 0, this.matTable).tex('uShadowMap', 1, this.shadowTex)
      .m4('uShadowMat', this.shadowMat).f('uShadowOn', a.shadows ? 1 : 0).f('uWet', a.wet ?? 0).f('uWind', Math.hypot(a.windX, a.windZ));
    const ps = f.pointShadow;
    sh.f('uPointShadowOn', ps ? 1 : 0).v3('uPointShadowPos', ps ? [ps.x, ps.y, ps.z] : [0, -9999, 0]).f('uPointShadowFar', ps ? ps.radius : 1);
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.pointTex); gl.uniform1i(sh.u('uPointShadowMap'), 2);
    gl.uniform1i(sh.u('uNumLights'), Math.min(MAX_LIGHTS, f.lights.length));
    gl.uniform4fv(sh.u('uLightPos'), this.lightPos);
    gl.uniform4fv(sh.u('uLightCol'), this.lightCol);
  }

  private uploadInstances(ib: InstanceBuffer) {
    const gl = this.gl;
    const [fl, it] = ib.sorted();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instF);
    gl.bufferData(gl.ARRAY_BUFFER, fl, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instI);
    gl.bufferData(gl.ARRAY_BUFFER, it, gl.DYNAMIC_DRAW);
  }

  /** Ombre de la torche la plus proche : 6 faces d'un cube de profondeur (distance à la lumière). */
  private pointShadowPass(f: FrameInput, L: { x: number; y: number; z: number; radius: number }) {
    const gl = this.gl;
    const dirs: [number, number, number, number, number, number][] = [[1, 0, 0, 0, -1, 0], [-1, 0, 0, 0, -1, 0], [0, 1, 0, 0, 0, 1], [0, -1, 0, 0, 0, -1], [0, 0, 1, 0, -1, 0], [0, 0, -1, 0, -1, 0]];
    const view = mat4(), proj = mat4(), vp = mat4();
    perspective(proj, Math.PI / 2, 1, 0.05, L.radius);
    gl.viewport(0, 0, POINT_SIZE, POINT_SIZE);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2);
    const near = f.items.filter((it) => it.shadow && (it.cx === undefined || Math.hypot(it.cx - L.x, (it.cz ?? 0) - L.z) < L.radius + 46));
    for (let face = 0; face < 6; face++) {
      const d = dirs[face];
      lookAt(view, 0, 0, 0, d[0], d[1], d[2], d[3], d[4], d[5]);
      multiply(vp, proj, view);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pointFbos[face]);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      this.pointSh.use().m4('uFaceViewProj', vp).v3('uLightPos', [L.x, L.y, L.z]).f('uFar', L.radius);
      for (const it of near) { gl.bindVertexArray(it.mesh.vao); gl.drawElements(gl.TRIANGLES, it.mesh.count, gl.UNSIGNED_INT, 0); this.drawCalls++; }
      if (f.instances.count) { this.pointInstSh.use().m4('uFaceViewProj', vp).v3('uLightPos', [L.x, L.y, L.z]).f('uFar', L.radius); this.drawInstances(f.instances); }
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  private shadowPass(f: FrameInput) {
    const gl = this.gl, a = f.atmo, c = f.camera;
    const [fx, , fz] = c.forward();
    const cx = fx * SHADOW_RANGE * 0.45, cz = fz * SHADOW_RANGE * 0.45;
    const L = a.lightDir;
    const view = mat4(), proj = mat4();
    const up: [number, number, number] = Math.abs(L[1]) > 0.97 ? [0, 0, 1] : [0, 1, 0];
    lookAt(view, cx + L[0] * 400, L[1] * 400, cz + L[2] * 400, cx, 0, cz, up[0], up[1], up[2]);
    // stabilisation : on aligne l'origine sur la grille de texels
    const texel = (SHADOW_RANGE * 2) / SHADOW_SIZE;
    view[12] = Math.round(view[12] / texel) * texel; view[13] = Math.round(view[13] / texel) * texel;
    ortho(proj, -SHADOW_RANGE, SHADOW_RANGE, -SHADOW_RANGE, SHADOW_RANGE, 1, 900);
    multiply(this.shadowMat, proj, view);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.drawBuffers([gl.NONE]);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 3);
    this.shadowSh.use().m4('uShadowMat', this.shadowMat).v3('uCamPos', [c.x, c.y, c.z]);
    for (const it of f.items) {
      if (!it.shadow) continue;
      gl.bindVertexArray(it.mesh.vao);
      gl.drawElements(gl.TRIANGLES, it.mesh.count, gl.UNSIGNED_INT, 0);
      this.drawCalls++;
    }
    if (f.instances.count) {
      this.shadowInstSh.use().m4('uShadowMat', this.shadowMat).v3('uCamPos', [c.x, c.y, c.z]);
      this.drawInstances(f.instances);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  render(f: FrameInput): void {
    const gl = this.gl;
    this.drawCalls = 0;
    const c = f.camera;
    c.update(this.aspect);
    // lumières ponctuelles
    const n = Math.min(MAX_LIGHTS, f.lights.length);
    this.lightPos.fill(0); this.lightCol.fill(0);
    for (let i = 0; i < n; i++) {
      const l = f.lights[i];
      this.lightPos.set([l.x, l.y, l.z, l.radius], i * 4);
      this.lightCol.set([l.r, l.g, l.b, 0], i * 4);
    }
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);

    if (f.sceneOn) {
      if (f.instances.count) this.uploadInstances(f.instances);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
      if (f.atmo.shadows) this.shadowPass(f);
      if (f.pointShadow) this.pointShadowPass(f, f.pointShadow);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      gl.viewport(0, 0, this.wcols * 2, this.wrows * 2);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
      gl.clearBufferfv(gl.COLOR, 2, [0, 0, 0, 0]);
      gl.clearBufferfv(gl.DEPTH, 0, [1]);

      this.staticSh.use();
      this.setSceneUniforms(this.staticSh, f);
      for (const it of f.items) {
        this.staticSh.i('uClipMode', it.clip ?? 0).f('uClipRadius', f.clipRadius);
        gl.bindVertexArray(it.mesh.vao);
        gl.drawElements(gl.TRIANGLES, it.mesh.count, gl.UNSIGNED_INT, 0);
        this.drawCalls++;
      }
      if (f.instances.count) {
        this.instSh.use();
        this.setSceneUniforms(this.instSh, f);
        this.instSh.i('uClipMode', 0);
        this.drawInstances(f.instances);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.DEPTH_TEST);
    }

    // passe cellule
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cellFbo);
    gl.viewport(0, 0, this.wcols, this.wrows);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    const a = f.atmo;
    const th = Math.tan(c.fovY / 2);
    this.cellSh.use()
      .tex('uColor', 0, this.sceneTex[0]).tex('uData', 1, this.sceneTex[1]).tex('uExtra', 2, this.sceneTex[2])
      .tex('uDepth', 3, this.sceneDepth).tex('uMatTable', 4, this.matTable)
      .iv2('uGrid', this.wcols, this.wrows).v3('uCamPos', [c.x, c.y, c.z]).f('uNear', c.near).f('uFar', c.far)
      .v2('uTanHalf', th * this.aspect, th).m3('uViewRot', c.viewRot).m3('uInvViewRot', c.invViewRot)
      .v3('uSunDir', a.sunDir).v3('uMoonDir', a.moonDir).v3('uSunColor', a.sunColor)
      .v3('uSkyTop', a.skyTop).v3('uSkyHorizon', a.skyHorizon).v3('uFogColor', a.fogColor).f('uFogDensity', a.fogDensity)
      .f('uNight', a.night).f('uCloud', a.cloud).f('uRain', a.rain).f('uSnow', a.snow).v2('uWind', a.windX, a.windZ)
      .f('uFlash', a.flash).f('uIndoor', a.indoor).f('uTime', f.time).f('uBgFactor', 0.32).f('uLetterDist', 22)
      .i('uViewMode', f.viewMode).i('uSceneOn', f.sceneOn ? 1 : 0).f('uHurt', Math.min(1, f.hurt ?? 0));
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // présentation
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const ui = this.ui;
    gl.bindTexture(gl.TEXTURE_2D, this.uiGlyphTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RED_INTEGER, gl.UNSIGNED_SHORT, ui.glyph);
    gl.bindTexture(gl.TEXTURE_2D, this.uiFgTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, ui.fg);
    gl.bindTexture(gl.TEXTURE_2D, this.uiBgTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, ui.bg);
    const bottom = this.canvas.height - this.wrows * this.wcellH - this.worigY;
    const uiBottom = this.canvas.height - this.rows * this.cellH - this.originY;
    this.presentSh.use()
      .tex('uCellFg', 0, this.cellTex[0]).tex('uCellBg', 1, this.cellTex[1]).tex('uAtlas', 2, this.atlasTex)
      .iv2('uCellPx', this.wcellW, this.wcellH).iv2('uOrigin', this.worigX, bottom).iv2('uGrid', this.wcols, this.wrows)
      .tex('uUiGlyph', 3, this.uiGlyphTex).tex('uUiFg', 4, this.uiFgTex).tex('uUiBg', 5, this.uiBgTex).tex('uUiAtlas', 6, this.uiAtlasTex)
      .iv2('uUiCellPx', this.cellW, this.cellH).iv2('uUiOrigin', this.originX, uiBottom).iv2('uUiGrid', this.cols, this.rows)
      .f('uHurt', f.sceneOn ? Math.min(1, f.hurt ?? 0) : 0).f('uWobble', f.sceneOn ? f.wobble ?? 0 : 0).f('uTime', f.time)
      .v4('uTint', f.sceneOn && f.tint ? f.tint : [0, 0, 0, 0])
      .i('uAtlasCols', ATLAS_COLS).f('uVignette', f.sceneOn ? 0.35 : 0).i('uPalette', this.palette);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
