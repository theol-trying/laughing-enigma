import { C, TextGrid } from '@ascii-fort/ascii-engine/TextGrid';
import { playerNoise } from '@ascii-fort/sim/ai/Perception';
import { spell } from '@ascii-fort/sim/gameplay/Spells';
import type { Character } from '@ascii-fort/sim/gameplay/Character';
import { FX_META, TREES, TREE_BY_ID, ROW_REQ, frNum, fxTotal, refusalText, respecCost, talentsOf, treeSpent, type FxKey, type TalentDef, type TreeId } from '@ascii-fort/sim/gameplay/Talents';
import type { UICtx } from './UI';
import type { Game } from '../game/Game';

// Panneau des talents (onglet de la fiche du personnage, touche K) : quatre arbres, trois rangées de
// cases ; une case = un talent (nom, rangs). Le détail à droite donne la description, l'effet chiffré
// par rang et les valeurs concrètes « avant → après ». Dépenser un point demande une confirmation.

export const TREE_COLOR: Record<TreeId, number> = { guerrier: C.red, rodeur: C.green, mage: C.blue, artisan: C.gold };

/** Valeur concrète de chaque effet pour un personnage donné : [libellé, valeur] (le détail affiche « actuel → rang suivant »). */
const CONCRETE: Record<FxKey, [string, (c: Character) => string]> = {
  melee: ['Dégâts de mêlée', (c) => `×${frNum(c.meleeMult(), 2)}`],
  staCost: ['Coût d’un coup', (c) => `${frNum((c.weapon?.weapon?.stamina ?? 5) * c.staCostMult(), 1)} END`],
  armorPct: ['Armure', (c) => String(c.armor)],
  guard: ['Dégâts qui passent la parade', (c) => `${Math.round(c.guard() * 100)} %`],
  blockSta: ['Coût de la parade', (c) => `×${frNum(c.blockCost(), 2)} des dégâts reçus`],
  heavy: ['Coup puissant', (c) => `×${frNum(c.heavyMult(), 1)}`],
  atkSpeed: ['Cadence de frappe', (c) => `×${frNum(c.atkSpeedMult(), 2)}`],
  execute: ['Cible affaiblie', (c) => `×${frNum(c.executeMult(), 2)}`],
  staRegen: ['Récupération d’endurance', (c) => `×${frNum(c.staRegenMult(), 2)}`],
  bow: ['Arc', (c) => `×${frNum(c.bowMult(), 2)}`],
  bowRate: ['Bandage complet', (c) => `${frNum(c.bowDrawTime(), 2)} s`],
  noise: ['Bruit à la marche', (c) => frNum(playerNoise({ sprinting: false, moving: true, crouch: false, noiseMul: c.noiseMul() }), 2)],
  arrowRecover: ['Flèche récupérée', (c) => `${Math.round(c.arrowRecover() * 100)} %`],
  sneak: ['Sournois (mêlée / tir)', (c) => `×${frNum(3 + c.sneakBonus(), 1)} / ×${frNum(2 + c.sneakBonus(), 1)}`],
  steal: ['Vol à la tire', (c) => `${Math.round(c.pickpocketChance() * 100)} %`],
  stealth: ['Discrétion', (c) => `${Math.round(c.stealth() * 100)} %`],
  spell: ['Sorts', (c) => `×${frNum(c.spellMult(), 2)}`],
  manaCost: ['Coût du trait de feu', (c) => `${c.manaCost(spell('trait de feu')?.mana ?? 15)} mana`],
  manaMax: ['Mana maximal', (c) => String(c.maxMana)],
  manaRegen: ['Régénération', (c) => `${frNum(c.manaRegen(), 1)} mana/s`],
  spellTime: ['Invisibilité', (c) => `${c.spellTime(20)} s`],
  heal: ['Soin', (c) => `+${Math.round(c.healAmount())} PV`],
  quality: ['Qualité', (c) => `+${Math.round(c.qualityBonus() * 100)} pts`],
  wear: ['Usure', (c) => `×${frNum(c.wearMult(), 2)}`],
  carry: ['Charge maximale', (c) => String(c.carryMax())],
  buy: ['Coefficient d’achat', (c) => `×${frNum(c.priceMult(true), 2)}`],
  sell: ['Coefficient de vente', (c) => `×${frNum(c.priceMult(false), 2)}`],
  lockW: ['Zone de crochetage', (c) => `+${c.lockOpts().width} case${c.lockOpts().width > 1 ? 's' : ''}`],
  lockBreak: ['Casse du crochet', (c) => `${Math.round(c.lockOpts().breakChance * 100)} %`],
};

