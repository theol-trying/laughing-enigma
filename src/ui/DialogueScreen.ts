import { C, TextGrid } from '@ascii-fort/ascii-engine/TextGrid';
import type { Screen, UICtx } from './UI';
import type { DialogueNode } from '@ascii-fort/sim/gameplay/Dialogue';
import type { Entity } from '@ascii-fort/sim/entities/Entity';
import type { Character } from '@ascii-fort/sim/gameplay/Character';
import { sellCap, type Economy } from '@ascii-fort/sim/gameplay/Economy';
import type { Reputation } from '@ascii-fort/sim/gameplay/Reputation';
import type { EventBus } from '@ascii-fort/core/Events';
import { item, baseId, wearable, wearState, wearFactor, type ItemDef } from '@ascii-fort/sim/gameplay/Items';
import type { NPCData } from '@ascii-fort/sim/entities/NPC';
import type { Input } from '@ascii-fort/ascii-engine/Input';

const MOOD_COLOR: Record<string, number> = { amical: C.green, neutre: C.text, méfiant: C.orange, hostile: C.red };

/**
 * Pas de quantité au clavier : +/= et -/_ font ±1 (le « + » du clavier principal se tape déjà avec Maj, et
 * Maj change e.key : ces touches ne dépendent donc pas de Maj), PgPréc/PgSuiv ou Maj + pavé numérique font ±10.
 */
export function qtyStep(i: Input): number {
  const shift = i.isDown('ShiftLeft') || i.isDown('ShiftRight');
  if (i.pressed('PageUp')) return 10;
  if (i.pressed('PageDown')) return -10;
  if (i.pressed('NumpadAdd')) return shift ? 10 : 1;
  if (i.pressed('NumpadSubtract')) return shift ? -10 : -1;
  if (i.key('+') || i.key('=')) return 1;
  if (i.key('-') || i.key('_')) return -1;
  return 0;
}

/** Comparaison d'un objet avec celui équipé au même emplacement (inventaire, commerce). */
export function compareWithEquipped(ch: Character, d: ItemDef): [string, number][] {
  const out: [string, number][] = [];
  const diff = (label: string, a: number, b: number) => out.push([`${label} ${a} → ${b} (${b - a >= 0 ? '+' : ''}${Math.round((b - a) * 100) / 100})`, b - a]);
  // par emplacement (la pièce portée ne se compare pas à elle-même) et en valeurs effectives : hors d'usage, on frappe à mains nues (4)
  if (d.weapon && ch.equip.arme !== d.id) diff('Dégâts', ch.weapon?.weapon?.damage ?? 4, d.dur === 0 ? 4 : d.weapon.damage);
  if (d.armor) { const cur = ch.equip[d.armor.slot]; if (cur !== d.id) diff('Armure', cur ? item(cur).armor?.value ?? 0 : 0, d.armor.value); }
  if (d.shield && ch.equip.bouclier !== d.id) diff('Parade %', Math.round((ch.shield?.shield?.block ?? 0) * 100), Math.round(d.shield.block * 100));
  return out;
}

/** Caractéristiques lisibles d'un objet. */
export function itemStats(d: ItemDef): string[] {
  const out: string[] = [];
  const b = d.dur !== undefined ? item(baseId(d.id)) : null;
  const was = (v: number, w?: number) => (w !== undefined && w !== v ? ` (${w} en parfait état)` : '');
  if (d.weapon) out.push(`Dégâts ${d.weapon.damage}${was(d.weapon.damage, b?.weapon?.damage)} · vitesse ${d.weapon.speed} · allonge ${d.weapon.reach} m`);
  if (d.armor) out.push(`Armure +${d.armor.value}${was(d.armor.value, b?.armor?.value)} (${d.armor.slot})`);
  if (d.shield) out.push(`Parade ${Math.round(d.shield.block * 100)} %`);
  if (wearable(d)) { const s = d.dur ?? 100; out.push(s <= 0 ? 'Hors d’usage : aucun effet avant réparation (enclume, forgeron)' : `État ${s} % · ${wearState(s)}${s < 50 ? ` (efficacité ${Math.round(wearFactor(s) * 100)} %)` : ''}`); }
  if (d.use) out.push([d.use.hp ? `+${d.use.hp} PV` : '', d.use.stamina ? `+${d.use.stamina} END` : '', d.use.mana ? `+${d.use.mana} MANA` : '', d.use.cure ? 'soigne le poison' : '',
    d.use.buff ? `${d.use.buff.name} ${Math.round(d.use.buff.t / 60)} min` : '', d.use.warm ? `réchauffe ${d.use.warm} min` : '', d.use.meal ? `rassasie ${Math.round(d.use.meal.t / 60)} min` : ''].filter(Boolean).join(' · '));
  return out.filter(Boolean);
}

