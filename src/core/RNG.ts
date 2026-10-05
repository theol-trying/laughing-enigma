// PRNG seedé déterministe. Jamais de Math.random dans la génération du monde.
// - cyrb128 : hache une chaîne en 128 bits
// - sfc32   : générateur rapide et robuste (PractRand OK)
// - fork(nom) dérive un flux enfant à partir de la *clé* (pas de l'état consommé) :
//   l'ordre de consommation d'un système n'influence jamais un autre système.

export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Hache 32 bits d'une chaîne. */
export function hashString(str: string): number {
  return cyrb128(str)[0];
}

/** Hache entière de coordonnées (stable, rapide) — pour la génération par cellule/chunk. */
export function hash2i(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hash3i(seed: number, x: number, y: number, z: number): number {
  return hash2i(hash2i(seed, x, y), z, 0x9e3779b9);
}

/** Flottant [0,1) déterministe à partir de coordonnées. */
export function hashFloat(seed: number, x: number, y: number): number {
  return hash2i(seed, x, y) / 4294967296;
}

export class RNG {
  private a: number; private b: number; private c: number; private d: number;
  /** Clé de dérivation (seed + chemin des flux). */
  readonly key: string;

  constructor(key: string) {
    this.key = key;
    const [a, b, c, d] = cyrb128(key);
    this.a = a; this.b = b; this.c = c; this.d = d;
    for (let i = 0; i < 12; i++) this.nextU32(); // mélange initial
  }

  /** Flux enfant indépendant, dérivé de la clé (et non de l'état courant). */
  fork(name: string | number): RNG {
    return new RNG(this.key + '/' + name);
  }

  nextU32(): number {
    let a = this.a, b = this.b, c = this.c, d = this.d;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return t >>> 0;
  }

  /** [0, 1) */
  next(): number { return this.nextU32() / 4294967296; }
  float(min: number, max: number): number { return min + (max - min) * this.next(); }
  /** entier dans [min, max] inclus */
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  sign(): number { return this.next() < 0.5 ? -1 : 1; }

  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of items) total += Math.max(0, w);
    let r = this.next() * total;
    for (const [v, w] of items) { r -= Math.max(0, w); if (r < 0) return v; }
    return items[items.length - 1][0];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** loi normale (Box-Muller) */
  gaussian(mean = 0, sd = 1): number {
    const u = 1 - this.next(), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
