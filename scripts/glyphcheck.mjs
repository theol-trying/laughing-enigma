// Repère les caractères des textes du jeu absents de l'atlas de glyphes (affichés « ? »).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..') + '/';
const atlas = readFileSync(root + 'packages/ascii-engine/src/GlyphAtlas.ts', 'utf8');
const m = [...atlas.matchAll(/const (ASCII|LATIN|BLOCKS|BOX|SYMBOLS) = '([^']*)'/g)];
const set = new Set(Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)));
for (const [, n, s] of m) if (n !== 'ASCII') for (const c of s.replace(/\'/g, "'")) set.add(c);
const files = [];
(function w(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) w(p); else if (p.endsWith('.ts')) files.push(p); } })(root + 'src');
(function w(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) w(p); else if (p.endsWith('.ts')) files.push(p); } })(root + 'packages/sim/src');
const bad = new Map();
for (const f of files) {
  const s = readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'));
  for (const l of s) for (const c of l) if (c.charCodeAt(0) > 126 && !set.has(c)) bad.set(c, (bad.get(c) ?? '') || f.slice(root.length) + ': ' + l.trim().slice(0, 70));
}
for (const [c, w] of bad) console.log(JSON.stringify(c), '←', w);