/** texte raccourci avec « … » */
const fit = (s: string, n: number) => (s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '…');

export class TalentPanel {
  private tree: TreeId = 'guerrier';
  private row = 0; private col = 0;
  /** confirmation en attente : id d'un talent, ou '*reset' (remise à zéro payante) */
  private confirm: string | null = null;
  private flash: { id: string; t: number } | null = null;
  private log: { text: string; color: number; t: number } | null = null;
  /** position du pointeur à l'ouverture de l'onglet (null avant le premier dessin) : tant qu'il n'a pas bougé, le survol est ignoré */
  private mouseRef: { x: number; y: number } | null = null;
  private moved = false;
  /** case survolée (r,c) et depuis quand : le survol ne déplace le curseur qu'après un court arrêt, pour ne pas réagir au simple passage du pointeur */
  private hoverKey = ''; private hoverT = 0; private hoverDone = false;
  /** instant d'armement d'une confirmation : un double-clic sur « Apprendre » ne doit pas valider du même geste */
  private confirmT = 0;
  private armed(): boolean { return performance.now() - this.confirmT > 400; }

  constructor(private game: Game) { this.focus(); }

  /** À l'ouverture de l'onglet : l'arbre le plus investi, curseur sur le premier talent apprenable (sinon le premier). */
  focus(): void {
    const ch = this.game.character;
    let best = this.tree, top = -1;
    for (const t of TREES) { const s = treeSpent(ch.talents, t.id); if (s > top) { top = s; best = t.id; } }
    this.tree = best; this.confirm = null;
    this.mouseRef = null; this.moved = false; this.hoverKey = '';
    const grid = this.grid();
    for (let r = 0; r < grid.length; r++) { const c = grid[r].findIndex((d) => ch.canLearnTalent(d.id).ok); if (c >= 0) { this.row = r; this.col = c; return; } }
    this.row = 0; this.col = 0;
  }

  private grid(): TalentDef[][] { return [1, 2, 3].map((r) => talentsOf(this.tree, r)); }
  private current(): TalentDef | undefined { return this.grid()[this.row]?.[this.col]; }
  private say(text: string, color: number) { this.log = { text, color, t: performance.now() }; }

  private setTree(id: TreeId) {
    if (id === this.tree) return;
    this.tree = id; this.row = 0; this.col = 0; this.confirm = null;
    this.game.audio.ui();
  }
  private select(r: number, c: number) {
    const grid = this.grid();
    r = Math.max(0, Math.min(grid.length - 1, r));
    c = Math.max(0, Math.min((grid[r]?.length ?? 1) - 1, c));
    if (r !== this.row || c !== this.col) this.confirm = null;
    this.row = r; this.col = c;
  }

  // ------------------------------------------------------------------ actions
  /** Entrée / clic sur « Apprendre » : arme la confirmation (ou refuse en disant pourquoi). */
  private arm(d: TalentDef) {
    const chk = this.game.character.canLearnTalent(d.id);
    if (chk.ok) { this.confirm = d.id; this.confirmT = performance.now(); } else this.say(refusalText(chk, d), chk.why === 'rangee' ? C.red : C.orange);
  }
  private commit(d: TalentDef) {
    const g = this.game, ch = g.character;
    this.confirm = null;
    if (!ch.learnTalent(d.id)) { this.say(refusalText(ch.canLearnTalent(d.id), d), C.red); return; }
    g.syncStats(); g.coop?.saveNow(); g.audio.talent();
    const text = `Talent appris : ${d.name} (${ch.talentRank(d.id)}/${d.max}).`;
    g.events.emit('message', { text, color: TREE_COLOR[d.tree] });
    this.say(text, TREE_COLOR[d.tree]);
    this.flash = { id: d.id, t: performance.now() };
  }
  private askReset() {
    const ch = this.game.character, cost = respecCost(ch.level);
    if (ch.talentSpent() <= 0) this.say('Aucun talent à réinitialiser.', C.dim);
    else if (ch.inv.gold < cost) this.say(`Il faut ${cost} or pour réinitialiser vos talents (vous en avez ${ch.inv.gold}).`, C.red);
    else { this.confirm = '*reset'; this.confirmT = performance.now(); }
  }
  private doReset() {
    const g = this.game, ch = g.character, cost = respecCost(ch.level);
    this.confirm = null;
    if (!ch.respecTalents()) { this.say('Pas assez d’or.', C.red); return; }
    g.syncStats(); g.coop?.saveNow(); g.audio.ui();
    const text = `Talents réinitialisés (${cost} or) : ${ch.talentPoints()} point${ch.talentPoints() > 1 ? 's' : ''} à dépenser.`;
    g.events.emit('message', { text, color: C.gold });
    this.say(text, C.gold);
    this.row = 0; this.col = 0;
  }
  private enter() {
    if (this.confirm === '*reset') { this.doReset(); return; }
    const d = this.current();
    if (!d) return;
    if (this.confirm === d.id) this.commit(d); else this.arm(d);
  }

