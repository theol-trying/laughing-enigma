import { C, type TextGrid } from '../rendering/TextGrid';
import type { Screen, UICtx } from './UI';
import { optionList } from './UI';
import { WorldSeed, normalizeSeed, randomSeedString } from '../core/Seed';
import { MacroWorld } from '../world/MacroWorld';
import { Civilization } from '../world/civilization/Civilization';
import { BIOMES, B } from '../world/terrain/Biomes';
import { W_LAKE, W_RIVER, W_SEA } from '../world/terrain/Hydrology';
import { MACRO } from '../world/constants';
import { GENERATOR_VERSION, GAME_VERSION } from '../version';

const FONT: Record<string, string[]> = {
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'], S: [' ████', '█    ', ' ███ ', '    █', '████ '],
  C: [' ████', '█    ', '█    ', '█    ', ' ████'], I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
  F: ['█████', '█    ', '████ ', '█    ', '█    '], O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'], T: ['█████', '  █  ', '  █  ', '  █  ', '  █  '], ' ': ['  ', '  ', '  ', '  ', '  '],
};

export function bigText(s: string): string[] { return [0, 1, 2, 3, 4].map((r) => [...s].map((ch) => (FONT[ch] ?? FONT[' '])[r]).join(' ')); }

/** Fond animé : ciel étoilé, lune, chaînes de montagnes en parallaxe, château au loin. */
export function drawTitleBackground(g: TextGrid, t: number): void {
  const W = g.cols, H = g.rows;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y / H;
    const bg = ((10 + k * 30) << 16) | ((14 + k * 26) << 8) | (32 + k * 30);
    const hsh = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    const star = hsh < 0.012 && y < H * 0.55 ? (Math.sin(t * 2 + hsh * 900) > 0.2 ? '*' : '.') : ' ';
    g.set(x, y, 0, 0, bg, 1);
    if (star !== ' ') g.text(x, y, star, 0x9aa8c8, bg);
  }
  // lune
  const mx = Math.floor(W * 0.78), my = Math.floor(H * 0.16);
  for (const [dx, dy, ch] of [[0, 0, '█'], [1, 0, '█'], [-1, 0, '▐'], [2, 0, '▌'], [0, -1, '▄'], [1, -1, '▄'], [0, 1, '▀'], [1, 1, '▀']] as [number, number, string][]) g.text(mx + dx, my + dy, ch, 0xe8e8d8);
  const layers: [number, number, number, string, number][] = [[0.45, 0.022, 9, '▓', 0x2a3048], [0.58, 0.035, 7, '▒', 0x1e2a30], [0.72, 0.05, 5, '█', 0x141c18]];
  layers.forEach(([base, freq, amp, ch, col], li) => {
    for (let x = 0; x < W; x++) {
      const xx = x + t * (2 + li * 3);
      const top = Math.floor(H * base - (Math.sin(xx * freq) + Math.sin(xx * freq * 2.3 + li) * 0.5 + Math.sin(xx * freq * 5.1) * 0.2) * amp);
      for (let y = Math.max(0, top); y < H; y++) g.text(x, y, y === top ? (li === 0 ? '▲' : '▄') : ch, col);
      if (li === 1 && Math.floor(xx) % 97 === 40) for (let k = 0; k < 4; k++) { g.text(x, top - 1 - k, '█', 0x2a3640); g.text(x + 1, top - 1 - k, k === 3 ? '▄' : '█', 0x2a3640); }
    }
  });
}

export class TitleScreen implements Screen {
  modal = true;
  constructor(private hasSave: boolean, private actions: { newGame(): void; continueGame(): void; options(): void }) {}
  draw(ctx: UICtx): void {
    const g = ctx.grid;
    drawTitleBackground(g, performance.now() / 1000);
    const big = g.cols >= 64 ? bigText('ASCII FORT') : ['ASCII FORT'];
    const y0 = Math.max(1, Math.floor(g.rows * 0.18) - 3);
    big.forEach((l, i) => g.center(y0 + i, l, i < 2 ? 0xf0d080 : 0xd8a850));
    g.center(y0 + big.length + 1, 'un RPG procédural fait de caractères', C.dim);
    const labels = ['[N] Nouvelle partie', this.hasSave ? '[C] Continuer' : '[C] Continuer (aucune sauvegarde)', '[O] Options'];
    const w = 34, x = Math.floor((g.cols - w) / 2), y = Math.floor(g.rows * 0.62);
    g.box(x - 2, y - 1, w + 4, labels.length + 2, { bg: 0x0b0d10, alpha: 0.85 });
    const k = optionList(ctx, x, y, w, labels.map((l) => l.replace(/^\[.\] /, '')), C.text, C.sel);
    if (k === 0) this.actions.newGame();
    if (k === 1 && this.hasSave) this.actions.continueGame();
    if (k === 2) this.actions.options();
    g.text(1, g.rows - 1, `v${GAME_VERSION} · générateur ${GENERATOR_VERSION}`, C.faint);
  }
  input(ctx: UICtx): void {
    const i = ctx.input;
    if (i.key('n')) this.actions.newGame();
    if (i.key('c') && this.hasSave) this.actions.continueGame();
    if (i.key('o')) this.actions.options();
  }
}

interface Preview { seed: string; name: string; climate: string; region: string; start: string; macro: MacroWorld; civ: Civilization }

