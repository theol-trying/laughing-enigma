import { hashFloat } from '../../core/RNG';
import type { WorldSeed } from '../../core/Seed';
import { MACRO, CELL, NEIGH8 } from '../constants';
import type { MacroWorld } from '../MacroWorld';
import { B } from '../terrain/Biomes';
import { W_LAKE, W_RIVER, W_SEA } from '../terrain/Hydrology';
import { NameGen } from './Names';
import { buildRoadNetwork, RoadIndex } from './Roads';
import { genKingdoms, historyBeforeRoads, historyAfterRoads } from './History';
import { genPois } from './Pois';
import type { Faction, Settlement, SettlementType, HistoryEvent, Poi, Road, Dungeon, Good } from './types';

const N = MACRO;

/** Toute la couche humaine du monde, dérivée de la géographie (macro avant micro). */
export class Civilization {
  factions: Faction[] = [];
  settlements: Settlement[] = [];
  events: HistoryEvent[] = [];
  pois: Poi[] = [];
  roads: Road[] = [];
  dungeons: Dungeon[] = [];
  roadIndex!: RoadIndex;
  startId = -1;
  presentYear = 1200;
  readonly names: NameGen;
  /** score d'habitabilité par cellule (−Infinity : impossible) */
  readonly habitability = new Float32Array(N * N);

  private constructor(readonly macro: MacroWorld, readonly seed: WorldSeed) {
    this.names = macro.names.fork('civilization');
  }

  static generate(macro: MacroWorld): Civilization {
    const c = new Civilization(macro, macro.seed);
    c.presentYear = 1100 + c.seed.stream('history').int(0, 300);
    genKingdoms(c);
    c.computeHabitability();
    c.placeSettlements();
    historyBeforeRoads(c);
    c.roads = buildRoadNetwork(macro, c.settlements);
    c.roadIndex = new RoadIndex(c.roads);
    c.annotateRoads();
    historyAfterRoads(c);
    c.startId = c.chooseStart();
    genPois(c);
    c.roadIndex = new RoadIndex(c.roads);
    return c;
  }

  settlementAtCell(ci: number, cj: number, r = 0): Settlement | undefined {
    return this.settlements.find((s) => Math.hypot(s.ci - ci, s.cj - cj) <= r);
  }
  get start(): Settlement { return this.settlements[this.startId]; }
  factionOfCell(c: number): number {
    const reg = this.macro.regions[this.macro.region[c]];
    return reg ? reg.factionId : -1;
  }

