import { Music, type Mood } from './Music';
import { Ambience, type AmbienceState } from './Ambience';

// Sons synthétiques (Web Audio, aucun fichier) : musique procédurale, ambiances (vent, pluie,
// oiseaux, grillons, village, forge, rivière), pas selon le sol, impacts, cris de créatures.
// Les sons situés dans le monde sont spatialisés (on entend d'où vient un loup) ; sous l'eau,
// tout est assourdi.

export type Surface = 'herbe' | 'pierre' | 'bois' | 'eau' | 'neige';
export type { Mood };
export interface Pos { x: number; y: number; z: number }

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private rain!: GainNode;
  private patter!: GainNode;
  private fire!: GainNode;
  private music: Music | null = null;
  private ambience: Ambience | null = null;
  private underwater = false;
  volume = 0.6;
  musicVolume = 0.6;

  /** À appeler sur un geste de l'utilisateur (politique des navigateurs). */
  start(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC() as AudioContext;
    this.ctx = ctx;
    this.build(ctx, ctx.destination);
  }

  /** Construit le graphe (aussi utilisé hors ligne pour tester la musique). */
  build(ctx: BaseAudioContext, out: AudioNode): void {
    this.ctx = ctx as AudioContext;
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5;
    this.muffle.connect(out);
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.muffle);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // bruit « brun » : grave et doux (pluie, rivière, rumeur)
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const bd = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    const loop = (buf: AudioBuffer, filter: BiquadFilterNode, gain: number) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(filter); filter.connect(g); g.connect(this.amb); src.start();
      return g;
    };
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 500; wf.Q.value = 0.8;
    this.wind = { gain: loop(this.noise, wf, 0), filter: wf };
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 1100; rf.Q.value = 0.3;
    this.rain = loop(this.brown, rf, 0);
    const pf = ctx.createBiquadFilter(); pf.type = 'bandpass'; pf.frequency.value = 2400; pf.Q.value = 0.35;
    this.patter = loop(this.noise, pf, 0);
    const ff = ctx.createBiquadFilter(); ff.type = 'bandpass'; ff.frequency.value = 1400; ff.Q.value = 2;
    this.fire = loop(this.noise, ff, 0);
    const mus = ctx.createGain(); mus.connect(this.master);
    this.music = new Music(ctx as AudioContext, mus, this.noise);
    this.music.setVolume(this.musicVolume);
    this.ambience = new Ambience(ctx as AudioContext, this.amb, this.noise, this.brown, (p) => this.panner(p));
  }

  setVolume(v: number): void { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusicVolume(v: number): void { this.musicVolume = v; this.music?.setVolume(v); }

  /** Position et orientation de l'auditeur (la caméra). */
  listener(x: number, y: number, z: number, heading: number): void {
    const c = this.ctx;
    if (!c) return;
    const l = c.listener, fx = Math.sin(heading), fz = -Math.cos(heading);
    if (l.positionX) {
      l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
      l.forwardX.value = fx; l.forwardY.value = 0; l.forwardZ.value = fz;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { (l as any).setPosition(x, y, z); (l as any).setOrientation(fx, 0, fz, 0, 1, 0); }
  }

  /** Sous l'eau : tout est assourdi. */
  setUnderwater(on: boolean): void {
    const c = this.ctx;
    if (!c || on === this.underwater) return;
    this.underwater = on;
    this.muffle.frequency.setTargetAtTime(on ? 420 : 20000, c.currentTime, 0.15);
  }

  /** Musique : ambiance voulue (appelée chaque image). */
  mood(m: Mood): void { this.music?.update(m); }

  /** Ambiance continue (appelée chaque image). */
  ambient(wind: number, rain: number, fireNear: number, t: number, st?: AmbienceState): void {
    const c = this.ctx;
    if (!c) return;
    const now = c.currentTime;
    this.wind.gain.gain.setTargetAtTime(0.04 + wind * 0.12, now, 0.5);
    this.wind.filter.frequency.setTargetAtTime(380 + Math.sin(t * 0.3) * 120 + wind * 300, now, 0.8);
    this.rain.gain.setTargetAtTime(rain * 0.55, now, 0.8);
    this.patter.gain.setTargetAtTime(rain * 0.025, now, 0.8);
    if (rain > 0.05 && Math.random() < rain * 0.12) this.tone(1400 + Math.random() * 1600, 0.05, 0.012 + Math.random() * 0.012, 'sine', 0.6);
    // crépitements : petites impulsions aléatoires quand un feu est proche
    const crackle = fireNear > 0 && Math.random() < 0.25 ? 0.25 : 0.05;
    this.fire.gain.setTargetAtTime(fireNear * crackle, now, 0.02);
    if (st) this.ambience?.update(st);
  }

  /** Nœud de spatialisation placé dans le monde (atténuation selon la distance, gauche/droite). */
  private panner(p: Pos): PannerNode {
    const c = this.ctx!;
    const pn = c.createPanner();
    pn.panningModel = 'equalpower'; pn.distanceModel = 'inverse';
    pn.refDistance = 3; pn.maxDistance = 150; pn.rolloffFactor = 1.1;
    if (pn.positionX) { pn.positionX.value = p.x; pn.positionY.value = p.y; pn.positionZ.value = p.z; }
    else (pn as any).setPosition(p.x, p.y, p.z);
    pn.connect(this.sfx);
    return pn;
  }

  private out(pos: Pos | undefined, dur: number): AudioNode {
    if (!pos) return this.sfx;
    const pn = this.panner(pos);
    setTimeout(() => pn.disconnect(), (dur + 1) * 1000);
    return pn;
  }

  private burst(freq: number, type: BiquadFilterType, dur: number, gain: number, q = 1, pos?: Pos, at = 0): void {
    const c = this.ctx;
    if (!c) return;
    const src = c.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    const now = c.currentTime + at;
    g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(f); f.connect(g); g.connect(this.out(pos, dur + at));
    src.start(now, Math.random() * 1.5, dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slide = 0, pos?: Pos, at = 0): void {
    const c = this.ctx;
    if (!c) return;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); const now = c.currentTime + at;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), now + dur);
    g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g); g.connect(this.out(pos, dur + at)); o.start(now); o.stop(now + dur + 0.02);
  }

  step(s: Surface): void {
    if (s === 'pierre') this.burst(2200, 'bandpass', 0.06, 0.18, 1.5);
    else if (s === 'bois') this.burst(450, 'bandpass', 0.08, 0.3, 2);
    else if (s === 'eau') this.burst(3000, 'highpass', 0.12, 0.15);
    else if (s === 'neige') this.burst(900, 'lowpass', 0.1, 0.18);
    else this.burst(700, 'lowpass', 0.07, 0.16);
  }
  /** clapotis (nage, entrée dans l'eau) */
  splash(gain = 1, pos?: Pos): void { this.burst(500, 'lowpass', 0.35, 0.22 * gain, 1, pos); this.burst(1600, 'bandpass', 0.18, 0.06 * gain, 0.7, pos); }
  hit(pos?: Pos): void { this.tone(140, 0.12, 0.35, 'sine', 0.5, pos); this.burst(1200, 'bandpass', 0.07, 0.25, 1, pos); }
  hurt(): void { this.tone(90, 0.25, 0.4, 'triangle', 0.6); }
  swing(pos?: Pos): void { this.burst(1800, 'bandpass', 0.12, 0.08, 0.6, pos); }
  thunder(): void { this.burst(120, 'lowpass', 2.2, 0.9); }
  ui(): void { this.tone(880, 0.06, 0.08, 'square'); }
  chime(): void { this.tone(660, 0.15, 0.1, 'triangle'); this.tone(990, 0.2, 0.1, 'triangle', 0, undefined, 0.12); }
  /** talent appris, point de talent gagné : arpège ascendant */
  talent(): void { this.tone(523, 0.14, 0.1, 'triangle'); this.tone(659, 0.14, 0.1, 'triangle', 0, undefined, 0.09); this.tone(988, 0.3, 0.12, 'triangle', 0, undefined, 0.18); this.burst(4200, 'highpass', 0.12, 0.05, 1, undefined, 0.2); }

  // ---------------------------------------------------------------- cheval, coffre, achats
  /** Sabots : trot (2 temps) ou galop (3 temps, plus rapprochés), claquants sur la pierre, sourds sur l'herbe et la neige. */
  hoof(gallop: boolean, s: Surface): void {
    const hard = s === 'pierre' || s === 'bois', f = s === 'pierre' ? 2000 : s === 'bois' ? 520 : s === 'neige' ? 800 : 620;
    const beats = gallop ? 3 : 2;
    for (let i = 0; i < beats; i++) this.burst(f * (i === beats - 1 ? 1.15 : 1), hard ? 'bandpass' : 'lowpass', 0.05, hard ? 0.2 : 0.17, 2, undefined, i * (gallop ? 0.07 : 0.1));
  }
  /** Hennissement : appel (au sifflet), cri (blessé) ou mort. */
  whinny(kind: 'appel' | 'cri' | 'mort', p?: Pos): void {
    const dead = kind === 'mort', base = dead ? 520 : 700, dur = kind === 'appel' ? 0.7 : 0.45;
    this.tone(base, dur, 0.22, 'sawtooth', 0.55, p);
    this.tone(base * 1.5, dur * 0.8, 0.1, 'triangle', 0.5, p, 0.05);
    this.burst(1400, 'bandpass', dur * 0.6, 0.06, 2, p);
  }
  /** Sifflet du cavalier : deux notes montantes. */
  whistle(): void { this.tone(1500, 0.18, 0.12, 'sine', 1.5); this.tone(2200, 0.3, 0.1, 'sine', 0.8, undefined, 0.2); }
  /** On se met en selle ou on descend : cuir qui craque, petit choc. */
  mount(): void { this.burst(380, 'bandpass', 0.1, 0.25, 2); this.tone(110, 0.1, 0.2, 'triangle', 0.6); }
  /** Couvercle du coffre : grincement à l'ouverture, claquement à la fermeture. */
  chest(open: boolean): void { if (open) { this.tone(170, 0.3, 0.12, 'sawtooth', 1.6); this.burst(300, 'lowpass', 0.15, 0.2); } else { this.burst(250, 'lowpass', 0.12, 0.3); this.tone(120, 0.1, 0.18, 'triangle', 0.6); } }
  /** Pièces qui tombent dans une main (achat). */
  coin(): void { this.tone(1320, 0.08, 0.1, 'triangle'); this.tone(1760, 0.18, 0.1, 'triangle', 0, undefined, 0.07); }

  // ---------------------------------------------------------------- créatures (spatialisées)
  /** Cri d'une créature : alerte (elle vous a repéré), attaque ou mort. */
  creature(type: string, kind: 'alerte' | 'attaque' | 'mort', p: Pos): void {
    const c = this.ctx;
    if (!c) return;
    const dead = kind === 'mort';
    switch (type) {
      case 'loup':
        if (kind === 'alerte') this.growl(p, 0.5);
        else if (dead) this.tone(520, 0.5, 0.25, 'triangle', 0.4, p);
        else { this.burst(700, 'bandpass', 0.14, 0.35, 2, p); this.tone(320, 0.12, 0.2, 'sawtooth', 0.6, p); }
        break;
      case 'cerf':
        this.tone(dead ? 380 : 520, dead ? 0.5 : 0.18, 0.18, 'sawtooth', 0.5, p);
        break;
      case 'cheval':
        this.whinny(dead ? 'mort' : kind === 'attaque' ? 'cri' : 'appel', p);
        break;
      case 'sanglier':
        for (let i = 0; i < (dead ? 4 : 2); i++) this.burst(240, 'lowpass', 0.12, 0.4, 2, p, i * 0.15);
        break;
      case 'perdrix':
        for (let i = 0; i < 6; i++) this.burst(1400, 'bandpass', 0.04, 0.12, 1, p, i * 0.05);
        break;
      case 'araignée':
        this.burst(4200, 'highpass', dead ? 0.25 : 0.5, dead ? 0.15 : 0.18, 1, p);
        break;
      case 'squelette': case 'roi-squelette': case 'gardien des tombes':
        for (let i = 0; i < (dead ? 9 : 5); i++) this.burst(2600 + Math.random() * 1500, 'bandpass', 0.03, 0.22, 3, p, i * 0.055 + Math.random() * 0.02);
        break;
      case 'spectre':
        this.tone(dead ? 300 : 660, dead ? 1.2 : 0.9, 0.14, 'sine', dead ? 0.4 : 1.4, p);
        this.burst(900, 'bandpass', 0.8, 0.06, 0.6, p);
        break;
      case 'chauve-souris':   // cris aigus et brefs (grottes)
        for (let i = 0; i < (dead ? 2 : 4); i++) this.tone(dead ? 2400 : 3200 + i * 250, 0.05, 0.1, 'square', 0.5, p, i * 0.07);
        break;
      case 'ours des cavernes':
        if (kind === 'alerte') this.growl(p, 0.7);
        else this.tone(dead ? 85 : 120, dead ? 1.1 : 0.6, 0.4, 'sawtooth', 0.5, p);
        this.burst(260, 'lowpass', 0.5, 0.25, 1, p);
        break;
      case 'troll':
        this.tone(dead ? 70 : 95, dead ? 1.4 : 1.0, 0.45, 'sawtooth', 0.6, p);
        this.burst(300, 'lowpass', 0.9, 0.3, 1, p);
        break;
      default: // humanoïdes (bandits, gobelins) : grognement
        this.burst(type.includes('gobelin') ? 1100 : 520, 'bandpass', dead ? 0.45 : 0.2, 0.3, 3, p);
        this.burst(type.includes('gobelin') ? 2300 : 1200, 'bandpass', dead ? 0.35 : 0.15, 0.12, 4, p);
    }
  }

  /** Hurlement de loup au loin (la nuit). */
  howl(p: Pos): void {
    const c = this.ctx;
    if (!c) return;
    const now = c.currentTime, o = c.createOscillator(); o.type = 'triangle';
    const base = 380 + Math.random() * 80;
    o.frequency.setValueAtTime(base, now); o.frequency.linearRampToValueAtTime(base * 1.6, now + 0.6);
    o.frequency.linearRampToValueAtTime(base * 1.45, now + 1.8); o.frequency.linearRampToValueAtTime(base * 1.1, now + 2.6);
    const vib = c.createOscillator(); vib.frequency.value = 5.5; const vg = c.createGain(); vg.gain.value = base * 0.02;
    vib.connect(vg); vg.connect(o.frequency);
    const g = c.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.35, now + 0.4); g.gain.setTargetAtTime(0, now + 2.2, 0.25);
    o.connect(g); g.connect(this.out(p, 3.2)); o.start(now); vib.start(now); o.stop(now + 3.2); vib.stop(now + 3.2);
  }

  private growl(p: Pos, gain: number) {
    const c = this.ctx!;
    const now = c.currentTime, src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 190; f.Q.value = 4;
    const trem = c.createOscillator(); trem.frequency.value = 26; const tg = c.createGain(); tg.gain.value = gain * 0.5;
    const g = c.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(gain, now + 0.1); g.gain.setTargetAtTime(0, now + 0.6, 0.12);
    trem.connect(tg); tg.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(this.out(p, 1.2)); src.start(now, Math.random(), 1); trem.start(now); trem.stop(now + 1);
  }

  /** Coup de marteau sur l'enclume (forge). */
  clang(p: Pos): void {
    for (const [k, g] of [[1, 0.16], [2.76, 0.1], [5.4, 0.06]] as [number, number][]) this.tone(560 * k, 0.45 / Math.sqrt(k), g, 'sine', 0, p);
    this.burst(4000, 'highpass', 0.04, 0.2, 1, p);
  }

  /** Coup de hache dans le bois, coup de pioche dans la roche, arbre qui tombe. */
  chop(p: Pos): void { this.burst(320, 'lowpass', 0.14, 0.45, 1, p); this.tone(150, 0.12, 0.25, 'triangle', 0.6, p); }
  mine(p: Pos): void { this.tone(1700 + Math.random() * 400, 0.18, 0.14, 'square', 0.9, p); this.burst(3200, 'highpass', 0.06, 0.25, 1, p); this.burst(260, 'lowpass', 0.1, 0.25, 1, p); }
  timber(p: Pos): void { this.tone(90, 1.2, 0.2, 'sawtooth', 0.45, p); this.burst(180, 'lowpass', 0.6, 0.5, 1, p, 1.0); }
  /** Potion qui bouillonne (établi). */
  brew(p: Pos): void { for (let i = 0; i < 5; i++) this.tone(300 + Math.random() * 500, 0.08, 0.06, 'sine', 1.6, p, i * 0.09); this.burst(700, 'lowpass', 0.5, 0.12, 1, p); }
  /** Grésillement de la cuisson. */
  sizzle(p: Pos): void { this.burst(5200, 'highpass', 0.7, 0.14, 1, p); }
  /** Raclage du tannage. */
  scrape(p: Pos): void { this.burst(900, 'bandpass', 0.25, 0.2, 2, p); this.burst(900, 'bandpass', 0.25, 0.18, 2, p, 0.3); }
  /** Objet qui casse (pièce hors d'usage). */
  crack(): void { this.burst(2600, 'bandpass', 0.18, 0.35, 3); this.tone(420, 0.35, 0.12, 'sawtooth', 0.4); }
  /** Feuillage froissé (cueillette). */
  rustle(p: Pos): void { this.burst(3000, 'bandpass', 0.3, 0.12, 0.8, p); }

  // ---------------------------------------------------------------- événements vivants (raids, fêtes, épidémies, guerres)
  /** Tocsin : cloche frappée (fondamentale grave, partiels inharmoniques qui s'éteignent lentement). */
  bell(p: Pos, gain = 1): void {
    for (const [k, g, d] of [[1, 0.14, 2.6], [2.02, 0.08, 1.8], [2.74, 0.06, 1.4], [4.07, 0.04, 0.9]] as [number, number, number][]) this.tone(392 * k, d, g * gain, 'sine', 0, p);
    this.burst(2600, 'bandpass', 0.05, 0.12 * gain, 2, p);
  }
  /** Cri de frayeur d'un villageois (voix glissante). */
  scream(p: Pos, fem = false): void {
    const f = fem ? 760 : 520;
    this.tone(f, 0.55, 0.12, 'sawtooth', 1.35, p);
    this.tone(f * 1.5, 0.45, 0.05, 'triangle', 1.3, p, 0.03);
    this.burst(f * 2, 'bandpass', 0.4, 0.05, 3, p);
  }
  /** Toux (malade) : deux ou trois quintes de souffle rauque ; sans position : le joueur lui-même. */
  cough(p?: Pos, fem = false): void {
    const f = fem ? 900 : 650, n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) { this.burst(f, 'bandpass', 0.11, p ? 0.32 : 0.22, 2.5, p, i * 0.22); this.burst(f * 0.45, 'lowpass', 0.09, p ? 0.2 : 0.14, 1, p, i * 0.22 + 0.01); }
  }
  /** Cor de guerre : appel grave et tenu (début d'une bataille, déclaration de guerre). */
  horn(p?: Pos): void {
    this.tone(146, 1.6, 0.16, 'sawtooth', 1.02, p); this.tone(220, 1.3, 0.1, 'sawtooth', 1.01, p, 0.35);
    this.tone(146, 1.4, 0.06, 'triangle', 1, p, 0.35);
  }
  /** Vivats de la foule (concours, fête). */
  cheer(p?: Pos): void { for (let i = 0; i < 6; i++) this.burst(700 + Math.random() * 900, 'bandpass', 0.35 + Math.random() * 0.3, 0.07, 1.5, p, i * 0.06); }
  /** Flèche plantée dans une cible de paille. */
  thud(p: Pos): void { this.burst(260, 'lowpass', 0.09, 0.4, 1.5, p); this.tone(120, 0.08, 0.15, 'triangle', 0.7, p); }
  // ---------------------------------------------------------------- quartiers : marché et tavernes (étape 55)
  /** Chopes qui trinquent (taverne). */
  clink(p?: Pos): void { this.tone(2350, 0.18, 0.05, 'triangle', 0, p); this.tone(3120, 0.14, 0.035, 'triangle', 0, p, 0.012); this.burst(5200, 'highpass', 0.04, 0.04, 1, p); }
  /** Criée d'un marchand : appel de voix glissant, bref et doux (une voyelle tenue puis qui retombe). */
  call(p: Pos, fem = false): void {
    const f = fem ? 420 : 260;
    this.tone(f, 0.32, 0.05, 'sawtooth', 1.25, p); this.tone(f * 1.25, 0.42, 0.04, 'sawtooth', 0.8, p, 0.28);
    this.burst(f * 3, 'bandpass', 0.6, 0.035, 4, p);
  }
  /** Dés qui roulent sur une table. */
  dice(): void { for (let i = 0; i < 5; i++) this.burst(2600 + i * 180, 'bandpass', 0.03, 0.14, 3, undefined, i * 0.07 + (i > 2 ? 0.05 : 0)); }
  /** Fanfare (paix, victoire au concours). */
  fanfare(): void { for (const [f, at] of [[523, 0], [659, 0.14], [784, 0.28], [1047, 0.42]] as [number, number][]) this.tone(f, 0.35, 0.09, 'square', 1, undefined, at); }

  /** Projectile tiré par un autre joueur (multijoueur). */
  shot(kind: string, p: Pos): void {
    if (kind === 'feu') { this.burst(900, 'lowpass', 0.5, 0.3, 1, p); this.tone(220, 0.4, 0.12, 'sawtooth', 0.5, p); }
    else if (kind === 'givre') { this.tone(1900, 0.35, 0.08, 'sine', 1.6, p); this.burst(5000, 'highpass', 0.3, 0.08, 1, p); }
    else if (kind === 'éclair') { this.burst(2500, 'bandpass', 0.25, 0.4, 0.4, p); this.burst(140, 'lowpass', 0.6, 0.35, 1, p, 0.05); }
    else { this.tone(180, 0.12, 0.2, 'triangle', 0.5, p); this.burst(2500, 'bandpass', 0.15, 0.08, 1, p); }
  }
}