  /** Entrées du clavier ; renvoie true si la touche est consommée (Échap qui annule une confirmation comprise). */
  input(ctx: UICtx): boolean {
    const i = ctx.input, grid = this.grid();
    if (i.key('Escape') && this.confirm) { this.confirm = null; return true; }
    for (let k = 0; k < TREES.length; k++) if (i.pressed('Digit' + (k + 1)) || i.pressed('Numpad' + (k + 1))) { this.setTree(TREES[k].id); return true; }
    if (i.key('Tab')) { this.setTree(TREES[(TREES.findIndex((t) => t.id === this.tree) + 1) % TREES.length].id); return true; }
    if (i.pressed('ArrowUp')) { this.select(this.row - 1, this.col); return true; }
    if (i.pressed('ArrowDown')) { this.select(Math.min(grid.length - 1, this.row + 1), this.col); return true; }
    if (i.pressed('ArrowLeft')) { this.select(this.row, this.col - 1); return true; }
    if (i.pressed('ArrowRight')) { this.select(this.row, this.col + 1); return true; }
    if (i.key('r')) { this.askReset(); return true; }
    if (i.pressed('Enter') || i.pressed('Space')) { this.enter(); return true; }
    return false;
  }

  // ------------------------------------------------------------------ dessin
  draw(ctx: UICtx, x: number, y: number, w: number, h: number): void {
    const g = ctx.grid, ch = this.game.character, now = performance.now(), m = ctx.mouseCell;
    const tree = TREE_BY_ID.get(this.tree)!;
    const pts = ch.talentPoints(), spent = ch.talentSpent();
    const grid = this.grid();
    this.select(this.row, this.col); // borne le curseur
    if (!this.mouseRef) this.mouseRef = { x: m.x, y: m.y };
    if (m.x !== this.mouseRef.x || m.y !== this.mouseRef.y) this.moved = true;
    let anyOver = false;
    g.text(x + 2, y + 2, `Points de talent : ${pts} disponible${pts > 1 ? 's' : ''} · ${spent} dépensé${spent > 1 ? 's' : ''}${pts ? '' : ` · prochain point au niveau ${(Math.floor(ch.level / 3) + 1) * 3}`}`.slice(0, w - 4), pts ? C.gold : C.title);
    // onglets des arbres
    let tx = x + 2;
    TREES.forEach((t, i) => {
      const label = ` ${i + 1}.${t.short} (${treeSpent(ch.talents, t.id)}) `, on = t.id === this.tree;
      const over = m.y === y + 3 && m.x >= tx && m.x < tx + label.length;
      g.text(tx, y + 3, label, on ? TREE_COLOR[t.id] : over ? C.white : C.dim, on ? C.sel : -1);
      if (over && ctx.clicked && !on) this.setTree(t.id);
      tx += label.length + 1;
    });
    const lw = Math.floor(w * 0.55), bw = Math.min(20, Math.floor((lw - 4) / 3));
    g.text(x + 2, y + 4, fit(tree.blurb, lw - 3), C.dim);
    for (let j = 4; j < h - 3; j++) g.text(x + lw + 1, y + j, '│', C.border);

    // rangées : en-tête puis cases de 4 lignes
    const have = treeSpent(ch.talents, this.tree);
    grid.forEach((list, r) => {
      const hy = y + 5 + r * 5, need = ROW_REQ[r], open = have >= need;
      if (hy + 4 >= y + h - 3) return;
      const head = r === 0 ? 'Rangée 1 · libre' : `Rangée ${r + 1} · exige ${need} points dépensés (${Math.min(have, need)}/${need}) · ${open ? 'ouverte' : 'verrouillée'}`;
      g.text(x + 2, hy, fit(head, lw - 3), open ? C.green : C.red);
      list.forEach((d, c) => {
        const bx = x + 2 + c * (bw + 1), by = hy + 1, rank = ch.talentRank(d.id), chk = ch.canLearnTalent(d.id);
        const sel = r === this.row && c === this.col, over = m.x >= bx && m.x < bx + bw && m.y >= by && m.y < by + 4;
        if (over) {
          anyOver = true;
          const key = r + ',' + c;
          if (this.hoverKey !== key) { this.hoverKey = key; this.hoverT = now; this.hoverDone = false; }
          // le survol déplace le curseur (après un court arrêt, jamais pendant une confirmation, jamais avant que le pointeur ait bougé), sans écraser le clavier
          if (this.moved && !this.confirm && !this.hoverDone && now - this.hoverT >= 180) { this.select(r, c); this.hoverDone = true; }
          if (ctx.clicked) { this.hoverDone = true; if (sel && chk.ok) this.arm(d); else this.select(r, c); }
        }
        const locked = chk.why === 'rangee', maxed = chk.why === 'max', learn = chk.ok, tc = TREE_COLOR[d.tree];
        const flashing = this.flash && this.flash.id === d.id && now - this.flash.t < 700 && Math.floor((now - this.flash.t) / 120) % 2 === 0;
        const bc = flashing ? C.white : locked ? C.faint : learn ? (Math.floor(now / 500) % 2 ? C.white : tc) : rank ? tc : C.dim;
        g.box(bx, by, bw, 4, { fg: bc, bg: sel ? C.sel : C.panel, double: sel, alpha: sel ? 0.95 : 0.5 });
        g.text(bx + 1, by + 1, fit(d.name, bw - 2), locked ? C.faint : rank ? tc : C.text);
        const pips = '■'.repeat(rank) + '□'.repeat(d.max - rank);
        g.text(bx + 1, by + 2, fit(`${rank ? '◆' : '◇'} ${pips} ${rank}/${d.max}${maxed ? ' √' : learn ? ' [+]' : ''}`, bw - 2), locked ? C.faint : maxed ? C.gold : learn ? C.green : C.dim);
      });
    });

    if (!anyOver) this.hoverKey = '';

    // bonus actifs (tous arbres confondus)
    const cap = (y + h - 5) - (y + 22) + 1;
    if (cap >= 1) {
      g.text(x + 2, y + 21, 'Bonus actifs', C.title);
      const act = (Object.keys(FX_META) as FxKey[]).map((k) => [k, fxTotal(ch.talents, k)] as const).filter(([, v]) => v > 0);
      if (!act.length) g.text(x + 2, y + 22, fit('Aucun talent appris : un point tous les 3 niveaux.', lw - 3), C.dim);
      const nc = act.length > cap ? 2 : 1, cw2 = nc === 2 ? Math.floor((lw - 3) / 2) : lw - 3, shown = act.slice(0, cap * nc);
      shown.forEach(([k, v], n) => {
        const more = n === shown.length - 1 && act.length > shown.length;
        g.text(x + 2 + (n % nc) * cw2, y + 22 + Math.floor(n / nc), fit(more ? `… +${act.length - n} autres` : `${FX_META[k].fmt(v)} ${FX_META[k].label}`, cw2 - 1), C.text);
      });
    }

    // détail du talent choisi (colonne de droite) et actions
    const cur = grid[this.row]?.[this.col];
    if (cur) this.detail(ctx, cur, x + lw + 3, y + 5, w - lw - 5, y + h - 4);
    if (this.log && now - this.log.t < 5000) g.text(x + 2, y + h - 3, fit(this.log.text, w - 4), this.log.color);
    g.text(x + 2, y + h - 2, '1-4 arbre · ←→↑↓ choisir · Entrée : apprendre · R : réinitialiser · P : fiche · K/Échap : fermer'.slice(0, w - 4), C.dim);
  }

