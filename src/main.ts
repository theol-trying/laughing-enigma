// ASCII FORT — application : écran titre → nouvelle partie → monde → jeu.
import { Renderer } from '@ascii-fort/ascii-engine/Renderer';
import { Input } from '@ascii-fort/ascii-engine/Input';
import { Game } from './game/Game';
import { C } from '@ascii-fort/ascii-engine/TextGrid';
import { CLEAR_WEATHER, computeAtmosphere } from '@ascii-fort/ascii-engine/Atmosphere';
import { Camera } from '@ascii-fort/ascii-engine/Camera';
import { InstanceBuffer } from '@ascii-fort/ascii-engine/Renderer';
import { UIManager } from './ui/UI';
import { DialogueScreen, TradeScreen } from './ui/DialogueScreen';
import { InventoryScreen, JournalScreen, MapScreen, StatsScreen, PauseScreen, type Options } from './ui/GameScreens';
import { TitleScreen, NewGameScreen, drawTitleBackground } from './ui/TitleScreen';
import { drawHud, type HudState } from './ui/HUD';
import type { MacroWorld } from '@ascii-fort/worldgen/MacroWorld';
import type { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import { SaveManager } from './game/SaveManager';
import { DevConsole } from './ui/DevConsole';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const r = new Renderer(canvas);
const input = new Input(canvas);
const screens = new UIManager(r, input);

// options (préférences locales du navigateur)
const DEFAULT_OPTS: Options = { cellSize: Math.max(10, Math.min(20, Math.round(window.innerHeight / 58))), detail: 0.75, sensitivity: 1, fov: 68, volume: 0.6, timeScale: 1 };
let opts: Options = { ...DEFAULT_OPTS };
try { opts = { ...DEFAULT_OPTS, ...JSON.parse(localStorage.getItem('ascii-fort-options') ?? '{}') }; } catch { /* stockage indisponible */ }
const saveOpts = () => { try { localStorage.setItem('ascii-fort-options', JSON.stringify(opts)); } catch { /* ignore */ } };
r.resize(opts.cellSize, opts.detail);
window.addEventListener('resize', () => r.resize(opts.cellSize, opts.detail));
document.getElementById('boot')?.remove();

let game: Game | null = null;
let loading: { seed: string; macro?: MacroWorld; civ?: Civilization; frames: number } | null = null;
const hud: HudState = { log: [], debug: false, fps: 60, genMs: 0, drawCalls: 0 };
const idleCam = new Camera();
const idleInst = new InstanceBuffer();

function applyOptions() {
  saveOpts();
  if (r.cssCellH !== opts.cellSize || r.detail !== opts.detail) r.resize(opts.cellSize, opts.detail);
  if (game) { game.audio.setVolume(opts.volume); game.sensitivity = opts.sensitivity; game.camera.fovY = (opts.fov * Math.PI) / 180; game.time.scale = opts.timeScale; }
}

function hasSave(): boolean { return !!SaveManager.latest(); }

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

// ---------------------------------------------------------------- sauvegardes
let autosaveT = 120;
async function saveTo(slot: string, label: string, quiet = false) {
  if (!game) return;
  try {
    await SaveManager.save(slot, game.toSave(label));
    if (!quiet) game.events.emit('message', { text: `Partie sauvegardée (${label}).`, color: C.green });
  } catch (e) { game.events.emit('message', { text: 'Échec de la sauvegarde : ' + String(e), color: C.red }); }
}
async function loadFrom(slot?: string) {
  const meta = SaveManager.latest();
  const key = slot ?? meta?.slot;
  if (!key) return;
  const d = await SaveManager.load(key);
  if (!d) { game?.events.emit('message', { text: 'Aucune sauvegarde.', color: C.red }); return; }
  screens.closeAll();
  const g = game && game.seed.text === d.seed ? game : startGame(d.seed);
  g.applySave(d);
  g.events.emit('message', { text: `Partie chargée (${d.label}, ${new Date(d.savedAt).toLocaleString('fr-FR')}).`, color: C.green });
  if (d.generator !== g.toSave().generator) g.events.emit('message', { text: `Attention : sauvegarde créée avec le générateur ${d.generator}.`, color: C.orange });
}
window.addEventListener('ascii-fort-save', () => { void saveTo('manuel', 'manuelle'); });
window.addEventListener('ascii-fort-load', () => { void loadFrom(); });

function pause() {
  if (!game || screens.modal) return;
  screens.open(new PauseScreen(game, opts, {
    save: () => window.dispatchEvent(new CustomEvent('ascii-fort-save')),
    load: () => window.dispatchEvent(new CustomEvent('ascii-fort-load')),
    quit: () => { void saveTo('auto', 'automatique', true).then(() => { game?.dispose(); game = null; showTitle(); }); },
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
    if (input.key('F1')) screens.open(new DevConsole(g, input, () => {}));
    if (input.key('F5')) void saveTo('rapide', 'rapide');
    if (input.key('F9')) void loadFrom('rapide');
    autosaveT -= dt;
    if (autosaveT <= 0) { autosaveT = 120; void saveTo('auto', 'automatique', true); }
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
