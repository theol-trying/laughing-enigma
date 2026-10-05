// Scène de test du renderer (étape 2) — remplacée par le jeu complet à l'étape 8.
import { Renderer, InstanceBuffer, type DrawItem } from './rendering/Renderer';
import { MeshBuilder } from './rendering/Mesh';
import { Camera } from './rendering/Camera';
import { Input } from './core/Input';
import { computeAtmosphere, CLEAR_WEATHER, type WeatherMix } from './rendering/Atmosphere';
import { M } from './rendering/Materials';
import { Noise2D } from './core/Noise';
import { RNG } from './core/RNG';
import { trsYawPitch, mat4, clamp } from './core/math';
import { C } from './rendering/TextGrid';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const r = new Renderer(canvas);
const cellH = () => clamp(Math.round(window.innerHeight / 58), 10, 22);
r.resize(cellH());
window.addEventListener('resize', () => r.resize(cellH()));
document.getElementById('boot')?.remove();
const input = new Input(canvas);
canvas.addEventListener('click', () => input.requestLock());

const noise = new Noise2D(new RNG('test'));
const H = (x: number, z: number) => noise.fbm(x * 0.006, z * 0.006, 5) * 22 + noise.ridged(x * 0.003, z * 0.003) * 70 - 10;
const mb = new MeshBuilder(1 << 16);
const N = 220, S = 2, O = -N;
for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
  const x = O + i * S, z = O + j * S, h = H(x, z);
  const nx = H(x - 1, z) - H(x + 1, z), nz = H(x, z - 1) - H(x, z + 1), l = Math.hypot(nx, 2, nz);
  const slope = 1 - 2 / l;
  let mat: number = M.GRASS, col = 0x4f8a3a;
  if (h > 48) { mat = M.SNOW; col = 0xe8eef4; } else if (slope > 0.35 || h > 34) { mat = M.ROCK; col = 0x7d7a72; } else if (h < 1.5) { mat = M.SAND; col = 0xc8b47a; }
  mb.vertex(x, h, z, nx / l, 2 / l, nz / l, col, mat);
}
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i; mb.quad(a, a + N + 1, a + N + 2, a + 1); }
// eau
const wb = mb.vertex(O, 0, O, 0, 1, 0, 0x2a5a8a, M.WATER), wc = mb.vertex(-O, 0, O, 0, 1, 0, 0x2a5a8a, M.WATER);
const wd = mb.vertex(-O, 0, -O, 0, 1, 0, 0x2a5a8a, M.WATER), we = mb.vertex(O, 0, -O, 0, 1, 0, 0x2a5a8a, M.WATER);
mb.quad(wb, we, wd, wc);
// village
const rng = new RNG('village');
const lights: { x: number; y: number; z: number; radius: number; r: number; g: number; b: number }[] = [];
for (let k = 0; k < 14; k++) {
  const x = rng.float(-60, 60), z = rng.float(-80, -10), y = H(x, z), yaw = rng.float(0, Math.PI);
  const w = rng.float(5, 9), d = rng.float(4, 6), wallH = rng.float(2.6, 3.4);
  mb.box(x, y - 1, z, w, wallH + 1, d, yaw, 0x8a6a48, M.WOOD);
  mb.gable(x, y + wallH, z, w + 0.8, d + 0.8, rng.float(1.8, 2.6), yaw, rng.chance(0.5) ? 0x8a3a2a : 0xb09a5a, rng.chance(0.5) ? M.ROOF : M.THATCH, 0x8a6a48, M.WOOD);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  mb.box(x + (d / 2 + 0.01) * s, y + 1.1, z + (d / 2 + 0.01) * c, 0.8, 0.8, 0.06, yaw, 0xffc060, M.WINDOW);
  if (k % 3 === 0) {
    const tx = x + (d / 2 + 0.6) * s, tz = z + (d / 2 + 0.6) * c;
    mb.box(tx, y, tz, 0.15, 1.8, 0.15, 0, 0x5a4030, M.WOOD);
    mb.box(tx, y + 1.8, tz, 0.3, 0.4, 0.3, 0, 0xffa030, M.FIRE);
    lights.push({ x: tx, y: y + 2.1, z: tz, radius: 14, r: 1.6, g: 0.9, b: 0.45 });
  }
}
for (let k = 0; k < 160; k++) {
  const x = rng.float(-200, 200), z = rng.float(-200, 200), y = H(x, z);
  if (y < 2 || y > 34 || (z < 0 && z > -90 && Math.abs(x) < 70)) continue;
  const h = rng.float(5, 9);
  mb.cylinder(x, y - 0.3, z, 0.3, h * 0.5, 5, 0x5a4028, M.TRUNK);
  if (rng.chance(0.5)) mb.cone(x, y + h * 0.3, z, rng.float(2, 3), h, 7, 0x2a5a30, M.PINE);
  else mb.blob(x, y + h * 0.6, z, rng.float(2, 3.2), rng.float(2, 3), rng.float(2, 3.2), 0x3a7a34, M.FOLIAGE);
}
const world = r.createMesh(mb.finish());
const items: DrawItem[] = [{ mesh: world, shadow: true }];

