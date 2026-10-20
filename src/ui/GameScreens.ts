import { C, TextGrid } from '@ascii-fort/ascii-engine/TextGrid';
import { compareWithEquipped, itemStats } from './DialogueScreen';
import { SPELLS, spell } from '@ascii-fort/sim/gameplay/Spells';
import type { Screen, UICtx } from './UI';
import { optionList } from './UI';
import type { Game } from '../game/Game';
import { item, baseId, durOf, wearable } from '@ascii-fort/sim/gameplay/Items';
import { recipeFor, usesOf, repairNeed, TAB_PLACE } from '@ascii-fort/sim/gameplay/Crafting';
import { STATS, STAT_NAMES, SKILLS, SKILL_NAMES , STAT_DESC } from '@ascii-fort/sim/gameplay/Character';
import { MACRO } from '@ascii-fort/worldgen/constants';
import { B } from '@ascii-fort/worldgen/terrain/Biomes';
import { W_LAKE, W_RIVER, W_SEA } from '@ascii-fort/worldgen/terrain/Hydrology';
import { GENERATOR_VERSION } from '../version';
import { TalentPanel } from './TalentPanel';
import { frNum } from '@ascii-fort/sim/gameplay/Talents';
import { MAX_BOUNTIES } from '@ascii-fort/sim/gameplay/Bounties';
import type { Quest } from '@ascii-fort/sim/gameplay/QuestSystem';
import { shortFaction } from '../game/Happenings';

export function frame(g: TextGrid, title: string, wMax = 110, hMax = 34) {
  const w = Math.min(g.cols - 2, wMax), h = Math.min(g.rows - 2, hMax);
  const x = Math.floor((g.cols - w) / 2), y = Math.floor((g.rows - h) / 2);
  g.box(x, y, w, h, { title, double: true });
  return { x, y, w, h };
}

/** Nom d'un exemplaire tenant en `width` colonnes : le nom de base est coupé, jamais l'état (« (62 %) », « (HS) »). */
export function fitName(id: string, width: number, prefix = ''): string {
  const s = durOf(id), st = wearable(item(id)) && s < 100 ? (s > 0 ? ` (${s} %)` : ' (HS)') : '';
  return `${prefix}${item(baseId(id)).name}`.slice(0, Math.max(0, width - st.length)) + st;
}

// ------------------------------------------------------------------ inventaire
export class InventoryScreen implements Screen {
  modal = true;
  private sel = 0;
  private tab = 0;
  constructor(private game: Game) {}

  private static TABS = ['Tout', 'Armes', 'Armures', 'Consommables', 'Matériaux', 'Divers', 'Sorts'];

  private items() {
    const all = this.game.character.inv.list();
    const t = InventoryScreen.TABS[this.tab];
    const cat = (c: string) => t === 'Tout' || (t === 'Armes' && (c === 'arme' || c === 'munition')) || (t === 'Armures' && (c === 'armure' || c === 'bouclier'))
      || (t === 'Consommables' && (c === 'nourriture' || c === 'potion')) || (t === 'Matériaux' && c === 'matériau')
      || (t === 'Divers' && (c === 'clé' || c === 'quête' || c === 'valeur' || c === 'parchemin'));
    return all.filter((l) => cat(l.def.cat));
  }

