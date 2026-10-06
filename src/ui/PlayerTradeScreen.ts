import { C } from '@ascii-fort/ascii-engine/TextGrid';
import { item } from '@ascii-fort/sim/gameplay/Items';
import type { Screen, UICtx } from './UI';
import type { Coop, TradeSession } from '../net/Coop';

// Échanges entre joueurs (multijoueur) : proposition, puis écran à deux colonnes — votre offre
// (objets et or), celle de l'autre joueur. L'échange se fait quand les deux ont validé les mêmes offres.

/** Proposition d'échange reçue : Entrée accepte, Échap refuse. */
export class TradeAskScreen implements Screen {
  modal = true;
  private done = false;
  constructor(private name: string, private answer: (ok: boolean) => void) {}
  draw(ctx: UICtx): void {
    const g = ctx.grid, w = Math.min(g.cols - 4, 56), x = Math.floor((g.cols - w) / 2), y = Math.floor(g.rows * 0.3);
    g.box(x, y, w, 6, { title: 'Échange', double: true, alpha: 0.95 });
    g.text(x + 3, y + 2, `${this.name} vous propose un échange.`.slice(0, w - 6), C.white);
    g.text(x + 3, y + 4, '[Entrée] accepter · [Échap] refuser', C.yellow);
  }
  input(ctx: UICtx): void {
    if (this.done) return;
    if (ctx.input.key('Enter')) { this.done = true; ctx.close(); this.answer(true); }
    else if (ctx.input.key('Escape')) { this.done = true; ctx.close(); this.answer(false); }
  }
}

/** Écran d'échange : ↑/↓ choisir, →/+ proposer davantage, ←/- retirer, Entrée valider, Échap annuler. */
export class PlayerTradeScreen implements Screen {
  modal = true;
  private sel = 0;
  constructor(private coop: Coop, private session: TradeSession) {}

  private rows(): { id: string; name: string; have: number }[] {
    const ch = this.coop.game.character, out = [{ id: 'or', name: 'Pièces d’or', have: ch.inv.gold }];
    for (const [id, n] of ch.inv.items) {
      const d = item(id);
      if (d.cat === 'quête' || d.cat === 'clé') continue;
      const free = n - (ch.isEquipped(id) ? 1 : 0);
      if (free > 0) out.push({ id, name: d.name, have: free });
    }
    return out;
  }

  draw(ctx: UICtx): void {
    const s = this.session, g = ctx.grid;
    const w = Math.min(g.cols - 2, 100), h = Math.min(g.rows - 2, 28), x = Math.floor((g.cols - w) / 2), y = Math.floor((g.rows - h) / 2);
    g.box(x, y, w, h, { title: `Échange avec ${s.name}`, double: true, alpha: 0.96 });
    const half = Math.floor(w / 2);
    g.text(x + 2, y + 1, 'Votre offre', C.title);
    g.text(x + half + 1, y + 1, `Offre de ${s.name}`.slice(0, half - 3), C.title);
    const rows = this.rows();
    this.sel = Math.min(this.sel, rows.length - 1);
    const top = Math.max(0, this.sel - (h - 9));
    rows.slice(top, top + h - 7).forEach((r, i) => {
      const k = top + i, offered = r.id === 'or' ? s.mine.gold : s.mine.items.get(r.id) ?? 0, on = k === this.sel;
      const line = `${r.name.slice(0, half - 16).padEnd(half - 15)}${String(offered).padStart(4)}/${r.have}`;
      g.text(x + 2, y + 3 + i, line, offered ? C.white : C.dim, on ? C.sel : -1);
      if (ctx.clicked && ctx.mouseCell.y === y + 3 + i && ctx.mouseCell.x < x + half) this.sel = k;
    });
    const theirs: string[] = [];
    if (s.theirs.gold) theirs.push(`${s.theirs.gold} pièces d’or`);
    for (const [id, n] of s.theirs.items) theirs.push(`${item(id).name}${n > 1 ? ' ×' + n : ''}`);
    if (!theirs.length) theirs.push('(rien pour l’instant)');
    theirs.slice(0, h - 7).forEach((t, i) => g.text(x + half + 1, y + 3 + i, t.slice(0, half - 3), s.theirs.items.length || s.theirs.gold ? C.white : C.dim));
    for (let i = 1; i < h - 3; i++) g.text(x + half - 1, y + i, '│', C.border);
    const st = this.coop.tradeStatus();
    g.text(x + 2, y + h - 3, st.slice(0, w - 4), st.includes('valid') ? C.green : C.dim);
    g.text(x + 2, y + h - 2, '↑↓ choisir · → ou + proposer · ← ou - retirer (Maj : ×10) · Entrée valider · Échap annuler'.slice(0, w - 4), C.dim);
  }

  input(ctx: UICtx): void {
    const i = ctx.input, s = this.session;
    if (!this.coop.trade || this.coop.trade !== s) { ctx.close(); return; }
    if (i.key('Escape')) { this.coop.cancelTrade(); ctx.close(); return; }
    if (i.key('Enter')) { this.coop.validateTrade(); return; }
    const rows = this.rows();
    if (i.key('ArrowUp')) this.sel = Math.max(0, this.sel - 1);
    if (i.key('ArrowDown')) this.sel = Math.min(rows.length - 1, this.sel + 1);
    const step = i.isDown('ShiftLeft') || i.isDown('ShiftRight') ? 10 : 1;
    const more = i.key('ArrowRight') || i.key('+'), less = i.key('ArrowLeft') || i.key('-');
    if ((more || less) && rows[this.sel]) {
      const r = rows[this.sel], cur = r.id === 'or' ? s.mine.gold : s.mine.items.get(r.id) ?? 0;
      const amount = r.id === 'or' ? step * 5 : step;
      const next = Math.max(0, Math.min(r.have, cur + (more ? amount : -amount)));
      if (next !== cur) this.coop.setOffer(r.id, next);
    }
  }
}