/** Dialogue : répliques du PNJ et réponses numérotées (clic ou touche 1-9) ; E, Tab ou Échap pour partir. */
export class DialogueScreen implements Screen {
  modal = true;
  private optY = 0; private optX = 0; private optW = 0;
  constructor(private node: DialogueNode, private onClose: () => void = () => {}) {}

  draw(ctx: UICtx): void {
    const g = ctx.grid, n = this.node;
    const w = Math.min(g.cols - 4, 96);
    const lines = n.lines.flatMap((l) => TextGrid.wrap(`« ${l} »`, w - 6));
    const h = lines.length + n.options.length + 6;
    const x = Math.floor((g.cols - w) / 2), y = Math.max(0, g.rows - h - 1);
    g.box(x, y, w, h, { title: n.speaker, double: true });
    g.text(x + 3 + n.speaker.length + 2, y, ` ${n.sub} `, C.dim, C.panel);
    g.text(x + w - 12, y, ` ${n.mood} `, MOOD_COLOR[n.mood] ?? C.text, C.panel);
    lines.forEach((l, i) => g.text(x + 3, y + 2 + i, l, C.white));
    this.optY = y + 3 + lines.length; this.optX = x + 3; this.optW = w - 6;
    n.options.forEach((o, i) => {
      const yy = this.optY + i, over = ctx.mouseCell.y === yy && ctx.mouseCell.x >= this.optX && ctx.mouseCell.x < this.optX + this.optW;
      g.text(this.optX, yy, `${(i + 1) % 10}. ${o.label}`.slice(0, this.optW).padEnd(this.optW), over ? 0xffffff : C.yellow, over ? C.sel : -1);
    });
    g.text(x + 3, y + h - 1, ' 1-9, 0 ou clic : répondre · E, Tab ou Échap : partir '.slice(0, w - 6), C.dim, C.panel);
  }

  input(ctx: UICtx): void {
    const i = ctx.input;
    if (i.key('Escape') || i.key('e') || i.key('Tab')) { ctx.close(); this.onClose(); return; }
    let k = -1;
    const m = ctx.mouseCell;
    if (ctx.clicked && m.x >= this.optX && m.x < this.optX + this.optW && m.y >= this.optY && m.y < this.optY + this.node.options.length) k = m.y - this.optY;
    // 1-9, puis 0 pour la dixième option (l'aubergiste peut en avoir dix)
    for (let d = 0; d < Math.min(10, this.node.options.length); d++) { const c = String((d + 1) % 10); if (i.pressed('Digit' + c) || i.pressed('Numpad' + c)) k = d; }
    if (k < 0) return;
    const next = this.node.options[k].go();
    if (next) this.node = next;
    else { ctx.close(); this.onClose(); }
  }
}

export interface TradeHost {
  character: Character; economy: Economy; rep: Reputation; events: EventBus;
  stockOf(e: Entity): { id: string; qty: number }[];
  /** réparation contre de l'or (forgeron) : exemplaires abîmés et prix total */
  repairQuote?(n: NPCData): { count: number; cost: number };
  repairAll?(n: NPCData): { count: number; cost: number; total: number };
}

/**
 * Commerce : marchandise du PNJ (achat) et sac du joueur (vente), prix régionaux.
 * Un clic choisit un objet, la quantité se règle (+/−, boutons), Entrée ou double-clic valide.
 */
