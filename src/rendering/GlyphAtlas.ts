// Jeu de caractères + atlas de glyphes.
// L'index 0 est réservé (« transparent » pour l'UI). Les blocs (█▓▒░, quadrants) et les
// traits de boîte (─│┌…╬) sont dessinés procéduralement pour se raccorder sans jour.

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const LATIN = 'àâäæçéèêëîïôöœùûüÿÀÂÄÆÇÉÈÊËÎÏÔÖŒÙÛÜŸ«»°±×÷·¦§¤¢£¥©¬µ¶¿¡’‘“”…—–•†‡';
const BLOCKS = '█▓▒░▀▄▌▐▖▗▘▝▚▞▙▛▜▟■□▪▬';
const BOX = '─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬';
const SYMBOLS = '▲△▼▽◄►◆◇○●◘◙◦♠♣♥♦☼♪♫⌂☺☻♀♂↑↓←→↕↔∙√∞≈≡≤≥∩⌐Ω∆Σπσδφ';

export const CHARSET: string[] = ['\u0000', ...Array.from(ASCII + LATIN + BLOCKS + BOX + SYMBOLS)];
const INDEX = new Map<string, number>();
CHARSET.forEach((c, i) => { if (!INDEX.has(c)) INDEX.set(c, i); });
const QUESTION = INDEX.get('?')!;

/** Index du glyphe d'un caractère (« ? » si absent). */
export function glyphIndex(ch: string): number {
  return INDEX.get(ch) ?? QUESTION;
}
export const GLYPH_SPACE = glyphIndex(' ');
export const ATLAS_COLS = 32;

// --- dessin procédural -------------------------------------------------------
const BOX_ARMS: Record<string, [number, number, number, number]> = {
  // haut, bas, gauche, droite : 0 rien, 1 simple, 2 double
  '─': [0, 0, 1, 1], '│': [1, 1, 0, 0], '┌': [0, 1, 0, 1], '┐': [0, 1, 1, 0], '└': [1, 0, 0, 1], '┘': [1, 0, 1, 0],
  '├': [1, 1, 0, 1], '┤': [1, 1, 1, 0], '┬': [0, 1, 1, 1], '┴': [1, 0, 1, 1], '┼': [1, 1, 1, 1],
  '═': [0, 0, 2, 2], '║': [2, 2, 0, 0], '╔': [0, 2, 0, 2], '╗': [0, 2, 2, 0], '╚': [2, 0, 0, 2], '╝': [2, 0, 2, 0],
  '╠': [2, 2, 0, 2], '╣': [2, 2, 2, 0], '╦': [0, 2, 2, 2], '╩': [2, 0, 2, 2], '╬': [2, 2, 2, 2],
};
// quadrants : bits HG=1, HD=2, BG=4, BD=8
const QUADS: Record<string, number> = {
  '█': 15, '▀': 3, '▄': 12, '▌': 5, '▐': 10, '▘': 1, '▝': 2, '▖': 4, '▗': 8, '▚': 9, '▞': 6, '▛': 7, '▜': 11, '▙': 13, '▟': 14,
};
/** Glyphe quadrant pour un masque de 4 bits (HG=1, HD=2, BG=4, BD=8). */
export const QUAD_GLYPHS: number[] = (() => {
  const out = new Array(16).fill(GLYPH_SPACE);
  for (const [ch, m] of Object.entries(QUADS)) out[m] = glyphIndex(ch);
  return out;
})();

