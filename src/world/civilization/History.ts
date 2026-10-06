import { MACRO, CELL } from '../constants';
import { B } from '../terrain/Biomes';
import { W_NONE } from '../terrain/Hydrology';
import type { Civilization } from './Civilization';
import { de } from './Names';
import type { Faction, FactionKind, HistoryEvent, EventKind, Settlement, Poi, PoiKind } from './types';

// Factions et histoire procédurale. Chaque événement laisse des traces physiques (ruines,
// champs de bataille, cimetières, forts, monuments) et sociales (relations entre factions).

const N = MACRO;
const COLORS = [0xd8b040, 0x5a8ad8, 0xc84a3a, 0x7ab060];

function addFaction(c: Civilization, kind: FactionKind, name: string, color: number): Faction {
  const f: Faction = { id: c.factions.length, name, kind, color, capitalId: -1, regions: [], relations: [], notes: [] };
  c.factions.push(f);
  return f;
}

function setRel(c: Civilization, a: number, b: number, v: number, note?: string) {
  if (a < 0 || b < 0 || a === b) return;
  c.factions[a].relations[b] = v; c.factions[b].relations[a] = v;
  if (note) { c.factions[a].notes.push(note); c.factions[b].notes.push(note); }
}

export function genKingdoms(c: Civilization): void {
  const m = c.macro, regs = m.regions;
  const K = regs.length >= 10 ? 3 : 2;
  const seeds = [regs.reduce((a, b) => (b.cells > a.cells ? b : a)).id];
  while (seeds.length < Math.min(K, regs.length)) {
    let best = -1, bd = -1;
    for (const r of regs) {
      const d = Math.min(...seeds.map((s) => Math.hypot(regs[s].ci - r.ci, regs[s].cj - r.cj)));
      if (d > bd) { bd = d; best = r.id; }
    }
    seeds.push(best);
  }
  const kn = c.names.fork('kingdoms');
  seeds.forEach((_, k) => addFaction(c, 'royaume', kn.faction('royaume'), COLORS[k]));
  for (const r of regs) {
    let best = 0, bd = Infinity;
    seeds.forEach((s, k) => { const d = Math.hypot(regs[s].ci - r.ci, regs[s].cj - r.cj); if (d < bd) { bd = d; best = k; } });
    r.factionId = best;
    c.factions[best].regions.push(r.id);
  }
  addFaction(c, 'ordre', kn.faction('ordre'), 0xe8e0c0);
  addFaction(c, 'guilde', kn.faction('guilde'), 0xc89a50);
  addFaction(c, 'bandits', kn.faction('bandits'), 0x8a3a2a);
  addFaction(c, 'culte', kn.faction('culte'), 0x7a4a9a);
  for (const a of c.factions) for (const b of c.factions) if (a.id !== b.id) a.relations[b.id] = 0.1;
  const id = (k: FactionKind) => c.factions.find((f) => f.kind === k)!.id;
  for (const f of c.factions) {
    if (f.kind === 'royaume') {
      setRel(c, f.id, id('ordre'), 0.4); setRel(c, f.id, id('guilde'), 0.35);
      setRel(c, f.id, id('bandits'), -0.8); setRel(c, f.id, id('culte'), -0.6);
    }
  }
  setRel(c, id('bandits'), id('guilde'), -0.9, 'les bandits pillent les convois de la guilde');
  setRel(c, id('culte'), id('ordre'), -0.85, "l'ordre traque les adorateurs du culte");
  for (const f of c.factions) f.relations[f.id] = 1;
}

export function factionOf(c: Civilization, kind: FactionKind): Faction { return c.factions.find((f) => f.kind === kind)!; }

function event(c: Civilization, kind: EventKind, year: number, title: string, text: string, factions: number[], places: number[]): HistoryEvent {
  const e: HistoryEvent = { id: c.events.length, year, kind, title, text, factions, places, pois: [] };
  c.events.push(e);
  for (const p of places) c.settlements[p]?.events.push(e.id);
  return e;
}

export function addPoi(c: Civilization, kind: PoiKind, name: string, x: number, z: number, why: string, extra: Partial<Poi> = {}): Poi {
  const p: Poi = { id: c.pois.length, kind, name, x, z, settlementId: -1, eventId: -1, dungeonId: -1, factionId: -1, roadId: -1, why, ...extra };
  c.pois.push(p);
  if (p.eventId >= 0) c.events[p.eventId].pois.push(p.id);
  return p;
}

