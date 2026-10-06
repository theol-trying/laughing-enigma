import { C, TextGrid } from '@ascii-fort/ascii-engine/TextGrid';
import type { Screen, UICtx } from './UI';
import { optionList } from './UI';
import type { DialogueNode } from '@ascii-fort/sim/gameplay/Dialogue';
import type { Entity } from '@ascii-fort/sim/entities/Entity';
import type { Character } from '@ascii-fort/sim/gameplay/Character';
import type { Economy } from '@ascii-fort/sim/gameplay/Economy';
import type { Reputation } from '@ascii-fort/sim/gameplay/Reputation';
import type { EventBus } from '@ascii-fort/core/Events';
import { item } from '@ascii-fort/sim/gameplay/Items';

const MOOD_COLOR: Record<string, number> = { amical: C.green, neutre: C.text, méfiant: C.orange, hostile: C.red };

export class DialogueScreen implements Screen {
  modal = true;
  constructor(private node: DialogueNode, private onClose: () => void = () => {}) {}

  draw(ctx: UICtx): void {
    const g = ctx.grid, n = this.node;
    const w = Math.min(g.cols - 4, 96);
    const lines = n.lines.flatMap((l) => TextGrid.wrap(`« ${l} »`, w - 6));
    const h = lines.length + n.options.length + 7;
    const x = Math.floor((g.cols - w) / 2), y = g.rows - h - 1;
    g.box(x, y, w, h, { title: n.speaker, double: true });
    g.text(x + 3 + n.speaker.length + 2, y, ` ${n.sub} `, C.dim, C.panel);
    g.text(x + w - 12, y, ` ${n.mood} `, MOOD_COLOR[n.mood] ?? C.text, C.panel);
    lines.forEach((l, i) => g.text(x + 3, y + 2 + i, l, C.white));
    this.optY = y + 3 + lines.length;
    this.optX = x + 3; this.optW = w - 6;
  }
  private optX = 0; private optY = 0; private optW = 0;

  input(ctx: UICtx): void {
    if (ctx.input.key('Escape')) { ctx.close(); this.onClose(); return; }
    const k = optionList(ctx, this.optX, this.optY, this.optW, this.node.options.map((o) => o.label), C.yellow, C.sel);
    if (k >= 0) {
      const next = this.node.options[k].go();
      if (next) this.node = next;
      else { ctx.close(); this.onClose(); }
    }
  }
}

export interface TradeHost {
  character: Character; economy: Economy; rep: Reputation; events: EventBus;
  stockOf(e: Entity): { id: string; qty: number }[];
}

/** Commerce : marchandise du PNJ (achat) et sac du joueur (vente), prix régionaux. */
export class TradeScreen implements Screen {
  modal = true;
  private col = 0;
  private sel = [0, 0];
  constructor(private e: Entity, private h: TradeHost) {}

  private rows() {
    const n = this.e.npc!, h = this.h, ch = h.character;
    const f = h.rep.priceFactor(n);
    const buy = h.stockOf(this.e).map((s) => ({ id: s.id, qty: s.qty, price: h.economy.price(item(s.id), n.sid, true, ch.priceMult(true), f) }));
    const sell = ch.inv.list().filter((l) => l.def.cat !== 'quête' && l.def.cat !== 'clé' && !(ch.isEquipped(l.id) && l.qty === 1))
      .map((l) => ({ id: l.id, qty: l.qty, price: h.economy.price(l.def, n.sid, false, ch.priceMult(false), f) }));
    return [buy, sell];
  }