export class TradeScreen implements Screen {
  modal = true;
  private col = 0;
  private sel = [0, 0];
  private qty = 1;
  private lastClick = { t: 0, col: -1, row: -1 };
  /** compte rendu de la réparation chez le forgeron */
  private note: { text: string; color: number } | null = null;
  private noteT = 0;
  constructor(private e: Entity, private h: TradeHost) {}

  private rows() {
    const n = this.e.npc!, h = this.h, ch = h.character;
    const f = h.rep.priceFactor(n);
    const buy = h.stockOf(this.e).filter((s) => s.qty > 0).map((s) => ({ id: s.id, qty: s.qty, price: h.economy.price(item(s.id), n.sid, true, ch.priceMult(true), f) }));
    // la revente ne dépasse jamais 90 % du prix d'achat du même objet chez ce marchand (pas de gain à acheter puis revendre)
    const sell = ch.inv.list().filter((l) => l.def.cat !== 'quête' && l.def.cat !== 'clé' && !(ch.isEquipped(l.id) && l.qty === 1))
      .map((l) => ({ id: l.id, qty: l.qty - (ch.isEquipped(l.id) ? 1 : 0), price: sellCap(h.economy.price(l.def, n.sid, false, ch.priceMult(false), f), h.economy.price(l.def, n.sid, true, ch.priceMult(true), f)) }));
    return [buy, sell];
  }

  /** Quantité maximale possible pour la ligne choisie (stock, or, bourse du marchand). */
  private maxQty(): number {
    const [buy, sell] = this.rows(), ch = this.h.character, n = this.e.npc!;
    const r = [buy, sell][this.col][this.sel[this.col]];
    if (!r) return 0;
    return this.col === 0 ? Math.min(r.qty, Math.floor(ch.inv.gold / Math.max(1, r.price))) : Math.min(r.qty, Math.floor(n.wealth / Math.max(1, r.price)));
  }

  private select(c: number, i: number) { if (this.col !== c || this.sel[c] !== i) this.qty = 1; this.col = c; this.sel[c] = i; }

