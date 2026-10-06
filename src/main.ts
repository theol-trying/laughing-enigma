// ASCII FORT — application : écran titre → nouvelle partie → monde → jeu.
import { Renderer } from './rendering/Renderer';
import { Input } from './core/Input';
import { Game } from './core/Game';
import { C } from './rendering/TextGrid';
import { CLEAR_WEATHER, computeAtmosphere } from './rendering/Atmosphere';
import { Camera } from './rendering/Camera';
import { InstanceBuffer } from './rendering/Renderer';
import { UIManager } from './ui/UI';
import { DialogueScreen, TradeScreen } from './ui/DialogueScreen';
import { InventoryScreen, JournalScreen, MapScreen, StatsScreen, PauseScreen, type Options } from './ui/GameScreens';
import { TitleScreen, NewGameScreen, drawTitleBackground } from './ui/TitleScreen';
import { drawHud, type HudState } from './ui/HUD';
import type { MacroWorld } from './world/MacroWorld';
import type { Civilization } from './world/civilization/Civilization';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const r = new Renderer(canvas);
const input = new Input(canvas);
const screens = new UIManager(r, input);

// options (préférences locales du navigateur)
const DEFAULT_OPTS: Options = { cellSize: Math.max(10, Math.min(20, Math.round(window.innerHeight / 58))), sensitivity: 1, fov: 68, volume: 0.6, timeScale: 1 };
let opts: Options = { ...DEFAULT_OPTS };
try { opts = { ...DEFAULT_OPTS, ...JSON.parse(localStorage.getItem('ascii-fort-options') ?? '{}') }; } catch { /* stockage indisponible */ }
const saveOpts = () => { try { localStorage.setItem('ascii-fort-options', JSON.stringify(opts)); } catch { /* ignore */ } };
r.resize(opts.cellSize);
window.addEventListener('resize', () => r.resize(opts.cellSize));
document.getElementById('boot')?.remove();

let game: Game | null = null;
let loading: { seed: string; macro?: MacroWorld; civ?: Civilization; frames: number } | null = null;
const hud: HudState = { log: [], debug: false, fps: 60, genMs: 0, drawCalls: 0 };
const idleCam = new Camera();
const idleInst = new InstanceBuffer();

function applyOptions() {
  saveOpts();
  if (r.cssCellH !== opts.cellSize) r.resize(opts.cellSize);
  if (game) { game.audio.setVolume(opts.volume); game.sensitivity = opts.sensitivity; game.camera.fovY = (opts.fov * Math.PI) / 180; game.time.scale = opts.timeScale; }
}

function hasSave(): boolean { try { return !!localStorage.getItem('ascii-fort-save-meta'); } catch { return false; } }

function showTitle() {
  screens.closeAll();
  screens.open(new TitleScreen(hasSave(), {
    newGame: () => screens.open(new NewGameScreen(input, {
      create: (seed, macro, civ) => { screens.closeAll(); loading = { seed, macro, civ, frames: 0 }; },
      back: () => screens.close(),
    })),
    continueGame: () => window.dispatchEvent(new CustomEvent('ascii-fort-load')),
    options: () => screens.open(new PauseScreen({ seed: { text: '—' } } as unknown as Game, opts, { save() {}, load() {}, quit() { screens.close(); }, applyOptions })),
  }));
}

function startGame(seed: string, macro?: MacroWorld, civ?: Civilization): Game {
  const t0 = performance.now();
  game?.dispose();
  const g = new Game(seed, r, macro, civ);
  game = g;
  hud.genMs = performance.now() - t0;
  hud.log = [];
  g.events.on('message', (e) => { hud.log.push({ text: e.text, t: performance.now(), color: e.color ?? C.text }); if (hud.log.length > 30) hud.log.shift(); });
  g.ui = {
    openDialogue: (node, onClose) => screens.open(new DialogueScreen(node, onClose)),
    openTrade: (e) => { screens.closeAll(); screens.open(new TradeScreen(e, g)); },
  };
  applyOptions();
  g.events.emit('message', { text: `Bienvenue dans les ${g.world.macro.worldName}. Vous arrivez à ${g.world.civ.start.name}.`, color: C.title });
  g.events.emit('message', { text: 'Clic : capturer la souris · ZQSD : marcher · E : interagir · Tab : sac · M : carte · J : journal', color: C.dim });
  return g;
}

function pause() {
  if (!game || screens.modal) return;
  screens.open(new PauseScreen(game, opts, {
    save: () => window.dispatchEvent(new CustomEvent('ascii-fort-save')),
    load: () => window.dispatchEvent(new CustomEvent('ascii-fort-load')),
    quit: () => { game?.dispose(); game = null; showTitle(); },
    applyOptions,
  }));
}

canvas.addEventListener('click', () => { if (game) game.audio.start(); if (game && !screens.modal) input.requestLock(); });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && game && !screens.modal) pause(); });

const idle = (now: number) => r.render({ camera: idleCam, atmo: computeAtmosphere(12, CLEAR_WEATHER), time: now / 1000, items: [], clipRadius: 0, instances: idleInst, lights: [], viewMode: 0, sceneOn: false });

let last = performance.now();
function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  hud.fps = hud.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  const ui = r.ui;
  ui.clear();

  // création du monde : on affiche d'abord un écran de chargement
  if (loading) {
    drawTitleBackground(ui, now / 1000);
    ui.center(Math.floor(r.rows / 2) - 1, ' Génération du monde… ', C.title, C.panel);
    ui.center(Math.floor(r.rows / 2) + 1, ` ${loading.seed} `, C.dim, C.panel);
    idle(now);
    if (++loading.frames > 2) { const l = loading; loading = null; startGame(l.seed, l.macro, l.civ); }
    input.endFrame();
    return;
  }

  if (!game) {
    if (!screens.top) showTitle();
    screens.update();
    screens.draw();
    idle(now);
    input.endFrame();
    return;
  }

  const g = game;
  if (screens.modal) screens.update();
  else {
    if (input.key('Tab')) screens.open(new InventoryScreen(g));
    else if (input.key('m')) screens.open(new MapScreen(g));
    else if (input.key('j')) screens.open(new JournalScreen(g));
    else if (input.key('c') && !input.isDown('KeyC')) screens.open(new StatsScreen(g));
    else if (input.key('Escape')) pause();
    if (input.key('F3')) hud.debug = !hud.debug;
    if (!screens.modal) g.update(dt, input);
  }
  hud.drawCalls = r.drawCalls;
  if (!screens.modal || screens.top instanceof DialogueScreen) drawHud(ui, g, hud);
  screens.draw();
  if (game) g.render(0); else idle(now);
  input.endFrame();
}
function frame(now: number) { tick(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);

(window as any).__dbg = {
  r, input, screens,
  get game() { return game; },
  newGame: (seed = 'TEST-001') => { screens.closeAll(); return startGame(seed); },
  step: (n = 1) => { for (let i = 0; i < n; i++) { last -= 16; tick(performance.now()); } },
  tp: (x: number, z: number) => { if (!game) return; game.player.x = x; game.player.z = z; game.world.chunks.update(x, z, -1); game.player.y = game.world.heightAt(x, z) + 0.2; },
};
