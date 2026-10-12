import { C, TextGrid } from '@ascii-fort/ascii-engine/TextGrid';
import type { Screen, UICtx } from './UI';
import type { Character } from '@ascii-fort/sim/gameplay/Character';
import type { EventBus } from '@ascii-fort/core/Events';
import { item, baseId, durOf, wearFactor, wearState } from '@ascii-fort/sim/gameplay/Items';
import { recipesFor, maxBatch, outQty, qualityChance, have, repairNeed, SOURCES, TAB_HELP, type CraftTab, type Recipe } from '@ascii-fort/sim/gameplay/Crafting';
import { itemStats, compareWithEquipped, qtyStep } from './DialogueScreen';

// Artisanat : un atelier liste ses recettes (ce qu'on a, ce qui manque, où le trouver) ; on fabrique à
// l'unité ou en lot, et l'enclume répare l'équipement usé. Le HUD est masqué sous l'écran : le compte
// rendu de la dernière action s'affiche dans l'écran.

/** Compte rendu d'une fabrication ou d'une réparation. */
export interface Feedback { text: string; color: number }
export interface CraftingHost {
  character: Character; events: EventBus;
  /** fabrique n fois la recette : consomme, produit, pratique, son, fil de butin, message */
  craft(r: Recipe, n: number): Feedback;
  /** répare à l'enclume ces exemplaires (un id par exemplaire) */
  repair(ids: string[]): Feedback;
  /** raison de fermer (mort, éloigné, attaqué) : null = rester ouvert, '' = fermer sans message */
  closeReason(): string | null;
}
type Row = { k: 'recette'; r: Recipe; max: number } | { k: 'réparer'; id: string; qty: number; on: boolean };

/** nombre lisible à la française (0,5) */
const num = (v: number) => String(v).replace('.', ',');
/** texte enveloppé à la largeur, aux espaces (un mot plus long que la largeur est coupé en dernier recours) */
const wrapTo = (s: string, width: number) => TextGrid.wrap(s, Math.max(1, width)).map((l) => l.slice(0, Math.max(1, width)));
/** texte raccourci avec « … » : un nom perd sa fin, jamais le suffixe qu'on lui accole */
const fit = (s: string, width: number) => (s.length <= width ? s : s.slice(0, Math.max(0, width - 1)) + '…');
/** morceaux répartis sur des lignes de largeur max, séparés par « · » ; un morceau n'est jamais coupé */
function pack(parts: string[], width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const p of parts) {
    if (!line) line = p;
    else if (line.length + 3 + p.length <= width) line += ' · ' + p;
    else { out.push(line); line = p; }
  }
  if (line) out.push(line);
  return out;
}

export class CraftingScreen implements Screen {
  modal = true;
  private tab = 0;
  private sel = 0;
  private qty = 1;
  private lastClick = { t: 0, row: -1 };
  private log: Feedback = { text: '', color: C.dim };

  constructor(private title: string, private tabs: CraftTab[], private h: CraftingHost) {
    const ch = h.character, skill = ch.skills.artisanat, rep = tabs.indexOf('Réparer');
    if (rep >= 0 && ch.worn().some((w) => w.slot && durOf(w.id) < 50)) this.tab = rep;
    else {
      const k = tabs.findIndex((t) => t !== 'Réparer' && recipesFor(t).some((r) => maxBatch(ch.inv, r, skill) > 0));
      this.tab = k >= 0 ? k : 0;
    }
    this.firstRow();
  }

  private get cur(): CraftTab { return this.tabs[this.tab]; }

  private rows(): Row[] {
    const ch = this.h.character, skill = ch.skills.artisanat;
    if (this.cur === 'Réparer') return ch.worn().map((w) => ({ k: 'réparer' as const, id: w.id, qty: w.qty, on: !!w.slot }));
    return recipesFor(this.cur).map((r) => ({ k: 'recette' as const, r, max: maxBatch(ch.inv, r, skill) }));
  }

  /** première ligne utile : une pièce à réparer ou une recette faisable */
  private firstRow() {
    const rows = this.rows(), i = rows.findIndex((r) => r.k === 'réparer' || r.max > 0);
    this.sel = i >= 0 ? i : 0;
    this.resetQty(rows[this.sel]);
  }
  /** fonte, grillades, tannage : tout d'un coup par défaut */
  private resetQty(row?: Row) { this.qty = row?.k === 'recette' && row.r.bulk ? Math.max(1, row.max) : 1; }
  private setTab(i: number) { const n = this.tabs.length; this.tab = ((i % n) + n) % n; this.firstRow(); }
  private select(i: number) {
    const rows = this.rows();
    i = Math.max(0, Math.min(i, rows.length - 1));
    if (i !== this.sel) { this.sel = i; this.resetQty(rows[i]); }
  }

