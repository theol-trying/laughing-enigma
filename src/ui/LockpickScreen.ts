import { C } from '@ascii-fort/ascii-engine/TextGrid';
import type { Screen, UICtx } from './UI';

// Crochetage : un curseur va et vient sur la serrure ; il faut l'arrêter (Espace, E ou clic) dans la
// zone de la goupille. Chaque goupille posée en ouvre une autre ; un raté peut casser le crochet.
// La difficulté rétrécit la zone et accélère le curseur ; la furtivité l'élargit.

export interface LockpickHost {
  picks(): number;
  breakPick(): void;
  /** progression de la compétence */
  practice(n: number): void;
}

export class LockpickScreen implements Screen {
  modal = true;
  private pin = 0;
  private pos = 0;
  private dir = 1;
  private zone = 0;
  private flash = { text: '', color: C.text, t: 0 };
  private readonly W = 32;
  private readonly width: number;
  private readonly speed: number;

  constructor(private label: string, private difficulty: number, skill: number, private host: LockpickHost, private onDone: (ok: boolean) => void) {
    this.width = Math.max(2, Math.round(7 - difficulty * 1.6 + skill / 18));
    this.speed = 14 + difficulty * 7;
    this.newZone();
  }

  private get pins(): number { return this.difficulty; }
  private newZone() { this.zone = 2 + Math.floor(Math.random() * (this.W - this.width - 4)); }
  private say(text: string, color: number) { this.flash = { text, color, t: 1.6 }; }

  draw(ctx: UICtx): void {
    const g = ctx.grid, w = Math.min(g.cols - 4, 50), h = 12, x = Math.floor((g.cols - w) / 2), y = Math.floor((g.rows - h) / 2);
    g.box(x, y, w, h, { title: `Crochetage — ${this.label}`, double: true, alpha: 0.96 });
    const pins = Array.from({ length: this.pins }, (_, i) => (i < this.pin ? '▓' : '░')).join(' ');
    g.text(x + 3, y + 2, `Goupilles : ${pins}    Crochets : ${this.host.picks()}`, C.text);
    const bx = x + Math.floor((w - this.W - 2) / 2);
    g.text(bx, y + 4, '╔' + '═'.repeat(this.W) + '╗', C.border);
    let bar = '';
    for (let i = 0; i < this.W; i++) bar += i === Math.floor(this.pos) ? '▌' : i >= this.zone && i < this.zone + this.width ? '▒' : '·';
    g.text(bx, y + 5, '║', C.border); g.text(bx + 1, y + 5, bar, C.dim); g.text(bx + 1 + this.W, y + 5, '║', C.border);
    g.text(bx + 1 + this.zone, y + 5, '▒'.repeat(this.width), C.gold);
    g.text(bx + 1 + Math.floor(this.pos), y + 5, '▌', C.white);
    g.text(bx, y + 6, '╚' + '═'.repeat(this.W) + '╝', C.border);
    if (this.flash.t > 0) g.center(y + 8, ` ${this.flash.text} `, this.flash.color, C.panel);
    g.text(x + 3, y + h - 2, 'Espace, E ou clic : poser · Échap : renoncer', C.dim);
  }

  input(ctx: UICtx): void {
    const i = ctx.input, dt = 1 / 60;
    if (this.flash.t > 0) this.flash.t -= dt;
    if (i.key('Escape')) { ctx.close(); this.onDone(false); return; }
    this.pos += this.dir * this.speed * dt;
    if (this.pos >= this.W - 1) { this.pos = this.W - 1; this.dir = -1; }
    if (this.pos <= 0) { this.pos = 0; this.dir = 1; }
    if (!(i.pressed('Space') || i.key('e') || ctx.clicked)) return;
    const at = Math.floor(this.pos);
    if (at >= this.zone && at < this.zone + this.width) {
      this.pin++;
      this.host.practice(1);
      if (this.pin >= this.pins) { ctx.close(); this.onDone(true); return; }
      this.say('Clic ! Une goupille cède.', C.green);
      this.newZone();
    } else if (Math.random() < 0.5) {
      this.host.breakPick();
      this.say('Crac ! Le crochet se brise.', C.red);
      if (this.host.picks() <= 0) { ctx.close(); this.onDone(false); }
    } else this.say('Raté… la goupille retombe.', C.orange);
  }
}