function drawProcedural(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, w: number, h: number): boolean {
  const q = QUADS[ch];
  if (q !== undefined) {
    const hw = Math.round(w / 2), hh = Math.round(h / 2);
    if (q & 1) ctx.fillRect(x, y, hw, hh);
    if (q & 2) ctx.fillRect(x + hw, y, w - hw, hh);
    if (q & 4) ctx.fillRect(x, y + hh, hw, h - hh);
    if (q & 8) ctx.fillRect(x + hw, y + hh, w - hw, h - hh);
    return true;
  }
  if (ch === '░' || ch === '▒' || ch === '▓') {
    const s = Math.max(1, Math.round(w / 5));
    for (let py = 0; py < h; py += s) for (let px = 0; px < w; px += s) {
      const ix = px / s, iy = py / s;
      const on = ch === '▒' ? (ix + iy) % 2 === 0
        : ch === '░' ? (ix % 2 === 0 && iy % 2 === 0) || ((ix + 1) % 4 === 0 && (iy + 1) % 4 === 2)
        : !(ix % 2 === 1 && iy % 2 === 1);
      if (on) ctx.fillRect(x + px, y + py, s, s);
    }
    return true;
  }
  const arms = BOX_ARMS[ch];
  if (arms) {
    const t = Math.max(1, Math.round(w / 8));
    const cx = x + Math.floor(w / 2 - t / 2), cy = y + Math.floor(h / 2 - t / 2);
    const g = t * 2;
    const lineV = (ox: number, y0: number, y1: number) => ctx.fillRect(ox, y0, t, y1 - y0);
    const lineH = (oy: number, x0: number, x1: number) => ctx.fillRect(x0, oy, x1 - x0, t);
    const [u, d, l, r] = arms;
    const vOff = (s: number) => (s === 2 ? [-g, g] : [0]);
    for (const o of vOff(u)) lineV(cx + o, y, cy + t);
    for (const o of vOff(d)) lineV(cx + o, cy, y + h);
    for (const o of vOff(l)) lineH(cy + o, x, cx + t);
    for (const o of vOff(r)) lineH(cy + o, cx, x + w);
    return true;
  }
  if (ch === '■' || ch === '□' || ch === '▪') {
    const m = ch === '▪' ? 0.3 : 0.18;
    const bx = x + Math.round(w * m), by = y + Math.round(h / 2 - (w * (1 - 2 * m)) / 2), bs = Math.round(w * (1 - 2 * m));
    if (ch === '□') { const t = Math.max(1, Math.round(w / 8)); ctx.fillRect(bx, by, bs, t); ctx.fillRect(bx, by + bs - t, bs, t); ctx.fillRect(bx, by, t, bs); ctx.fillRect(bx + bs - t, by, t, bs); }
    else ctx.fillRect(bx, by, bs, bs);
    return true;
  }
  if (ch === '▬') { ctx.fillRect(x, y + Math.round(h * 0.4), w, Math.round(h * 0.2)); return true; }
  return false;
}

export interface Atlas {
  cellW: number; cellH: number; cols: number; rows: number;
  width: number; height: number;
  data: Uint8Array; // R8, ligne 0 = haut de la première rangée de glyphes
}

const FONT_FAMILY = '"Cascadia Mono", "Cascadia Code", Consolas, "DejaVu Sans Mono", Menlo, "Courier New", monospace';

/** Mesure la largeur de cellule pour une hauteur de cellule donnée (pixels écran). */
export function measureCell(cellH: number): { cellW: number; fontPx: number } {
  const fontPx = Math.max(6, Math.round(cellH * 0.8));
  const c = document.createElement('canvas').getContext('2d')!;
  c.font = `${fontPx}px ${FONT_FAMILY}`;
  const cellW = Math.max(4, Math.round(c.measureText('M').width));
  return { cellW, fontPx };
}

export function buildAtlas(cellW: number, cellH: number, fontPx: number): Atlas {
  const cols = ATLAS_COLS, rows = Math.ceil(CHARSET.length / cols);
  const width = cols * cellW, height = rows * cellH;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${fontPx}px ${FONT_FAMILY}`;
  CHARSET.forEach((ch, i) => {
    if (i === 0 || ch === ' ') return;
    const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH;
    if (drawProcedural(ctx, ch, x, y, cellW, cellH)) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, cellW, cellH); ctx.clip();
    ctx.fillText(ch, x + cellW / 2, y + cellH / 2 + cellH * 0.04);
    ctx.restore();
  });
  const img = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = img[i * 4 + 3];
  return { cellW, cellH, cols, rows, width, height, data };
}