  draw(ctx: UICtx): void {
    const g = ctx.grid, ch = this.game.character;
    const { x, y, w, h } = frame(g, 'Inventaire');
    // onglets
    let tx = x + 2;
    InventoryScreen.TABS.forEach((t, i) => {
      const label = ` ${i + 1}.${t} `, on = i === this.tab;
      const over = ctx.mouseCell.y === y + 1 && ctx.mouseCell.x >= tx && ctx.mouseCell.x < tx + label.length;
      if (tx + label.length < x + w - 1) g.text(tx, y + 1, label, on ? 0xffffff : over ? C.white : C.dim, on ? C.sel : -1);
      if (over && ctx.clicked) { this.tab = i; this.sel = 0; }
      tx += label.length + 1;
    });
    const lw = Math.floor(w * 0.52), dx = x + lw + 2, dw = w - lw - 4;
    if (InventoryScreen.TABS[this.tab] === 'Sorts') { this.drawSpells(ctx, x, y, lw, dx, dw, h); return; }
    const list = this.items();
    this.sel = Math.max(0, Math.min(this.sel, list.length - 1));
    g.text(x + 2, y + 3, 'Objet'.padEnd(lw - 22) + 'Qté  Poids  Valeur', C.dim);
    const view = h - 8, start = Math.max(0, Math.min(this.sel - Math.floor(view / 2), list.length - view));
    if (!list.length) g.text(x + 2, y + 4, '(rien dans cette catégorie)', C.dim);
    list.slice(start, start + view).forEach((l, i) => {
      const k = start + i, yy = y + 4 + i;
      const over = ctx.mouseCell.y === yy && ctx.mouseCell.x > x && ctx.mouseCell.x < x + lw;
      if (over) { this.sel = k; if (ctx.clicked) this.use(); }
      const eq = ch.isEquipped(l.id) ? '■ ' : '  ';
      const name = fitName(l.id, lw - 22, eq).padEnd(lw - 22);
      const s = durOf(l.id), wr = wearable(l.def);
      const col = wr && s <= 0 ? C.red : wr && s < 25 ? C.orange : l.def.rarity === 'épique' ? C.gold : l.def.rarity === 'rare' ? C.magenta : l.def.quality ? C.green : l.def.cat === 'quête' || l.def.cat === 'clé' ? C.gold : l.def.cat === 'parchemin' ? C.cyan : C.text;
      g.text(x + 2, yy, `${name}${String(l.qty).padStart(3)}  ${(l.def.weight * l.qty).toFixed(1).padStart(5)}  ${String(l.def.value).padStart(6)}`, k === this.sel ? 0xffffff : col, k === this.sel ? C.sel : -1);
    });
    // détails et comparaison
    const d = list[this.sel]?.def;
    let yy = y + 3;
    if (d) {
      g.text(dx, yy++, d.name.slice(0, dw), d.rarity === 'épique' ? C.gold : d.rarity === 'rare' ? C.magenta : C.title);
      g.text(dx, yy++, `${d.cat}${d.rarity ? ' · ' + d.rarity : ''}${ch.isEquipped(d.id) ? ' · équipé' : ''}`, C.dim);
      const id = list[this.sel].id, info: string[] = [];
      info.push(...itemStats(d));
      const need = repairNeed(id);
      if (need) info.push(`Réparer : enclume (${need.n} × ${item(need.mat).name}${need.skill ? `, artisanat ${need.skill}` : ''}) ou forgeron (or)`);
      info.push(d.desc);
      const rf = recipeFor(id);
      if (rf) info.push(`Se fabrique : ${TAB_PLACE[rf.tab]} · artisanat ${rf.skill}`);
      const uses = [...new Set(usesOf(id).map((r) => item(r.out).name))];
      if (uses.length) info.push(`Sert à : ${uses.slice(0, 3).join(', ')}${uses.length > 3 ? '…' : ''}`);
      for (const l of info.flatMap((s) => TextGrid.wrap(s, dw)).slice(0, 10)) g.text(dx, yy++, l.slice(0, dw), C.text);
      for (const [l, v] of compareWithEquipped(ch, d)) g.text(dx, yy++, l.slice(0, dw), v > 0 ? C.green : v < 0 ? C.red : C.dim);
      const verb = d.weapon || d.armor || d.shield ? (ch.isEquipped(d.id) ? 'Entrée : retirer' : 'Entrée : équiper') : d.use ? 'Entrée : utiliser' : d.cat === 'parchemin' ? 'Entrée : lire (apprendre le sort)' : '';
      if (verb) g.text(dx, yy++, verb, C.yellow);
    }
    // emplacements d'équipement (clic : retirer)
    const eqY = Math.max(yy + 1, y + h - 11);
    g.text(dx, eqY, 'Équipement (clic : retirer)', C.title);
    const SLOT: Record<string, string> = { arme: 'Arme', bouclier: 'Bouclier', tête: 'Tête', corps: 'Corps', mains: 'Mains', pieds: 'Pieds' };
    (['arme', 'bouclier', 'tête', 'corps', 'mains', 'pieds'] as (keyof typeof ch.equip)[]).forEach((s, i) => {
      const yy2 = eqY + 1 + i, id = ch.equip[s];
      const over = ctx.mouseCell.y === yy2 && ctx.mouseCell.x >= dx && ctx.mouseCell.x < dx + dw;
      g.text(dx, yy2, `${SLOT[s].padEnd(9)} ${id ? fitName(id, dw - 10) : '—'}`.slice(0, dw), id ? (durOf(id) <= 0 ? C.red : durOf(id) < 25 ? C.orange : C.text) : C.faint, over && id ? C.sel : -1);
      if (over && id && ctx.clicked) this.game.useItem(id);
    });
    g.text(dx, eqY + 8, `Armure ${ch.armor} · Poids ${ch.inv.weight().toFixed(1)}/${ch.carryMax()} · ${ch.inv.gold} or`.slice(0, dw), C.gold);
    g.text(x + 2, y + h - 2, '←→ ou 1-7 onglet · ↑↓ choisir · Entrée/clic : équiper/utiliser · X : jeter · Tab/Échap : fermer'.slice(0, w - 4), C.dim);
  }

