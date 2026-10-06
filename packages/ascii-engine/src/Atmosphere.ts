import { clamp, lerp, smoothstep } from '@ascii-fort/core/math';

// Palette dynamique : ciel, soleil/lune, ambiance et brouillard selon l'heure et la météo.

export type RGB = [number, number, number];

export interface WeatherMix {
  cloud: number;  // couverture nuageuse 0..1
  rain: number;   // 0..1
  snow: number;   // 0..1
  fog: number;    // 0..1
  storm: number;  // 0..1
  windX: number; windZ: number;
}

export const CLEAR_WEATHER: WeatherMix = { cloud: 0.25, rain: 0, snow: 0, fog: 0, storm: 0, windX: 0.3, windZ: 0.1 };

export interface AtmosphereState {
  sunDir: RGB; moonDir: RGB; lightDir: RGB;
  sunColor: RGB;      // lumière directionnelle effective (soleil ou lune)
  ambSky: RGB; ambGround: RGB;
  skyTop: RGB; skyHorizon: RGB;
  fogColor: RGB; fogDensity: number;
  night: number;      // 0 jour … 1 nuit noire
  cloud: number; rain: number; snow: number; flash: number;
  windX: number; windZ: number;
  indoor: number;
  shadows: boolean;
  /** 0..1 : surfaces mouillées (après la pluie, elles sèchent lentement) */
  wet?: number;
}

const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

// heure, haut du ciel, horizon, lumière
const KEYS: [number, number, number, number][] = [
  [0, 0x02040b, 0x0a1020, 0x18223a],
  [4.5, 0x050a18, 0x1a1a32, 0x1c2440],
  [5.6, 0x1c2a52, 0x8a4a4a, 0x8a5040],
  [6.4, 0x3a5a90, 0xf09060, 0xffa060],
  [7.6, 0x4a7ac0, 0xc8daf0, 0xffe6c0],
  [12, 0x3a6ec8, 0xb8d6f4, 0xfff6e4],
  [16.5, 0x4672b8, 0xe8d8b8, 0xffe0b0],
  [18.6, 0x3a3c78, 0xff8048, 0xff7a38],
  [19.8, 0x1a1c44, 0x7a3a50, 0x6a3440],
  [21, 0x070a1a, 0x161a30, 0x1c2238],
  [24, 0x02040b, 0x0a1020, 0x18223a],
];

function sampleKeys(hour: number): { top: RGB; hor: RGB; light: RGB } {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= hour) i++;
  const [h0, t0, z0, l0] = KEYS[i], [h1, t1, z1, l1] = KEYS[i + 1];
  const t = clamp((hour - h0) / (h1 - h0), 0, 1);
  const mix = (a: number, b: number): RGB => { const A = hex(a), B = hex(b); return [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)]; };
  return { top: mix(t0, t1), hor: mix(z0, z1), light: mix(l0, l1) };
}

const norm = (v: RGB): RGB => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const scale = (v: RGB, k: number): RGB => [v[0] * k, v[1] * k, v[2] * k];
const mixc = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const grey = (v: RGB): RGB => { const g = v[0] * 0.3 + v[1] * 0.5 + v[2] * 0.2; return [g, g, g]; };

export function computeAtmosphere(hour: number, w: WeatherMix, indoor = 0, flash = 0): AtmosphereState {
  const a = ((hour - 6) / 12) * Math.PI;
  const sunDir = norm([Math.cos(a), Math.sin(a) * 0.9, 0.35]);
  const moonDir = norm([-Math.cos(a) * 0.8, -Math.sin(a) * 0.8 + 0.15, -0.3]);
  const sunUp = smoothstep(-0.08, 0.2, sunDir[1]);
  const night = 1 - smoothstep(-0.12, 0.12, sunDir[1]);
  const { top, hor, light } = sampleKeys(((hour % 24) + 24) % 24);

  const overcast = clamp(w.cloud * 0.8 + w.rain * 0.4 + w.storm * 0.5, 0, 1);
  let skyTop = mixc(top, scale(grey(top), 0.85), overcast * 0.85);
  let skyHorizon = mixc(hor, scale(grey(hor), 0.95), overcast * 0.8);
  const darken = 1 - w.storm * 0.55 - w.rain * 0.2;
  skyTop = scale(skyTop, darken); skyHorizon = scale(skyHorizon, darken);

  const moonLight = scale(hex(0x6a80b0), 0.22 * night * (1 - overcast * 0.7));
  const sunI = sunUp * (1 - overcast * 0.75);
  const lightDir = sunDir[1] > -0.05 ? sunDir : moonDir;
  const sunColor = sunDir[1] > -0.05 ? scale(light, sunI * 1.05) : moonLight;

  const ambBase = mixc(skyTop, skyHorizon, 0.5);
  const ambK = 0.68 + overcast * 0.2;
  const ambSky = mixc(scale(ambBase, ambK), [0.05, 0.06, 0.1], night * 0.6);
  const ambGround = scale(ambSky, 0.62);

  const fogBase = 0.0011 + w.fog * 0.016 + w.rain * 0.0022 + w.snow * 0.004 + w.storm * 0.002 + night * 0.0004;
  const fogColor = mixc(skyHorizon, grey(skyHorizon), 0.3 + w.fog * 0.4);

  return {
    sunDir, moonDir, lightDir, sunColor,
    ambSky: indoor ? scale(ambSky, 0.35) : ambSky,
    ambGround: indoor ? scale(ambGround, 0.35) : ambGround,
    skyTop, skyHorizon,
    fogColor: indoor ? [0.02, 0.018, 0.015] : fogColor,
    fogDensity: indoor ? 0.03 : fogBase,
    night, cloud: w.cloud, rain: w.rain, snow: w.snow, flash,
    windX: w.windX, windZ: w.windZ, indoor,
    shadows: !indoor && sunDir[1] > 0.04 && sunI > 0.08,
  };
}