/** Cellule libre (terre, hors implantations) dans un anneau autour d'un point. */
export function findSpot(c: Civilization, x: number, z: number, rMin: number, rMax: number, ok: (cell: number) => boolean, salt: string): number {
  const m = c.macro, rng = c.seed.stream('poi', salt);
  const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
  const cells: number[] = [];
  const R = Math.ceil(rMax / CELL);
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
    const d = Math.hypot(di, dj) * CELL;
    if (d < rMin || d > rMax) continue;
    const i = ci + di, j = cj + dj;
    if (i < 2 || j < 2 || i >= N - 2 || j >= N - 2) continue;
    const cell = j * N + i;
    if (m.hydro.water[cell] !== W_NONE) continue;
    if (c.settlements.some((s) => !s.abandoned && Math.hypot(s.x - (i + 0.5) * CELL, s.z - (j + 0.5) * CELL) < s.radius + 70)) continue;
    if (ok(cell)) cells.push(cell);
  }
  return cells.length ? cells[rng.int(0, cells.length - 1)] : -1;
}

const cx = (cell: number) => ((cell % N) + 0.5) * CELL;
const cz = (cell: number) => (((cell / N) | 0) + 0.5) * CELL;

function abandon(c: Civilization, s: Settlement, why: string) {
  s.abandoned = true; s.type = 'ruines'; s.population = 0;
  s.reasons.push(why);
}

export function historyBeforeRoads(c: Civilization): void {
  const rng = c.seed.stream('history');
  const Y = c.presentYear;
  const kingdoms = c.factions.filter((f) => f.kind === 'royaume');
  // les royaumes prennent le nom de leur capitale
  for (const k of kingdoms) {
    const cap = c.settlements[k.capitalId];
    if (cap) { k.name = `Royaume ${de(cap.name)}`; cap.reasons.unshift(`siège du ${k.name}`); }
    event(c, 'fondation', Y - rng.int(220, 330), `Fondation du ${k.name}`, `${cap?.name ?? 'Une cité'} devint le siège d'un royaume qui soumit les seigneurs voisins.`, [k.id], cap ? [cap.id] : []);
  }

  // chute d'un ancien royaume → ruines de forteresse sur une hauteur, convoitées par le culte
  const m = c.macro;
  const ancient = c.names.fork('ancient').place();
  const center = c.settlements[0] ?? { x: 4096, z: 4096 };
  const fortCell = findSpot(c, center.x, center.z, 600, 3200, (cell) => m.elev[cell] > 70 && m.slope[cell] < 0.5 && m.biome[cell] !== B.SNOW
    && c.settlements.every((s) => Math.hypot(s.x - cx(cell), s.z - cz(cell)) > 500), 'ancient');
  const culte = factionOf(c, 'culte');
  if (fortCell >= 0) {
    const yr = Y - rng.int(380, 520);
    const e = event(c, 'chute', yr, `Chute de l'ancien royaume ${de(ancient)}`, `Le royaume ${de(ancient)} s'effondra dans le sang ; sa forteresse ne fut jamais reprise. On dit que ses rois reposent encore sous les pierres.`, [culte.id], []);
    const s = pushSettlement(c, fortCell, 'ruines', `Ruines ${de(ancient)}`, -1, yr - 200);
    s.reasons.push(`vestiges de l'ancien royaume ${de(ancient)}`);
    s.events.push(e.id); e.places.push(s.id);
    const p = addPoi(c, 'ruines', `Forteresse ${de(ancient)}`, s.x, s.z, `capitale déchue de l'ancien royaume ${de(ancient)}`, { settlementId: s.id, eventId: e.id, factionId: culte.id });
    addDungeon(c, p, 'forteresse', `Cachots ${de(ancient)}`, 4, 'le Roi-Squelette');
    culte.notes.push(`le culte cherche les trésors des rois ${de(ancient)}`);
  }

  // peste → village abandonné et cimetière près du voisin
  const small = c.settlements.filter((s) => s.type === 'hameau' && !s.abandoned);
  if (small.length) {
    const victim = small[rng.int(0, small.length - 1)];
    const yr = Y - rng.int(25, 90);
    const e = event(c, 'peste', yr, `La Peste de ${victim.name}`, `Une fièvre noire vida ${victim.name} en un été. Les survivants partirent ; les morts furent enterrés à l'écart.`, [victim.factionId], [victim.id]);
    abandon(c, victim, `abandonné après la peste de ${yr}`);
    const cell = findSpot(c, victim.x, victim.z, 90, 260, (k) => m.slope[k] < 0.25, 'plague');
    if (cell >= 0) addPoi(c, 'cimetière', `Cimetière des pestiférés`, cx(cell), cz(cell), `les morts de la peste de ${victim.name} y reposent`, { eventId: e.id, settlementId: victim.id });
  }

  // un troll a rasé un hameau au pied des montagnes
  const nearMount = c.settlements.filter((s) => s.type === 'hameau' && !s.abandoned && c.mountainNear(s.ci, s.cj, 8));
  if (nearMount.length) {
    const victim = nearMount[rng.int(0, nearMount.length - 1)];
    const yr = Y - rng.int(6, 40);
    const e = event(c, 'destruction', yr, `Le saccage de ${victim.name}`, `Une bête descendue des montagnes, haute comme deux hommes, détruisit ${victim.name}. Personne n'a osé la poursuivre.`, [victim.factionId], [victim.id]);
    abandon(c, victim, `détruit par un troll en ${yr}`);
    const cell = findSpot(c, victim.x, victim.z, 250, 900, (k) => m.biome[k] === B.MOUNTAIN, 'troll');
    if (cell >= 0) addPoi(c, 'antre du troll', `Antre du troll`, cx(cell), cz(cell), `la bête qui a rasé ${victim.name} y a fait son repaire`, { eventId: e.id, settlementId: victim.id });
  }

  // schisme → le monastère appartient à l'ordre, en froid avec le royaume
  const ordre = factionOf(c, 'ordre');
  const mon = c.settlements.find((s) => s.type === 'monastère');
  if (mon) {
    const k = mon.factionId >= 0 ? mon.factionId : 0;
    mon.factionId = ordre.id;
    const yr = Y - rng.int(60, 140);
    event(c, 'schisme', yr, `Le Schisme de ${mon.name}`, `Des moines refusèrent l'autorité du ${c.factions[k].name} sur l'Église et fondèrent ${mon.name}, loin des cours.`, [ordre.id, k], [mon.id]);
    setRel(c, ordre.id, k, -0.25, `le schisme de ${mon.name} a brouillé l'ordre et le ${c.factions[k].name}`);
  }

  // mines → village minier, galeries basses envahies par des gobelins
  for (const s of c.settlements.filter((s) => s.type === 'village minier')) {
    const yr = Y - rng.int(15, 70);
    const e = event(c, 'mine', yr, `Ouverture des mines de ${s.name}`, `On trouva du fer dans la montagne au-dessus de ${s.name}. Depuis peu, des gobelins ont envahi les galeries basses.`, [s.factionId, factionOf(c, 'guilde').id], [s.id]);
    const cell = findSpot(c, s.x, s.z, 120, 420, (k) => m.elev[k] > s.y + 10 && m.slope[k] > 0.08, 'mine' + s.id);
    if (cell >= 0) {
      const p = addPoi(c, 'mine', `Mines de ${s.name}`, cx(cell), cz(cell), `filon de fer exploité par ${s.name}`, { settlementId: s.id, eventId: e.id });
      addDungeon(c, p, 'mine', `Galeries de ${s.name}`, 2, 'le chef gobelin');
    }
  }
}