  private detail(ctx: UICtx, d: TalentDef, dx: number, y0: number, dw: number, lim: number) {
    const g = ctx.grid, ch = this.game.character, tc = TREE_COLOR[d.tree], rank = ch.talentRank(d.id), chk = ch.canLearnTalent(d.id);
    let yy = y0;
    const room = lim - 4; // les 3 dernières lignes sont réservées aux actions
    const line = (s: string, c: number) => { if (yy < room) g.text(dx, yy, s.slice(0, dw), c); yy++; };
    // l'unité reste collée à son nombre pendant le retour à la ligne (espace insécable, rétablie avant l'affichage)
    const para = (s: string, c: number) => { for (const l of TextGrid.wrap(s.replace(/(\d) (%|pts|cases?|s|END|PV|mana)(?![\p{L}])/gu, '$1\u00a0$2'), dw)) line(l.replace(/\u00a0/g, ' '), c); };
    line(d.name, tc);
    line(`${TREE_BY_ID.get(d.tree)!.name} · rangée ${d.row} · rang ${rank}/${d.max}  ${'■'.repeat(rank)}${'□'.repeat(d.max - rank)}`, C.dim);
    if (chk.ok) line('État : disponible', C.green);
    else if (chk.why === 'max') line('État : rang maximal', C.gold);
    else para(refusalText(chk, d), chk.why === 'rangee' ? C.red : C.orange);
    yy++;
    para(d.desc, C.text);
    yy++;
    const keys = Object.keys(d.fx) as FxKey[];
    const all = (r: number) => keys.map((k) => `${FX_META[k].label} ${FX_META[k].fmt(d.fx[k]! * r)}`).join(' · ');
    para(`Par rang : ${all(1)}`, C.cyan);
    if (rank > 0) para(`Actuel (${rank}/${d.max}) : ${all(rank)}`, C.green);
    if (rank < d.max) para(`Rang ${rank + 1} : ${all(rank + 1)}`, C.yellow);
    yy++;
    const next = rank < d.max ? ch.previewTalent(d.id, rank + 1) : null;
    for (const k of keys) para(`${CONCRETE[k][0]} : ${CONCRETE[k][1](ch)}${next ? ' → ' + CONCRETE[k][1](next) : ''}`, C.text);

    // zone d'actions (en bas) : confirmation ou bouton
    const ay = lim - 3;
    const btn = (bx: number, by: number, label: string, fn: () => void, c = C.yellow) => {
      const over = ctx.mouseCell.y === by && ctx.mouseCell.x >= bx && ctx.mouseCell.x < bx + label.length;
      g.text(bx, by, label, over ? 0xffffff : c, over ? C.sel : -1);
      if (over && ctx.clicked) fn();
      return bx + label.length + 2;
    };
    // question de confirmation : jamais tronquée, sur deux lignes au besoin (la ligne ay - 1 est libre)
    const ask = (s: string, c: number) => {
      const ls = TextGrid.wrap(s, dw);
      if (ls.length > 2) ls.splice(1, ls.length - 1, fit(ls.slice(1).join(' '), dw));
      ls.forEach((l, n) => g.text(dx, ay - (ls.length - 1) + n, l, c));
    };
    if (this.confirm === '*reset') {
      const cost = respecCost(ch.level);
      ask(`Réinitialiser tous vos talents pour ${cost} or ?`, C.orange);
      let bx = btn(dx, ay + 1, '[ Oui : Entrée ]', () => { if (this.armed()) this.doReset(); });
      btn(bx, ay + 1, '[ Non : Échap ]', () => { this.confirm = null; }, C.dim);
    } else if (this.confirm === d.id) {
      ask(`Dépenser 1 point pour « ${d.name} » (rang ${rank + 1}/${d.max}) ?`, C.yellow);
      let bx = btn(dx, ay + 1, '[ Oui : Entrée ]', () => { if (this.armed()) this.commit(d); });
      btn(bx, ay + 1, '[ Non : Échap ]', () => { this.confirm = null; }, C.dim);
    } else if (chk.ok) btn(dx, ay + 1, '[ Apprendre : 1 point ]', () => this.arm(d));
  }
}
