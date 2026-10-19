import { C, TextGrid } from '@ascii-fort/ascii-engine/TextGrid';
import type { Screen, UICtx } from './UI';
import type { EventBus } from '@ascii-fort/core/Events';
import type { Bounty } from '@ascii-fort/sim/gameplay/Bounties';
import type { Feedback } from './CraftingScreen';
import { de } from '@ascii-fort/worldgen/civilization/Names';

// Tableau des primes : à gauche les avis du jour puis les primes acceptées, à droite le détail (danger, récompense, lieu,
// distance et direction, état) et les actions (accepter, réclamer, abandonner). Le HUD est masqué sous l'écran : le
// compte rendu de la dernière action s'affiche en bas.

/** Ligne de la liste : un avis du jour, ou une prime acceptée (état, objectif, réclamable à ce tableau). */
export interface BountyRow { b: Bounty; mine: boolean; st?: 'en cours' | 'remplie' | 'caduque'; goal?: string; here?: boolean }

export interface BountyHost {
  title: string; day: number; max: number; events: EventBus;
  rows(): BountyRow[];
  active(): number;
  level(): number;
  /** distance et direction de la cible, vues du tableau */
  where(b: Bounty): string;
  /** faction qui paie la réputation ; implantation où la prime se réclame */
  faction(b: Bounty): string;
  claimAt(b: Bounty): string;
  accept(b: Bounty): Feedback;
  claim(id: string): Feedback;
  abandon(id: string): Feedback;
  /** null : reste ouvert ; '' : fermeture silencieuse ; texte : message puis fermeture */
  closeReason(): string | null;
}

/** ♦ à ♦♦♦♦ selon le niveau de danger. */
const pips = (d: number) => '♦'.repeat(Math.max(1, Math.min(4, 1 + Math.floor((d - 1) / 3))));
const wrapTo = (s: string, w: number) => TextGrid.wrap(s, Math.max(1, w)).map((l) => l.slice(0, Math.max(1, w)));

export class BountyScreen implements Screen {
  modal = true;
  private sel = 0;
  private lastClick = { t: 0, row: -1 };
  private log: Feedback = { text: '', color: C.dim };
  constructor(private h: BountyHost) {}

  private dangerColor(d: number): number { const lv = this.h.level(); return d >= lv + 3 ? C.red : d >= lv ? C.orange : C.green; }

  /** Action principale de la ligne : accepter un avis, réclamer une prime remplie. */
  private act(): void {
    const r = this.h.rows()[this.sel];
    if (!r) return;
    if (!r.mine) this.log = this.h.accept(r.b);
    else if (r.st === 'remplie') this.log = this.h.claim(r.b.id);
    else this.log = { text: r.st === 'caduque' ? 'Objectif disparu : abandonnez cette prime (X).' : 'L’objectif n’est pas encore rempli.', color: C.orange };
    this.clamp();
  }
  private drop(): void {
    const r = this.h.rows()[this.sel];
    if (r?.mine) { this.log = this.h.abandon(r.b.id); this.clamp(); }
  }
  private clamp(): void { this.sel = Math.max(0, Math.min(this.sel, this.h.rows().length - 1)); }

