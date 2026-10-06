// Musique procédurale adaptative, entièrement synthétisée (aucun fichier audio).
// Instruments médiévaux : luth (corde pincée Karplus-Strong, précalculée par note), flûte (sinus,
// souffle, vibrato), bourdon de vielle (deux scies désaccordées filtrées), tambour sur cadre et
// tambourin. Chaque ambiance a son mode, son tempo, sa progression d'accords et sa densité ; les
// accords, arpèges et phrases de flûte sont tirés au fil de l'eau. Changement d'ambiance : fondu.

export type Mood = 'silence' | 'exploration' | 'village' | 'nuit' | 'donjon' | 'combat';

interface Theme {
  tempo: number; root: number; scale: number[]; prog: number[];
  lute: number; flute: number; drone: number; drums: number;
  /** mesures jouées puis mesures de silence (respiration) */
  play: [number, number]; rest: [number, number];
  reverb: number;
}

const DORIAN = [0, 2, 3, 5, 7, 9, 10], MIXO = [0, 2, 4, 5, 7, 9, 10], AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10], HARMONIC = [0, 2, 3, 5, 7, 8, 11];

const THEMES: Record<Exclude<Mood, 'silence'>, Theme> = {
  exploration: { tempo: 78, root: 50, scale: DORIAN, prog: [0, 6, 3, 4, 0, 2, 3, 4], lute: 0.65, flute: 0.55, drone: 0.35, drums: 0, play: [16, 24], rest: [6, 12], reverb: 0.35 },
  village: { tempo: 104, root: 55, scale: MIXO, prog: [0, 3, 4, 0, 0, 6, 3, 4], lute: 0.9, flute: 0.6, drone: 0.2, drums: 0.35, play: [16, 32], rest: [4, 8], reverb: 0.25 },
  nuit: { tempo: 60, root: 57, scale: AEOLIAN, prog: [0, 5, 3, 4, 0, 5, 6, 4], lute: 0.3, flute: 0.4, drone: 0.55, drums: 0, play: [12, 20], rest: [8, 14], reverb: 0.5 },
  donjon: { tempo: 52, root: 45, scale: PHRYGIAN, prog: [0, 1, 0, 6, 0, 1, 5, 6], lute: 0.15, flute: 0.2, drone: 0.9, drums: 0.15, play: [16, 24], rest: [4, 8], reverb: 0.7 },
  combat: { tempo: 138, root: 52, scale: HARMONIC, prog: [0, 5, 6, 4, 0, 5, 3, 4], lute: 0.85, flute: 0.3, drone: 0.6, drums: 1, play: [999, 999], rest: [0, 0], reverb: 0.2 },
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export class Music {
  private bus: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private reverb: ConvolverNode;
  private droneOsc: OscillatorNode[] = [];
  private droneGain: GainNode;
  private droneFilter: BiquadFilterNode;
  private plucks = new Map<number, AudioBuffer>();
  private noise: AudioBuffer;
  private mood: Mood = 'silence';
  private theme: Theme | null = null;
  private next = 0;          // heure (contexte) de la prochaine croche
  private step = 0;          // croche courante dans la mesure (0..7)
  private bar = 0;
  private chord = 0;
  private section: 'play' | 'rest' = 'play';
  private sectionLeft = 8;
  private melody = 0;        // degré courant de la flûte
  private phrase = 0;        // croches restantes dans la phrase de flûte
  private motif: number[] = [];
  private volume = 0.6;

  constructor(private ctx: AudioContext, out: AudioNode, noise: AudioBuffer) {
    this.noise = noise;
    this.bus = ctx.createGain(); this.bus.gain.value = 0; this.bus.connect(out);
    this.dry = ctx.createGain(); this.dry.connect(this.bus);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.3;
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this.impulse(2.4);
    this.wet.connect(this.reverb); this.reverb.connect(this.bus);
    // bourdon : deux scies légèrement désaccordées (fondamentale et quinte), filtrées
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0;
    this.droneFilter = ctx.createBiquadFilter(); this.droneFilter.type = 'lowpass'; this.droneFilter.frequency.value = 650; this.droneFilter.Q.value = 0.7;
    this.droneFilter.connect(this.droneGain); this.droneGain.connect(this.dry); this.droneGain.connect(this.wet);
    for (const det of [-4, 5, 0]) {
      const o = ctx.createOscillator(); o.type = det === 0 ? 'triangle' : 'sawtooth'; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = det === 0 ? 0.5 : 0.28;
      o.connect(g); g.connect(this.droneFilter); o.start();
      this.droneOsc.push(o);
    }
  }

  setVolume(v: number): void { this.volume = v; if (this.mood !== 'silence') this.bus.gain.setTargetAtTime(v * 1.2, this.ctx.currentTime, 0.5); }

  /** Ambiance souhaitée (appelée chaque image) ; la transition se fait en douceur. */
  update(mood: Mood): void {
    const c = this.ctx, now = c.currentTime;
    if (mood !== this.mood) {
      this.mood = mood;
      if (mood === 'silence') { this.bus.gain.setTargetAtTime(0, now, 1.2); this.theme = null; }
      else {
        // fondu : on baisse, on change de thème à la prochaine mesure, puis on remonte
        const fast = mood === 'combat';
        this.bus.gain.setTargetAtTime(0.0001, now, fast ? 0.15 : 0.9);
        this.theme = THEMES[mood];
        this.step = 0; this.bar = 0; this.section = 'play';
        this.sectionLeft = Math.round(rnd(...this.theme.play));
        this.next = Math.max(this.next, now + (fast ? 0.35 : 2.2));
        this.bus.gain.setTargetAtTime(this.volume * 1.2, this.next, fast ? 0.3 : 1.5);
        this.wet.gain.setTargetAtTime(this.theme.reverb, now, 1);
        this.motif = [];
      }
    }
    const t = this.theme;
    if (!t) return;
    if (this.next < now - 0.5) this.next = now + 0.05;            // onglet en arrière-plan : on se recale
    const eighth = 60 / t.tempo / 2;
    while (this.next < now + 0.3) {
      this.tick(t, this.next, eighth);
      this.next += eighth;
    }
  }

  private tick(t: Theme, at: number, eighth: number) {
    const s = this.step;
    if (s === 0) {
      // nouvelle mesure : accord suivant, sections jeu / silence
      this.chord = t.prog[this.bar % t.prog.length];
      if (--this.sectionLeft <= 0) {
        this.section = this.section === 'play' ? 'rest' : 'play';
        this.sectionLeft = Math.max(1, Math.round(rnd(...(this.section === 'play' ? t.play : t.rest))));
      }
      const playing = this.section === 'play';
      const rootM = t.root - 12 + t.scale[this.chord % 7];
      this.droneOsc[0].frequency.setTargetAtTime(mtof(rootM), at, 0.4);
      this.droneOsc[1].frequency.setTargetAtTime(mtof(rootM + 7), at, 0.4);
      this.droneOsc[2].frequency.setTargetAtTime(mtof(rootM), at, 0.4);
      this.droneGain.gain.setTargetAtTime(t.drone * (playing ? 0.07 : 0.025), at, 1.2);
      this.bar++;
    }
    if (this.section === 'play') {
      // luth : arpège sur les notes de l'accord
      const strong = s % 2 === 0;
      if (Math.random() < t.lute * (strong ? 0.95 : 0.55)) {
        const pattern = [0, 2, 4, 7, 4, 2, 9, 4];
        const deg = this.chord + pattern[(s + this.bar) % pattern.length];
        this.pluck(this.note(t, deg, s === 0 ? -12 : 0), at, (s === 0 ? 0.32 : 0.22) * (this.mood === 'combat' ? 0.9 : 1), this.mood === 'combat' ? 0.25 : 1.2);
        if (s === 0 && Math.random() < 0.6) this.pluck(this.note(t, this.chord + 4, -12), at + 0.012, 0.16, 1.2);
      }
      // flûte : phrases qui reprennent un motif, notes tenues, respirations
      if (s % 2 === 0) this.fluteStep(t, at, eighth);
      // percussions
      if (t.drums > 0) {
        if (s === 0 || (this.mood === 'combat' && (s === 3 || s === 4))) this.drum(at, 0.5 * t.drums);
        else if (s === 4 && Math.random() < t.drums) this.drum(at, 0.3 * t.drums, true);
        if (this.mood === 'combat' ? true : s % 2 === 1 && Math.random() < t.drums * 0.8) this.tambourine(at, (s % 2 ? 0.05 : 0.08) * t.drums);
      }
    }
    this.step = (s + 1) % 8;
  }

  private fluteStep(t: Theme, at: number, eighth: number) {
    if (this.phrase <= 0) {
      if (Math.random() > t.flute) { this.phrase = -4; return; }
      this.phrase = pick([4, 6, 8]);
      if (!this.motif.length || Math.random() < 0.35) this.motif = Array.from({ length: 4 }, () => pick([-2, -1, 1, 1, 2, 0]));
      this.melody = this.chord + pick([0, 2, 4]);
    }
    if (this.phrase < 0) { this.phrase++; return; }
    const i = this.phrase-- % this.motif.length;
    this.melody += this.motif[i] ?? 0;
    if (this.melody > 11) this.melody -= 3; if (this.melody < 0) this.melody += 3;
    const hold = Math.random() < 0.35 ? 4 : 2;
    if (Math.random() < 0.85) this.flute(this.note(t, this.melody, 12), at, eighth * hold * 0.95, 0.075);
  }

  private note(t: Theme, degree: number, octave = 0): number {
    const d = ((degree % 7) + 7) % 7, o = Math.floor(degree / 7);
    return t.root + t.scale[d] + o * 12 + octave;
  }

  // ---------------------------------------------------------------- instruments
  /** Corde pincée (Karplus-Strong), calculée une fois par note. */
  private pluckBuffer(m: number): AudioBuffer {
    let b = this.plucks.get(m);
    if (b) return b;
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 1.6), f = mtof(m);
    b = this.ctx.createBuffer(1, len, sr);
    const out = b.getChannelData(0), N = Math.max(2, Math.round(sr / f));
    const ring = new Float32Array(N);
    let prev = 0;
    for (let i = 0; i < N; i++) { const w = Math.random() * 2 - 1; prev = prev * 0.5 + w * 0.5; ring[i] = prev; } // attaque adoucie
    const decay = 0.996 - Math.min(0.006, f / 200000);
    for (let i = 0, k = 0; i < len; i++) {
      const a = ring[k], b2 = ring[(k + 1) % N];
      out[i] = a;
      ring[k] = (a + b2) * 0.5 * decay;
      k = (k + 1) % N;
    }
    this.plucks.set(m, b);
    return b;
  }

  private pluck(m: number, at: number, gain: number, len: number) {
    const c = this.ctx, src = c.createBufferSource();
    src.buffer = this.pluckBuffer(m);
    const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 240; body.gain.value = 6; body.Q.value = 1;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, at); g.gain.setTargetAtTime(0, at + len * 0.6, len * 0.25);
    src.connect(body); body.connect(g); g.connect(this.dry); g.connect(this.wet);
    src.start(at); src.stop(at + len + 0.6);
  }

  private flute(m: number, at: number, dur: number, gain: number) {
    const c = this.ctx, f = mtof(m);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2; const g2 = c.createGain(); g2.gain.value = 0.08;
    const vib = c.createOscillator(); vib.frequency.value = 5.2; const vg = c.createGain(); vg.gain.value = 0;
    vg.gain.setValueAtTime(0, at); vg.gain.linearRampToValueAtTime(f * 0.007, at + Math.min(0.5, dur * 0.6));
    vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.07); g.gain.setTargetAtTime(gain * 0.8, at + 0.1, 0.3);
    g.gain.setTargetAtTime(0, at + dur, 0.09);
    // souffle à l'attaque
    const n = c.createBufferSource(); n.buffer = this.noise;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = f * 2.5; nf.Q.value = 1.5;
    const ng = c.createGain(); ng.gain.setValueAtTime(gain * 0.35, at); ng.gain.setTargetAtTime(gain * 0.06, at + 0.05, 0.08); ng.gain.setTargetAtTime(0, at + dur, 0.08);
    n.connect(nf); nf.connect(ng); ng.connect(g);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.dry); g.connect(this.wet);
    const end = at + dur + 0.5;
    for (const x of [o, o2, vib]) { x.start(at); x.stop(end); }
    n.start(at, Math.random() * 1.5, dur + 0.5);
  }

  private drum(at: number, gain: number, soft = false) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(soft ? 150 : 110, at); o.frequency.exponentialRampToValueAtTime(soft ? 80 : 46, at + 0.18);
    const g = c.createGain(); g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.001, at + (soft ? 0.25 : 0.4));
    o.connect(g); g.connect(this.dry); o.start(at); o.stop(at + 0.45);
    const n = c.createBufferSource(); n.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const ng = c.createGain(); ng.gain.setValueAtTime(gain * 0.35, at); ng.gain.exponentialRampToValueAtTime(0.001, at + 0.08);
    n.connect(f); f.connect(ng); ng.connect(this.dry); n.start(at, Math.random(), 0.1);
  }

  private tambourine(at: number, gain: number) {
    const c = this.ctx, n = c.createBufferSource(); n.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 7500; f.Q.value = 2;
    const g = c.createGain(); g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
    n.connect(f); f.connect(g); g.connect(this.dry); g.connect(this.wet); n.start(at, Math.random(), 0.14);
  }

  /** Réverbération : réponse impulsionnelle de bruit à décroissance exponentielle. */
  private impulse(sec: number): AudioBuffer {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * sec), b = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return b;
  }
}