  private drawSpells(ctx: UICtx, x: number, y: number, lw: number, dx: number, dw: number, h: number) {
    const g = ctx.grid, ch = this.game.character;
    const list = SPELLS;
    this.sel = Math.max(0, Math.min(this.sel, list.length - 1));
    g.text(x + 2, y + 3, 'Sort'.padEnd(lw - 14) + 'Mana  Touche', C.dim);
    list.forEach((s, i) => {
      const yy = y + 4 + i, known = ch.spells.includes(s.id);
      const over = ctx.mouseCell.y === yy && ctx.mouseCell.x > x && ctx.mouseCell.x < x + lw;
      if (over) { this.sel = i; if (ctx.clicked) this.assign(); }
      const key = ch.spellR === s.id ? 'R' : ch.spellF === s.id ? 'F' : '';
      g.text(x + 2, yy, `${s.name.padEnd(lw - 14)}${String(ch.manaCost(s.mana)).padStart(4)}  ${key.padStart(4)}`, i === this.sel ? 0xffffff : known ? C.text : C.faint, i === this.sel ? C.sel : -1);
    });
    const s = list[this.sel];
    let yy = y + 3;
    g.text(dx, yy++, s.name, C.title);
    g.text(dx, yy++, `${ch.manaCost(s.mana)} mana · ${s.kind === 'projectile' ? `projectile, ${Math.round((s.dmg ?? 0) * ch.spellMult())} dégâts` : s.kind === 'soin' ? `soin, +${Math.round(ch.healAmount())} PV` : 'bonus temporaire'}`, C.dim);
    for (const l of TextGrid.wrap(s.desc, dw)) g.text(dx, yy++, l, C.text);
    yy++;
    if (ch.spells.includes(s.id)) g.text(dx, yy++, 'R ou F : lancer ce sort avec cette touche', C.yellow);
    else g.text(dx, yy++, `À apprendre : parchemin (${s.price} or) chez un prêtre ou un moine.`.slice(0, dw), C.dim);
    g.text(dx, y + h - 5, `R : ${spell(ch.spellR)?.name ?? '—'}`, C.cyan);
    g.text(dx, y + h - 4, `F : ${spell(ch.spellF)?.name ?? '—'}`, C.cyan);
    g.text(x + 2, y + h - 2, '←→ onglet · ↑↓ choisir · R / F : assigner à la touche · Tab/Échap : fermer'.slice(0, lw + dw), C.dim);
  }

  private assign(key?: 'r' | 'f') {
    const ch = this.game.character, s = SPELLS[this.sel];
    if (!s || !ch.spells.includes(s.id)) { this.game.events.emit('message', { text: 'Sort inconnu : il faut d’abord lire son parchemin.', color: C.dim }); return; }
    const k = key ?? (s.kind === 'projectile' ? 'r' : 'f');
    if (k === 'r') { if (ch.spellF === s.id) ch.spellF = ch.spellR; ch.spellR = s.id; }
    else { if (ch.spellR === s.id) ch.spellR = ch.spellF; ch.spellF = s.id; }
    this.game.events.emit('message', { text: `${s.name} → touche ${k.toUpperCase()}`, color: C.cyan });
  }

  private use() { const l = this.items()[this.sel]; if (l) this.game.useItem(l.id); }

  input(ctx: UICtx): void {
    const i = ctx.input, spells = InventoryScreen.TABS[this.tab] === 'Sorts';
    const n = spells ? SPELLS.length : this.items().length;
    if (i.key('Escape') || i.key('Tab')) { ctx.close(); return; }
    if (i.pressed('ArrowLeft')) { this.tab = (this.tab + InventoryScreen.TABS.length - 1) % InventoryScreen.TABS.length; this.sel = 0; }
    if (i.pressed('ArrowRight')) { this.tab = (this.tab + 1) % InventoryScreen.TABS.length; this.sel = 0; }
    for (let k = 0; k < InventoryScreen.TABS.length; k++) if (i.pressed('Digit' + (k + 1))) { this.tab = k; this.sel = 0; }
    if (i.pressed('ArrowUp')) this.sel = Math.max(0, this.sel - 1);
    if (i.pressed('ArrowDown')) this.sel = Math.min(n - 1, this.sel + 1);
    if (spells) {
      if (i.key('r')) this.assign('r');
      if (i.key('f')) this.assign('f');
      if (i.pressed('Enter')) this.assign();
      return;
    }
    if (i.pressed('Enter') || i.key('e')) this.use();
    if (i.key('x')) { const l = this.items()[this.sel]; if (l) this.game.dropItem(l.id, 1); }
  }
}

// ------------------------------------------------------------------ journal
interface JLine { text: string; color: number; indent: number; q?: Quest }

/** Journal : histoires, quêtes, primes, biens, quêtes terminées ; on choisit la quête suivie à l'écran (Entrée ou clic). */
export class JournalScreen implements Screen {
  modal = true;
  private sel = 0;
  private scroll = 0;
  private first = true;
  constructor(private game: Game) {}