  private act(all: boolean) {
    const row = this.rows()[this.sel];
    if (!row) return;
    if (row.k === 'recette') this.log = this.h.craft(row.r, all ? Math.max(1, row.max) : this.qty);
    else this.log = this.h.repair(all ? this.rows().flatMap((r) => (r.k === 'réparer' ? Array.from({ length: r.qty }, () => r.id) : [])) : [row.id]);
    const rows = this.rows();
    this.sel = Math.max(0, Math.min(this.sel, rows.length - 1));
    const nr = rows[this.sel];
    this.qty = Math.max(1, Math.min(this.qty, nr?.k === 'recette' ? Math.max(1, nr.max) : 1));
  }

  draw(ctx: UICtx): void {
    const g = ctx.grid, ch = this.h.character, skill = ch.skills.artisanat, m = ctx.mouseCell;
    const w = Math.min(g.cols - 2, 104), h = Math.min(g.rows - 2, 32);
    const x = Math.floor((g.cols - w) / 2), y = Math.floor((g.rows - h) / 2);
    g.box(x, y, w, h, { title: this.title, double: true, alpha: 0.96 });
    // onglets et compétence
    let tx = x + 2;
    this.tabs.forEach((t, i) => {
      const label = ` ${i + 1}.${t} `, over = m.y === y + 1 && m.x >= tx && m.x < tx + label.length;
      g.text(tx, y + 1, label, i === this.tab ? 0xffffff : over ? C.white : C.dim, i === this.tab ? C.sel : -1);
      if (over && ctx.clicked && i !== this.tab) this.setTab(i);
      tx += label.length + 1;
    });
    g.text(x + w - 27, y + 1, `Artisanat ${skill}`, C.gold);
    g.bar(x + w - 13, y + 1, 10, ch.skillXp.artisanat / (10 + skill * 1.5), C.gold);

    const rows = this.rows(), repair = this.cur === 'Réparer';
    // rappel des touches : réparti sur deux lignes au besoin (« Échap : fermer » ne disparaît jamais) ; il réserve le bas de l'écran
    const nt = this.tabs.length;
    const keys = pack((repair
      ? [nt > 1 ? `←→/1-${nt} onglet` : '', '↑↓ choisir', 'Entrée : réparer', 'R ou Maj+Entrée : tout réparer', 'Échap : fermer']
      : [nt > 1 ? `←→/1-${nt} onglet` : '', '↑↓ choisir', '+/- quantité (PgPréc/PgSuiv ×10)', 'Entrée : fabriquer (Maj : le maximum)', 'Échap : fermer']).filter(Boolean), w - 4).slice(0, 2);
    const bottom = y + h - 5 - keys.length;       // dernière ligne des deux colonnes ; le filet est juste dessous
    const lw = Math.floor(w * 0.44), view = bottom - y - 4, lx = x + 2;
    g.text(lx, y + 3, repair ? 'Objet abîmé'.padEnd(lw - 8) + 'État' : 'Recette'.padEnd(lw - 10) + 'Possible', C.dim);
    for (let i = y + 3; i <= bottom; i++) g.text(x + lw + 1, i, '│', C.border);
    g.text(x + 1, bottom + 1, '─'.repeat(w - 2), C.border);
    if (!rows.length) wrapTo(repair ? '(tout votre équipement est en bon état)' : '(aucune recette)', lw - 1).forEach((s, k) => g.text(lx, y + 4 + k, s, C.dim));
    const start = Math.max(0, Math.min(this.sel - Math.floor(view / 2), rows.length - view));
    rows.slice(start, start + view).forEach((row, k) => {
      const i = start + k, yy = y + 4 + k;
      const over = m.y === yy && m.x >= lx && m.x < lx + lw - 1, active = i === this.sel;
      let text: string, col: number, right: string, rcol = -1;
      if (row.k === 'recette') {
        const r = row.r, per = outQty(r, skill), lacks = skill < r.skill;
        // libellé coupé avant le suffixe de quantité produite, pour ne jamais perdre « ×2 »
        const suf = per > 1 ? ' ×' + per : '';
        text = `${row.max > 0 ? '√' : lacks ? ' ' : '·'} ${fit(r.label ?? item(r.out).name, lw - 12 - suf.length)}${suf}`;
        right = lacks ? `art. ${r.skill}` : row.max > 0 ? `×${row.max}` : '-';
        col = row.max > 0 ? C.text : lacks ? C.faint : C.dim;
        if (lacks) rcol = C.orange;
        text = text.slice(0, lw - 10).padEnd(lw - 9) + right.padStart(7);
      } else {
        const d = durOf(row.id), fill = Math.ceil(d / 20);
        right = '▓'.repeat(fill) + '░'.repeat(5 - fill) + (d > 0 ? ` ${String(d).padStart(2)} %` : '   HS');
        // le nom est raccourci avant le suffixe « ×n » (jamais l'inverse)
        const suf = row.qty > 1 ? ' ×' + row.qty : '';
        text = `${row.on ? '■' : ' '} ${fit(item(baseId(row.id)).name, lw - 15 - suf.length)}${suf}`.padEnd(lw - 12) + right;
        col = d <= 0 ? C.red : d < 25 ? C.orange : C.text;
      }
      g.text(lx, yy, text, active ? 0xffffff : col, active ? C.sel : over ? C.panel2 : -1);
      if (rcol >= 0 && !active) g.text(lx + text.length - right.length, yy, right, rcol, over ? C.panel2 : -1);
      if (over && ctx.clicked) {
        const now = performance.now(), dbl = now - this.lastClick.t < 400 && this.lastClick.row === i;
        this.select(i);
        this.lastClick = { t: now, row: i };
        if (dbl) this.act(false);
      }
    });

    // détail de la ligne choisie
    const row = this.rows()[this.sel];
    const dx = x + lw + 3, dw = w - lw - 5;
    // limit : dernière ligne du détail ; la quantité et le bouton restent à part, collés en bas quand la colonne est pleine
    let yy = y + 3, limit = bottom;
    /** ligne de détail, enveloppée aux espaces sur la largeur de la colonne (`first` : retrait de la 1re ligne, `rest` : des suivantes) */
    const line = (s: string, c: number, first = '', rest = first) => {
      wrapTo(s, dw - first.length).forEach((t, k) => { if (yy <= limit) g.text(dx, yy, (k ? rest : first) + t, c); yy++; });
    };
    /** ligne d'ingrédient : √/x à gauche, possédé ou manque à droite, puis où le trouver */
    const ingredient = (label: string, need: number, got: number, src?: string) => {
      const ok = got >= need, r = ok ? `vous : ${got}` : `manque ${need - got}`;
      wrapTo(`${ok ? '√' : 'x'} ${label} ×${need}`, dw - r.length - 3).forEach((s, k) => {
        if (yy <= limit) { g.text(dx, yy, (k ? '  ' : '') + s, ok ? C.green : C.red); if (!k) g.text(dx + dw - r.length, yy, r, ok ? C.dim : C.red); }
        yy++;
      });
      if (!ok && src) line(src, C.dim, '    où : ', '         ');
    };
    const btn = (bx: number, label: string, on: boolean, fn: () => void) => {
      if (yy > bottom) return bx + label.length + 1;
      const over = m.y === yy && m.x >= bx && m.x < bx + label.length;
      g.text(bx, yy, label, !on ? C.faint : over ? 0xffffff : C.yellow, over && on ? C.sel : -1);
      if (over && on && ctx.clicked) fn();
      return bx + label.length + 1;
    };
    if (row?.k === 'recette') {
      const r = row.r, d = item(r.out), per = outQty(r, skill), max = row.max;
      this.qty = Math.max(1, Math.min(this.qty, Math.max(1, max)));
      limit = bottom - 3;                          // quantité, bouton et message d'état sont réservés en bas
      line(`${d.name}${per > 1 ? ' ×' + per : ''}`, C.title);
      for (const s of itemStats(d).slice(0, 2)) if (yy <= limit) line(s, C.text);
      const cmp = compareWithEquipped(ch, d);
      if (cmp.length && yy <= limit) {
        let cx = dx;
        for (const [l, v] of cmp) {
          if (cx > dx && cx + l.length > dx + dw) { yy++; cx = dx; }
          if (yy <= limit) g.text(cx, yy, l, v > 0 ? C.green : v < 0 ? C.red : C.dim);
          cx += l.length + 3;
        }
        yy++;
      }
      if (d.desc && yy <= limit) line(d.desc, C.dim);
      yy++;
      const made = this.qty * per;
      line(`Il faut (pour ${made}) :`, C.title);
      for (const ing of r.ins) ingredient(ing.label ?? item(ing.ids[0]).name, ing.qty * this.qty, have(ch.inv, ing), SOURCES[ing.ids[0]]);
      if (skill < r.skill) line(`Artisanat requis : ${r.skill} (vous : ${skill})`, C.red);
      else if (r.skill > 0) line(`Artisanat requis : ${r.skill}`, C.dim);
      if (r.quality) line(`Qualité : ${Math.round(qualityChance(r, skill) * 100)} % de chance (meilleure, plus solide)`, C.cyan);
      line(`Pratique : +${num(r.xp)} par fabrication`, C.dim);
      yy = Math.min(yy + 1, bottom - 2); limit = bottom;
      let bx = dx;
      if (yy <= bottom) g.text(bx, yy, 'Quantité :', C.text);
      bx += 11;
      bx = btn(bx, '[-]', this.qty > 1, () => { this.qty--; });
      if (yy <= bottom) g.text(bx, yy, String(this.qty).padStart(3), C.white);
      bx += 4;
      bx = btn(bx, '[+]', this.qty < max, () => { this.qty++; });
      btn(bx, '[max]', max > 1, () => { this.qty = max; });
      yy++;
      btn(dx, `[ ${r.verb} ${made} × ${fit(d.name, 22)} ]`, max > 0, () => this.act(false));
      yy++;
      if (max <= 0) line(skill < r.skill ? 'Compétence insuffisante.' : 'Ingrédients insuffisants.', C.red);
    } else if (row?.k === 'réparer') {
      const d = durOf(row.id), def = item(row.id), need = repairNeed(row.id);
      limit = bottom - 1;                          // les boutons restent visibles en bas
      line(`${item(baseId(row.id)).name}${row.on ? ' · sur vous' : ''}`, C.title);
      // jauge à gauche, état à droite ; l'efficacité passe à la ligne suivante plutôt que d'être coupée
      const etat = [`${d} % · ${wearState(d)}`, ...(d > 0 && d < 50 ? [`(efficacité ${Math.round(wearFactor(d) * 100)} %)`] : [])];
      etat.flatMap((t) => wrapTo(t, dw - 16)).forEach((s, k) => {
        if (yy <= limit) {
          if (!k) { g.text(dx, yy, 'État ', C.text); g.bar(dx + 5, yy, 10, d / 100, d < 25 ? C.red : d < 50 ? C.orange : C.green); }
          g.text(dx + 16, yy, s, C.text);
        }
        yy++;
      });
      const st = itemStats(def)[0];
      if (st) line(st, C.text);
      yy++;
      line('Réparer jusqu’à 100 % :', C.title);
      if (need) {
        ingredient(item(need.mat).name, need.n, ch.inv.count(need.mat), SOURCES[need.mat]);
        if (skill < need.skill) line(`Pièce rare : artisanat ${need.skill} requis (ou un forgeron).`, C.orange);
      }
      const sum = new Map<string, number>();
      for (const r of rows) if (r.k === 'réparer') { const n = repairNeed(r.id); if (n) sum.set(n.mat, (sum.get(n.mat) ?? 0) + n.n * r.qty); }
      if (sum.size) line(`Tout réparer : ${[...sum].map(([id, n]) => `${n} × ${item(id).name}`).join(', ')}`, C.dim);
      yy = Math.min(yy + 1, bottom);
      const bx = btn(dx, '[ Réparer ]', true, () => this.act(false));
      btn(bx + 1, '[ Tout réparer (R) ]', true, () => this.act(true));
    }

    // compte rendu, aide, touches
    // (un compte rendu long passe à la ligne en prenant la place de l'aide de l'onglet)
    const fy = bottom + 2, report = wrapTo(this.log.text, w - 4).slice(0, 2);
    g.text(x + 2, fy, report[0], this.log.color);
    if (report[1]) g.text(x + 2, fy + 1, report[1], this.log.color);
    else g.text(x + 2, fy + 1, wrapTo(TAB_HELP[this.cur], w - 4)[0], C.dim);
    keys.forEach((s, k) => g.text(x + 2, fy + 2 + k, s, C.dim));
  }

