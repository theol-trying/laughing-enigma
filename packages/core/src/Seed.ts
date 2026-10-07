import { RNG, hashString } from './RNG';
import { GENERATOR_VERSION } from './version';

/** Noms des flux RNG dérivés de la seed principale. Chaque système a le sien. */
export type StreamName =
  | 'terrain' | 'climate' | 'hydrology' | 'regions' | 'factions' | 'history'
  | 'settlements' | 'roads' | 'layout' | 'poi' | 'npc' | 'dungeon' | 'monsters'
  | 'loot' | 'names' | 'weather' | 'vegetation' | 'quests' | 'economy' | 'items' | 'faune';

/** Normalise une saisie de seed : majuscules, séparateurs « - », caractères sûrs. */
export function normalizeSeed(input: string): string {
  return input
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const W1 = ['THE', 'OLD', 'LOST', 'GREY', 'IRON', 'PALE', 'RED', 'HIGH', 'DEEP', 'COLD'];
const W2 = ['ASHEN', 'SILENT', 'BROKEN', 'GOLDEN', 'HOLLOW', 'SUNKEN', 'WILD', 'BURNING', 'MISTY', 'FALLEN', 'BITTER', 'AMBER'];
const W3 = ['KINGDOM', 'MARCHES', 'VALE', 'REALM', 'CROWN', 'DOMINION', 'FRONTIER', 'HIGHLANDS', 'BARONY', 'WILDS', 'COAST', 'MOORS'];

/** Seed aléatoire lisible (seul usage légitime de Math.random : choisir une seed). */
export function randomSeedString(): string {
  const r = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${r(W1)}-${r(W2)}-${r(W3)}-${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`;
}

export class WorldSeed {
  readonly text: string;
  private cache = new Map<string, number>();

  constructor(text: string) {
    this.text = normalizeSeed(text) || 'ASCII-FORT';
  }

  /** Nouveau flux RNG frais pour un système (toujours identique pour une même seed). */
  stream(name: StreamName, ...sub: (string | number)[]): RNG {
    return new RNG(`${GENERATOR_VERSION}|${this.text}|${name}${sub.length ? '|' + sub.join('|') : ''}`);
  }

  /** Graine entière 32 bits pour les fonctions de hachage par coordonnées. */
  int(name: StreamName, sub = ''): number {
    const k = name + sub;
    let v = this.cache.get(k);
    if (v === undefined) { v = hashString(`${GENERATOR_VERSION}|${this.text}|${k}`); this.cache.set(k, v); }
    return v;
  }
}
