// Shaders GLSL ES 3.0.
export const MAX_LIGHTS = 24;

const SCENE_COMMON = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
`;

/** Maillages statiques (terrain, bâtiments, végétation). Positions en monde, rendu relatif caméra. */
export const STATIC_VS = SCENE_COMMON + /* glsl */ `
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aNormal;
layout(location=2) in vec4 aColor;
layout(location=3) in uvec4 aMat;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uTime;
out vec3 vWorld;
out vec3 vNormal;
out vec4 vColor;
flat out uint vMat;
flat out uint vLetter;
flat out uint vFlags;
void main() {
  vec3 p = aPos;
  // balancement du feuillage au vent
  if (aMat.y == 1u) p.xz += sin(uTime * 1.7 + p.x * 0.3 + p.z * 0.2) * 0.08 * clamp(p.y - aPos.y + 1.0, 0.0, 1.0);
  vWorld = p;
  vNormal = aNormal.xyz;
  vColor = aColor;
  vMat = aMat.x;
  vLetter = 0u;
  vFlags = 0u;
  gl_Position = uViewProj * vec4(p - uCamPos, 1.0);
}`;

/** Entités : cube unité instancié (matrice + couleur + matière + lettre par instance). */
export const INSTANCED_VS = SCENE_COMMON + /* glsl */ `
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aNormal;
layout(location=4) in vec4 aM0;
layout(location=5) in vec4 aM1;
layout(location=6) in vec4 aM2;
layout(location=7) in vec4 aM3;
layout(location=8) in vec4 aIColor;
layout(location=9) in uvec4 aIMat;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
out vec3 vWorld;
out vec3 vNormal;
out vec4 vColor;
flat out uint vMat;
flat out uint vLetter;
flat out uint vFlags;
void main() {
  mat4 m = mat4(aM0, aM1, aM2, aM3);
  vec4 w = m * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vec3 s2 = vec3(dot(aM0.xyz, aM0.xyz), dot(aM1.xyz, aM1.xyz), dot(aM2.xyz, aM2.xyz));
  vNormal = normalize(mat3(m) * (aNormal.xyz / max(s2, vec3(1e-6))));
  vColor = aIColor;
  vMat = aIMat.x;
  vLetter = aIMat.y;
  vFlags = aIMat.z;
  gl_Position = uViewProj * vec4(w.xyz - uCamPos, 1.0);
}`;

export const SCENE_FS = SCENE_COMMON + /* glsl */ `
in vec3 vWorld;
in vec3 vNormal;
in vec4 vColor;
flat in uint vMat;
flat in uint vLetter;
flat in uint vFlags;
uniform highp usampler2D uMatTable;
uniform vec3 uCamPos;
uniform float uWet;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uSkyHorizon;
uniform float uTime;
uniform float uNight;
uniform int uNumLights;
uniform vec4 uLightPos[${MAX_LIGHTS}];
uniform vec4 uLightCol[${MAX_LIGHTS}];
uniform int uClipMode;      // 0 aucun, 1 jeter si proche, 2 jeter si loin
uniform float uClipRadius;
uniform highp sampler2D uShadowMap;
uniform mat4 uShadowMat;
uniform float uShadowOn;
layout(location=0) out vec4 oColor;  // rgb couleur éclairée, a = intensité lumineuse
layout(location=1) out vec4 oData;   // r matière, g hachage/phase, ba normale octaédrique
layout(location=2) out vec4 oExtra;  // r lettre d'entité, g drapeaux

vec2 octEncode(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  vec2 e = n.y >= 0.0 ? n.xz : (1.0 - abs(n.zx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.z >= 0.0 ? 1.0 : -1.0);
  return e * 0.5 + 0.5;
}
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float shadowAt(vec3 wp, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 s = uShadowMat * vec4(wp + n * 0.25 - uCamPos, 1.0);
  vec3 c = s.xyz / s.w * 0.5 + 0.5;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  vec2 ts = 1.0 / vec2(textureSize(uShadowMap, 0));
  float lit = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    float d = texture(uShadowMap, c.xy + vec2(x, y) * ts).r;
    lit += c.z - 0.0015 > d ? 0.0 : 1.0;
  }
  return lit / 9.0;
}