  private build(w: number): JLine[] {
    const game = this.game, qs = game.quests.quests, out: JLine[] = [], W = w - 10, tracked = game.quests.trackedQuest();
    const head = (text: string) => out.push({ text, color: C.title, indent: 2 });
    const dim = (text: string) => { for (const l of TextGrid.wrap(text, W)) out.push({ text: l, color: C.dim, indent: 4 }); };
    const blank = () => out.push({ text: '', color: C.dim, indent: 0 });
    const quest = (q: Quest, tag: string) => {
      const on = q === tracked;
      out.push({ text: `${on ? '►' : '◆'} ${q.title}${tag}${on ? ' (suivie)' : ''}`, color: on ? C.white : q.kind === 'chaîne' ? C.magenta : C.yellow, indent: 3, q });
      for (const l of TextGrid.wrap(q.summary, W).slice(0, 3)) out.push({ text: l, color: C.dim, indent: 6 });
      q.stages.forEach((s, i) => TextGrid.wrap(s, W - 2).forEach((l, k) => out.push({ text: `${k ? ' ' : i < q.stage ? '√' : i === q.stage ? '►' : '·'} ${l}`, color: i < q.stage ? C.green : i === q.stage ? C.white : C.faint, indent: 6 })));
      blank();
    };
    const chains = qs.filter((q) => q.kind === 'chaîne' && q.status === 'active');
    head('Histoires');
    if (!chains.length) {
      const towns = game.exploits.rumorTowns();
      dim(towns.length ? `On parle de graves ennuis à ${towns.slice(0, 4).join(', ')}. Les habitants en diront plus.` : 'Aucune. Certains habitants ont de graves ennuis : écoutez-les.');
      blank();
    }
    for (const q of chains) quest(q, ` · danger ${game.exploits.chain(q.id)?.danger ?? '?'}`);
    const sys = qs.filter((q) => q.kind !== 'chaîne' && q.kind !== 'prime' && q.status === 'active');
    head('Quêtes en cours');
    if (!sys.length) { dim('Aucune. Parlez aux habitants : certains ont des soucis.'); blank(); }
    for (const q of sys) quest(q, '');
    const pr = qs.filter((q) => q.kind === 'prime' && q.status === 'active'), done = game.exploits.done;
    head(`Primes (${pr.length}/${MAX_BOUNTIES})${done ? ` · ${done} réclamée${done > 1 ? 's' : ''}` : ''}`);
    if (!pr.length) { dim('Aucune. Le tableau des primes se trouve sur la place des villages et des villes.'); blank(); }
    for (const q of pr) { const st = game.exploits.bountyOf(q)?.st; quest(q, ` · ${q.reward.gold} or${st === 'remplie' ? ' · à réclamer' : st === 'caduque' ? ' · caduque' : ''}`); }
    const evs = game.happenings.journalLines();
    if (evs.length) { head('Événements'); for (const l of evs) for (const t of TextGrid.wrap(l.text, W)) out.push({ text: t, color: l.color, indent: 4 }); blank(); }
    const routes = game.convoys.journalLines();
    if (routes.length) { head('Routes'); for (const l of routes) for (const t of TextGrid.wrap(l.text, W)) out.push({ text: t, color: l.color, indent: 4 }); blank(); }
    const goods = game.poss.journalLines();
    if (goods.length) { head('Biens et compagnons'); for (const l of goods) out.push({ text: l.text.slice(0, w - 8), color: l.color, indent: 4 }); blank(); }
    const fin = qs.filter((q) => q.status === 'terminée' && q.kind !== 'prime');
    if (fin.length) { head('Terminées'); for (const q of fin) out.push({ text: `√ ${q.title}`, color: q.kind === 'chaîne' ? C.magenta : C.green, indent: 4 }); }
    return out;
  }

  draw(ctx: UICtx): void {
    const g = ctx.grid, game = this.game, { x, y, w, h } = frame(g, 'Journal', 100);
    const lines = this.build(w), view = h - 4, picks = lines.map((l, i) => (l.q ? i : -1)).filter((i) => i >= 0);
    if (this.first) { this.first = false; const t = game.quests.trackedQuest(), i = lines.findIndex((l) => l.q && l.q === t); this.sel = Math.max(0, picks.indexOf(i)); }
    this.sel = Math.max(0, Math.min(this.sel, picks.length - 1));
    const cur = picks[this.sel] ?? -1;
    if (cur >= 0) { if (cur < this.scroll) this.scroll = Math.max(0, cur - 1); if (cur >= this.scroll + view) this.scroll = cur - view + 4; }
    this.scroll = Math.max(0, Math.min(this.scroll, lines.length - view));
    lines.slice(this.scroll, this.scroll + view).forEach((l, k) => {
      const i = this.scroll + k, yy = y + 1 + k, on = i === cur, over = !!l.q && ctx.mouseCell.y === yy && ctx.mouseCell.x > x && ctx.mouseCell.x < x + w - 1;
      g.text(x + l.indent, yy, l.text.slice(0, w - l.indent - 2), on ? 0xffffff : l.color, on ? C.sel : over ? C.panel2 : -1);
      if (over && ctx.clicked) { this.sel = picks.indexOf(i); game.quests.tracked = l.q!.id; }
    });
    if (lines.length > view) { const pos = ` ${this.scroll + 1}-${Math.min(lines.length, this.scroll + view)}/${lines.length} `; g.text(x + w - pos.length - 2, y, pos, C.dim, C.panel); }
    g.text(x + 2, y + h - 2, `↑↓ choisir · Entrée ou clic : suivre à l’écran · PgPréc/PgSuiv · ${game.state.discovered.size} lieux découverts · J/Échap : fermer`.slice(0, w - 4), C.dim);
  }
  input(ctx: UICtx): void {
    const i = ctx.input, game = this.game;
    if (i.key('Escape') || i.key('j')) { ctx.close(); return; }
    const lines = this.build(Math.min(ctx.grid.cols - 2, 100)), picks = lines.filter((l) => l.q);
    if (i.pressed('ArrowUp')) this.sel = Math.max(0, this.sel - 1);
    if (i.pressed('ArrowDown')) this.sel = Math.min(picks.length - 1, this.sel + 1);
    // la liste suit la quête choisie : PgPréc/PgSuiv et la molette sautent de deux quêtes
    if (i.pressed('PageUp') || i.wheel < 0) this.sel = Math.max(0, this.sel - 2);
    if (i.pressed('PageDown') || i.wheel > 0) this.sel = Math.min(picks.length - 1, this.sel + 2);
    if ((i.pressed('Enter') || i.pressed('NumpadEnter')) && picks[this.sel]) { game.quests.tracked = picks[this.sel].q!.id; game.events.emit('message', { text: `Quête suivie : ${picks[this.sel].q!.title}`, color: C.yellow }); }
  }
}

