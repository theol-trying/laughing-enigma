import { hash2i, hashString } from '@ascii-fort/core/RNG';
import { CLEAR_WEATHER, type WeatherMix } from '@ascii-fort/ascii-engine/Atmosphere';
import type { MacroWorld } from '@ascii-fort/worldgen/MacroWorld';
import { B } from '@ascii-fort/worldgen/terrain/Biomes';

// Météo par région : périodes de 8 h, état tiré de façon déterministe (seed + région + période)
// selon le climat de la région ; transitions progressives sur la dernière heure de chaque période.

export type WeatherState = 'clair' | 'couvert' | 'pluie' | 'brouillard' | 'orage' | 'neige';

const MIX: Record<WeatherState, WeatherMix> = {
  clair: CLEAR_WEATHER,
  couvert: { cloud: 0.85, rain: 0, snow: 0, fog: 0.05, storm: 0, windX: 0.5, windZ: 0.2 },
  pluie: { cloud: 0.95, rain: 0.75, snow: 0, fog: 0.15, storm: 0, windX: 0.9, windZ: 0.3 },
  brouillard: { cloud: 0.55, rain: 0, snow: 0, fog: 0.75, storm: 0, windX: 0.1, windZ: 0.05 },
  orage: { cloud: 1, rain: 1, snow: 0, fog: 0.2, storm: 1, windX: 1.4, windZ: 0.5 },
  neige: { cloud: 0.9, rain: 0, snow: 0.8, fog: 0.25, storm: 0, windX: 0.4, windZ: 0.2 },
};
const PERIOD = 480, BLEND = 60;
/** points échantillonnés autour du joueur : [rayon (m), nombre, poids] */
const RINGS: [number, number, number][] = [[0, 1, 0.6], [90, 6, 0.5], [200, 8, 0.45], [340, 10, 0.35]];

export class Weather {
  private salt: number;
  constructor(private macro: MacroWorld) { this.salt = hashString(`${macro.seed.text}|weather`); }

  private climate(x: number, z: number) {
    const m = this.macro, c = m.cellOf(x, z);
    return { t: m.temp[c], w: m.moist[c], e: m.elev[c], b: m.biome[c], region: m.region[c] };
  }

  /** État d'une région pour une période donnée (déterministe). */
  stateFor(x: number, z: number, period: number): WeatherState {
    const k = this.climate(x, z);
    const r = hash2i(this.salt, k.region, period) / 4294967296;
    const cold = k.t < 0.3 || k.e > 300 || k.b === B.SNOW;
    const wet = k.w;
    const table: [WeatherState, number][] = [
      ['clair', 1.2 - wet * 0.6], ['couvert', 0.6 + wet * 0.3],
      [cold ? 'neige' : 'pluie', 0.15 + wet * 0.6], ['brouillard', k.b === B.SWAMP ? 0.6 : 0.12 + wet * 0.15],
      [cold ? 'neige' : 'orage', k.b === B.MOUNTAIN ? 0.25 : 0.06 + wet * 0.1],
    ];
    const total = table.reduce((s, [, w]) => s + w, 0);
    let acc = r * total;
    for (const [s, w] of table) { acc -= w; if (acc < 0) return s; }
    return 'clair';
  }

  /** Météo imposée (console de développement). */
  forced(s: WeatherState, minutes: number): { mix: WeatherMix; state: WeatherState; flash: number } {
    const slot = Math.floor(minutes * 3);
    const flash = s === 'orage' && hash2i(this.salt, slot, 7) / 4294967296 < 0.035 ? 1 - (minutes * 3 - slot) : 0;
    return { mix: MIX[s], state: s, flash };
  }

/** Mélange météo autour d'un point : on moyenne la météo de points voisins (≈ 300 m) pour que les
   * fronts de pluie, de neige ou de brouillard se fondent au lieu de changer d'un pas à l'autre. */
  at(x: number, z: number, minutes: number): { mix: WeatherMix; state: WeatherState; flash: number } {
    const acc: WeatherMix = { cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0, windX: 0, windZ: 0 };
    const votes = new Map<WeatherState, number>();
    let wsum = 0;
    for (const [r, n, w] of RINGS) {
      for (let i = 0; i < n; i++) {
        const an = (i / n) * Math.PI * 2 + r * 0.01;
        const l = this.local(x + Math.cos(an) * r, z + Math.sin(an) * r, minutes);
        for (const k of Object.keys(acc) as (keyof WeatherMix)[]) acc[k] += l.mix[k] * w;
        votes.set(l.state, (votes.get(l.state) ?? 0) + w);
        wsum += w;
      }
    }
    for (const k of Object.keys(acc) as (keyof WeatherMix)[]) acc[k] /= wsum;
    let state: WeatherState = 'clair', best = -1;
    for (const [st, v] of votes) if (v > best) { best = v; state = st; }
    let flash = 0;
    if (acc.storm > 0.5) {
      const slot = Math.floor(minutes * 3);
      if (hash2i(this.salt, slot, 7) / 4294967296 < 0.035) flash = 1 - (minutes * 3 - slot);
    }
    return { mix: acc, state, flash };
  }

  /** Mélange météo au point et à l'instant donnés (transition douce entre périodes). */
  private local(x: number, z: number, minutes: number): { mix: WeatherMix; state: WeatherState } {
    const p = Math.floor(minutes / PERIOD), into = minutes - p * PERIOD;
    const a = this.stateFor(x, z, p);
    let mix = MIX[a];
    if (into > PERIOD - BLEND) {
      const b = this.stateFor(x, z, p + 1), t = (into - (PERIOD - BLEND)) / BLEND;
      const A = MIX[a], Bm = MIX[b];
      mix = { cloud: A.cloud + (Bm.cloud - A.cloud) * t, rain: A.rain + (Bm.rain - A.rain) * t, snow: A.snow + (Bm.snow - A.snow) * t, fog: A.fog + (Bm.fog - A.fog) * t, storm: A.storm + (Bm.storm - A.storm) * t, windX: A.windX + (Bm.windX - A.windX) * t, windZ: A.windZ + (Bm.windZ - A.windZ) * t };
    }
    return { mix, state: a };
  }
}
