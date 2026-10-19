import { C, TextGrid } from '@ascii-fort/ascii-engine/TextGrid';
import type { Screen, UICtx } from './UI';
import type { Character } from '@ascii-fort/sim/gameplay/Character';
import type { EventBus } from '@ascii-fort/core/Events';
import { Inventory, item } from '@ascii-fort/sim/gameplay/Items';
import { CHEST_MAX_STACKS, CHEST_MAX_QTY, CHEST_MAX_GOLD, depositable, moveItem, moveGold } from '@ascii-fort/sim/gameplay/Estate';
import { qtyStep, itemStats } from './DialogueScreen';
import { fitName } from './GameScreens';

export interface ChestHost {
  character: Character; events: EventBus;
  /** coffre personnel : objets (l'usure voyage dans l'id) et or */
  chest: Inventory;
  title: string;
  /** null : reste ouvert ; '' : fermeture silencieuse ; texte : message puis fermeture (attaque, éloignement, mort) */
  closeReason(): string | null;
  onClose(): void;
}

interface Row { id: string; qty: number; gold?: boolean }

/**
 * Coffre personnel de la maison : deux colonnes (le sac, le coffre), transfert dans les deux sens sans vol ni duplication.
 * Modèle : TradeScreen. Les objets de quête, les clés et le dernier exemplaire équipé restent sur soi ; 120 piles au plus.
 */
export class ChestScreen implements Screen {
  modal = true;
  private col = 0;
  private sel = [0, 0];
  private scroll = [0, 0];
  private qty = 1;
  private lastClick = { t: 0, col: -1, row: -1 };
  constructor(private h: ChestHost) {}

  private rows(): [Row[], Row[]] {
    const ch = this.h.character, chest = this.h.chest;
    const bag: Row[] = [{ id: '', qty: ch.inv.gold, gold: true }];
    for (const l of ch.inv.list()) if (depositable(l.id)) { const q = l.qty - (ch.isEquipped(l.id) ? 1 : 0); if (q > 0) bag.push({ id: l.id, qty: q }); }
    return [bag, [{ id: '', qty: chest.gold, gold: true }, ...chest.list().map((l) => ({ id: l.id, qty: l.qty }))]];
  }

  /** Quantité maximale transférable pour la ligne choisie (stock, plafonds du coffre). */
  private maxQty(): number {
    const r = this.rows()[this.col][this.sel[this.col]], chest = this.h.chest;
    if (!r) return 0;
    if (this.col === 1) return r.qty;
    if (r.gold) return Math.max(0, Math.min(r.qty, CHEST_MAX_GOLD - chest.gold));
    if (!chest.items.has(r.id) && chest.items.size >= CHEST_MAX_STACKS) return 0;
    return Math.max(0, Math.min(r.qty, CHEST_MAX_QTY - chest.count(r.id)));
  }

  private select(c: number, i: number) { if (this.col !== c || this.sel[c] !== i) this.qty = 1; this.col = c; this.sel[c] = i; }

  private doMove(): void {
    const ch = this.h.character, chest = this.h.chest, rows = this.rows(), r = rows[this.col][this.sel[this.col]];
    if (!r) return;
    const n = Math.max(1, Math.min(this.qty, this.maxQty()));
    const bag = this.col === 0, name = r.gold ? 'or' : item(r.id).name;
    let moved: number;
    if (r.gold) moved = bag ? moveGold(ch.inv, chest, n, CHEST_MAX_GOLD) : moveGold(chest, ch.inv, n);
    else if (bag) moved = moveItem(ch.inv, chest, r.id, n, { keep: ch.isEquipped(r.id) ? 1 : 0, maxStacks: CHEST_MAX_STACKS, maxQty: CHEST_MAX_QTY });
    else moved = moveItem(chest, ch.inv, r.id, n);
    if (!moved) { this.h.events.emit('message', { text: bag && !r.gold && !chest.items.has(r.id) ? `Coffre plein (${CHEST_MAX_STACKS} objets différents).` : 'Rien à transférer.', color: C.red }); return; }
    this.h.events.emit('message', { text: `${bag ? 'Déposé' : 'Repris'} : ${name}${r.gold ? ` ${moved}` : moved > 1 ? ' ×' + moved : ''}`, color: C.green });
    this.qty = 1;
  }