// ------------------------------------------------------------------ carte
const SET_GLYPH: Record<string, [string, number]> = {
  capitale: ['◙', 0xffe080], ville: ['■', 0xf0d070], bourg: ['■', 0xd8c070], village: ['⌂', 0xe8d8a0], 'village minier': ['⌂', 0xc8b8a0], port: ['⌂', 0x90c8f0],
  hameau: ['∙', 0xd8d0b0], château: ['╬', 0xffd060], fort: ['┼', 0xd0b060], monastère: ['†', 0xe8e0c0], 'avant-poste': ['┼', 0xb0a070], camp: ['x', 0xe05040], ruines: ['%', 0x9a9080],
};
const BIOME_GLYPH: Record<number, [string, number]> = {
  [B.OCEAN]: ['≈', 0x2a5a8a], [B.LAKE]: ['~', 0x4a8ac0], [B.BEACH]: ['.', 0xc8b47a], [B.PLAINS]: ['"', 0x6a9a3e], [B.FOREST]: ['♣', 0x3a7a2e],
  [B.TAIGA]: ['♠', 0x2e6a3e], [B.SWAMP]: ['%', 0x6a7a3a], [B.HEATH]: [',', 0x9a8a50], [B.MOUNTAIN]: ['▲', 0x8a867c], [B.SNOW]: ['▲', 0xe8eef4],
};

