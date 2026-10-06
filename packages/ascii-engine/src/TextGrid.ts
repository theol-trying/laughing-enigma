import { glyphIndex, GLYPH_SPACE } from './GlyphAtlas';

// Couche d'interface en caractères (fusionnée dans la passe « cellule » du renderer).
// Couleurs : entiers 0xRRGGBB. Une cellule dont le glyphe vaut 0 est transparente.

export const C = {
  white: 0xe8e8e0, text: 0xc8c8bc, dim: 0x7a7a70, faint: 0x4a4a44, black: 0x000000,
  red: 0xe05040, green: 0x60d070, blue: 0x5a9ae8, yellow: 0xf0d060, orange: 0xf09040,
  cyan: 0x60d0e0, magenta: 0xd070d0, gold: 0xe8c050, hp: 0xd04030, sta: 0x50b050, mp: 0x4a7ae0,
  panel: 0x0b0d10, panel2: 0x14181e, border: 0x5a6a5a, title: 0xe8d8a0, sel: 0x2a3a2a,
};

export class TextGrid {
  cols = 0; rows = 0;
  glyph = new Uint16Array(0);
  fg = new Uint8Array(0);
  bg = new Uint8Array(0);

  resize(cols: number, rows: number): void {
    this.cols = cols; this.rows = rows;
    this.glyph = new Uint16Array(cols * rows);
    this.fg = new Uint8Array(cols * rows * 4);
    this.bg = new Uint8Array(cols * rows * 4);
  }

  clear(): void { this.glyph.fill(0); this.bg.fill(0); }

  /** Pose un glyphe. bgAlpha : 0 = fond de la scène conservé, 1 = fond opaque. */
  set(x: number, y: number, g: number, fg: number, bg = -1, bgAlpha = 1): void {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x;
    this.glyph[i] = g;
    this.fg[i * 4] = (fg >> 16) & 255; this.fg[i * 4 + 1] = (fg >> 8) & 255; this.fg[i * 4 + 2] = fg & 255; this.fg[i * 4 + 3] = 255;
    if (bg >= 0) {
      this.bg[i * 4] = (bg >> 16) & 255; this.bg[i * 4 + 1] = (bg >> 8) & 255; this.bg[i * 4 + 2] = bg & 255;
      this.bg[i * 4 + 3] = Math.round(bgAlpha * 255);
    }
  }

  /** Écrit un texte ; renvoie la colonne après le dernier caractère. */
  text(x: number, y: number, s: string, fg = C.text, bg = -1, bgAlpha = 1): number {
    let cx = x | 0;
    for (const ch of s) { this.set(cx, y, glyphIndex(ch), fg, bg, bgAlpha); cx++; }
    return cx;
  }

  center(y: number, s: string, fg = C.text, bg = -1, x0 = 0, w = this.cols): void {
    this.text(x0 + Math.floor((w - [...s].length) / 2), y, s, fg, bg);
  }

  fill(x: number, y: number, w: number, h: number, ch: string, fg: number, bg = -1, bgAlpha = 1): void {
    const g = ch === ' ' ? GLYPH_SPACE : glyphIndex(ch);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, g, fg, bg, bgAlpha);
  }

  /** Cadre (simple ou double) avec fond, titre optionnel. */
  box(x: number, y: number, w: number, h: number, opts: { fg?: number; bg?: number; double?: boolean; title?: string; alpha?: number } = {}): void {
    const fg = opts.fg ?? C.border, bg = opts.bg ?? C.panel, a = opts.alpha ?? 0.94;
    const [tl, tr, bl, br, hz, vt] = opts.double ? ['╔', '╗', '╚', '╝', '═', '║'] : ['┌', '┐', '└', '┘', '─', '│'];
    this.fill(x, y, w, h, ' ', fg, bg, a);
    for (let i = 1; i < w - 1; i++) { this.text(x + i, y, hz, fg, bg, a); this.text(x + i, y + h - 1, hz, fg, bg, a); }
    for (let j = 1; j < h - 1; j++) { this.text(x, y + j, vt, fg, bg, a); this.text(x + w - 1, y + j, vt, fg, bg, a); }
    this.text(x, y, tl, fg, bg, a); this.text(x + w - 1, y, tr, fg, bg, a);
    this.text(x, y + h - 1, bl, fg, bg, a); this.text(x + w - 1, y + h - 1, br, fg, bg, a);
    if (opts.title) this.text(x + 2, y, ` ${opts.title} `, C.title, bg, a);
  }

  /** Barre de jauge façon « ███████░░░ ». */
  bar(x: number, y: number, w: number, frac: number, fg: number, empty = C.faint, bg = -1): void {
    const n = Math.max(0, Math.min(w, Math.round(frac * w)));
    for (let i = 0; i < w; i++) this.text(x + i, y, i < n ? '█' : '░', i < n ? fg : empty, bg);
  }

  /** Découpe un texte en lignes de largeur max. */
  static wrap(s: string, width: number): string[] {
    const out: string[] = [];
    for (const para of s.split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        if (!line) line = word;
        else if (line.length + 1 + word.length <= width) line += ' ' + word;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  }
}
