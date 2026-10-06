// Sons synthétiques (Web Audio, aucun fichier) : vent, pluie, feu, pas selon le sol, impacts,
// tonnerre et petits bruits d'interface.

export type Surface = 'herbe' | 'pierre' | 'bois' | 'eau' | 'neige';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private rain!: GainNode;
  private patter!: GainNode;
  private brown!: AudioBuffer;
  private rainLevel = 0;
  private fire!: GainNode;
  volume = 0.6;

  /** À appeler sur un geste de l'utilisateur (politique des navigateurs). */
  start(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC() as AudioContext;
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const loop = (filter: BiquadFilterNode, gain: number) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(filter); filter.connect(g); g.connect(this.master); src.start();
      return g;
    };
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 500; wf.Q.value = 0.8;
    this.wind = { gain: loop(wf, 0), filter: wf };
    // pluie : bruit brun (grave, doux) filtré + léger crépitement filtré en douceur
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const bd = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 1100; rf.Q.value = 0.3;
    const rs = ctx.createBufferSource(); rs.buffer = this.brown; rs.loop = true;
    this.rain = ctx.createGain(); this.rain.gain.value = 0;
    rs.connect(rf); rf.connect(this.rain); this.rain.connect(this.master); rs.start();
    const pf = ctx.createBiquadFilter(); pf.type = 'bandpass'; pf.frequency.value = 2400; pf.Q.value = 0.35;
    const pl = ctx.createBiquadFilter(); pl.type = 'lowpass'; pl.frequency.value = 3800;
    const ps = ctx.createBufferSource(); ps.buffer = this.noise; ps.loop = true;
    this.patter = ctx.createGain(); this.patter.gain.value = 0;
    ps.connect(pf); pf.connect(pl); pl.connect(this.patter); this.patter.connect(this.master); ps.start();
    const ff = ctx.createBiquadFilter(); ff.type = 'bandpass'; ff.frequency.value = 1400; ff.Q.value = 2;
    this.fire = loop(ff, 0);
  }

  setVolume(v: number): void { this.volume = v; if (this.ctx) this.master.gain.value = v; }

  /** Ambiance continue (appelée chaque image). */
  ambient(wind: number, rain: number, fireNear: number, t: number): void {
    const c = this.ctx;
    if (!c) return;
    const now = c.currentTime;
    this.wind.gain.gain.setTargetAtTime(0.04 + wind * 0.12, now, 0.5);
    this.wind.filter.frequency.setTargetAtTime(380 + Math.sin(t * 0.3) * 120 + wind * 300, now, 0.8);
    this.rainLevel = rain;
    this.rain.gain.setTargetAtTime(rain * 0.55, now, 0.8);
    this.patter.gain.setTargetAtTime(rain * 0.025, now, 0.8);
    // quelques grosses gouttes qui tombent près de soi
    if (rain > 0.05 && Math.random() < rain * 0.12) this.drop();
    // crépitements : petites impulsions aléatoires quand un feu est proche
    const crackle = fireNear > 0 && Math.random() < 0.25 ? 0.25 : 0.05;
    this.fire.gain.setTargetAtTime(fireNear * crackle, now, 0.02);
  }

  private burst(freq: number, type: BiquadFilterType, dur: number, gain: number, q = 1): void {
    const c = this.ctx;
    if (!c) return;
    const src = c.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    const now = c.currentTime;
    g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(now, Math.random() * 1.5, dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slide = 0): void {
    const c = this.ctx;
    if (!c) return;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); const now = c.currentTime;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), now + dur);
    g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g); g.connect(this.master); o.start(now); o.stop(now + dur + 0.02);
  }

  step(s: Surface): void {
    if (s === 'pierre') this.burst(2200, 'bandpass', 0.06, 0.18, 1.5);
    else if (s === 'bois') this.burst(450, 'bandpass', 0.08, 0.3, 2);
    else if (s === 'eau') this.burst(3000, 'highpass', 0.12, 0.15);
    else if (s === 'neige') this.burst(900, 'lowpass', 0.1, 0.18);
    else this.burst(700, 'lowpass', 0.07, 0.16);
  }
  private drop(): void { this.tone(1400 + Math.random() * 1600, 0.05, 0.012 + Math.random() * 0.012, 'sine', 0.6); }
  /** clapotis (nage, entrée dans l'eau) */
  splash(gain = 1): void { this.burst(500, 'lowpass', 0.35, 0.22 * gain); this.burst(1600, 'bandpass', 0.18, 0.06 * gain, 0.7); }
  hit(): void { this.tone(140, 0.12, 0.35, 'sine', 0.5); this.burst(1200, 'bandpass', 0.07, 0.25); }
  hurt(): void { this.tone(90, 0.25, 0.4, 'triangle', 0.6); }
  swing(): void { this.burst(1800, 'bandpass', 0.12, 0.08, 0.6); }
  thunder(): void { this.burst(120, 'lowpass', 2.2, 0.9); }
  ui(): void { this.tone(880, 0.06, 0.08, 'square'); }
  chime(): void { this.tone(660, 0.15, 0.1, 'triangle'); setTimeout(() => this.tone(990, 0.2, 0.1, 'triangle'), 120); }
}
