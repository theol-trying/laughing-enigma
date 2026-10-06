// Ambiances sonores vivantes, synthétisées et placées dans le monde : oiseaux le jour, grillons la
// nuit, rumeur du village, rivière ou lac proche. (Le marteau du forgeron et les cris des
// créatures sont déclenchés par le jeu, à leur position.)

export interface Pos { x: number; y: number; z: number }

export interface AmbienceState {
  /** auditeur */
  x: number; y: number; z: number;
  day: number;          // 0 nuit … 1 plein jour
  rain: number;
  outdoor: boolean;
  forest: number;       // 0..1 : densité d'arbres / bois (plus d'oiseaux)
  crowd: number;        // 0..1 : animation du village alentour
  water: Pos | null;    // point d'eau le plus proche
  waterKind: 'rivière' | 'lac' | 'mer' | null;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Ambience {
  private birdT = 2;
  private crickets: { p: Pos; t: number; life: number }[] = [];
  private crowd: GainNode;
  private crowdF: BiquadFilterNode;
  private water: GainNode;
  private waterPan: PannerNode;
  private waterF: BiquadFilterNode;
  private modT = 0;

  constructor(private ctx: AudioContext, private out: AudioNode, noise: AudioBuffer, brown: AudioBuffer, private panner: (p: Pos) => PannerNode) {
    // rumeur du village : bruit brun filtré dans la bande des voix, modulé lentement
    const cs = ctx.createBufferSource(); cs.buffer = brown; cs.loop = true;
    this.crowdF = ctx.createBiquadFilter(); this.crowdF.type = 'bandpass'; this.crowdF.frequency.value = 650; this.crowdF.Q.value = 0.9;
    const cf2 = ctx.createBiquadFilter(); cf2.type = 'peaking'; cf2.frequency.value = 1300; cf2.gain.value = 5;
    this.crowd = ctx.createGain(); this.crowd.gain.value = 0;
    cs.connect(this.crowdF); this.crowdF.connect(cf2); cf2.connect(this.crowd); this.crowd.connect(out); cs.start();
    // eau : nappe de bruit filtrée, placée au point d'eau le plus proche
    const ws = ctx.createBufferSource(); ws.buffer = noise; ws.loop = true;
    this.waterF = ctx.createBiquadFilter(); this.waterF.type = 'bandpass'; this.waterF.frequency.value = 900; this.waterF.Q.value = 0.5;
    const wl = ctx.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 2600;
    this.water = ctx.createGain(); this.water.gain.value = 0;
    this.waterPan = panner({ x: 0, y: 0, z: 0 });
    this.waterPan.refDistance = 6; this.waterPan.rolloffFactor = 1.4;
    ws.connect(this.waterF); this.waterF.connect(wl); wl.connect(this.water); this.water.connect(this.waterPan); ws.start();
  }

  update(s: AmbienceState): void {
    const c = this.ctx, now = c.currentTime, dt = 1 / 60;
    const calm = s.outdoor ? Math.max(0, 1 - s.rain * 2.5) : 0;
    // oiseaux : chants brefs, ici et là dans les arbres
    const birds = calm * Math.max(0, s.day - 0.35) * (0.35 + s.forest);
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = birds > 0.05 ? rnd(0.5, 3.2) / Math.min(2, birds * 1.6) : 2;
      if (birds > 0.05) this.bird({ x: s.x + rnd(-28, 28), y: s.y + rnd(3, 9), z: s.z + rnd(-28, 28) });
    }
    // grillons : quelques chanteurs dans l'herbe autour de soi, la nuit
    const night = calm * Math.max(0, 0.6 - s.day) / 0.6;
    const want = Math.round(night * 5);
    while (this.crickets.length < want) this.crickets.push({ p: { x: s.x + rnd(-22, 22), y: s.y - 1, z: s.z + rnd(-22, 22) }, t: rnd(0, 1), life: rnd(15, 40) });
    if (this.crickets.length > want) this.crickets.length = want;
    for (const k of this.crickets) {
      k.t -= dt; k.life -= dt;
      if (k.life <= 0 || Math.hypot(k.p.x - s.x, k.p.z - s.z) > 35) { k.p = { x: s.x + rnd(-22, 22), y: s.y - 1, z: s.z + rnd(-22, 22) }; k.life = rnd(15, 40); }
      if (k.t <= 0) { k.t = rnd(0.55, 1.3); this.cricket(k.p); }
    }
    // rumeur du village (le jour), modulée doucement
    this.modT -= dt;
    if (this.modT <= 0) {
      this.modT = rnd(0.25, 0.6);
      this.crowd.gain.setTargetAtTime(s.crowd * s.day * (s.outdoor ? 0.06 : 0.03) * rnd(0.6, 1.2), now, 0.25);
      this.crowdF.frequency.setTargetAtTime(rnd(520, 820), now, 0.3);
    }
    // eau proche : rivière (vive), lac ou mer (plus grave, en vagues)
    if (s.water && s.waterKind) {
      const pn = this.waterPan;
      if (pn.positionX) { pn.positionX.setTargetAtTime(s.water.x, now, 0.3); pn.positionY.setTargetAtTime(s.water.y, now, 0.3); pn.positionZ.setTargetAtTime(s.water.z, now, 0.3); }
      const river = s.waterKind === 'rivière';
      const swell = river ? 1 : 0.6 + 0.4 * Math.sin(now * (s.waterKind === 'mer' ? 0.5 : 0.8));
      this.water.gain.setTargetAtTime((river ? 0.22 : 0.14) * swell, now, 0.4);
      this.waterF.frequency.setTargetAtTime(river ? 1100 : 520, now, 1);
    } else this.water.gain.setTargetAtTime(0, now, 0.8);
  }

  /** Chant d'oiseau : quelques notes glissées dans l'aigu. */
  private bird(p: Pos) {
    const c = this.ctx, pn = this.panner(p), n = 2 + Math.floor(Math.random() * 5);
    const base = rnd(2600, 4800), style = Math.random();
    let t = c.currentTime + 0.02;
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator(); o.type = style < 0.7 ? 'sine' : 'triangle';
      const d = rnd(0.04, style < 0.4 ? 0.09 : 0.16);
      const f0 = base * rnd(0.85, 1.2);
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * (style < 0.5 ? rnd(1.2, 1.6) : rnd(0.6, 0.85)), t + d);
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g); g.connect(pn); o.start(t); o.stop(t + d + 0.02);
      t += d + rnd(0.02, 0.12);
    }
    setTimeout(() => pn.disconnect(), (t - c.currentTime + 1) * 1000);
  }

  /** Grillon : trois impulsions rapides vers 4,5 kHz. */
  private cricket(p: Pos) {
    const c = this.ctx, pn = this.panner(p), f = rnd(4200, 4900);
    for (let i = 0; i < 3; i++) {
      const t = c.currentTime + i * 0.055;
      const o = c.createOscillator(); o.frequency.value = f;
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.006); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      o.connect(g); g.connect(pn); o.start(t); o.stop(t + 0.04);
    }
    setTimeout(() => pn.disconnect(), 1200);
  }
}