void main() {
  float dx = vWorld.x - uCamPos.x, dz = vWorld.z - uCamPos.z;
  float hd = sqrt(dx * dx + dz * dz);
  if (uClipMode == 1 && hd < uClipRadius) discard;
  if (uClipMode == 2 && hd > uClipRadius) discard;

  uint flags = texelFetch(uMatTable, ivec2(14, int(vMat)), 0).r;
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 albedo = vColor.rgb;
  float sky = vColor.a;
  float phase = hash13(floor(vWorld * 2.0) + 0.5);

  if ((flags & 4u) != 0u) {
    // eau : normale animée
    float t = uTime;
    n = normalize(vec3(sin(vWorld.x * 0.7 + t * 1.3) * 0.08 + sin(vWorld.z * 1.3 - t) * 0.05, 1.0,
                       cos(vWorld.z * 0.8 + t * 1.1) * 0.08));
    phase = fract(vWorld.x * 0.11 + vWorld.z * 0.07 + sin(vWorld.z * 0.25 + t * 0.8) * 0.25 - t * 0.25);
  }

  float ndl = max(dot(n, uSunDir), 0.0);
  float sh = ndl > 0.0 ? shadowAt(vWorld, n) : 1.0;
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5) * (0.25 + 0.75 * sky);
  vec3 light = amb + uSunColor * ndl * sh * (0.15 + 0.85 * sky);

  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uNumLights) break;
    vec3 L = uLightPos[i].xyz - vWorld;
    float d = length(L);
    float r = uLightPos[i].w;
    if (d >= r) continue;
    float att = 1.0 - d / r; att *= att;
    float lam = max(dot(n, L / max(d, 0.001)), 0.0) * 0.75 + 0.25;
    light += uLightCol[i].rgb * att * lam;
  }

  vec3 col = albedo * light;
  float inten = dot(light, vec3(0.3, 0.5, 0.2));
  // pluie : les surfaces exposées foncent et luisent, des flaques reflètent le ciel sur le sol plat
  if (uWet > 0.0 && sky > 0.5 && (flags & 36u) == 0u) {
    float w = uWet * smoothstep(0.5, 1.0, sky);
    col *= 1.0 - 0.3 * w;
    if (n.y > 0.5) {
      vec3 v = normalize(uCamPos - vWorld), hv = normalize(uSunDir + v);
      vec2 q = vWorld.xz * 0.32, iq = floor(q), fq = fract(q);
      fq = fq * fq * (3.0 - 2.0 * fq);
      float nz = mix(mix(hash13(vec3(iq, 1.0)), hash13(vec3(iq + vec2(1.0, 0.0), 1.0)), fq.x),
                     mix(hash13(vec3(iq + vec2(0.0, 1.0), 1.0)), hash13(vec3(iq + 1.0, 1.0)), fq.x), fq.y);
      float puddle = smoothstep(0.62, 0.78, nz) * step(0.95, n.y) * smoothstep(0.3, 0.8, w);
      float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
      float sheen = pow(max(dot(n, hv), 0.0), 30.0) * (1.0 - uNight * 0.7);
      col = mix(col, uSkyHorizon * (0.3 + 0.5 * (1.0 - uNight)), w * (puddle * 0.6 + fres * 0.22)) + uSunColor * sheen * w * (0.15 + puddle * 0.8);
      inten = mix(inten, max(inten, 0.45), puddle * w * 0.5);
    }
  }

  if ((flags & 1u) != 0u) {               // émissif
    float fl = 0.85 + 0.15 * sin(uTime * 13.0 + phase * 40.0);
    col = albedo * (1.1 * fl); inten = 1.0;
    phase = fract(phase + uTime * 0.9);
  } else if ((flags & 2u) != 0u) {        // fenêtres éclairées la nuit
    float glow = uNight * (0.75 + 0.25 * sin(uTime * 3.0 + phase * 20.0));
    col = mix(col, albedo * 1.2, glow); inten = mix(inten, 0.95, glow);
  }
  if ((flags & 4u) != 0u) {
    vec3 v = normalize(uCamPos - vWorld);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    vec3 hv = normalize(uSunDir + v);
    float spec = pow(max(dot(n, hv), 0.0), 60.0) * (1.0 - uNight * 0.8);
    col = mix(col, uSkyHorizon * (0.4 + 0.6 * (1.0 - uNight)), 0.35 + 0.5 * fres) + uSunColor * spec * 1.5;
    inten = clamp(inten * 0.7 + fres * 0.4 + spec, 0.0, 1.0);
  }
  if ((vFlags & 1u) != 0u) { col = vec3(1.0, 0.25, 0.2); inten = 1.0; } // flash de dégâts
  if ((vFlags & 2u) != 0u) { col *= 1.35; inten = min(1.0, inten + 0.25); } // cible

  oColor = vec4(col, clamp(inten, 0.0, 1.0));
  oData = vec4(float(vMat) / 255.0, phase, octEncode(n));
  oExtra = vec4(float(vLetter) / 255.0, float(vFlags) / 255.0, 0.0, 1.0);
}`;

export const SHADOW_VS = SCENE_COMMON + /* glsl */ `
layout(location=0) in vec3 aPos;
uniform mat4 uShadowMat;
uniform vec3 uCamPos;
void main() { gl_Position = uShadowMat * vec4(aPos - uCamPos, 1.0); }`;

export const SHADOW_INST_VS = SCENE_COMMON + /* glsl */ `
layout(location=0) in vec3 aPos;
layout(location=4) in vec4 aM0;
layout(location=5) in vec4 aM1;
layout(location=6) in vec4 aM2;
layout(location=7) in vec4 aM3;
uniform mat4 uShadowMat;
uniform vec3 uCamPos;
void main() { vec4 w = mat4(aM0, aM1, aM2, aM3) * vec4(aPos, 1.0); gl_Position = uShadowMat * vec4(w.xyz - uCamPos, 1.0); }`;

export const SHADOW_FS = SCENE_COMMON + /* glsl */ `
out vec4 o;
void main() { o = vec4(1.0); }`;

/** Triangle plein écran. */
export const FULLSCREEN_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Passe « cellule » : une invocation par caractère de la grille → glyphe + couleurs. */
export const CELL_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uColor;
uniform sampler2D uData;
uniform sampler2D uExtra;
uniform highp sampler2D uDepth;
uniform highp usampler2D uMatTable;
uniform ivec2 uGrid;
uniform vec3 uCamPos;
uniform float uNear;
uniform float uFar;
uniform vec2 uTanHalf;      // tan(fov/2) en x et y
uniform mat3 uViewRot;      // monde → vue
uniform mat3 uInvViewRot;   // vue → monde
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uNight;
uniform float uCloud;
uniform float uRain;
uniform float uSnow;
uniform vec2 uWind;
uniform float uFlash;
uniform float uIndoor;
uniform float uTime;
uniform float uBgFactor;
uniform float uLetterDist;
uniform int uViewMode;
uniform int uSceneOn;
layout(location=0) out vec4 oFg;
layout(location=1) out vec4 oBg;

const int ROW_QUAD = 60, ROW_SKY = 61, ROW_FX = 62, ROW_DEBUG = 63;

uint tbl(int x, int row) { return texelFetch(uMatTable, ivec2(x, row), 0).r; }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
vec3 octDecode(vec2 e) {
  e = e * 2.0 - 1.0;
  vec3 n = vec3(e.x, 1.0 - abs(e.x) - abs(e.y), e.y);
  if (n.y < 0.0) n.xz = (1.0 - abs(n.zx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.z >= 0.0 ? 1.0 : -1.0);
  return normalize(n);
}
vec3 tone(vec3 c) { return 1.0 - exp(-c * 1.9); }
float linDepth(float z) { float ndc = z * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear)); }

vec3 viewDirAt(vec2 sub) {
  // sub : coordonnées en sous-échantillons (0..2*grid)
  vec2 ndc = sub / vec2(uGrid * 2) * 2.0 - 1.0;
  return normalize(uInvViewRot * vec3(ndc.x * uTanHalf.x, ndc.y * uTanHalf.y, -1.0));
}

vec3 skyColor(vec3 d) {
  float h = d.y;
  vec3 c = mix(uSkyHorizon, uSkyTop, smoothstep(-0.02, 0.55, h));
  if (h < 0.0) c = mix(uSkyHorizon, uFogColor * 0.6, smoothstep(0.0, -0.3, h));
  float sunGlow = pow(max(dot(d, uSunDir), 0.0), 12.0) * (1.0 - uNight);
  c += uSunColor * sunGlow * 0.35;
  return c + uFlash * vec3(0.6, 0.65, 0.8);
}

// Ciel : renvoie glyphe et couleurs pour une direction
void skyCell(vec3 d, vec2 cell, out uint g, out vec3 fg, out vec3 bg) {
  bg = skyColor(d);
  fg = bg; g = tbl(9, ROW_SKY); // espace
  // étoiles
  if (uNight > 0.2 && d.y > 0.02) {
    vec2 q = floor(vec2(atan(d.z, d.x) * 120.0, d.y * 150.0));
    float h = hash12(q);
    if (h < 0.012 * uNight * (1.0 - uCloud)) {
      float tw = 0.6 + 0.4 * sin(uTime * 3.0 + h * 500.0);
      g = tbl(5 + int(h * 333.0) % 4, ROW_SKY);
      fg = vec3(0.75, 0.8, 1.0) * tw;
    }
  }
  // soleil et lune
  float sd = dot(d, uSunDir);
  if (sd > 0.9985 && uNight < 0.9) { g = tbl(0, ROW_SKY); fg = vec3(1.0, 0.97, 0.8); bg = mix(bg, fg, 0.6); }
  else if (sd > 0.9965 && uNight < 0.9) { g = tbl(1, ROW_SKY); fg = vec3(1.0, 0.9, 0.6); }
  else if (sd > 0.993 && uNight < 0.9) { g = tbl(3, ROW_SKY); fg = mix(bg, vec3(1.0, 0.85, 0.5), 0.8); }
  float md = dot(d, uMoonDir);
  if (md > 0.9975 && uNight > 0.3) { g = tbl(4, ROW_SKY); fg = vec3(0.85, 0.9, 1.0); }
  // nuages
  if (d.y > 0.01 && uCloud > 0.02) {
    vec2 uv = d.xz / (d.y + 0.08) * 1.6 + uWind * uTime * 0.02;
    float den = fbm(uv) * 1.25 - (1.0 - uCloud) * 0.85;
    if (den > 0.0) {
      float k = clamp(den * 3.0, 0.0, 1.0) * smoothstep(0.01, 0.15, d.y);
      int idx = 9 + int(k * 5.99);
      vec3 cc = mix(vec3(0.55, 0.58, 0.62), vec3(1.0), 1.0 - uCloud * 0.6) * (0.15 + 0.85 * (1.0 - uNight));
      cc = mix(cc, uSunColor, 0.25 * (1.0 - uNight));
      if (k > 0.05) { g = tbl(idx, ROW_SKY); fg = cc; bg = mix(bg, cc * 0.7, k * 0.6); }
    }
  }
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  uint glyph = 0u;
  vec3 fg = vec3(0.0), bg = vec3(0.0);

  if (uSceneOn == 1) {
    ivec2 s0 = cell * 2;
    ivec2 offs[4] = ivec2[4](ivec2(0, 1), ivec2(1, 1), ivec2(0, 0), ivec2(1, 0)); // HG HD BG BD
    float ld[4]; vec4 col[4]; vec4 dat[4]; bool isSky[4];
    float dmin = 1e9, dmax = 0.0; int imin = 0, imax = 0; int nSky = 0;
    for (int i = 0; i < 4; i++) {
      ivec2 p = s0 + offs[i];
      float z = texelFetch(uDepth, p, 0).r;
      isSky[i] = z >= 0.99999;
      ld[i] = isSky[i] ? uFar : linDepth(z);
      col[i] = texelFetch(uColor, p, 0);
      dat[i] = texelFetch(uData, p, 0);
      if (isSky[i]) nSky++;
      if (ld[i] < dmin) { dmin = ld[i]; imin = i; }
      if (ld[i] > dmax) { dmax = ld[i]; imax = i; }
    }
    vec2 subCenter = vec2(s0) + 1.0;
    vec3 vd = viewDirAt(subCenter);
    // brouillard + teinte solaire
    vec3 fogCol = uFogColor + uSunColor * pow(max(dot(vd, uSunDir), 0.0), 6.0) * 0.25 * (1.0 - uNight);

    // découpe en quadrants ? (silhouette : ciel / objet, ou rupture de plan)
    bool split = false;
    if (nSky > 0 && nSky < 4) split = true;
    else if (nSky == 0 && dmax > dmin * 1.08) {
      vec3 nA = octDecode(dat[imin].ba);
      vec3 pA = viewDirAt(vec2(s0 + offs[imin]) + 0.5) * dmin;
      vec3 pB = viewDirAt(vec2(s0 + offs[imax]) + 0.5) * dmax;
      float planeDist = abs(dot(pB - pA, nA));
      split = planeDist > 0.035 * dmin + 0.08 || dmax > dmin * 3.0;
    }

    if (nSky == 4) {
      skyCell(vd, vec2(cell), glyph, fg, bg);
    } else if (split) {
      float th = sqrt(max(dmin, 0.01) * dmax);
      int mask = 0; vec3 nearC = vec3(0.0), farC = vec3(0.0); float nn = 0.0, nf = 0.0; float nearD = 0.0, farD = 0.0;
      for (int i = 0; i < 4; i++) {
        bool near = !isSky[i] && ld[i] < th;
        if (nSky > 0) near = !isSky[i];
        if (near) { mask |= (1 << i); nearC += col[i].rgb; nn += 1.0; nearD += ld[i]; }
        else {
          vec3 c = isSky[i] ? skyColor(viewDirAt(vec2(s0 + offs[i]) + 0.5)) : col[i].rgb;
          farC += c; nf += 1.0; farD += isSky[i] ? 0.0 : ld[i];
        }
      }
      nearC /= max(nn, 1.0); farC /= max(nf, 1.0); nearD /= max(nn, 1.0);
      float fN = 1.0 - exp(-pow(nearD * uFogDensity, 2.0));
      fg = mix(tone(nearC) * 1.1, fogCol, fN);
      bg = nSky > 0 ? farC : mix(tone(farC) * 0.9, fogCol, 1.0 - exp(-pow((farD / max(nf, 1.0)) * uFogDensity, 2.0)));
      glyph = tbl(mask, ROW_QUAD);
    } else {
      // cellule homogène : glyphe de la matière
      int i0 = imin;
      vec3 c = (col[0].rgb + col[1].rgb + col[2].rgb + col[3].rgb) * 0.25;
      float inten = (col[0].a + col[1].a + col[2].a + col[3].a) * 0.25;
      int mat = int(dat[i0].r * 255.0 + 0.5);
      float ph = dat[i0].g;
      uint flags = tbl(14, mat);
      int rampLen = int(tbl(8, mat));
      int detN = int(tbl(13, mat));
      float d = ld[i0];
      float fogF = 1.0 - exp(-pow(d * uFogDensity, 2.0));
      float lv = clamp(pow(inten, 0.6) * (1.0 - fogF * 0.75), 0.0, 1.0);
      float dith = (ph - 0.5) * 0.35;
      int li = rampLen > 0 ? clamp(int(lv * float(rampLen) + dith + 0.15), 0, rampLen - 1) : 0;
      glyph = rampLen > 0 ? tbl(li, mat) : 0u;
      bool animated = (flags & 8u) != 0u;
      if (detN > 0 && li >= 2) {
        if ((flags & 16u) != 0u) {
          vec3 nv = uViewRot * octDecode(dat[i0].ba);
          if (d < 120.0) glyph = tbl(9 + (nv.x < 0.0 ? 0 : 1), mat);
        } else if (animated) {
          glyph = tbl(9 + int(ph * float(detN)) % detN, mat);
        } else if (d < 45.0 && ph > 0.45) {
          glyph = tbl(9 + int(ph * 97.0) % detN, mat);
        }
      }
      // lettre roguelike pour les créatures lointaines
      vec4 ex = texelFetch(uExtra, s0 + offs[i0], 0);
      uint letter = uint(ex.r * 255.0 + 0.5);
      if (letter > 0u && d > uLetterDist) glyph = letter;
      vec3 tc = tone(c);
      fg = mix(tc * 1.15 + 0.03, fogCol, fogF);
      bg = mix(tc * uBgFactor, fogCol * 0.92, fogF);
      if (fogF > 0.985) glyph = tbl(9, ROW_SKY);

      if (uViewMode == 1) { // profondeur
        float k = clamp(log(d) / log(uFar), 0.0, 1.0);
        glyph = tbl(int(k * 10.0), ROW_DEBUG); fg = vec3(1.0 - k); bg = vec3(0.0);
      } else if (uViewMode == 2) { // normales
        fg = octDecode(dat[i0].ba) * 0.5 + 0.5; bg = fg * 0.3;
      } else if (uViewMode == 3) { // matières
        fg = vec3(fract(float(mat) * 0.37), fract(float(mat) * 0.61), fract(float(mat) * 0.83)); bg = fg * 0.3;
      } else if (uViewMode == 4) { // lumière seule
        fg = vec3(inten); bg = vec3(inten * 0.2);
      }
    }

    // précipitations
    if (uIndoor < 0.5 && (uRain > 0.01 || uSnow > 0.01)) {
      float colId = float(cell.x);
      float rowTop = float(uGrid.y - 1 - cell.y);
      if (uRain > 0.01) {
        float dS = ld[imin];
        vec3 rc = vec3(0.62, 0.7, 0.82) * (0.45 + 0.55 * (1.0 - uNight));
        // éclaboussures sur les surfaces tournées vers le ciel (sol, toits) et ronds dans l'eau
        int smat = int(dat[imin].r * 255.0 + 0.5);
        uint sflags = tbl(14, smat);
        vec3 sn = octDecode(dat[imin].ba);
        if (!isSky[imin] && dS < 35.0 && sn.y > 0.6 && smat != 22 && (sflags & 32u) == 0u) {
          vec3 fwd = uInvViewRot * vec3(0.0, 0.0, -1.0);
          vec3 wp = uCamPos + vd * dS / max(0.15, dot(vd, fwd));
          vec2 qc = floor(wp.xz / 0.7);
          float hs = hash12(qc);
          float ts = fract(uTime * (1.1 + hs) + hs * 7.0);
          if (hs > 0.3 && ts < 0.05 + 0.12 * uRain) {
            bool wet = (sflags & 4u) != 0u;
            glyph = tbl(ts < 0.05 ? 4 : (wet ? (hs > 0.65 ? 9 : 8) : (hs > 0.65 ? 7 : 6)), ROW_FX);
            fg = mix(fg, rc * 1.15, 0.7);
          }
        }
        // gouttes sur trois profondeurs (2,5 m, 9 m, 26 m) : une surface plus proche les cache
        for (int L = 0; L < 3; L++) {
          float depthL = L == 0 ? 2.5 : (L == 1 ? 9.0 : 26.0);
          if (dS < depthL) continue;
          float sp = L == 0 ? 46.0 : (L == 1 ? 28.0 : 16.0);
          float seg = L == 0 ? 17.0 : (L == 1 ? 23.0 : 29.0);
          float y = rowTop - uTime * sp + hash12(vec2(colId, 7.0 + float(L) * 13.0)) * 300.0;
          float len = (L == 0 ? 0.22 : (L == 1 ? 0.12 : 0.07)) * (0.5 + uRain * 0.6);
          if (fract(y / seg) < len && hash12(vec2(colId + float(L) * 0.37, floor(y / seg))) < (L == 0 ? 0.16 : 0.4) * (0.35 + uRain)) {
            int gi = abs(uWind.x) > 0.5 ? (uWind.x > 0.0 ? 2 : 1) : 0;
            glyph = tbl(L == 2 ? 7 : gi, ROW_FX);
            fg = mix(fg, mix(rc, fogCol, L == 2 ? 0.45 : (L == 1 ? 0.2 : 0.0)), L == 0 ? 0.9 : 0.75);
            break;
          }
        }
      }
      if (uSnow > 0.01) {
        float sp = 4.0;
        float x = colId + sin(uTime * 0.7 + rowTop * 0.15) * 2.0;
        float y = rowTop - uTime * sp;
        float h = hash12(vec2(floor(x), floor(y)));
        if (h < uSnow * 0.05) { glyph = tbl(3 + int(h * 100.0) % 3, ROW_FX); fg = vec3(0.92, 0.95, 1.0) * (0.45 + 0.55 * (1.0 - uNight)); }
      }
    }
  }

  oFg = vec4(clamp(fg, 0.0, 1.0), float(glyph & 255u) / 255.0);
  oBg = vec4(clamp(bg, 0.0, 1.0), float(glyph >> 8u) / 255.0);
}`;