/** Mélange de deux couleurs 0xRRGGBB (k : part de b). */
function mix(a: number, b: number, k: number): number {
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - k) + ((b >> sh) & 255) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export class MapScreen implements Screen {
  modal = true;
  private zoom = 1;
  /** territoires colorés selon le propriétaire courant des places (F : afficher / masquer) */
  private borders = true;
  private cx: number; private cz: number;
  constructor(private game: Game) { this.cx = game.player.x; this.cz = game.player.z; }

  draw(ctx: UICtx): void {
    const g = ctx.grid, game = this.game, m = game.world.macro, civ = game.world.civ, st = game.state;
    const { x, y, w, h } = frame(g, `Carte — ${m.worldName}`, 200, 80);
    const mw = w - 2, mh = h - 3;
    // échelle : une case couvre sx × 2sx mètres (les caractères sont deux fois plus hauts que larges)
    const sx = (MACRO * 32) / (mw * this.zoom) * 0.75, sz = sx * 2;
    const ox = this.cx - (mw / 2) * sx, oz = this.cz - (mh / 2) * sz;
    const roadCells = new Set<number>();
    for (const r of civ.roads) for (const c of r.cells) roadCells.add(c);
    // territoires : fond teinté de la couleur de la faction qui tient la place la plus proche, frontières plus marquées
    const terr = this.borders ? game.happenings.territory().cells : null;
    const BG = 0x0a0c0e, tint = civ.factions.map((f) => mix(BG, f.color, 0.2)), edge = civ.factions.map((f) => mix(BG, f.color, 0.42));
    for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
      const wx = ox + (i + 0.5) * sx, wz = oz + (j + 0.5) * sz;
      if (wx < 0 || wz < 0 || wx >= MACRO * 32 || wz >= MACRO * 32) { g.text(x + 1 + i, y + 1 + j, ' ', C.black, 0x020304); continue; }
      const c = m.cellOf(wx, wz);
      if (!st.explored[c]) { g.text(x + 1 + i, y + 1 + j, '░', 0x10141a, 0x05070a); continue; }
      const wtr = m.hydro.water[c];
      let [ch, col] = BIOME_GLYPH[m.biome[c]];
      if (wtr === W_RIVER) { ch = '~'; col = 0x5aa0d8; }
      else if (wtr === W_SEA) { ch = '≈'; col = 0x2a5a8a; }
      else if (wtr === W_LAKE) { ch = '~'; col = 0x4a8ac0; }
      else if (roadCells.has(c)) { ch = '·'; col = 0xb89a6a; }
      let bg = BG;
      if (terr && wtr !== W_SEA) {
        const o = terr[c];
        if (o >= 0 && tint[o] !== undefined) {
          const ci = c % MACRO, cj = (c / MACRO) | 0;
          const border = (ci + 1 < MACRO && terr[c + 1] !== o) || (ci > 0 && terr[c - 1] !== o) || (cj + 1 < MACRO && terr[c + MACRO] !== o) || (cj > 0 && terr[c - MACRO] !== o);
          bg = border ? edge[o] : tint[o];
        }
      }
      g.text(x + 1 + i, y + 1 + j, ch, col, bg);
    }
    const toCell = (wx: number, wz: number) => ({ i: Math.floor((wx - ox) / sx), j: Math.floor((wz - oz) / sz) });
    // cases déjà écrites (glyphes et noms) : un nom de marqueur ne s'écrit pas par-dessus un autre (clé = rangée × 4096 + colonne)
    const used = new Set<number>();
    const label = (wx: number, wz: number, glyph: string, col: number, name?: string, apart = false) => {
      const { i, j } = toCell(wx, wz);
      if (i < 0 || j < 0 || i >= mw || j >= mh) return;
      g.text(x + 1 + i, y + 1 + j, glyph, col, 0x0a0c0e);
      used.add(j * 4096 + i);
      if (!name || i + name.length + 2 >= mw) return;
      // « apart » : même rangée si elle est libre, sinon celle du dessous, puis celle du dessus ; à défaut le nom n'est pas écrit
      for (const jj of apart ? [j, j + 1, j - 1] : [j]) {
        if (jj < 0 || jj >= mh || (apart && Array.from({ length: name.length }, (_, k) => jj * 4096 + i + 2 + k).some((c) => used.has(c)))) continue;
        g.text(x + 3 + i, y + 1 + jj, name, col, 0x0a0c0e, 0.6);
        for (let k = 0; k < name.length; k++) used.add(jj * 4096 + i + 2 + k);
        break;
      }
    };
    for (const s of civ.settlements) if (st.discovered.has(`settlement:${s.id}`)) { const [gl, col] = SET_GLYPH[s.type]; label(s.x, s.z, gl, col, this.zoom >= 2 || s.type === 'capitale' || s.type === 'ville' || s.id === civ.startId ? s.name : undefined); }
    for (const p of civ.pois) if (st.discovered.has(`poi:${p.id}`)) label(p.x, p.z, p.dungeonId >= 0 ? 'Ω' : p.kind === 'camp de bandits' ? 'x' : '¤', p.kind === 'camp de bandits' ? C.red : C.cyan, this.zoom >= 3 ? p.name : undefined);
    for (const m of game.poss.markers()) label(m.x, m.z, m.glyph, m.color, this.zoom >= 2 ? m.name : undefined, true);
    // convois rencontrés ou proches, épaves récentes
    const roads = game.convoys.markers();
    for (const m of roads) label(m.x, m.z, m.glyph, m.color, this.zoom >= 4 ? m.name : undefined, true);
    // événements connus : raids, fêtes, épidémies, bataille du jour
    const evs = game.happenings.markers();
    for (const m of evs) label(m.x, m.z, m.glyph, m.color, this.zoom >= 2 ? m.name : undefined, true);
    const bosses = game.exploits.markers();
    for (const m of bosses) label(m.x, m.z, m.glyph, m.color, this.zoom >= 2 ? m.name : undefined, true);
    // cibles des quêtes en cours (la quête suivie clignote en blanc)
    const tracked = game.quests.trackedQuest();
    for (const q of game.quests.quests) if (q.status === 'active' && q.target && Math.floor(performance.now() / 400) % 2) label(q.target.x, q.target.z, '!', q === tracked ? C.white : C.yellow);
    const arrows = ['▲', '►', '▼', '◄'];
    label(game.player.x, game.player.z, Math.floor(performance.now() / 300) % 2 ? '@' : arrows[((Math.round(game.player.heading / (Math.PI / 2)) % 4) + 4) % 4], C.white);
    // légende : coupée par morceaux entiers (jamais au milieu d'un mot) quand la fenêtre est étroite
    const legend: [string, string][] = [[`+/- zoom (×${this.zoom})`, ''], ['flèches : déplacer', ' · '], ['Espace : recentrer', ' · '], ['M/Échap : fermer', ' · '], ['◙ capitale', ' · '], ['■ ville', ' '], ['⌂ village', ' '], ['╬ château', ' '], ['Ω souterrain', ' '], ['x bandits', ' '], ['! quête', ' ']];
    if (bosses.length) legend.push(['‡ boss', ' ']);
    if (roads.some((m) => m.glyph === '♦')) legend.push(['♦ convoi', ' ']);
    if (roads.some((m) => m.glyph === '×')) legend.push(['× épave', ' ']);
    if (game.poss.markers().length) legend.push(['♥ maison', ' '], ['h cheval', ' '], ['☻ mercenaire', ' ']);
    for (const [gl, t] of [['☼', 'raid'], ['♫', 'fête'], ['†', 'épidémie'], ['±', 'bataille']]) if (evs.some((m) => m.glyph === gl)) legend.push([`${gl} ${t}`, ' ']);
    legend.push([`F : territoires (${this.borders ? 'oui' : 'non'})`, ' · ']);
    let help = '';
    for (const [t, sep] of legend) { const next = help ? help + sep + t : t; if (next.length > w - 4) break; help = next; }
    g.text(x + 2, y + h - 2, help, C.dim);
    // légende des territoires : les factions qui tiennent des places, dans leur couleur (en bas à droite de la carte)
    if (terr) {
      const owners: number[] = [];
      for (const st0 of civ.settlements) { if (st0.abandoned || st0.type === 'camp' || st0.type === 'ruines') continue; const o = game.ownerOf(st0.id); if (o >= 0 && !owners.includes(o)) owners.push(o); }
      let lx = x + w - 2;
      for (const o of owners.sort((a, b) => b - a)) {
        const name = ` ■ ${shortFaction(civ.factions[o].name)} `;
        if (lx - name.length < x + 2) break;
        lx -= name.length;
        g.text(lx, y + h - 3, name, civ.factions[o].color, 0x0a0c0e);
      }
    }
  }

  input(ctx: UICtx): void {
    const i = ctx.input;
    if (i.key('Escape') || i.key('m')) { ctx.close(); return; }
    if (i.key('+') || i.key('=') || i.wheel < 0) this.zoom = Math.min(8, this.zoom * 2);
    if (i.key('-') || i.wheel > 0) this.zoom = Math.max(1, this.zoom / 2);
    if (i.key('f')) this.borders = !this.borders;
    const step = 400 / this.zoom;
    if (i.isDown('ArrowLeft')) this.cx -= step * 0.05; if (i.isDown('ArrowRight')) this.cx += step * 0.05;
    if (i.isDown('ArrowUp')) this.cz -= step * 0.1; if (i.isDown('ArrowDown')) this.cz += step * 0.1;
    if (i.pressed('Space')) { this.cx = this.game.player.x; this.cz = this.game.player.z; }
  }
}

