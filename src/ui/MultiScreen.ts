import { C } from '@ascii-fort/ascii-engine/TextGrid';
import { cleanCode } from '@ascii-fort/net/protocol';
import { randomSeedString } from '@ascii-fort/core/Seed';
import type { Screen, UICtx } from './UI';
import { drawTitleBackground } from './TitleScreen';

// Écrans du mode en ligne : choix du nom, création d'un salon (nouvelle seed) ou arrivée dans
// un salon existant par son code ; puis, en partie, la saisie des messages (chat).

interface TextInput { textSink: ((e: KeyboardEvent) => boolean) | null }

const NAME_KEY = 'ascii-fort-name';
function loadName(): string { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } }
function saveName(n: string) { try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ } }

export class MultiScreen implements Screen {
  modal = true;
  private field = 0;            // 0 nom, 1 seed (créer), 2 code (rejoindre)
  private name = loadName();
  private seed = randomSeedString();
  private code: string;
  private status = '';
  private statusColor = C.dim;
  private busy = false;

  constructor(private inp: TextInput, code: string, private actions: { create(name: string, seed: string): Promise<void>; join(name: string, code: string): Promise<void>; back(): void }) {
    this.code = cleanCode(code);
    this.field = this.name ? (this.code ? 2 : 1) : 0;
    inp.textSink = (e) => {
      if (this.busy) return true;
      if (e.key === 'Escape') { this.leave(); return true; }
      if (e.key === 'ArrowUp') { this.field = (this.field + 2) % 3; return true; }
      if (e.key === 'ArrowDown' || e.key === 'Tab') { this.field = (this.field + 1) % 3; return true; }
      if (e.key === 'Enter') { this.submit(); return true; }
      if (e.key === 'Backspace') { this.edit((s) => s.slice(0, -1)); return true; }
      if (e.key.length === 1) {
        const ch = e.key;
        if (this.field === 0 && this.name.length < 16 && !/[\u0000-\u001f<>]/.test(ch)) this.name += ch;
        if (this.field === 1 && this.seed.length < 40 && /[\p{L}\p{N} _-]/u.test(ch)) this.seed += ch.toUpperCase();
        if (this.field === 2 && this.code.length < 8 && /[a-z0-9]/i.test(ch)) this.code += ch.toUpperCase();
        return true;
      }
      return false;
    };
  }

  private edit(f: (s: string) => string) {
    if (this.field === 0) this.name = f(this.name);
    else if (this.field === 1) this.seed = f(this.seed);
    else this.code = f(this.code);
  }
  private leave() { this.inp.textSink = null; this.actions.back(); }

  private submit() {
    if (this.field === 0) { this.field = this.code ? 2 : 1; return; }
    const name = this.name.trim() || 'Voyageur';
    saveName(name);
    if (this.field === 1 && !this.seed.trim()) this.seed = randomSeedString();
    if (this.field === 2 && this.code.length < 5) { this.say('Code de salon trop court.', C.red); return; }
    this.busy = true;
    this.say(this.field === 1 ? 'Création du salon…' : `Connexion au salon ${this.code}…`, C.yellow);
    const p = this.field === 1 ? this.actions.create(name, this.seed.trim()) : this.actions.join(name, this.code);
    p.then(() => { this.inp.textSink = null; })
      .catch((err: Error) => { this.busy = false; this.say(err.message || 'Connexion impossible.', C.red); });
  }
  private say(t: string, c: number) { this.status = t; this.statusColor = c; }

  draw(ctx: UICtx): void {
    const g = ctx.grid;
    drawTitleBackground(g, performance.now() / 1000);
    const w = Math.min(g.cols - 4, 74), h = 18, x = Math.floor((g.cols - w) / 2), y = Math.max(0, Math.floor((g.rows - h) / 2));
    g.box(x, y, w, h, { title: 'Multijoueur en ligne', double: true, alpha: 0.95 });
    const caret = Math.floor(performance.now() / 500) % 2 ? '▌' : ' ';
    const rows: [string, string, number][] = [['Votre nom', this.name, 18], ['Créer un salon — seed du monde', this.seed, 42], ['Rejoindre — code du salon', this.code, 10]];
    rows.forEach(([label, val, len], i) => {
      const yy = y + 2 + i * 3, on = this.field === i;
      g.text(x + 3, yy, label, on ? C.title : C.dim);
      g.text(x + 5, yy + 1, `[${(val + (on ? caret : '')).padEnd(len, '_')}]`, on ? C.white : C.text, on ? C.sel : -1);
      if (ctx.clicked && ctx.mouseCell.y >= yy && ctx.mouseCell.y <= yy + 1 && ctx.mouseCell.x >= x && ctx.mouseCell.x < x + w) this.field = i;
    });
    const btns: [string, () => void][] = [['Créer (Entrée)', () => { this.field = 1; this.submit(); }], ['Rejoindre (Entrée)', () => { this.field = 2; this.submit(); }], ['Retour (Échap)', () => this.leave()]];
    let bx = x + 3;
    for (const [label, fn] of btns) {
      const over = ctx.mouseCell.y === y + 11 && ctx.mouseCell.x >= bx && ctx.mouseCell.x < bx + label.length + 4;
      g.text(bx, y + 11, `[ ${label} ]`, over ? 0xffffff : C.yellow, over ? C.sel : -1);
      if (over && ctx.clicked && !this.busy) fn();
      bx += label.length + 6;
    }
    g.text(x + 3, y + 13, 'Créez un monde et donnez son code (ou le lien) à vos amis : chacun joue', C.dim);
    g.text(x + 3, y + 14, 'sur son PC, dans le même monde. ↑/↓ pour changer de champ.', C.dim);
    if (this.status) g.text(x + 3, y + 16, this.status.slice(0, w - 6), this.statusColor);
  }
  input(): void { /* saisie gérée par textSink */ }
}

/** Saisie d'un message de chat (Entrée pour envoyer, Échap pour annuler). */
export class ChatScreen implements Screen {
  modal = true;
  private line = '';
  private done = false;
  constructor(private inp: TextInput, private send: (text: string) => void) {
    inp.textSink = (e) => {
      if (e.key === 'Escape') { this.close(); return true; }
      if (e.key === 'Enter') { if (this.line.trim()) this.send(this.line.trim()); this.close(); return true; }
      if (e.key === 'Backspace') { this.line = this.line.slice(0, -1); return true; }
      if (e.key.length === 1 && this.line.length < 200) { this.line += e.key; return true; }
      return false;
    };
  }
  private close() { this.inp.textSink = null; this.done = true; }
  draw(ctx: UICtx): void {
    const g = ctx.grid, y = g.rows - 7, w = Math.min(g.cols - 4, 90);
    const caret = Math.floor(performance.now() / 500) % 2 ? '▌' : ' ';
    const shown = this.line.length > w - 14 ? '…' + this.line.slice(-(w - 15)) : this.line;
    g.text(2, y, ` Message : ${shown}${caret}`.padEnd(w), C.white, C.panel, 0.85);
  }
  input(ctx: UICtx): void { if (this.done) ctx.close(); }
}