  draw(ctx: UICtx): void {
    const g = ctx.grid, n = this.e.npc!, ch = this.h.character;
    const w = Math.min(g.cols - 2, 110), h = Math.min(g.rows - 4, 30);
    const x = Math.floor((g.cols - w) / 2), y = Math.floor((g.rows - h) / 2);
    g.box(x, y, w, h, { title: `Commerce — ${n.first} ${n.last} (${n.profession})`, double: true });
    const [buy, sell] = this.rows();
    const cw = Math.floor((w - 5) / 2);
    const colX = [x + 2, x + 3 + cw];
    g.text(colX[0], y + 1, `Il vend · bourse : ${n.wealth} or`, C.title);
    g.text(colX[1], y + 1, `Vous vendez · votre or : ${ch.inv.gold}`, C.title);
    [buy, sell].forEach((list, c) => {
      list.slice(0, h - 6).forEach((r, i) => {
        const yy = y + 3 + i;
        const over = ctx.mouseCell.y === yy && ctx.mouseCell.x >= colX[c] && ctx.mouseCell.x < colX[c] + cw;
        const active = this.col === c && this.sel[c] === i;
        const label = `${item(r.id).name}${r.qty > 1 ? ' ×' + r.qty : ''}`.slice(0, cw - 9).padEnd(cw - 8) + `${String(r.price).padStart(5)} or`;
        g.text(colX[c], yy, label, active || over ? 0xffffff : C.text, active ? C.sel : over ? C.panel2 : -1);
        if (over && ctx.clicked) { this.col = c; this.sel[c] = i; this.doTrade(); }
      });
    });
    const cur = [buy, sell][this.col][this.sel[this.col]];
    if (cur) TextGrid.wrap(item(cur.id).desc || ' ', w - 4).slice(0, 1).forEach((l) => g.text(x + 2, y + h - 3, l, C.dim));
    g.text(x + 2, y + h - 2, '↑↓ choisir · ←→ colonne · Entrée/clic : acheter/vendre · Échap : quitter', C.dim);
  }

  private doTrade() {
    const [buy, sell] = this.rows();
    const ch = this.h.character, n = this.e.npc!;
    if (this.col === 0) {
      const r = buy[this.sel[0]];
      if (!r) return;
      if (ch.inv.gold < r.price) { this.h.events.emit('message', { text: 'Pas assez d\'or.', color: C.red }); return; }
      ch.inv.gold -= r.price; n.wealth += r.price; ch.inv.add(r.id);
      const st = this.h.stockOf(this.e).find((s) => s.id === r.id);
      if (st) st.qty--;
      this.h.events.emit('trade', { npcId: n.id, itemId: r.id, qty: 1, price: r.price, sold: false });
      ch.practice('commerce', 0.6);
    } else {
      const r = sell[this.sel[1]];
      if (!r) return;
      if (n.wealth < r.price) { this.h.events.emit('message', { text: `${n.first} n'a plus assez d'or.`, color: C.red }); return; }
      if (!ch.inv.remove(r.id)) return;
      if (ch.isEquipped(r.id) && !ch.inv.count(r.id)) for (const k of Object.keys(ch.equip) as (keyof typeof ch.equip)[]) if (ch.equip[k] === r.id) ch.equip[k] = null;
      ch.inv.gold += r.price; n.wealth -= r.price;
      const st = this.h.stockOf(this.e);
      const ex = st.find((s) => s.id === r.id);
      if (ex) ex.qty++; else st.push({ id: r.id, qty: 1 });
      this.h.events.emit('trade', { npcId: n.id, itemId: r.id, qty: 1, price: r.price, sold: true });
      ch.practice('commerce', 0.6);
    }
  }

  input(ctx: UICtx): void {
    const i = ctx.input;
    if (i.key('Escape')) { ctx.close(); return; }
    const [buy, sell] = this.rows();
    const len = [buy.length, sell.length];
    if (i.pressed('ArrowLeft')) this.col = 0;
    if (i.pressed('ArrowRight')) this.col = 1;
    if (i.pressed('ArrowUp')) this.sel[this.col] = Math.max(0, this.sel[this.col] - 1);
    if (i.pressed('ArrowDown')) this.sel[this.col] = Math.min(len[this.col] - 1, this.sel[this.col] + 1);
    this.sel[this.col] = Math.max(0, Math.min(this.sel[this.col], len[this.col] - 1));
    if (i.pressed('Enter') || i.pressed('Space') || i.key('e')) this.doTrade();
  }
}
