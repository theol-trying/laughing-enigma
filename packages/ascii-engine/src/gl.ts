// Utilitaires WebGL2 minimalistes.

export class Shader {
  readonly prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();

  constructor(private gl: WebGL2RenderingContext, vs: string, fs: string, name = 'shader') {
    const v = compile(gl, gl.VERTEX_SHADER, vs, name + '.vs');
    const f = compile(gl, gl.FRAGMENT_SHADER, fs, name + '.fs');
    const p = gl.createProgram()!;
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: link\n${gl.getProgramInfoLog(p)}`);
    gl.deleteShader(v); gl.deleteShader(f);
    this.prog = p;
  }

  use(): this { this.gl.useProgram(this.prog); return this; }

  u(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) { l = this.gl.getUniformLocation(this.prog, name); this.locs.set(name, l); }
    return l;
  }
  i(name: string, v: number) { this.gl.uniform1i(this.u(name), v); return this; }
  f(name: string, v: number) { this.gl.uniform1f(this.u(name), v); return this; }
  v2(name: string, a: number, b: number) { this.gl.uniform2f(this.u(name), a, b); return this; }
  v3(name: string, v: ArrayLike<number>) { this.gl.uniform3f(this.u(name), v[0], v[1], v[2]); return this; }
  v4(name: string, v: ArrayLike<number>) { this.gl.uniform4f(this.u(name), v[0], v[1], v[2], v[3]); return this; }
  iv2(name: string, a: number, b: number) { this.gl.uniform2i(this.u(name), a, b); return this; }
  m4(name: string, m: Float32Array) { this.gl.uniformMatrix4fv(this.u(name), false, m); return this; }
  m3(name: string, m: Float32Array) { this.gl.uniformMatrix3fv(this.u(name), false, m); return this; }
  tex(name: string, unit: number, t: WebGLTexture | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(this.u(name), unit);
    return this;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, name: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error(`${name}: compile\n${log}\n${numbered}`);
  }
  return s;
}

export function makeTexture(
  gl: WebGL2RenderingContext, w: number, h: number,
  internal: number, format: number, type: number, data: ArrayBufferView | null = null,
): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function makeFramebuffer(gl: WebGL2RenderingContext, colors: WebGLTexture[], depth: WebGLTexture | null): WebGLFramebuffer {
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  colors.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
  if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplet: 0x' + st.toString(16));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fb;
}