export function historyAfterRoads(c: Civilization): void {
  const rng = c.seed.stream('history', 'after');
  const Y = c.presentYear, m = c.macro;
  const kingdoms = c.factions.filter((f) => f.kind === 'royaume' && f.capitalId >= 0);

  // guerre entre deux royaumes → champ de bataille sur la route qui les relie, monument chez le vainqueur, fort au col
  if (kingdoms.length >= 2) {
    const [ka, kb] = [kingdoms[0], kingdoms[1]];
    const winner = rng.chance(0.5) ? ka : kb, loser = winner === ka ? kb : ka;
    const yr = Y - rng.int(55, 150);
    const war = event(c, 'guerre', yr, `La Guerre des Deux Couronnes`, `Le ${ka.name} et le ${kb.name} se disputèrent les terres frontalières pendant onze ans. Le ${winner.name} l'emporta, mais la rancune demeure.`, [ka.id, kb.id], [ka.capitalId, kb.capitalId]);
    setRel(c, ka.id, kb.id, -0.55, 'la Guerre des Deux Couronnes n\'est pas oubliée');
    // point frontière le long d'une route reliant leurs territoires
    let best: { x: number; z: number; road: number } | null = null, bestScore = Infinity;
    for (const r of c.roads) for (let i = 1; i < r.cells.length; i++) {
      const f0 = c.factionOfCell(r.cells[i - 1]), f1 = c.factionOfCell(r.cells[i]);
      if ((f0 === ka.id && f1 === kb.id) || (f0 === kb.id && f1 === ka.id)) {
        const cell = r.cells[i];
        const sc = c.settlements.reduce((a, s) => Math.min(a, Math.hypot(s.x - cx(cell), s.z - cz(cell))), Infinity);
        if (-sc < bestScore) { bestScore = -sc; best = { x: cx(cell), z: cz(cell), road: r.id }; }
      }
    }
    if (best) {
      const cell = findSpot(c, best.x, best.z, 60, 300, (k) => m.slope[k] < 0.2, 'battle');
      if (cell >= 0) {
        const battle = event(c, 'bataille', yr + 6, `La bataille de la Frontière`, `Des milliers d'hommes tombèrent près de la route. Les paysans retrouvent encore des pointes de lances en labourant.`, [ka.id, kb.id], []);
        addPoi(c, 'champ de bataille', `Champ de la Frontière`, cx(cell), cz(cell), `bataille décisive de la Guerre des Deux Couronnes`, { eventId: battle.id, roadId: best.road });
      }
      // fort au point le plus élevé de cette route
      const road = c.roads[best.road];
      let hi = road.cells[0];
      for (const k of road.cells) if (m.elev[k] > m.elev[hi]) hi = k;
      if (c.settlements.every((s) => Math.hypot(s.ci - (hi % N), s.cj - ((hi / N) | 0)) > 8)) {
        const fy = yr + rng.int(8, 25);
        const s = pushSettlement(c, hi, 'fort', `Fort de ${c.names.place()}`, winner.id, fy);
        s.reasons.push(`tient le passage de la route après la guerre`);
        event(c, 'forteresse', fy, `Construction de ${s.name}`, `Après la guerre, le ${winner.name} fit élever ${s.name} pour garder la route de la frontière.`, [winner.id], [s.id]);
      }
    }
    const cap = c.settlements[winner.capitalId];
    addPoi(c, 'statue', `Statue du roi vainqueur`, cap.x + 4, cap.z + 4, `célèbre la victoire de la Guerre des Deux Couronnes`, { eventId: war.id, settlementId: cap.id });
    void loser;
  }

  // révolte → les survivants sont devenus des bandits
  const towns = c.settlements.filter((s) => (s.type === 'bourg' || s.type === 'ville') && !s.abandoned);
  const bandits = factionOf(c, 'bandits');
  if (towns.length) {
    const t = towns[rng.int(0, towns.length - 1)];
    const yr = Y - rng.int(4, 22);
    event(c, 'révolte', yr, `La révolte de ${t.name}`, `Écrasés d'impôts, les paysans autour de ${t.name} se soulevèrent. La révolte fut noyée dans le sang ; les survivants prirent le maquis et devinrent ${bandits.name}.`, [t.factionId, bandits.id], [t.id]);
    bandits.notes.push(`anciens révoltés de ${t.name}`);
  }

  // expédition perdue vers les ruines anciennes
  const ruins = c.pois.find((p) => p.kind === 'ruines' && p.dungeonId >= 0);
  if (ruins && towns.length) {
    const t = towns.reduce((a, b) => (Math.hypot(a.x - ruins.x, a.z - ruins.z) < Math.hypot(b.x - ruins.x, b.z - ruins.z) ? a : b));
    const leader = c.names.fork('expedition').person(rng.chance(0.5) ? 'm' : 'f');
    const yr = Y - rng.int(1, 5);
    const e = event(c, 'expédition', yr, `L'expédition de ${leader.first} ${leader.last}`, `${leader.first} ${leader.last} partit de ${t.name} explorer ${ruins.name} avec quatre compagnons. Aucun n'est revenu.`, [t.factionId], [t.id]);
    e.pois.push(ruins.id);
  }
  // ordre chronologique, puis renumérotation des références
  c.events.sort((a, b) => a.year - b.year || a.id - b.id);
  const remap = new Map(c.events.map((e, i) => [e.id, i]));
  c.events.forEach((e, i) => { e.id = i; });
  for (const s of c.settlements) s.events = s.events.map((x) => remap.get(x) ?? x);
  for (const p of c.pois) if (p.eventId >= 0) p.eventId = remap.get(p.eventId) ?? p.eventId;
}

export function pushSettlement(c: Civilization, cell: number, type: Settlement['type'], name: string, factionId: number, founded: number): Settlement {
  const s: Settlement = {
    id: c.settlements.length, name, type, ci: cell % N, cj: (cell / N) | 0, x: cx(cell), z: cz(cell), y: c.macro.elevAt(cx(cell), cz(cell)),
    radius: type === 'ruines' ? 34 : type === 'fort' ? 26 : type === 'camp' ? 16 : 18,
    population: type === 'fort' ? 40 : type === 'camp' ? 6 : 0, factionId, regionId: c.macro.region[cell],
    produces: [], needs: ['grain', 'outils'], reasons: [], events: [], abandoned: type === 'ruines', founded,
  };
  c.settlements.push(s);
  return s;
}

export function addDungeon(c: Civilization, p: Poi, kind: 'grotte' | 'mine' | 'crypte' | 'forteresse', name: string, depth: number, boss: string): void {
  p.dungeonId = c.dungeons.length;
  c.dungeons.push({ id: c.dungeons.length, kind, name, poiId: p.id, depth, boss });
}