// ------------------------------------------------------------------ personnage
export class StatsScreen implements Screen {
  modal = true;
  private panel: TalentPanel;
  constructor(private game: Game, private tab: 'perso' | 'talents' = 'perso') { this.panel = new TalentPanel(game); }

  private setTab(t: 'perso' | 'talents') { if (t === this.tab) return; this.tab = t; if (t === 'talents') this.panel.focus(); }

  draw(ctx: UICtx): void {
    const g = ctx.grid, ch = this.game.character;
    const talents = this.tab === 'talents';
    const { x, y, w, h } = talents ? frame(g, 'Talents', 108, 34) : frame(g, 'Personnage', 100, 32);
    if (talents) this.panel.draw(ctx, x, y, w, h); else this.drawPerso(ctx, x, y, w, h);
    // onglets (le changement prend effet à l'image suivante)
    const tp = ch.talentPoints();
    const tabs: ['perso' | 'talents', string][] = [['perso', ' Personnage (P) '], ['talents', ` Talents (K)${tp ? ` · ${tp} point${tp > 1 ? 's' : ''}` : ''} `]];
    let tx = x + 2;
    for (const [id, label] of tabs) {
      const on = this.tab === id, over = ctx.mouseCell.y === y + 1 && ctx.mouseCell.x >= tx && ctx.mouseCell.x < tx + label.length;
      const blink = id === 'talents' && tp > 0 && !on && Math.floor(performance.now() / 500) % 2 === 0;
      g.text(tx, y + 1, label, on ? 0xffffff : over ? C.white : blink ? C.yellow : C.dim, on ? C.sel : -1);
      if (over && ctx.clicked && !on) this.setTab(id);
      tx += label.length + 1;
    }
  }

  private drawPerso(ctx: UICtx, x: number, y: number, w: number, h: number): void {
    const g = ctx.grid, ch = this.game.character, p = this.game.player, rep = this.game.rep, civ = this.game.world.civ;
    g.text(x + 2, y + 2, `Niveau ${ch.level} · ${ch.xp}/${ch.xpForNext()} XP · ${ch.statPoints} point(s) à répartir`, ch.statPoints ? C.gold : C.title);
    g.text(x + 2, y + 13, 'Chaque niveau : +8 PV, +4 endurance, +3 mana, +3 % de dégâts et 1 point à répartir.', C.dim);
    const tp = ch.talentPoints();
    g.text(x + 2, y + 14, tp ? `Talents : ${tp} point${tp > 1 ? 's' : ''} à dépenser (touche K)` : `Talents : ${ch.talentSpent()} point(s) dépensé(s) · prochain point au niveau ${(Math.floor(ch.level / 3) + 1) * 3} (touche K)`, tp ? C.gold : C.dim);
    STATS.forEach((s, i) => {
      const yy = y + 4 + i;
      g.text(x + 3, yy, `${i + 1}. ${STAT_NAMES[s].padEnd(14)} ${String(ch.stats[s]).padStart(2)}`, C.text);
      g.text(x + 30, yy, STAT_DESC[s].slice(0, Math.floor(w / 2) - 30), C.dim);
      if (ch.statPoints > 0) {
        const over = ctx.mouseCell.y === yy && ctx.mouseCell.x >= x + 26 && ctx.mouseCell.x <= x + 28;
        g.text(x + 26, yy, '[+]', over ? 0xffffff : C.green, over ? C.sel : -1);
        if (over && ctx.clicked) this.raise(i);
      }
    });
    g.text(x + 3, y + 11, `PV ${Math.ceil(p.hp)}/${p.maxHp} · END ${Math.round(p.maxStamina)} · MANA ${Math.round(p.maxMana)} · Armure ${ch.armor}`, C.text);
    g.text(x + 3, y + 12, `Dégâts ×${frNum(ch.meleeMult(), 2)} · Arc ×${frNum(ch.bowMult(), 2)} · Sorts ×${frNum(ch.spellMult(), 2)} · Charge ${ch.carryMax()}`, C.text);
    const sx = x + Math.floor(w / 2) + 2;
    g.text(sx, y + 4 - 1, 'Compétences (progressent à l\'usage)', C.title);
    SKILLS.forEach((s, i) => {
      g.text(sx, y + 4 + i, `${SKILL_NAMES[s].padEnd(15)} ${String(ch.skills[s]).padStart(3)}`, C.text);
      g.bar(sx + 21, y + 4 + i, 10, ch.skillXp[s] / (10 + ch.skills[s] * 1.5), C.gold);
    });
    g.text(x + 2, y + 15, 'Réputation', C.title);
    g.text(x + 3, y + 16, `Renommée ${Math.round(rep.global)}`, C.text);
    civ.factions.forEach((f, i) => g.text(x + 3 + (i % 2) * Math.floor(w / 2), y + 17 + Math.floor(i / 2), `${f.name.slice(0, 32).padEnd(33)} ${Math.round(rep.faction[f.id]).toString().padStart(4)}`, rep.faction[f.id] < -10 ? C.red : rep.faction[f.id] > 10 ? C.green : C.text));
    g.text(x + 2, y + h - 2, '1-6 ou clic : augmenter une caractéristique · K : talents · P/Échap : fermer', C.dim);
  }
  private raise(i: number) { const ch = this.game.character; if (ch.statPoints <= 0) return; ch.stats[STATS[i]]++; ch.statPoints--; this.game.syncStats(); }

