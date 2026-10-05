// Clavier / souris / Pointer Lock. Déplacements lus par e.code (position physique : ZQSD en
// AZERTY), raccourcis par e.key (caractère réel).

export class Input {
  readonly down = new Set<string>();          // codes physiques maintenus
  private pressedCodes = new Set<string>();   // codes pressés cette frame
  private pressedKeys: string[] = [];         // e.key pressés cette frame (raccourcis, saisie)
  mouseDX = 0; mouseDY = 0;
  mouseX = 0; mouseY = 0;                      // pixels écran (device)
  buttons = 0;
  private clicked = 0; private released = 0;
  wheel = 0;
  locked = false;
  /** quand défini, reçoit la saisie texte (champ seed, console) ; renvoie true si consommé */
  textSink: ((e: KeyboardEvent) => boolean) | null = null;
  private lastTap = new Map<string, number>();
  doubleTapped: string | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (this.textSink && this.textSink(e)) { e.preventDefault(); return; }
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F3', 'F5', 'F9', 'Backquote', 'Quote'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.pressedCodes.add(e.code);
        this.pressedKeys.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
        const now = performance.now(), last = this.lastTap.get(e.code) ?? 0;
        if (now - last < 260 && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) this.doubleTapped = e.code;
        this.lastTap.set(e.code, now);
      }
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => { this.down.clear(); this.buttons = 0; });
    canvas.addEventListener('mousemove', (e) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.mouseX = e.offsetX * dpr; this.mouseY = e.offsetY * dpr;
      if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    canvas.addEventListener('mousedown', (e) => { this.buttons |= 1 << e.button; this.clicked |= 1 << e.button; e.preventDefault(); });
    window.addEventListener('mouseup', (e) => { this.buttons &= ~(1 << e.button); this.released |= 1 << e.button; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
  }

  requestLock(): void { if (!this.locked) this.canvas.requestPointerLock?.(); }
  exitLock(): void { if (this.locked) document.exitPointerLock?.(); }

  isDown(code: string): boolean { return this.down.has(code); }
  pressed(code: string): boolean { return this.pressedCodes.has(code); }
  /** raccourci par caractère (e.key en minuscule) ou nom de touche (« Escape », « Tab »…) */
  key(k: string): boolean { return this.pressedKeys.includes(k); }
  keysThisFrame(): readonly string[] { return this.pressedKeys; }
  mouseClicked(b = 0): boolean { return (this.clicked & (1 << b)) !== 0; }
  mouseReleased(b = 0): boolean { return (this.released & (1 << b)) !== 0; }
  mouseDown(b = 0): boolean { return (this.buttons & (1 << b)) !== 0; }

  endFrame(): void {
    this.pressedCodes.clear(); this.pressedKeys = [];
    this.mouseDX = this.mouseDY = 0; this.clicked = this.released = 0; this.wheel = 0;
    this.doubleTapped = null;
  }
}