  draw(ctx: UICtx): void {
    const g = ctx.grid, n = this.e.npc!, ch = this.h.character;
    const w = Math.min(g.cols - 2, 110), h = Math.min(g.rows - 2, 32);
    const x = Math.floor((g.cols - w) / 2), y = Math.floor((g.rows - h) / 2);
    g.box(x, y, w, h, { title: `Commerce — ${n.first} ${n.last} (${n.profession})`, double: true });
    const [buy, sell] = this.rows();
    const cw = Math.floor((w - 5) / 2), colX = [x + 2, x + 3 + cw];
    g.text(colX[0], y + 1, `Il vend · sa bourse : ${n.wealth} or`, C.title);
    g.text(colX[1], y + 1, `Vous vendez · votre or : ${ch.inv.gold}`, C.title);
    const listH = h - 12;
    [buy, sell].forEach((list, c) => {
      if (!list.length) g.text(colX[c], y + 3, '(rien)', C.dim);
      list.slice(0, listH).forEach((r, i) => {
        const yy = y + 3 + i;
        const over = ctx.mouseCell.y === yy && ctx.mouseCell.x >= colX[c] && ctx.mouseCell.x < colX[c] + cw;
        const active = this.col === c && this.sel[c] === i;
        const label = `${item(r.id).name}${r.qty > 1 ? ' ×' + r.qty : ''}`.slice(0, cw - 9).padEnd(cw - 8) + `${String(r.price).padStart(5)} or`;
        g.text(colX[c], yy, label, active || over ? 0xffffff : C.text, active ? C.sel : over ? C.panel2 : -1);
        if (over && ctx.clicked) {
          const now = performance.now(), dbl = now - this.lastClick.t < 400 && this.lastClick.col === c && this.lastClick.row === i;
          this.select(c, i);
          this.lastClick = { t: now, col: c, row: i };
          if (dbl) this.doTrade();
        }
      });
    });
    for (let i = 1; i < listH + 2; i++) g.text(x + 2 + cw, y + i, '│', C.border);
    // détail de l'objet choisi, comparaison, quantité et action
    const cur = [buy, sell][this.col][this.sel[this.col]];
    let yy = y + h - 9;
    g.text(x + 1, yy - 1, '─'.repeat(w - 2), C.border);
    if (cur) {
      const d = item(cur.id), max = this.maxQty();
      this.qty = Math.max(1, Math.min(this.qty, Math.max(1, max)));
      g.text(x + 2, yy, `${d.name}`.slice(0, w - 4), d.rarity === 'rare' ? C.magenta : C.title);
      g.text(x + 2 + Math.min(30, d.name.length + 2), yy, `${d.cat}${ch.isEquipped(d.id) ? ' · équipé' : ''}`, C.dim);
      yy++;
      const stats = itemStats(d), cmp = compareWithEquipped(ch, d);
      g.text(x + 2, yy++, [...stats, TextGrid.wrap(d.desc || '', w)[0] ?? ''].filter(Boolean).join(' · ').slice(0, w - 4), C.text);
      if (cmp.length) { let cx = x + 2; for (const [l, v] of cmp) { g.text(cx, yy, l, v > 0 ? C.green : v < 0 ? C.red : C.dim); cx += l.length + 3; } }
      else if (d.weapon || d.armor || d.shield) g.text(x + 2, yy, ch.isEquipped(d.id) ? 'Vous le portez.' : 'Rien d’équipé à comparer à cet emplacement.', C.dim);
      yy += 2;
      // quantité
      const btn = (bx: number, label: string, on: boolean, fn: () => void) => {
        const over = ctx.mouseCell.y === yy && ctx.mouseCell.x >= bx && ctx.mouseCell.x < bx + label.length;
        g.text(bx, yy, label, !on ? C.faint : over ? 0xffffff : C.yellow, over && on ? C.sel : -1);
        if (over && on && ctx.clicked) fn();
        return bx + label.length + 1;
      };
      let bx = x + 2;
      g.text(bx, yy, 'Quantité :', C.text); bx += 11;
      bx = btn(bx, '[-]', this.qty > 1, () => { this.qty--; });
      g.text(bx, yy, String(this.qty).padStart(3), C.white); bx += 4;
      bx = btn(bx, '[+]', this.qty < max, () => { this.qty++; });
      bx = btn(bx, '[max]', max > 1, () => { this.qty = max; });
      const total = cur.price * this.qty;
      const verb = this.col === 0 ? 'Acheter' : 'Vendre';
      bx += 2;
      btn(bx, `[ ${verb} ${this.qty} × ${d.name.slice(0, 24)} — ${total} or ]`, max > 0, () => this.doTrade());
      if (max <= 0) g.text(x + 2, yy + 1, this.col === 0 ? (cur.qty <= 0 ? 'Plus en stock.' : 'Pas assez d’or.') : 'Le marchand n’a plus assez d’or.', C.red);
    }
    // forgeron : réparation de l'équipement contre de l'or
    if (n.profession === 'forgeron' && this.h.repairQuote) {
      const q = this.h.repairQuote(n), ry = y + h - 3;
      const label = q.count ? `[R] Faire réparer l’équipement : ${q.count} objet${q.count > 1 ? 's' : ''} — ${q.cost} or` : 'Votre équipement est en bon état.';
      // compte rendu de la dernière réparation à la place du libellé, quelques secondes
      if (this.note && performance.now() - this.noteT < 3000) g.text(x + 2, ry, this.note.text.slice(0, w - 4), this.note.color);
      else {
        const over = q.count > 0 && ctx.mouseCell.y === ry && ctx.mouseCell.x >= x + 2 && ctx.mouseCell.x < x + 2 + label.length;
        g.text(x + 2, ry, label.slice(0, w - 4), !q.count ? C.dim : over ? 0xffffff : C.yellow, over ? C.sel : -1);
        if (over && ctx.clicked) this.repairAll();
      }
    }
    g.text(x + 2, y + h - 2, '↑↓ choisir · ←→ colonne · +/- quantité (PgPréc/PgSuiv ×10) · Entrée : valider · Échap : quitter'.slice(0, w - 4), C.dim);
  }