export class NewGameScreen implements Screen {
  modal = true;
  private seed = randomSeedString();
  private preview: Preview | null = null;
  private editT = 0;
  private dirty = true;
  constructor(private ctxInput: { textSink: ((e: KeyboardEvent) => boolean) | null }, private actions: { create(seed: string, macro?: MacroWorld, civ?: Civilization): void; back(): void }) {
    ctxInput.textSink = (e) => {
      if (e.key === 'Backspace') { this.seed = this.seed.slice(0, -1); this.touch(); return true; }
      if (e.key === 'Enter') { this.create(); return true; }
      if (e.key === 'Tab') { this.seed = randomSeedString(); this.touch(); return true; }
      if (e.key === 'Escape') { this.leave(); return true; }
      if (e.key.length === 1 && /[\p{L}\p{N} _-]/u.test(e.key) && this.seed.length < 40) { this.seed += e.key.toUpperCase(); this.touch(); return true; }
      return false;
    };
  }
  private touch() { this.dirty = true; this.editT = performance.now(); }
  private leave() { this.ctxInput.textSink = null; this.actions.back(); }
  private create() {
    const s = normalizeSeed(this.seed) || randomSeedString();
    this.ctxInput.textSink = null;
    const pv = this.preview && this.preview.seed === s ? this.preview : null;
    this.actions.create(s, pv?.macro, pv?.civ);
  }
  private build() {
    const s = normalizeSeed(this.seed);
    if (!s) return;
    const macro = MacroWorld.generate(new WorldSeed(s));
    const civ = Civilization.generate(macro);
    const st = civ.start;
    this.preview = { seed: s, name: macro.worldName, climate: macro.dominantClimate(), region: macro.regions[st.regionId]?.name ?? '—', start: `${st.name} (${st.type})`, macro, civ };
    this.dirty = false;
  }

  draw(ctx: UICtx): void {
    const g = ctx.grid;
    drawTitleBackground(g, performance.now() / 1000);
    if (this.dirty && performance.now() - this.editT > 650) this.build();
    const w = Math.min(g.cols - 4, 96), h = Math.min(g.rows - 2, 30), x = Math.floor((g.cols - w) / 2), y = Math.floor((g.rows - h) / 2);
    g.box(x, y, w, h, { title: 'Nouvelle partie', double: true, alpha: 0.95 });
    g.text(x + 3, y + 2, 'Seed :', C.title);
    const caret = Math.floor(performance.now() / 500) % 2 ? '▌' : ' ';
    g.text(x + 11, y + 2, `[${(this.seed + caret).padEnd(41, '_')}]`, C.white);
    const btns: [string, () => void][] = [['RANDOMIZE (Tab)', () => { this.seed = randomSeedString(); this.touch(); }], ['CREATE WORLD (Entrée)', () => this.create()], ['Retour (Échap)', () => this.leave()]];
    let bx = x + 3;
    for (const [label, fn] of btns) {
      const over = ctx.mouseCell.y === y + 4 && ctx.mouseCell.x >= bx && ctx.mouseCell.x < bx + label.length + 4;
      g.text(bx, y + 4, `[ ${label} ]`, over ? 0xffffff : C.yellow, over ? C.sel : -1);
      if (over && ctx.clicked) fn();
      bx += label.length + 6;
    }
    const pv = this.preview;
    if (pv) {
      const info = [`World name      ${pv.name}`, `Dominant climate ${pv.climate}`, `Starting region ${pv.region}`, `Départ          ${pv.start}`, `Seed            ${pv.seed}`, `Generator       ${GENERATOR_VERSION}`];
      info.forEach((l, i) => g.text(x + 3, y + 7 + i, l.slice(0, Math.floor(w / 2) - 2), i === 0 ? C.title : C.text));
      // mini-carte
      const mx = x + Math.floor(w / 2) + 1, my = y + 6, mw = Math.floor(w / 2) - 3, mh = h - 9;
      const m = pv.macro, sx = MACRO / mw, sz = MACRO / mh;
      for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
        const c = Math.floor(j * sz) * MACRO + Math.floor(i * sx);
        const wtr = m.hydro.water[c], b = m.biome[c];
        const [ch, col] = wtr === W_SEA ? ['≈', 0x2a5a8a] : wtr === W_LAKE ? ['~', 0x4a8ac0] : wtr === W_RIVER ? ['~', 0x5aa0d8]
          : b === B.MOUNTAIN || b === B.SNOW ? ['▲', b === B.SNOW ? 0xe8eef4 : 0x8a867c] : b === B.FOREST ? ['♣', 0x3a7a2e] : b === B.TAIGA ? ['♠', 0x2e6a3e] : b === B.SWAMP ? ['%', 0x6a7a3a] : ['"', 0x6a9a3e];
        g.text(mx + i, my + j, ch, col, 0x05070a);
      }
      for (const s of pv.civ.settlements) if (!s.abandoned && (s.type === 'capitale' || s.type === 'ville' || s.id === pv.civ.startId)) {
        g.text(mx + Math.floor(s.x / 32 / sx), my + Math.floor(s.z / 32 / sz), s.id === pv.civ.startId ? '@' : '■', s.id === pv.civ.startId ? C.white : C.gold, 0x05070a);
      }
      void BIOMES;
    } else g.text(x + 3, y + 8, 'Génération de l\'aperçu…', C.dim);
    g.text(x + 3, y + h - 2, 'Tapez une seed ou gardez celle-ci. La même seed donnera toujours le même monde.', C.dim);
  }
  input(): void { /* saisie gérée par textSink */ }
}