  input(ctx: UICtx): void {
    const i = ctx.input;
    const why = this.h.closeReason();
    if (why !== null) { ctx.close(); if (why) this.h.events.emit('message', { text: why, color: C.orange }); return; }
    if (i.key('Escape') || i.key('Tab') || i.key('e')) { ctx.close(); return; }
    if (i.pressed('ArrowLeft')) this.setTab(this.tab - 1);
    if (i.pressed('ArrowRight')) this.setTab(this.tab + 1);
    for (let k = 1; k <= this.tabs.length; k++) if (k - 1 !== this.tab && (i.pressed('Digit' + k) || i.pressed('Numpad' + k))) this.setTab(k - 1);
    if (i.pressed('ArrowUp')) this.select(this.sel - 1);
    if (i.pressed('ArrowDown')) this.select(this.sel + 1);
    const shift = i.isDown('ShiftLeft') || i.isDown('ShiftRight');
    const row = this.rows()[this.sel];
    // +/- : ±1 ; PgPréc/PgSuiv, Maj + pavé numérique : ±10
    const step = row?.k === 'recette' ? qtyStep(i) : 0;
    if (row?.k === 'recette' && step) this.qty = Math.max(1, Math.min(Math.max(1, row.max), this.qty + step));
    if (i.pressed('Enter') || i.pressed('NumpadEnter')) this.act(shift);
    else if (this.cur === 'Réparer' && i.key('r')) this.act(true);
  }
}