  draw(ctx: UICtx): void {
    const g = ctx.grid, ch = this.h.character, chest = this.h.chest;
    const w = Math.min(g.cols - 2, 110), h = Math.min(g.rows - 2, 32);
    const x = Math.floor((g.cols - w) / 2), y = Math.floor((g.rows - h) / 2);
    g.box(x, y, w, h, { title: this.h.title.slice(0, w - 6), double: true });
    const lists = this.rows(), cw = Math.floor((w - 5) / 2), colX = [x + 2, x + 3 + cw];
    g.text(colX[0], y + 1, `Votre sac · ${ch.inv.weight().toFixed(1)}/${ch.carryMax()} kg`.slice(0, cw), C.title);
    g.text(colX[1], y + 1, `Coffre · ${chest.items.size}/${CHEST_MAX_STACKS} piles`.slice(0, cw), C.title);
    const listH = h - 13;                                  // lignes y+3 … y+h-11 : le séparateur est en y+h-10
    lists.forEach((list, c) => {
      this.sel[c] = Math.max(0, Math.min(this.sel[c], list.length - 1));
      if (this.sel[c] < this.scroll[c]) this.scroll[c] = this.sel[c];
      if (this.sel[c] >= this.scroll[c] + listH) this.scroll[c] = this.sel[c] - listH + 1;
      this.scroll[c] = Math.max(0, Math.min(this.scroll[c], list.length - listH));   // liste raccourcie : pas de ligne vide en bas
      list.slice(this.scroll[c], this.scroll[c] + listH).forEach((r, k) => {
        const i = this.scroll[c] + k, yy = y + 3 + k;
        const over = ctx.mouseCell.y === yy && ctx.mouseCell.x >= colX[c] && ctx.mouseCell.x < colX[c] + cw;
        const active = this.col === c && this.sel[c] === i;
        const qty = r.gold ? `${r.qty} or` : `×${r.qty}`, label = (r.gold ? 'Or' : fitName(r.id, cw - 10)).padEnd(cw - 9) + qty.padStart(9);
        g.text(colX[c], yy, label.slice(0, cw), active || over ? 0xffffff : r.gold ? C.gold : C.text, active ? C.sel : over ? C.panel2 : -1);
        if (over && ctx.clicked) {
          const now = performance.now(), dbl = now - this.lastClick.t < 400 && this.lastClick.col === c && this.lastClick.row === i;
          this.select(c, i);
          this.lastClick = { t: now, col: c, row: i };
          if (dbl) this.doMove();
        }
      });
      if (list.length > listH) {                           // indicateur « a-b/n », calé à droite à l'intérieur de sa colonne
        const pos = `${this.scroll[c] + 1}-${Math.min(list.length, this.scroll[c] + listH)}/${list.length}`;
        g.text(colX[c] + cw - pos.length, y + 2, pos, C.dim);
      }
    });
    for (let i = 1; i < listH + 3; i++) g.text(x + 2 + cw, y + i, '│', C.border);
    // détail de la ligne choisie, quantité et action
    const cur = lists[this.col][this.sel[this.col]];
    let yy = y + h - 9;
    g.text(x + 1, yy - 1, '─'.repeat(w - 2), C.border);
    if (cur) {
      const max = this.maxQty(), bag = this.col === 0;
      this.qty = Math.max(1, Math.min(this.qty, Math.max(1, max)));
      if (cur.gold) {
        g.text(x + 2, yy, 'Pièces d’or', C.gold);
        g.text(x + 2, yy + 1, 'Une bourse laissée au coffre ne se perd pas à la mort et ne se vole pas.'.slice(0, w - 4), C.text);
      } else {
        const d = item(cur.id);
        g.text(x + 2, yy, d.name.slice(0, w - 4), d.rarity === 'rare' ? C.magenta : C.title);
        g.text(x + 2 + Math.min(30, d.name.length + 2), yy, `${d.cat}${ch.isEquipped(d.id) ? ' · équipé' : ''}`, C.dim);
        g.text(x + 2, yy + 1, [...itemStats(d), TextGrid.wrap(d.desc || '', w)[0] ?? ''].filter(Boolean).join(' · ').slice(0, w - 4), C.text);
      }
      yy += 3;
      const btn = (bx: number, label: string, on: boolean, fn: () => void) => {
        const over = ctx.mouseCell.y === yy && ctx.mouseCell.x >= bx && ctx.mouseCell.x < bx + label.length;
        g.text(bx, yy, label, !on ? C.faint : over ? 0xffffff : C.yellow, over && on ? C.sel : -1);
        if (over && on && ctx.clicked) fn();
        return bx + label.length + 1;
      };
      const unit = cur.gold ? 10 : 1;
      let bx = x + 2;
      g.text(bx, yy, 'Quantité :', C.text); bx += 11;
      bx = btn(bx, '[-]', this.qty > 1, () => { this.qty = Math.max(1, this.qty - unit); });
      g.text(bx, yy, String(this.qty).padStart(6), C.white); bx += 7;
      bx = btn(bx, '[+]', this.qty < max, () => { this.qty = Math.min(max, this.qty + unit); });
      bx = btn(bx, '[tout]', max > 1, () => { this.qty = max; });
      bx += 2;
      btn(bx, `[ ${bag ? 'Déposer' : 'Reprendre'} ${this.qty} × ${cur.gold ? 'or' : item(cur.id).name.slice(0, 24)} ]`, max > 0, () => this.doMove());
      if (max <= 0) g.text(x + 2, yy + 1, bag ? (!cur.gold && !chest.items.has(cur.id) && chest.items.size >= CHEST_MAX_STACKS ? 'Le coffre est plein.' : 'Rien à déposer.') : 'Rien à reprendre.', C.red);
    }
    g.text(x + 2, y + h - 2, '↑↓ choisir · ←→ colonne · +/- quantité (PgPréc/PgSuiv ×10) · T : tout · Entrée : valider · Échap : fermer'.slice(0, w - 4), C.dim);
    g.text(x + 2, y + h - 3, 'Les objets de quête, les clés et l’équipement porté restent sur vous.'.slice(0, w - 4), C.faint);
  }