  draw(ctx: UICtx): void {
    const g = ctx.grid, m = ctx.mouseCell, h = this.h;
    const w = Math.min(g.cols - 2, 104), H = Math.min(g.rows - 2, 30);
    const x = Math.floor((g.cols - w) / 2), y = Math.floor((g.rows - H) / 2);
    g.box(x, y, w, H, { title: h.title.slice(0, w - 6), double: true, alpha: 0.96 });
    const n = h.active(), act = `Vos primes : ${n}/${h.max}`;
    g.text(x + 2, y + 1, `Jour ${h.day} · les avis changent chaque matin`.slice(0, w - act.length - 6), C.dim);
    g.text(x + w - act.length - 2, y + 1, act, n >= h.max ? C.orange : C.gold);
    const rows = h.rows();
    this.sel = Math.max(0, Math.min(this.sel, rows.length - 1));
    const lw = Math.floor(w * 0.46), lx = x + 2, dx = x + lw + 3, dw = w - lw - 5, bottom = y + H - 5;
    for (let i = y + 3; i <= bottom; i++) g.text(x + lw + 1, i, '│', C.border);
    g.text(x + 1, bottom + 1, '─'.repeat(w - 2), C.border);
    // liste : deux sections ; seules les lignes de primes se choisissent
    const offers = rows.filter((r) => !r.mine), mine = rows.filter((r) => r.mine);
    let yy = y + 3;
    const section = (title: string, list: BountyRow[], base: number, empty: string) => {
      if (yy > bottom) return;
      g.text(lx, yy++, title, C.title);
      if (!list.length && yy <= bottom) g.text(lx + 2, yy++, empty.slice(0, lw - 3), C.dim);
      list.forEach((r, k) => {
        if (yy > bottom) return;
        const i = base + k, active = i === this.sel, over = m.y === yy && m.x >= lx && m.x < lx + lw - 1;
        const mark = !r.mine ? ' ' : r.st === 'remplie' ? '√' : r.st === 'caduque' ? 'x' : '►';
        const right = `${r.b.reward.gold} or`, name = `${mark} ${r.b.title}`;
        const text = (name.length > lw - right.length - 3 ? name.slice(0, lw - right.length - 4) + '…' : name).padEnd(lw - right.length - 2) + right;
        const col = r.mine ? (r.st === 'remplie' ? C.green : r.st === 'caduque' ? C.faint : C.text) : C.text;
        g.text(lx, yy, text, active ? 0xffffff : col, active ? C.sel : over ? C.panel2 : -1);
        if (over && ctx.clicked) {
          const now = performance.now(), dbl = now - this.lastClick.t < 400 && this.lastClick.row === i;
          this.sel = i; this.lastClick = { t: now, row: i };
          if (dbl) this.act();
        }
        yy++;
      });
      yy++;
    };
    section('Avis du jour', offers, 0, '(plus aucun avis aujourd’hui : revenez demain)');
    section('Vos primes', mine, offers.length, '(aucune prime acceptée)');

    // détail de la ligne choisie
    const r = rows[this.sel];
    let dy = y + 3;
    const line = (s: string, c: number, indent = '') => { for (const t of wrapTo(s, dw - indent.length)) { if (dy <= bottom - 2) g.text(dx, dy, indent + t, c); dy++; } };
    const btn = (bx: number, by: number, label: string, on: boolean, fn: () => void) => {
      const over = m.y === by && m.x >= bx && m.x < bx + label.length;
      g.text(bx, by, label, !on ? C.faint : over ? 0xffffff : C.yellow, over && on ? C.sel : -1);
      if (over && on && ctx.clicked) fn();
      return bx + label.length + 2;
    };
    if (r) {
      const b = r.b;
      line(b.title, C.title);
      dy++;
      if (dy <= bottom - 2) { g.text(dx, dy, 'Danger : ', C.text); g.text(dx + 9, dy, `${pips(b.danger)} niveau ${b.danger}`, this.dangerColor(b.danger)); }
      dy++;
      const fac = h.faction(b);
      line(`Récompense : ${b.reward.gold} or · ${b.reward.xp} XP · +${b.reward.rep} réputation${fac ? ` (${fac})` : ''}`, C.gold);
      line(`Lieu : ${b.place}${b.kind === 'peaux' ? '' : ' · ' + h.where(b)}`, C.cyan);
      dy++;
      line(b.text, C.text);
      dy++;
      if (r.mine) {
        if (r.goal) line(r.goal, r.st === 'remplie' ? C.green : C.white, '► ');
        line(r.st === 'remplie' ? (r.here ? 'Objectif rempli : réclamez la prime ici.' : `Objectif rempli : la prime se réclame au tableau ${de(h.claimAt(b))}.`)
          : r.st === 'caduque' ? 'Objectif disparu (quelqu’un d’autre s’en est chargé) : abandonnez la prime.'
          : `En cours · à réclamer au tableau ${de(h.claimAt(b))}.`, r.st === 'remplie' ? C.green : r.st === 'caduque' ? C.orange : C.dim);
      } else if (n >= h.max) line(`Vous avez déjà ${h.max} primes en cours : réclamez-en ou abandonnez-en une.`, C.orange);
      // actions, toujours visibles en bas de la colonne
      const by = bottom;
      if (!r.mine) btn(dx, by, '[ Accepter ]', n < h.max, () => this.act());
      else {
        const nx = btn(dx, by, '[ Réclamer ]', r.st === 'remplie' && !!r.here, () => this.act());
        btn(nx, by, '[ Abandonner (X) ]', true, () => this.drop());
      }
    } else line('Aucun avis.', C.dim);

    // compte rendu et touches
    const fy = bottom + 2;
    wrapTo(this.log.text, w - 4).slice(0, 2).forEach((s, k) => g.text(x + 2, fy + k, s, this.log.color));
    g.text(x + 2, y + H - 2, '↑↓ choisir · Entrée ou double-clic : accepter / réclamer · X : abandonner · Échap : fermer'.slice(0, w - 4), C.dim);
  }

  input(ctx: UICtx): void {
    const i = ctx.input, why = this.h.closeReason();
    if (why !== null) { ctx.close(); if (why) this.h.events.emit('message', { text: why, color: C.orange }); return; }
    if (i.key('Escape') || i.key('Tab') || i.key('e')) { ctx.close(); return; }
    const n = this.h.rows().length;
    if (i.pressed('ArrowUp')) this.sel = Math.max(0, this.sel - 1);
    if (i.pressed('ArrowDown')) this.sel = Math.min(n - 1, this.sel + 1);
    if (i.pressed('Enter') || i.pressed('NumpadEnter')) this.act();
    if (i.key('x')) this.drop();
  }
}
