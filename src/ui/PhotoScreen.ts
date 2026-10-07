import { C } from '@ascii-fort/ascii-engine/TextGrid';
import type { Screen, UICtx } from './UI';
import type { Game } from '../game/Game';

// Mode photo (F2) : caméra libre détachée du joueur, interface masquée. ZQSD/WASD + souris pour se
// déplacer, Espace/C monter-descendre, Maj plus vite, molette : champ de vision, +/- : heure (en solo),
// L : palette de couleurs. F2 ou Échap pour revenir au jeu.

export class PhotoScreen implements Screen {
  modal = true;
  /** garde la capture de la souris (vue à la souris) */
  wantsLock = true;
  private t0 = performance.now();
  private fov0: number;

  constructor(private game: Game, private cyclePalette: () => string) {
    const p = game.player;
    game.photoCam = { x: p.x, y: p.eyeY, z: p.z, heading: p.heading, pitch: p.pitch };
    this.fov0 = game.camera.fovY;
  }

  draw(ctx: UICtx): void {
    const age = (performance.now() - this.t0) / 1000;
    if (age > 5) return;
    const g = ctx.grid;
    g.center(g.rows - 2, ' Mode photo · ZQSD + souris · Espace/C : monter/descendre · molette : zoom · +/- : heure · L : palette · F2/Échap : quitter ', C.text, C.panel, Math.max(0, 0.8 - age * 0.12));
  }

  input(ctx: UICtx): void {
    const i = ctx.input, g = this.game, cam = g.photoCam;
    if (!cam) { ctx.close(); return; }
    if (i.key('F2') || i.key('Escape')) { g.photoCam = null; g.camera.fovY = this.fov0; ctx.close(); return; }
    const dt = 1 / 60;
    if (i.locked) { cam.heading += i.mouseDX * 0.0022; cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - i.mouseDY * 0.0022)); }
    const sp = (i.isDown('ShiftLeft') ? 18 : 5) * dt;
    const f = (i.isDown('KeyW') ? 1 : 0) - (i.isDown('KeyS') ? 1 : 0), r = (i.isDown('KeyD') ? 1 : 0) - (i.isDown('KeyA') ? 1 : 0);
    const cp = Math.cos(cam.pitch);
    cam.x += (Math.sin(cam.heading) * cp * f + Math.cos(cam.heading) * r) * sp;
    cam.z += (-Math.cos(cam.heading) * cp * f + Math.sin(cam.heading) * r) * sp;
    cam.y += (Math.sin(cam.pitch) * f + (i.isDown('Space') ? 1 : 0) - (i.isDown('KeyC') ? 1 : 0)) * sp;
    if (i.wheel) g.camera.fovY = Math.max(0.25, Math.min(1.9, g.camera.fovY + Math.sign(i.wheel) * 0.05));
    if (!g.coop) {
      if (i.key('+') || i.isDown('NumpadAdd')) g.time.minutes += 2;
      if (i.key('-') || i.isDown('NumpadSubtract')) g.time.minutes -= 2;
    }
    if (i.key('l')) { const name = this.cyclePalette(); g.events.emit('message', { text: `Palette : ${name}`, color: C.dim }); }
  }
}