  input(ctx: UICtx): void {
    const i = ctx.input;
    if (this.tab === 'talents') {
      if (this.panel.input(ctx)) return; // le panneau garde Échap tant qu'une confirmation est en attente
      if (i.key('Escape') || i.key('k')) { ctx.close(); return; }
      if (i.key('p')) this.setTab('perso');
      return;
    }
    if (i.key('Escape') || i.key('p')) { ctx.close(); return; }
    if (i.key('k')) { this.setTab('talents'); return; }
    for (let k = 0; k < 6; k++) if (i.pressed('Digit' + (k + 1))) this.raise(k);
  }
}

// ------------------------------------------------------------------ pause et options
export interface Options { cellSize: number; detail: number; sensitivity: number; fov: number; volume: number; music: number; timeScale: number; palette: number; torchShadows: boolean }
export const PALETTES = ['couleurs', 'ambre', 'vert terminal'];
const DETAILS: [number, string][] = [[1, 'normale'], [0.75, 'fine'], [0.6, 'très fine']];

export class PauseScreen implements Screen {
  modal = true;
  private options = false;
  constructor(private game: Game, private opts: Options, private actions: { save(): void; load(): void; quit(): void; applyOptions(): void }) {}
  draw(ctx: UICtx): void {
    const g = ctx.grid;
    const { x, y, w } = frame(g, this.options ? 'Options' : 'Pause', 60, 16);
    g.text(x + 2, y + 1, `World: ${this.game.seed.text} · Generator: ${GENERATOR_VERSION}`.slice(0, w - 4), C.dim);
    const labels = this.options
      ? [`Taille de l'interface : ${this.opts.cellSize} px`, `Finesse du monde : ${(DETAILS.find((d) => d[0] === this.opts.detail) ?? DETAILS[1])[1]}`, `Sensibilité souris : ${this.opts.sensitivity.toFixed(1)}`, `Champ de vision : ${this.opts.fov}°`, `Volume : ${Math.round(this.opts.volume * 100)} %`, `Musique : ${Math.round(this.opts.music * 100)} %`, `Vitesse du temps : ×${this.opts.timeScale}`, `Palette : ${PALETTES[this.opts.palette ?? 0]}`, `Ombres des torches : ${this.opts.torchShadows === false ? 'non' : 'oui'}`, 'Retour']
      : ['Reprendre', 'Sauvegarder', 'Charger la dernière sauvegarde', 'Options', 'Quitter vers le titre'];
    const k = optionList(ctx, x + 3, y + 3, w - 6, labels, C.text, C.sel);
    if (k >= 0) this.choose(k, ctx);
  }
  private choose(k: number, ctx: UICtx) {
    const o = this.opts;
    if (this.options) {
      if (k === 0) o.cellSize = o.cellSize >= 22 ? 10 : o.cellSize + 2;
      if (k === 1) { const i = DETAILS.findIndex((d) => d[0] === o.detail); o.detail = DETAILS[(i + 1) % DETAILS.length][0]; }
      if (k === 2) o.sensitivity = o.sensitivity >= 3 ? 0.4 : +(o.sensitivity + 0.2).toFixed(1);
      if (k === 3) o.fov = o.fov >= 90 ? 55 : o.fov + 5;
      if (k === 4) o.volume = o.volume >= 1 ? 0 : +(o.volume + 0.25).toFixed(2);
      if (k === 5) o.music = o.music >= 1 ? 0 : +(o.music + 0.2).toFixed(2);
      if (k === 6) o.timeScale = o.timeScale >= 8 ? 1 : o.timeScale * 2;
      if (k === 7) o.palette = ((o.palette ?? 0) + 1) % PALETTES.length;
      if (k === 8) o.torchShadows = o.torchShadows === false;
      if (k === 9) this.options = false;
      this.actions.applyOptions();
      return;
    }
    if (k === 0) ctx.close();
    if (k === 1) { this.actions.save(); ctx.close(); }
    if (k === 2) { this.actions.load(); ctx.close(); }
    if (k === 3) this.options = true;
    if (k === 4) this.actions.quit();
  }
  input(ctx: UICtx): void { if (ctx.input.key('Escape')) { if (this.options) this.options = false; else ctx.close(); } }
}
