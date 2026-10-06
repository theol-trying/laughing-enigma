// Point d'entrée. (Étape 4 : exploration d'un monde généré ; les écrans titre/nouvelle partie
// arrivent à l'étape 8.)
import { Renderer } from './rendering/Renderer';
import { Input } from './core/Input';
import { Game } from './core/Game';
import { C } from './rendering/TextGrid';
import { clamp } from './core/math';
import { GENERATOR_VERSION } from './version';
import { CHUNK } from './world/constants';
import { BIOMES } from './world/terrain/Biomes';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const r = new Renderer(canvas);
const cellH = () => clamp(Math.round(window.innerHeight / 58), 10, 22);
r.resize(cellH());
window.addEventListener('resize', () => r.resize(cellH()));
document.getElementById('boot')?.remove();
const input = new Input(canvas);
canvas.addEventListener('click', () => input.requestLock());

const seedText = new URLSearchParams(location.search).get('seed') || 'TEST-001';
const t0 = performance.now();
const game = new Game(seedText, r);
const genMs = performance.now() - t0;
let showDebug = true, viewMode = 0;
const log: { text: string; t: number; color: number }[] = [];
game.events.on('message', (e) => { log.push({ text: e.text, t: performance.now(), color: e.color ?? C.text }); if (log.length > 6) log.shift(); });
let last = performance.now(), fps = 60;

function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  if (input.key('F3')) showDebug = !showDebug;
  if (input.key('n')) game.player.noclip = !game.player.noclip;
  if (input.key('t')) game.time.minutes += 60;
  for (let k = 1; k <= 5; k++) if (input.pressed('Digit' + k)) viewMode = k - 1;
  game.update(dt, input);

  const ui = r.ui; ui.clear();
  const p = game.player;
  if (showDebug) {
    const m = game.world.macro;
    const biome = BIOMES[game.world.sampler.biomeAt(p.x, p.z)].name;
    const region = m.regions[m.region[m.cellOf(p.x, p.z)]]?.name ?? '—';
    const lines = [
      `World: ${game.seed.text} · Generator: ${GENERATOR_VERSION} · ${m.worldName}`,
      `${fps.toFixed(0)} fps · ${r.cols}×${r.rows} car. · draw ${r.drawCalls} · monde généré en ${genMs.toFixed(0)} ms`,
      `pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} · chunk ${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)} · ${game.world.chunks.chunks.size} chunks · dernier ${game.world.chunks.lastLoadMs.toFixed(1)} ms`,
      `${biome} · ${region} · ${game.time.label()} (${game.time.phase})${p.swimming ? ' · nage' : ''}${p.noclip ? ' · NOCLIP' : ''}`,
      `clic: souris · ZQSD/WASD · Maj sprint · Espace saut · C accroupi · N noclip · T +1h · 1-5 vues · F3`,
    ];
    lines.forEach((l, i) => ui.text(1, i, ` ${l} `, i === 0 ? C.title : i === 4 ? C.dim : C.text, C.panel, 0.75));
  }
  ui.text(Math.floor(r.cols / 2), Math.floor(r.rows / 2), '+', C.white);
  // barres de vie et d'endurance (HUD complet à l'étape 8)
  const by = r.rows - 3;
  ui.text(r.cols - 26, by, 'HP  ', C.text); ui.bar(r.cols - 22, by, 12, p.hp / p.maxHp, C.hp); ui.text(r.cols - 9, by, `${Math.ceil(p.hp)}/${p.maxHp}`, C.text);
  ui.text(r.cols - 26, by + 1, 'STA ', C.text); ui.bar(r.cols - 22, by + 1, 12, p.stamina / p.maxStamina, C.sta);
  if (game.target && game.target.alive && Math.hypot(game.target.x - p.x, game.target.z - p.z) < 30) { ui.center(1, ` ${game.target.label} `, C.red, C.panel); ui.bar(Math.floor(r.cols / 2) - 8, 2, 16, game.target.hp / game.target.maxHp, C.hp); }
  if (p.dead) ui.center(Math.floor(r.rows / 2) - 3, ' Vous êtes mort ', C.red, C.black);
  if (game.focusEntity) ui.center(Math.floor(r.rows / 2) + 2, ` [E] Parler à ${game.focusEntity.label} `, C.yellow, C.panel);
  else if (game.focus) ui.center(Math.floor(r.rows / 2) + 2, ` [E] ${game.propLabel(game.focus)} `, C.yellow, C.panel);
  const tNow = performance.now();
  log.filter((l) => tNow - l.t < 6000).forEach((l, i, arr) => ui.text(1, r.rows - 1 - arr.length + i, ` ${l.text} `, l.color, C.panel, 0.7));
  game.render(viewMode);
  input.endFrame();
}
function frame(now: number) { tick(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
(window as any).__dbg = {
  game, r, input,
  step: (n = 1) => { for (let i = 0; i < n; i++) { last -= 16; tick(performance.now()); } },
  tp: (x: number, z: number) => { game.player.x = x; game.player.z = z; game.world.chunks.update(x, z, -1); game.player.y = game.world.heightAt(x, z) + 0.2; },
};