  /** Réparation chez le forgeron, avec un compte rendu dans l'écran (le journal du HUD est masqué ici). */
  private repairAll() {
    const n = this.e.npc!;
    if (n.profession !== 'forgeron' || !this.h.repairAll) return;
    const r = this.h.repairAll(n);
    if (!r.total) return;
    this.note = !r.count ? { text: 'Pas assez d’or pour la moindre réparation.', color: C.red }
      : r.count < r.total ? { text: `${r.count} objet${r.count > 1 ? 's' : ''} sur ${r.total} réparé${r.count > 1 ? 's' : ''} (${r.cost} or) : pas assez d’or pour le reste.`, color: C.orange }
      : { text: `Équipement réparé (${r.cost} or).`, color: C.green };
    this.noteT = performance.now();
  }

  private doTrade() {
    const [buy, sell] = this.rows();
    const ch = this.h.character, n = this.e.npc!;
    const max = this.maxQty();
    const count = Math.max(0, Math.min(this.qty, max));
    if (!count) { this.h.events.emit('message', { text: this.col === 0 ? 'Pas assez d\'or.' : `${n.first} n'a plus assez d'or.`, color: C.red }); return; }
    if (this.col === 0) {
      const r = buy[this.sel[0]];
      if (!r) return;
      for (let k = 0; k < count; k++) {
        ch.inv.gold -= r.price; n.wealth += r.price; ch.inv.add(r.id);
        const st = this.h.stockOf(this.e).find((s) => s.id === r.id);
        if (st) st.qty--;
        this.h.events.emit('trade', { npcId: n.id, itemId: r.id, qty: 1, price: r.price, sold: false });
        ch.practice('commerce', 0.6);
      }
      this.h.events.emit('message', { text: `Acheté : ${item(r.id).name}${count > 1 ? ' ×' + count : ''} (${r.price * count} or).`, color: C.green });
    } else {
      const r = sell[this.sel[1]];
      if (!r) return;
      for (let k = 0; k < count; k++) {
        if (!ch.inv.remove(r.id)) break;
        ch.inv.gold += r.price; n.wealth -= r.price;
        const st = this.h.stockOf(this.e);
        const ex = st.find((s) => s.id === r.id);
        if (ex) ex.qty++; else st.push({ id: r.id, qty: 1 });
        this.h.events.emit('trade', { npcId: n.id, itemId: r.id, qty: 1, price: r.price, sold: true });
        ch.practice('commerce', 0.6);
      }
      this.h.events.emit('message', { text: `Vendu : ${item(r.id).name}${count > 1 ? ' ×' + count : ''} (${r.price * count} or).`, color: C.green });
    }
    this.qty = 1;
  }

  input(ctx: UICtx): void {
    const i = ctx.input;
    if (i.key('Escape') || i.key('Tab') || i.key('e')) { ctx.close(); return; }
    if (i.key('r')) this.repairAll();
    const [buy, sell] = this.rows();
    const len = [buy.length, sell.length];
    if (i.pressed('ArrowLeft')) this.select(0, this.sel[0]);
    if (i.pressed('ArrowRight')) this.select(1, this.sel[1]);
    if (i.pressed('ArrowUp')) this.select(this.col, Math.max(0, this.sel[this.col] - 1));
    if (i.pressed('ArrowDown')) this.select(this.col, Math.min(len[this.col] - 1, this.sel[this.col] + 1));
    this.sel[this.col] = Math.max(0, Math.min(this.sel[this.col], len[this.col] - 1));
    const step = qtyStep(i);
    if (step) this.qty = Math.max(1, Math.min(Math.max(1, this.maxQty()), this.qty + step));
    if (i.pressed('Enter') || i.pressed('NumpadEnter')) this.doTrade();
  }
}