/** Présentation : chaque pixel lit sa cellule et le masque du glyphe dans l'atlas. */
export const PRESENT_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uCellFg;
uniform sampler2D uCellBg;
uniform sampler2D uAtlas;
uniform ivec2 uCellPx;
uniform ivec2 uOrigin;
uniform ivec2 uGrid;
uniform highp usampler2D uUiGlyph;
uniform sampler2D uUiFg;
uniform sampler2D uUiBg;
uniform sampler2D uUiAtlas;
uniform ivec2 uUiCellPx;
uniform ivec2 uUiOrigin;
uniform ivec2 uUiGrid;
uniform int uAtlasCols;
uniform float uVignette;
uniform float uHurt;
uniform float uWobble;
uniform float uTime;
uniform vec4 uTint;
uniform int uPalette;
out vec4 o;
// Deux grilles superposées : le monde (police fine) et l'interface (police de lecture).
// Une case d'interface avec un glyphe remplace les glyphes du monde qu'elle recouvre ; son fond
// (avec transparence) teinte le fond du monde.
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  ivec2 p = fc - uOrigin;
  ivec2 cell = p / uCellPx;
  vec3 fg = vec3(0.0), bg = vec3(0.0);
  float m = 0.0;
  // sous l'eau : les lignes de caractères ondulent
  if (uWobble > 0.0) { cell.x += int(round(sin(float(cell.y) * 0.45 + uTime * 2.6) * 1.6 * uWobble)); cell.x = clamp(cell.x, 0, uGrid.x - 1); }
  if (p.x >= 0 && p.y >= 0 && cell.x < uGrid.x && cell.y < uGrid.y) {
    ivec2 local = p - cell * uCellPx;
    vec4 f = texelFetch(uCellFg, cell, 0);
    vec4 b = texelFetch(uCellBg, cell, 0);
    int g = int(f.a * 255.0 + 0.5) + int(b.a * 255.0 + 0.5) * 256;
    ivec2 ga = ivec2(g % uAtlasCols, g / uAtlasCols);
    m = texelFetch(uAtlas, ga * uCellPx + ivec2(local.x, uCellPx.y - 1 - local.y), 0).r;
    fg = f.rgb; bg = b.rgb;
    // teinte (eau, magie) et liseré de douleur : sur le monde seulement, l'interface reste nette
    vec2 e = vec2(p) / vec2(uGrid * uCellPx) - 0.5;
    float edge = smoothstep(0.18, 0.62, length(e)) * uHurt;
    if (uTint.a > 0.0) {
      float lf = dot(fg, vec3(0.3, 0.5, 0.2)), lb = dot(bg, vec3(0.3, 0.5, 0.2));
      fg = mix(fg, uTint.rgb * (0.35 + lf * 1.5), uTint.a);
      bg = mix(bg, uTint.rgb * (0.25 + lb * 1.3), uTint.a);
    }
    fg = mix(fg, vec3(0.75, 0.06, 0.04), edge * 0.7);
    bg = mix(bg, vec3(0.35, 0.02, 0.01), edge * 0.8);
  }
  ivec2 q = fc - uUiOrigin;
  ivec2 uc = q / uUiCellPx;
  if (q.x >= 0 && q.y >= 0 && uc.x < uUiGrid.x && uc.y < uUiGrid.y) {
    ivec2 uiP = ivec2(uc.x, uUiGrid.y - 1 - uc.y);
    uint ug = texelFetch(uUiGlyph, uiP, 0).r;
    vec4 ubg = texelFetch(uUiBg, uiP, 0);
    bg = mix(bg, ubg.rgb, ubg.a);
    if (ug != 0u) {
      int g = int(ug);
      ivec2 local = q - uc * uUiCellPx;
      ivec2 ga = ivec2(g % uAtlasCols, g / uAtlasCols);
      m = texelFetch(uUiAtlas, ga * uUiCellPx + ivec2(local.x, uUiCellPx.y - 1 - local.y), 0).r;
      fg = texelFetch(uUiFg, uiP, 0).rgb;
    }
  }
  vec3 c = mix(bg, fg, m);
  vec2 uv = vec2(p) / vec2(uGrid * uCellPx) - 0.5;
  c *= 1.0 - uVignette * dot(uv, uv) * 1.4;
  // palettes monochromes façon vieux terminal
  if (uPalette > 0) {
    float l = pow(clamp(dot(c, vec3(0.3, 0.59, 0.11)) * 1.15, 0.0, 1.0), 0.8);
    c = uPalette == 1 ? vec3(1.0, 0.64, 0.16) * l + vec3(0.05, 0.02, 0.0) : vec3(0.28, 1.0, 0.38) * l + vec3(0.0, 0.03, 0.01);
  }
  o = vec4(c, 1.0);
}`;
