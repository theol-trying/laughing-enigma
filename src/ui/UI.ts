import type { Input } from '@ascii-fort/ascii-engine/Input';
import type { TextGrid } from '@ascii-fort/ascii-engine/TextGrid';
import type { Renderer } from '@ascii-fort/ascii-engine/Renderer';

// Écrans d'interface en caractères, empilés. Un écran « modal » met le jeu en pause et libère
// la souris (le pointeur redevient visible pour cliquer dans les menus).

export interface UICtx { input: Input; grid: TextGrid; renderer: Renderer; mouseCell: { x: number; y: number }; clicked: boolean; close(): void }

export interface Screen {
  modal: boolean;
  /** garde la capture de la souris malgré le mode modal (mode photo) */
  wantsLock?: boolean;
  draw(ctx: UICtx): void;
  /** gère les entrées ; appeler ctx.close() pour fermer */
  input(ctx: UICtx): void;
}

export class UIManager {
  stack: Screen[] = [];
  constructor(private renderer: Renderer, private inputRef: Input) {}

  open(s: Screen): void { this.stack.push(s); if (s.modal && !s.wantsLock) this.inputRef.exitLock(); }
  replace(s: Screen): void { this.stack.pop(); this.open(s); }
  /** appelé quand le dernier écran modal se ferme (pour recapturer la souris en jeu) */
  onResume: (() => void) | null = null;
  close(): void { this.stack.pop(); if (!this.modal) this.onResume?.(); }
  closeAll(): void { this.stack = []; }
  get top(): Screen | undefined { return this.stack[this.stack.length - 1]; }
  get modal(): boolean { return this.stack.some((s) => s.modal); }

  private ctx(): UICtx {
    const i = this.inputRef;
    return { input: i, grid: this.renderer.ui, renderer: this.renderer, mouseCell: this.renderer.cellAt(i.mouseX, i.mouseY), clicked: i.mouseClicked(0), close: () => this.close() };
  }

  update(): void {
    const t = this.top;
    if (t) t.input(this.ctx());
  }

  draw(): void { const c = this.ctx(); for (const s of this.stack) s.draw(c); }
}

/** Liste d'options numérotées, cliquables ; renvoie l'index choisi ou −1. */
export function optionList(ctx: UICtx, x: number, y: number, w: number, labels: string[], color: number, hover: number): number {
  const g = ctx.grid;
  let chosen = -1;
  labels.forEach((l, i) => {
    const over = ctx.mouseCell.y === y + i && ctx.mouseCell.x >= x && ctx.mouseCell.x < x + w;
    const text = `${i + 1}. ${l}`.slice(0, w);
    g.text(x, y + i, text.padEnd(w), over ? 0xffffff : color, over ? hover : -1, over ? 1 : 0);
    if (over && ctx.clicked) chosen = i;
  });
  for (let k = 0; k < Math.min(9, labels.length); k++) if (ctx.input.pressed('Digit' + (k + 1)) || ctx.input.pressed('Numpad' + (k + 1))) chosen = k;
  return chosen;
}
