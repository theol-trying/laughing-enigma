import { MACRO, CELL } from '../world/constants';

// État du monde = différences avec le monde généré (tout le reste se régénère depuis la seed).

export interface Dropped { key: string; id: string; qty: number; x: number; y: number; z: number }

export class WorldState {
  /** contenants déjà ouverts / pillés */
  readonly opened = new Set<string>();
  /** objets posés au sol par le joueur */
  dropped: Dropped[] = [];
  /** drapeaux divers : portes ouvertes, chambre louée, étapes de quêtes… */
  readonly flags = new Map<string, number | string | boolean>();
  /** lieux découverts (« poi:3 », « settlement:5 ») */
  readonly discovered = new Set<string>();
  /** brouillard de guerre de la carte (1 octet par cellule macro) */
  readonly explored = new Uint8Array(MACRO * MACRO);
  private dropN = 0;

  drop(id: string, qty: number, x: number, y: number, z: number): void {
    this.dropped.push({ key: `drop:${this.dropN++}`, id, qty, x, y, z });
  }

  /** Révèle la carte autour d'un point (rayon en mètres). */
  explore(x: number, z: number, r = 280): void {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL), R = Math.ceil(r / CELL);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      if (di * di + dj * dj > R * R) continue;
      const i = ci + di, j = cj + dj;
      if (i >= 0 && j >= 0 && i < MACRO && j < MACRO) this.explored[j * MACRO + i] = 1;
    }
  }
}