  private nearSea(c: number, r: number): boolean {
    const ci = c % N, cj = (c / N) | 0;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = ci + di, j = cj + dj;
      if (i >= 0 && j >= 0 && i < N && j < N && this.macro.hydro.water[j * N + i] === W_SEA) return true;
    }
    return false;
  }

  private computeHabitability() {
    const m = this.macro, h = this.habitability, salt = this.seed.int('settlements');
    for (let c = 0; c < N * N; c++) {
      h[c] = -Infinity;
      if (!m.isLand(c) || m.hydro.water[c] === W_RIVER) continue;
      const b = m.biome[c], e = m.elev[c], sl = m.slope[c];
      if (b === B.MOUNTAIN || b === B.SNOW || b === B.BEACH || sl > 0.24 || e > 280) continue;
      let s = 0;
      const ci = c % N, cj = (c / N) | 0;
      let river = false, lake = false;
      for (const [dx, dz] of NEIGH8) {
        const i = ci + dx, j = cj + dz;
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const w = m.hydro.water[j * N + i];
        if (w === W_RIVER) river = true; else if (w === W_LAKE) lake = true;
      }
      if (river) s += 3.2; else if (m.waterDist[c] <= 2) s += 1.4;
      if (lake) s += 1.2;
      if (this.nearSea(c, 2)) s += 1.1;
      s += b === B.PLAINS ? 2 : b === B.FOREST ? 0.8 : b === B.TAIGA ? 0.3 : b === B.HEATH ? 0.2 : b === B.SWAMP ? -2.5 : 0;
      s -= sl * 12 + Math.max(0, e - 120) / 60;
      s += hashFloat(salt, ci, cj) * 0.8;
      h[c] = s;
    }
  }

  private makeSettlement(c: number, type: SettlementType): Settlement {
    const m = this.macro, rng = this.seed.stream('settlements', c);
    const ci = c % N, cj = (c / N) | 0;
    const x = (ci + 0.5) * CELL + rng.float(-6, 6), z = (cj + 0.5) * CELL + rng.float(-6, 6);
    const pop: Record<SettlementType, [number, number]> = {
      hameau: [15, 40], village: [60, 180], 'village minier': [80, 200], port: [100, 260], bourg: [300, 800], ville: [900, 2000],
      capitale: [2500, 5000], fort: [30, 80], château: [40, 120], monastère: [20, 60], 'avant-poste': [6, 15], camp: [5, 9], ruines: [0, 0],
    };
    const rad: Record<SettlementType, number> = {
      hameau: 30, village: 55, 'village minier': 55, port: 60, bourg: 80, ville: 100, capitale: 115,
      fort: 26, château: 30, monastère: 32, 'avant-poste': 14, camp: 16, ruines: 40,
    };
    const [p0, p1] = pop[type];
    const s: Settlement = {
      id: this.settlements.length, name: this.names.place(), type, ci, cj, x, z, y: m.elevAt(x, z),
      radius: rad[type], population: rng.int(p0, p1), factionId: this.factionOfCell(c), regionId: m.region[c],
      produces: [], needs: [], reasons: [], events: [], abandoned: false, founded: this.presentYear - rng.int(40, 320),
    };
    this.settlements.push(s);
    return s;
  }

  private placeSettlements() {
    const m = this.macro, h = this.habitability;
    const cand: number[] = [];
    for (let c = 0; c < N * N; c++) if (h[c] > -Infinity) cand.push(c);
    cand.sort((a, b) => h[b] - h[a] || a - b);
    const far = (c: number, d: number) => this.settlements.every((s) => Math.hypot(s.ci - (c % N), s.cj - ((c / N) | 0)) >= d);

    // capitales : la meilleure place de chaque royaume
    for (const f of this.factions.filter((f) => f.kind === 'royaume')) {
      const c = cand.find((c) => this.factionOfCell(c) === f.id && far(c, 60));
      if (c === undefined) continue;
      const s = this.makeSettlement(c, 'capitale');
      f.capitalId = s.id;
    }
    // châteaux : sur une hauteur près de chaque capitale
    for (const cap of [...this.settlements]) {
      let best = -1, bestE = -Infinity;
      for (let dj = -12; dj <= 12; dj++) for (let di = -12; di <= 12; di++) {
        const d = Math.hypot(di, dj);
        if (d < 6 || d > 12) continue;
        const i = cap.ci + di, j = cap.cj + dj;
        if (i < 2 || j < 2 || i >= N - 2 || j >= N - 2) continue;
        const c = j * N + i;
        if (!m.isLand(c) || m.hydro.water[c] === W_RIVER || m.slope[c] > 0.35 || m.biome[c] === B.SNOW) continue;
        const e = m.elev[c] - d * 0.5;
        if (e > bestE && far(c, 5)) { bestE = e; best = c; }
      }
      if (best >= 0 && m.elev[best] > cap.y + 8) {
        const s = this.makeSettlement(best, 'château');
        s.factionId = cap.factionId;
        s.reasons.push(`domine ${cap.name} depuis la hauteur`);
      }
    }
    const placeMany = (type: SettlementType, count: number, dist: number) => {
      let n = 0;
      for (const c of cand) {
        if (n >= count) break;
        if (!far(c, dist)) continue;
        this.makeSettlement(c, type); n++;
      }
    };
    placeMany('ville', 2, 34);
    placeMany('bourg', 4, 26);
    placeMany('village', 15, 14);
    placeMany('hameau', 12, 9);

    // spécialisations : ports, villages miniers
    let ports = 0, mines = 0;
    for (const s of this.settlements) {
      const c = s.cj * N + s.ci;
      if ((s.type === 'village' || s.type === 'bourg') && ports < 2 && this.nearSea(c, 2)) { if (s.type === 'village') s.type = 'port'; ports++; s.reasons.push('port sur la côte'); }
      else if (s.type === 'village' && mines < 2 && this.mountainNear(s.ci, s.cj, 6)) { s.type = 'village minier'; mines++; s.reasons.push('au pied des montagnes et de leurs filons'); }
    }
    // monastère : un lieu reculé, en hauteur, près d'une forêt
    let best = -1, bs = -Infinity;
    for (const c of cand) {
      if (!far(c, 20)) continue;
      const e = m.elev[c];
      const sc = h[c] * 0.3 + Math.min(e, 200) / 50 + (m.biome[c] === B.FOREST || m.biome[c] === B.TAIGA ? 1 : 0);
      if (sc > bs) { bs = sc; best = c; }
    }
    if (best >= 0) this.makeSettlement(best, 'monastère').reasons.push('lieu reculé propice au recueillement');

    for (const s of this.settlements) this.economyOf(s);
  }

  mountainNear(ci: number, cj: number, r: number): boolean {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = ci + di, j = cj + dj;
      if (i >= 0 && j >= 0 && i < N && j < N && (this.macro.biome[j * N + i] === B.MOUNTAIN || this.macro.biome[j * N + i] === B.SNOW)) return true;
    }
    return false;
  }

  /** Productions, besoins et raisons d'être à partir du milieu environnant. */
  private economyOf(s: Settlement) {
    const m = this.macro, c = s.cj * N + s.ci;
    const prod = new Set<Good>();
    const counts = new Map<number, number>();
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
      const i = s.ci + di, j = s.cj + dj;
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const b = m.biome[j * N + i];
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    const has = (b: number, n = 6) => (counts.get(b) ?? 0) >= n;
    if (has(B.PLAINS, 10)) { prod.add('grain'); prod.add('laine'); s.reasons.push('terres cultivables'); }
    if (has(B.FOREST) || has(B.TAIGA)) { prod.add('bois'); prod.add('gibier'); }
    if (has(B.SWAMP, 4)) prod.add('herbes');
    const river = this.macro.hydro.rivers.find((r) => r.cells.some((rc) => Math.abs((rc % N) - s.ci) <= 2 && Math.abs(((rc / N) | 0) - s.cj) <= 2));
    if (river) { prod.add('poisson'); s.reasons.push(`au bord de ${river.name}`); }
    if (this.nearSea(c, 2)) { prod.add('poisson'); prod.add('sel'); }
    if (s.type === 'village minier' || this.mountainNear(s.ci, s.cj, 4)) { prod.add('minerai'); prod.add('pierre'); }
    if (s.type === 'village minier') prod.add('fer');
    if (s.type === 'bourg' || s.type === 'ville' || s.type === 'capitale') { prod.add('outils'); prod.add('étoffe'); }
    if (s.type === 'monastère') { prod.add('vin'); prod.add('herbes'); }
    if (prod.size === 0) prod.add('grain');
    s.produces = [...prod];
    const all: Good[] = ['grain', 'bois', 'minerai', 'fer', 'poisson', 'laine', 'herbes', 'sel', 'vin', 'outils', 'étoffe'];
    s.needs = all.filter((g) => !prod.has(g)).slice(0, s.type === 'hameau' ? 2 : 4);
  }

  /** Raisons liées aux routes (carrefours) et importance commerciale. */
  private annotateRoads() {
    for (const s of this.settlements) {
      const n = this.roads.filter((r) => r.a === s.id || r.b === s.id).length;
      if (n >= 3) s.reasons.push('carrefour de routes');
      else if (n >= 1 && this.roads.some((r) => (r.a === s.id || r.b === s.id) && r.kind === 2)) s.reasons.push('sur une route commerciale');
    }
  }

  /** Village de départ : relié à une ville, une forêt et des ruines à portée — de quoi faire. */
  private chooseStart(): number {
    let best = -1, bestScore = -Infinity;
    for (const s of this.settlements) {
      if (s.abandoned || !(s.type === 'village' || s.type === 'port' || s.type === 'village minier')) continue;
      let sc = 0;
      const roads = this.roads.filter((r) => r.a === s.id || r.b === s.id);
      if (roads.some((r) => r.kind === 2)) sc += 3;
      sc += Math.min(3, roads.length);
      let forest = 0;
      for (let dj = -10; dj <= 10; dj++) for (let di = -10; di <= 10; di++) {
        const i = s.ci + di, j = s.cj + dj;
        if (i >= 0 && j >= 0 && i < N && j < N && (this.macro.biome[j * N + i] === B.FOREST || this.macro.biome[j * N + i] === B.TAIGA)) forest++;
      }
      sc += Math.min(3, forest / 25);
      if (this.settlements.some((o) => o.abandoned && Math.hypot(o.x - s.x, o.z - s.z) < 1800)) sc += 3;
      if (s.reasons.some((r) => r.startsWith('au bord'))) sc += 1;
      sc -= Math.hypot(s.ci - N / 2, s.cj - N / 2) / 40;
      if (sc > bestScore) { bestScore = sc; best = s.id; }
    }
    if (best < 0) best = this.settlements.find((s) => !s.abandoned)?.id ?? 0;
    this.settlements[best].reasons.push('lieu de départ du voyageur');
    return best;
  }
}