  input(ctx: UICtx): void {
    const i = ctx.input, why = this.h.closeReason();
    if (why !== null) { if (why) this.h.events.emit('message', { text: why, color: C.orange }); ctx.close(); this.h.onClose(); return; }
    if (i.key('Escape') || i.key('Tab') || i.key('e')) { ctx.close(); this.h.onClose(); return; }
    const lists = this.rows(), len = [lists[0].length, lists[1].length];
    if (i.pressed('ArrowLeft')) this.select(0, this.sel[0]);
    if (i.pressed('ArrowRight')) this.select(1, this.sel[1]);
    if (i.pressed('ArrowUp')) this.select(this.col, Math.max(0, this.sel[this.col] - 1));
    if (i.pressed('ArrowDown')) this.select(this.col, Math.min(len[this.col] - 1, this.sel[this.col] + 1));
    this.sel[this.col] = Math.max(0, Math.min(this.sel[this.col], len[this.col] - 1));
    const cur = lists[this.col][this.sel[this.col]], max = Math.max(1, this.maxQty());
    const step = qtyStep(i) * (cur?.gold ? 10 : 1);
    if (step) this.qty = Math.max(1, Math.min(max, this.qty + step));
    if (i.key('t')) this.qty = max;
    if (i.pressed('Enter') || i.pressed('NumpadEnter')) this.doMove();
  }
}