const cam = new Camera();
cam.x = 0; cam.z = 30; cam.heading = 0;
let hour = 9.5, weatherIdx = 0, viewMode = 0;
const WEATHERS: [string, WeatherMix][] = [
  ['clair', CLEAR_WEATHER],
  ['couvert', { ...CLEAR_WEATHER, cloud: 0.85 }],
  ['pluie', { ...CLEAR_WEATHER, cloud: 0.95, rain: 0.8, windX: 0.8 }],
  ['brouillard', { ...CLEAR_WEATHER, cloud: 0.6, fog: 0.6 }],
  ['neige', { ...CLEAR_WEATHER, cloud: 0.9, snow: 0.8 }],
];
const inst = new InstanceBuffer();
const m = mat4();
let last = performance.now(), fps = 60, t = 0;

function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  if (input.locked) { cam.heading += input.mouseDX * 0.0022; cam.pitch = clamp(cam.pitch - input.mouseDY * 0.0022, -1.45, 1.45); }
  const sp = (input.isDown('ShiftLeft') ? 18 : 5) * dt;
  const fx = Math.sin(cam.heading), fz = -Math.cos(cam.heading);
  let mx = 0, mz = 0;
  if (input.isDown('KeyW')) { mx += fx; mz += fz; } if (input.isDown('KeyS')) { mx -= fx; mz -= fz; }
  if (input.isDown('KeyD')) { mx -= fz; mz += fx; } if (input.isDown('KeyA')) { mx += fz; mz -= fx; }
  cam.x += mx * sp; cam.z += mz * sp; cam.y = Math.max(0.5, H(cam.x, cam.z)) + 1.7;
  if (input.key('t')) hour = (hour + 1) % 24;
  if (input.key('y')) weatherIdx = (weatherIdx + 1) % WEATHERS.length;
  for (let k = 1; k <= 5; k++) if (input.pressed('Digit' + k)) viewMode = k - 1;
  hour = (hour + dt / 60) % 24;

  inst.reset();
  const px = 4, pz = 10, py = H(px, pz), sw = Math.sin(t * 6) * 0.5;
  inst.add(trsYawPitch(m, px, py + 1.25, pz, 0, 0, 0.5, 0.7, 0.3), 0x8a2a2a, M.CLOTH, 66);
  inst.add(trsYawPitch(m, px, py + 1.75, pz, 0, 0, 0.3, 0.3, 0.3), 0xd8a888, M.SKIN, 66);
  inst.add(trsYawPitch(m, px - 0.13, py + 0.45, pz, 0, sw, 0.18, 0.9, 0.18), 0x3a3a4a, M.CLOTH, 66);
  inst.add(trsYawPitch(m, px + 0.13, py + 0.45, pz, 0, -sw, 0.18, 0.9, 0.18), 0x3a3a4a, M.CLOTH, 66);

  const [wname, w] = WEATHERS[weatherIdx];
  const atmo = computeAtmosphere(hour, w, 0, 0);
  const ui = r.ui; ui.clear();
  ui.text(1, 0, ` ASCII FORT — test du renderer `, C.title, C.panel);
  ui.text(1, 1, ` ${fps.toFixed(0)} fps · ${r.cols}×${r.rows} · heure ${hour.toFixed(1)} · ${wname} · vue ${viewMode} · draw ${r.drawCalls} `, C.text, C.panel, 0.8);
  ui.text(1, 2, ` clic: souris · ZQSD · Maj · T heure · Y météo · 1-5 vues `, C.dim, C.panel, 0.8);
  ui.text(1, r.rows - 2, 'HP  ', C.text); ui.bar(5, r.rows - 2, 12, 0.74, C.hp); ui.text(18, r.rows - 2, '74/100', C.text);
  ui.text(1, r.rows - 1, 'STA ', C.text); ui.bar(5, r.rows - 1, 12, 0.5, C.sta);
  ui.text(Math.floor(r.cols / 2), Math.floor(r.rows / 2), '+', C.white);
  r.render({ camera: cam, atmo, time: t, items, clipRadius: 0, instances: inst, lights, viewMode, sceneOn: true });
  input.endFrame();
}
function frame(now: number) { tick(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
(window as any).__dbg = { cam, r, step: (n = 1) => { for (let i = 0; i < n; i++) { last -= 16; tick(performance.now()); } }, setHour: (h: number) => (hour = h), setWeather: (i: number) => (weatherIdx = i), setView: (v: number) => (viewMode = v) };
