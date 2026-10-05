// Temps de jeu. Par défaut 1 seconde réelle = 1 minute de jeu (journée de 24 min).
export const MIN_PER_DAY = 1440;
export type DayPhase = 'nuit' | 'aube' | 'matin' | 'midi' | 'après-midi' | 'soir' | 'crépuscule';

export function phaseOf(hour: number): DayPhase {
  if (hour < 5) return 'nuit';
  if (hour < 7) return 'aube';
  if (hour < 11.5) return 'matin';
  if (hour < 13.5) return 'midi';
  if (hour < 17.5) return 'après-midi';
  if (hour < 20) return 'soir';
  if (hour < 21.5) return 'crépuscule';
  return 'nuit';
}

export class GameTime {
  /** minutes écoulées depuis le jour 0 à 00:00 */
  minutes: number;
  /** minutes de jeu par seconde réelle */
  scale = 1;

  constructor(start = 1 * MIN_PER_DAY + 8 * 60 + 30) { this.minutes = start; }

  /** Avance le temps ; renvoie le nombre d'heures entières franchies. */
  advance(dtSec: number): number {
    const before = Math.floor(this.minutes / 60);
    this.minutes += dtSec * this.scale;
    return Math.floor(this.minutes / 60) - before;
  }

  get day(): number { return Math.floor(this.minutes / MIN_PER_DAY); }
  get minuteOfDay(): number { return this.minutes - this.day * MIN_PER_DAY; }
  /** heure décimale [0, 24) */
  get hour(): number { return this.minuteOfDay / 60; }
  get phase(): DayPhase { return phaseOf(this.hour); }
  get isNight(): boolean { const h = this.hour; return h < 6 || h >= 20.5; }

  clock(): string {
    const m = Math.floor(this.minuteOfDay);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  label(): string { return `Jour ${this.day} · ${this.clock()}`; }

  setClock(hour: number, minute = 0): void {
    this.minutes = this.day * MIN_PER_DAY + hour * 60 + minute;
  }
}
