import { glyphIndex, QUAD_GLYPHS } from './GlyphAtlas';

// Matières : chacune a son vocabulaire de glyphes (rampe sombre → clair + glyphes de détail).
export const M = {
  SKY: 0, GRASS: 1, DIRT: 2, ROCK: 3, SNOW: 4, SAND: 5, MUD: 6, ROAD: 7, FIELD: 8, WATER: 9,
  WOOD: 10, STONE: 11, ROOF: 12, FOLIAGE: 13, TRUNK: 14, CLOTH: 15, SKIN: 16, BONE: 17, FUR: 18,
  METAL: 19, FIRE: 20, WINDOW: 21, PLANKS: 22, BUSH: 23, ITEM: 24, COBBLE: 25, DOOR: 26, THATCH: 27,
  SLIME: 28, BLOOD: 29, CROP: 30, RUBBLE: 31, GLOW: 32, LEATHER: 33, ICE: 34, PINE: 35, HEATH: 36,
} as const;
export type MatId = number;

export const MF = {
  EMISSIVE: 1,   // brille toujours (feu)
  NIGHT_GLOW: 2, // brille la nuit (fenêtres)
  WATER: 4,      // reflets, vagues
  ANIM: 8,       // glyphes animés
  ORIENTED: 16,  // glyphe selon l'orientation de la normale (toits : / \)
  CREATURE: 32,  // lettre roguelike au loin
  FOLIAGE: 64,
} as const;

interface MatDef { ramp: string; detail?: string; flags?: number }

const DEFS: Record<number, MatDef> = {
  [M.GRASS]: { ramp: ' .,:;"', detail: ",'\";`" },
  [M.HEATH]: { ramp: ' .,:;%', detail: ",;%'" },
  [M.DIRT]: { ramp: ' .,:;~=', detail: '.,:\'' },
  [M.ROCK]: { ramp: ' .:░#▒▓█', detail: '#%▓▒' },
  [M.SNOW]: { ramp: ' .:-=░▒▓', detail: "*.'°" },
  [M.SAND]: { ramp: ' .,:∙░▒', detail: '.:,∙' },
  [M.MUD]: { ramp: ' .,~:≈░', detail: '~≈.,' },
  [M.ROAD]: { ramp: ' .·:=░▒', detail: '.:·,' },
  [M.FIELD]: { ramp: ' .,|║"▒', detail: '|║"\'' },
  [M.CROP]: { ramp: ' .,|¦"', detail: '|¦"' },
  [M.WATER]: { ramp: ' .-~≈▒', detail: '~≈-_', flags: MF.WATER | MF.ANIM },
  [M.ICE]: { ramp: ' .:-=░▒▓', detail: '=-' },
  [M.WOOD]: { ramp: ' .:│║▒▓█', detail: '│║|' },
  [M.STONE]: { ramp: ' .:░#▒▓█', detail: '#▓▒█' },
  [M.RUBBLE]: { ramp: ' .,:%#▒', detail: '%#,.' },
  [M.ROOF]: { ramp: ' .:░▒▓█', detail: '/\\', flags: MF.ORIENTED },
  [M.THATCH]: { ramp: ' .:;░▒▓', detail: '/\\', flags: MF.ORIENTED },
  [M.FOLIAGE]: { ramp: ' .:+*♣♠', detail: '♣♠*&', flags: MF.FOLIAGE },
  [M.PINE]: { ramp: ' .:^*♠▲', detail: '▲♠^', flags: MF.FOLIAGE },
  [M.BUSH]: { ramp: ' .:+*%&', detail: '%&*+', flags: MF.FOLIAGE },
  [M.TRUNK]: { ramp: ' .:|│║▓', detail: '|│║' },
  [M.CLOTH]: { ramp: ' .:░▒▓█', flags: MF.CREATURE },
  [M.SKIN]: { ramp: ' .:░▒▓█', flags: MF.CREATURE },
  [M.BONE]: { ramp: ' .:░▒▓█', flags: MF.CREATURE },
  [M.FUR]: { ramp: ' .:░▒▓█', flags: MF.CREATURE },
  [M.LEATHER]: { ramp: ' .:░▒▓█', flags: MF.CREATURE },
  [M.SLIME]: { ramp: ' .:░▒▓█', flags: MF.CREATURE },
  [M.METAL]: { ramp: ' .:=≡▒▓█', detail: '≡=' },
  [M.FIRE]: { ramp: ' .\'^*!▲', detail: '^*!\'', flags: MF.EMISSIVE | MF.ANIM },
  [M.GLOW]: { ramp: ' .:*☼█', flags: MF.EMISSIVE },
  [M.WINDOW]: { ramp: ' .░▒▓█', flags: MF.NIGHT_GLOW },
  [M.PLANKS]: { ramp: ' .:-=═≡▒', detail: '═─=' },
  [M.COBBLE]: { ramp: ' .:oO0▒▓', detail: 'oO0°' },
  [M.DOOR]: { ramp: ' .:│║▓█', detail: '║' },
  [M.ITEM]: { ramp: ' .*◆◆♦♦█', detail: '◆♦', flags: MF.EMISSIVE },
  [M.BLOOD]: { ramp: ' .,:░▒', detail: ',.' },
};

// Rangées spéciales de la table
export const ROW_QUAD = 60, ROW_SKY = 61, ROW_FX = 62, ROW_DEBUG = 63;
export const TABLE_W = 16, TABLE_H = 64;
const SKY_GLYPHS = '█▓▒░○.·*+ .:░▒▓';   // 0 soleil cœur, 1-3 halo, 4 lune, 5-8 étoiles, 9-14 rampe nuages
const FX_GLYPHS = '|/\\*.·,\'';         // pluie | / \, neige * . ·, éclaboussures , '
const DEBUG_GLYPHS = '█▓▒░#=+-:. ';

/** Table des matières pour le shader (R16UI, 16 × 64). */
export function buildMaterialTable(): Uint16Array {
  const t = new Uint16Array(TABLE_W * TABLE_H);
  const setRow = (row: number, glyphs: number[], offset = 0) => glyphs.forEach((g, i) => (t[row * TABLE_W + offset + i] = g));
  for (const [idStr, def] of Object.entries(DEFS)) {
    const id = Number(idStr);
    const ramp = Array.from(def.ramp).slice(0, 8).map(glyphIndex);
    const detail = Array.from(def.detail ?? '').slice(0, 4).map(glyphIndex);
    setRow(id, ramp, 0);
    t[id * TABLE_W + 8] = ramp.length;
    setRow(id, detail, 9);
    t[id * TABLE_W + 13] = detail.length;
    t[id * TABLE_W + 14] = def.flags ?? 0;
  }
  setRow(ROW_QUAD, QUAD_GLYPHS, 0);
  setRow(ROW_SKY, Array.from(SKY_GLYPHS).map(glyphIndex), 0);
  setRow(ROW_FX, Array.from(FX_GLYPHS).map(glyphIndex), 0);
  setRow(ROW_DEBUG, Array.from(DEBUG_GLYPHS).map(glyphIndex), 0);
  return t;
}

export function materialFlags(id: number): number { return DEFS[id]?.flags ?? 0; }
