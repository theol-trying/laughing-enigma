import { MACRO, CELL } from '../constants';
import { B } from '../terrain/Biomes';
import type { Civilization } from './Civilization';
import { addPoi, addDungeon, findSpot, factionOf, pushSettlement } from './History';

// Points d'intérêt : chacun a une raison d'être liée à la géographie, aux routes ou à l'histoire.

const N = MACRO;
const cx = (cell: number) => ((cell % N) + 0.5) * CELL;
const cz = (cell: number) => (((cell / N) | 0) + 0.5) * CELL;

export function genPois(c: Civilization): void {
  const m = c.macro, rng = c.seed.stream('poi');
  const start = c.start;
  const isForest = (k: number) => m.biome[k] === B.FOREST || m.biome[k] === B.TAIGA;

  // ponts
  for (const r of c.roads) for (const b of r.bridges) {
    const riv = m.riverIndex.nearest(b.x, b.z);
    const rname = riv ? m.hydro.rivers[riv.river].name : 'la rivière';
    addPoi(c, 'pont', `Pont sur ${rname}`, b.x, b.z, `la route de ${c.settlements[r.a].name} à ${c.settlements[r.b].name} franchit ${rname}`, { roadId: r.id });
  }

  // camps de bandits : sur les routes commerciales, à l'écart des villages ; le premier menace la route du départ
  const bandits = factionOf(c, 'bandits');
  const startRoads = c.roads.filter((r) => r.a === start.id || r.b === start.id).sort((a, b) => b.trade - a.trade || a.id - b.id);
  const tradeRoads = c.roads.filter((r) => r.kind === 2).sort((a, b) => b.trade - a.trade || a.id - b.id);
  const camps: number[] = [];
  const campSpot = (r: typeof c.roads[number], t: number, minD: number) => {
    const mid = r.points[Math.floor((r.points.length - 1) * t)];
    return findSpot(c, mid.x, mid.z, 60, 220, (k) => (isForest(k) || m.biome[k] === B.HEATH || m.biome[k] === B.PLAINS) && m.slope[k] < 0.3
      && c.settlements.every((s) => Math.hypot(s.x - cx(k), s.z - cz(k)) > Math.max(minD, s.radius + 150)), `camp${r.id}-${t}-${minD}`);
  };
  // le premier camp est garanti sur une route du village de départ (contraintes relâchées si besoin)
  const firstTry: [typeof c.roads[number], number][] = [];
  search: for (const minD of [380, 300, 230]) for (const r of startRoads) for (const t of [0.5, 0.35, 0.65, 0.25, 0.75]) {
    const k = campSpot(r, t, minD);
    if (k >= 0) { firstTry.push([r, k]); break search; }
  }
  const plan: [typeof c.roads[number], number][] = [...firstTry];
  for (const r of tradeRoads) {
    if (plan.length >= 4 || plan.some(([p]) => p.id === r.id)) continue;
    const k = campSpot(r, 0.35 + rng.next() * 0.3, 380);
    if (k >= 0) plan.push([r, k]);
  }
  for (const [r, cell] of plan) {
    const a = c.settlements[r.a], b = c.settlements[r.b];
    const s = pushSettlement(c, cell, 'camp', `Camp ${bandits.name.replace(/^Les /, 'des ').replace(/^La /, 'de la ')}`, bandits.id, c.presentYear - rng.int(1, 4));
    s.reasons.push(`attaque les convois entre ${a.name} et ${b.name}`);
    addPoi(c, 'camp de bandits', s.name, s.x, s.z, `les bandits guettent la route de ${a.name} à ${b.name}`, { settlementId: s.id, factionId: bandits.id, roadId: r.id });
    camps.push(r.id);
  }

  // tanières de loups : forêts giboyeuses proches des pâturages ; une près du départ
  const wolfOk = (k: number) => isForest(k) && m.slope[k] < 0.4;
  const wolfSpots = [findSpot(c, start.x, start.z, 380, 900, wolfOk, 'wolf0')];
  for (let i = 1; i < 4; i++) {
    const s = c.settlements[rng.int(0, c.settlements.length - 1)];
    wolfSpots.push(findSpot(c, s.x, s.z, 400, 1400, wolfOk, 'wolf' + i));
  }
  wolfSpots.filter((k) => k >= 0).forEach((k, i) => addPoi(c, 'tanière de loups', i === 0 ? 'Tanière du bois' : 'Tanière de loups', cx(k), cz(k), 'les loups chassent le gibier et les troupeaux des alentours'));

  // repaires de gobelins (grottes dans les collines)
  for (let i = 0; i < 2; i++) {
    const s = c.settlements[rng.int(0, c.settlements.length - 1)];
    const k = findSpot(c, s.x, s.z, 500, 1800, (k) => m.slope[k] > 0.15 && m.elev[k] > 50 && m.biome[k] !== B.SNOW, 'gob' + i);
    if (k < 0) continue;
    const p = addPoi(c, 'repaire de gobelins', `Grotte ${i === 0 ? 'aux Gobelins' : 'Noire'}`, cx(k), cz(k), 'des gobelins pillent les fermes isolées depuis cette grotte');
    addDungeon(c, p, 'grotte', p.name, 2 + i, 'le chef gobelin');
  }

  // nid d'araignées dans un marais ou une forêt sombre
  const sw = findSpot(c, start.x, start.z, 800, 3500, (k) => m.biome[k] === B.SWAMP || m.biome[k] === B.TAIGA, 'spider');
  if (sw >= 0) addPoi(c, "nid d'araignées", "Nid d'araignées", cx(sw), cz(sw), "l'humidité et l'obscurité attirent les araignées géantes");

  // crypte près du départ : tombeau des anciens seigneurs, désormais hanté
  const ck = findSpot(c, start.x, start.z, 450, 1400, (k) => m.slope[k] < 0.3 && m.biome[k] !== B.SWAMP, 'crypt');
  if (ck >= 0) {
    const lord = c.names.fork('crypt').place();
    const p = addPoi(c, 'crypte', `Crypte de ${lord}`, cx(ck), cz(ck), `tombeau des anciens seigneurs de ${lord}, que l'ordre bénit jadis`, { factionId: factionOf(c, 'ordre').id });
    addDungeon(c, p, 'crypte', p.name, 1, 'le gardien des tombes');
  }

  // tours de guet sur les hauteurs qui dominent les routes
  let towers = 0;
  for (const r of c.roads) {
    if (towers >= 3) break;
    const mid = r.points[Math.floor(r.points.length / 2)];
    const k = findSpot(c, mid.x, mid.z, 100, 320, (k) => m.elev[k] > mid.y + 18 && m.slope[k] < 0.5, 'tower' + r.id);
    if (k < 0) continue;
    addPoi(c, 'tour de guet', 'Tour de guet', cx(k), cz(k), `surveille la route de ${c.settlements[r.a].name} à ${c.settlements[r.b].name}`, { roadId: r.id, factionId: c.settlements[r.a].factionId });
    towers++;
  }

  // sanctuaires au bord des routes
  for (let i = 0; i < 5 && c.roads.length; i++) {
    const r = c.roads[rng.int(0, c.roads.length - 1)];
    const p = r.points[rng.int(2, Math.max(2, r.points.length - 3))];
    if (!p) continue;
    const side = rng.sign() * (r.width / 2 + 3);
    const a = r.points[Math.max(0, r.points.indexOf(p) - 1)];
    const dx = p.x - a.x, dz = p.z - a.z, l = Math.hypot(dx, dz) || 1;
    addPoi(c, 'sanctuaire', 'Sanctuaire', p.x - (dz / l) * side, p.z + (dx / l) * side, 'les voyageurs y prient pour une route sûre', { roadId: r.id, factionId: factionOf(c, 'ordre').id });
  }

  // menhirs dans les landes et plaines isolées
  for (let i = 0; i < 3; i++) {
    const s = c.settlements[rng.int(0, c.settlements.length - 1)];
    const k = findSpot(c, s.x, s.z, 500, 2000, (k) => (m.biome[k] === B.HEATH || m.biome[k] === B.PLAINS) && m.slope[k] < 0.2, 'menhir' + i);
    if (k >= 0) addPoi(c, 'menhirs', 'Cercle de pierres', cx(k), cz(k), "dressées par un peuple oublié bien avant les royaumes");
  }

  // arbres remarquables
  for (let i = 0; i < 2; i++) {
    const s = c.settlements[rng.int(0, c.settlements.length - 1)];
    const k = findSpot(c, s.x, s.z, 300, 1500, (k) => m.biome[k] === B.FOREST || m.biome[k] === B.PLAINS, 'tree' + i);
    if (k >= 0) addPoi(c, 'arbre remarquable', i === 0 ? 'Le Chêne aux Pendus' : 'Le Vieux Tilleul', cx(k), cz(k), 'un arbre plusieurs fois centenaire, repère de tous les voyageurs');
  }
}
