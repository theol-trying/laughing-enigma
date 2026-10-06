import type { Civilization } from './Civilization';
import type { Settlement, Poi } from './types';
import type { RNG } from '../../core/RNG';
import { segDist } from '../../core/math';

// Plans des implantations et des points d'intérêt : bâtiments (avec intérieurs), enceintes,
// tours, champs, décors. Tout est dérivé de la seed (flux « layout ») et des routes réelles.

export type BuildingKind =
  | 'maison' | 'auberge' | 'forge' | 'échoppe' | 'chapelle' | 'corps de garde' | 'ferme' | 'grange'
  | 'moulin' | 'temple' | 'caserne' | 'donjon' | 'dortoir' | 'ruine' | 'mausolée' | 'cabane';

export type FurnitureKind =
  | 'lit' | 'table' | 'banc' | 'coffre' | 'tonneau' | 'âtre' | 'comptoir' | 'enclume' | 'foyer de forge'
  | 'étagère' | 'autel' | 'râtelier' | 'établi' | 'meule' | 'foin' | 'trône' | 'escalier';

export interface Furniture { kind: FurnitureKind; lx: number; lz: number; yaw: number }

export interface Building {
  id: number; sid: number; kind: BuildingKind; name: string;
  x: number; z: number; yaw: number; w: number; d: number;
  wallH: number; roofH: number; stone: boolean; ruined: boolean;
  doorX: number;               // position de la porte le long de la façade (local x)
  furniture: Furniture[];
  floorY: number;              // calculé à la construction (NaN avant)
  dungeonId: number;
}

export type DecorKind =
  | 'puits' | 'fontaine' | 'statue' | 'brasero' | 'feu de camp' | 'tente' | 'caisse' | 'pieu' | 'tombe'
  | 'croix' | 'menhir' | 'étal' | 'lanterne' | 'sanctuaire' | 'arbre géant' | 'tour de guet' | 'gravats'
  | 'ossements' | 'entrée grotte' | 'entrée mine' | 'clôture' | 'roue' | 'lance brisée' | 'tanière';
export interface Decor { kind: DecorKind; x: number; z: number; yaw: number; s: number; key: string; dungeonId: number }

export interface WallSeg { ax: number; az: number; bx: number; bz: number; h: number; stone: boolean; ruined: boolean }
export interface Tower { x: number; z: number; r: number; h: number; stone: boolean }
export interface Field { x: number; z: number; w: number; d: number; yaw: number; crop: 1 | 2 }

export interface Layout {
  sid: number;                 // implantation (-1 pour un POI)
  poiId: number;
  x: number; z: number; radius: number;
  plaza: { x: number; z: number; r: number; cobble: boolean } | null;
  buildings: Building[];
  walls: WallSeg[];
  towers: Tower[];
  decor: Decor[];
  fields: Field[];
}

const TOWN = new Set(['bourg', 'ville', 'capitale']);

interface Ctx { civ: Civilization; L: Layout; rng: RNG; s: Settlement | null }

function overlaps(L: Layout, x: number, z: number, r: number): boolean {
  for (const b of L.buildings) if (Math.hypot(b.x - x, b.z - z) < (Math.hypot(b.w, b.d) / 2 + r) * 0.92) return true;
  for (const t of L.towers) if (Math.hypot(t.x - x, t.z - z) < t.r + r + 1) return true;
  return false;
}

function terrainOk(civ: Civilization, x: number, z: number, r: number): boolean {
  const m = civ.macro;
  const riv = m.riverIndex.nearest(x, z);
  if (riv && riv.d < riv.width / 2 + r + 4) return false;
  let lo = Infinity, hi = -Infinity;
  for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
    const h = m.elevAt(x + dx, z + dz);
    if (h < 0.8) return false;
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  if (hi - lo > 4) return false;
  const road = civ.roadIndex.nearest(x, z);
  return !(road && road.d < r * 0.7);
}

function furnish(kind: BuildingKind, w: number, d: number, rng: RNG): Furniture[] {
  const F: Furniture[] = [];
  const hw = w / 2 - 0.9, hd = d / 2 - 0.9;
  const add = (k: FurnitureKind, lx: number, lz: number, yaw = 0) => F.push({ kind: k, lx, lz, yaw });
  switch (kind) {
    case 'maison': case 'ferme': case 'cabane':
      add('lit', -hw + 0.2, -hd + 0.6, 0);
      if (w > 7) add('lit', -hw + 1.6, -hd + 0.6, 0);
      add('âtre', hw - 0.3, -hd + 0.3, 0);
      add('table', 0, 0.3); add('banc', 0, 1.1);
      add('coffre', hw - 0.2, hd - 1.2, Math.PI / 2);
      if (rng.chance(0.6)) add('étagère', -hw, 0.5, Math.PI / 2);
      break;
    case 'auberge':
      add('comptoir', 0, -hd + 1.6); add('tonneau', -hw + 0.3, -hd + 0.3); add('tonneau', -hw + 1.2, -hd + 0.3); add('tonneau', hw - 0.3, -hd + 0.3);
      add('âtre', -hw + 0.3, 0.5, Math.PI / 2);
      add('table', -1.8, 1.4); add('banc', -1.8, 2.2); add('table', 1.8, 1.4); add('banc', 1.8, 2.2);
      add('lit', hw - 0.3, 0.2, Math.PI / 2); add('lit', hw - 0.3, 1.6, Math.PI / 2);
      add('coffre', hw - 0.4, -hd + 0.4);
      break;
    case 'forge':
      add('foyer de forge', -hw + 0.6, -hd + 0.6); add('enclume', -0.5, -0.5); add('établi', hw - 0.6, -hd + 0.4);
      add('râtelier', hw - 0.1, 0.8, Math.PI / 2); add('tonneau', -hw + 0.3, hd - 0.6); add('coffre', hw - 0.3, hd - 1.2, Math.PI / 2);
      break;
    case 'échoppe':
      add('comptoir', 0, -0.2); add('étagère', -hw + 0.6, -hd + 0.1); add('étagère', hw - 0.6, -hd + 0.1);
      add('coffre', -hw + 0.3, 0.9, Math.PI / 2); add('coffre', hw - 0.3, 0.9, Math.PI / 2); add('tonneau', 0, -hd + 0.4);
      break;
    case 'chapelle': case 'temple':
      add('autel', 0, -hd + 0.6);
      for (let r = 0; r < Math.floor(d / 2) - 1; r++) { add('banc', -1.3, -hd + 2.5 + r * 1.6); add('banc', 1.3, -hd + 2.5 + r * 1.6); }
      break;
    case 'corps de garde': case 'caserne': case 'dortoir':
      for (let i = 0; i < Math.min(4, Math.floor(w / 1.8)); i++) add('lit', -hw + 0.4 + i * 1.7, -hd + 0.6);
      add('râtelier', hw - 0.1, 0.8, Math.PI / 2); add('table', 0, 1); add('coffre', -hw + 0.3, hd - 1, Math.PI / 2);
      if (kind !== 'dortoir') add('âtre', hw - 0.3, -hd + 0.3);
      break;
    case 'grange': add('foin', -hw + 0.6, -hd + 0.6); add('foin', -hw + 1.8, -hd + 0.6); add('foin', hw - 0.6, -hd + 0.6); add('tonneau', hw - 0.4, hd - 0.6); break;
    case 'moulin': add('meule', 0, -0.4); add('foin', hw - 0.6, -hd + 0.6); add('lit', -hw + 0.2, -hd + 0.6); add('coffre', hw - 0.3, hd - 1, Math.PI / 2); break;
    case 'donjon': add('trône', 0, -hd + 0.8); add('table', 0, 0.5); add('banc', -1, 1.3); add('banc', 1, 1.3); add('râtelier', hw - 0.1, 0, Math.PI / 2); add('coffre', -hw + 0.3, -hd + 0.4); add('âtre', -hw + 0.3, 0.5, Math.PI / 2); break;
    case 'mausolée': add('escalier', 0, -0.5); break;
    default: break;
  }
  return F;
}

const NAMES_INN = ['du Sanglier Gris', 'du Pot d\'Étain', 'de la Chèvre Borgne', 'du Gué Tranquille', 'des Trois Corbeaux', 'du Chêne Creux', 'de la Lanterne', 'du Cerf Blanc'];

function addBuilding(ctx: Ctx, kind: BuildingKind, x: number, z: number, yaw: number, w: number, d: number, extra: Partial<Building> = {}): Building {
  const { L, rng, s } = ctx;
  const stone = extra.stone ?? (s ? TOWN.has(s.type) || s.type === 'fort' || s.type === 'château' || s.type === 'monastère' : true);
  const b: Building = {
    id: L.buildings.length, sid: L.sid, kind, name: kind === 'auberge' ? `Auberge ${rng.pick(NAMES_INN)}` : kind,
    x, z, yaw, w, d, wallH: kind === 'donjon' ? 9 : kind === 'temple' ? 6 : kind === 'grange' ? 4 : 3 + rng.float(0, 0.4),
    roofH: Math.min(w, d) * (stone ? 0.4 : 0.5), stone, ruined: false, doorX: kind === 'forge' || kind === 'grange' ? 0 : rng.float(-w / 4, w / 4),
    furniture: [], floorY: NaN, dungeonId: -1, ...extra,
  };
  b.furniture = furnish(kind, w, d, rng);
  L.buildings.push(b);
  return b;
}

/** Rues = tronçons de routes traversant l'implantation (sinon une rue fictive par le centre). */
function streets(ctx: Ctx, R: number): { x: number; z: number }[][] {
  const { civ, L } = ctx;
  const out: { x: number; z: number }[][] = [];
  for (const r of civ.roads) {
    const pts = r.points.filter((p) => Math.hypot(p.x - L.x, p.z - L.z) < R);
    if (pts.length >= 2) out.push(pts);
  }
  if (!out.length) {
    const a = ctx.rng.float(0, Math.PI);
    out.push([{ x: L.x - Math.cos(a) * R, z: L.z - Math.sin(a) * R }, { x: L.x + Math.cos(a) * R, z: L.z + Math.sin(a) * R }]);
  }
  return out;
}

/** Remplit les abords des rues de bâtiments, façade tournée vers la rue. */
function lots(ctx: Ctx, kinds: BuildingKind[], R: number, spacing: number, plazaR: number) {
  const { civ, L, rng } = ctx;
  const queue = [...kinds];
  const st = streets(ctx, R);
  // positions candidates triées par distance au centre
  const cand: { x: number; z: number; yaw: number; dist: number; nx: number; nz: number }[] = [];
  for (const pts of st) {
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.01) continue;
      const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
      for (let t = acc % spacing === 0 ? 0 : spacing - (acc % spacing); t < len; t += spacing) {
        const px = a.x + tx * t, pz = a.z + tz * t;
        for (const side of [-1, 1]) cand.push({ x: px, z: pz, yaw: 0, dist: Math.hypot(px - L.x, pz - L.z), nx: -tz * side, nz: tx * side });
      }
      acc += len;
    }
  }
  cand.sort((p, q) => p.dist - q.dist);
  for (const c of cand) {
    if (!queue.length) break;
    const kind = queue[0];
    const big = kind === 'auberge' || kind === 'temple' || kind === 'caserne';
    const w = big ? rng.float(10, 13) : kind === 'grange' ? rng.float(8, 10) : rng.float(6, 9);
    const d = big ? rng.float(8, 10) : rng.float(5.5, 7.5);
    const off = 4.5 + d / 2;
    const x = c.x + c.nx * off, z = c.z + c.nz * off;
    const r = Math.hypot(w, d) / 2;
    if (Math.hypot(x - L.x, z - L.z) > R || Math.hypot(x - L.x, z - L.z) < plazaR + r) continue;
    if (overlaps(L, x, z, r + 1.2) || !terrainOk(civ, x, z, r)) continue;
    // façade (+z local) vers la rue : yaw tel que (sin, cos) = −normale
    addBuilding(ctx, kind, x, z, Math.atan2(-c.nx, -c.nz), w, d);
    queue.shift();
  }
}

function ring(ctx: Ctx, R: number, stone: boolean, towers: boolean, ruined = false) {
  const { civ, L, rng } = ctx;
  const n = Math.max(10, Math.round(R / 7));
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const ax = L.x + Math.cos(a0) * R, az = L.z + Math.sin(a0) * R, bx = L.x + Math.cos(a1) * R, bz = L.z + Math.sin(a1) * R;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const road = civ.roadIndex.nearest(mx, mz);
    const riv = civ.macro.riverIndex.nearest(mx, mz);
    const gate = road && road.d < 6;
    if (riv && riv.d < riv.width / 2 + 2) continue;
    if (ruined && rng.chance(0.35)) continue;
    if (!gate) L.walls.push({ ax, az, bx, bz, h: (stone ? 6 : 3.2) * (ruined ? rng.float(0.3, 0.8) : 1), stone, ruined });
    if (towers && (i % 2 === 0 || gate)) L.towers.push({ x: ax, z: az, r: stone ? 2.6 : 1.4, h: (stone ? 10 : 5) * (ruined ? rng.float(0.4, 0.8) : 1), stone });
  }
}

function decor(L: Layout, kind: DecorKind, x: number, z: number, yaw = 0, s = 1, dungeonId = -1): void {
  L.decor.push({ kind, x, z, yaw, s, key: `${L.sid >= 0 ? 's' + L.sid : 'p' + L.poiId}:d${L.decor.length}`, dungeonId });
}

function square(ctx: Ctx, half: number, stone: boolean, ruined = false) {
  const { L } = ctx;
  const c = [[-half, -half], [half, -half], [half, half], [-half, half]];
  // porte au sud (+z) : deux demi-murs
  for (let i = 0; i < 4; i++) {
    const [ax, az] = c[i], [bx, bz] = c[(i + 1) % 4];
    if (i === 2) {
      L.walls.push({ ax: L.x + ax, az: L.z + az, bx: L.x + 3, bz: L.z + az, h: stone ? 7 : 3.5, stone, ruined });
      L.walls.push({ ax: L.x - 3, az: L.z + az, bx: L.x + bx, bz: L.z + bz, h: stone ? 7 : 3.5, stone, ruined });
    } else L.walls.push({ ax: L.x + ax, az: L.z + az, bx: L.x + bx, bz: L.z + bz, h: (stone ? 7 : 3.5) * (ruined ? 0.5 : 1), stone, ruined });
    L.towers.push({ x: L.x + ax, z: L.z + az, r: stone ? 3 : 1.6, h: (stone ? 11 : 6) * (ruined ? 0.6 : 1), stone });
  }
}

function settlementLayout(civ: Civilization, s: Settlement): Layout {
  const rng = civ.seed.stream('layout', s.id);
  const L: Layout = { sid: s.id, poiId: -1, x: s.x, z: s.z, radius: s.radius, plaza: null, buildings: [], walls: [], towers: [], decor: [], fields: [] };
  const ctx: Ctx = { civ, L, rng, s };
  const t = s.type;
  if (t === 'fort' || t === 'château') {
    const half = t === 'château' ? 24 : 19;
    square(ctx, half, true);
    addBuilding(ctx, 'donjon', s.x, s.z - half * 0.35, 0, t === 'château' ? 13 : 9, t === 'château' ? 11 : 8, { stone: true, doorX: 0 });
    addBuilding(ctx, 'caserne', s.x - half * 0.55, s.z + half * 0.3, Math.PI / 2, 10, 6, { stone: true });
    if (t === 'château') addBuilding(ctx, 'chapelle', s.x + half * 0.55, s.z + half * 0.3, -Math.PI / 2, 9, 6, { stone: true });
    else addBuilding(ctx, 'forge', s.x + half * 0.55, s.z + half * 0.35, -Math.PI / 2, 7, 6, { stone: true });
    decor(L, 'puits', s.x, s.z + half * 0.45);
    decor(L, 'brasero', s.x - 3, s.z + half - 2); decor(L, 'brasero', s.x + 3, s.z + half - 2);
    return L;
  }
  if (t === 'monastère') {
    addBuilding(ctx, 'temple', s.x, s.z - 8, 0, 14, 9, { stone: true });
    addBuilding(ctx, 'dortoir', s.x - 11, s.z + 6, Math.PI / 2, 11, 6, { stone: true });
    addBuilding(ctx, 'maison', s.x + 11, s.z + 6, -Math.PI / 2, 8, 6, { stone: true });
    decor(L, 'puits', s.x, s.z + 6);
    L.fields.push({ x: s.x, z: s.z + 22, w: 26, d: 12, yaw: 0, crop: 2 });
    for (let i = 0; i < 6; i++) decor(L, 'tombe', s.x + 16 + (i % 3) * 2.2, s.z - 14 + Math.floor(i / 3) * 2.5);
    return L;
  }
  if (t === 'camp') {
    decor(L, 'feu de camp', s.x, s.z);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.float(-0.3, 0.3), d = rng.float(6, 9);
      decor(L, 'tente', s.x + Math.cos(a) * d, s.z + Math.sin(a) * d, a, i === 0 ? 1.4 : 1);
    }
    for (let i = 0; i < 3; i++) decor(L, 'caisse', s.x + rng.float(-5, 5), s.z + rng.float(-5, 5), rng.float(0, 3));
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; if (i % 6 !== 0) decor(L, 'pieu', s.x + Math.cos(a) * 13, s.z + Math.sin(a) * 13, a); }
    return L;
  }
  if (t === 'ruines') {
    const ancient = s.name.startsWith('Ruines');
    if (ancient) { ring(ctx, 30, true, true, true); addBuilding(ctx, 'ruine', s.x, s.z, rng.float(0, 1), 14, 12, { ruined: true, stone: true }); }
    for (let i = 0; i < (ancient ? 4 : 6); i++) {
      const a = rng.float(0, Math.PI * 2), d = rng.float(8, 26);
      const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
      if (!overlaps(L, x, z, 5) && terrainOk(civ, x, z, 4)) addBuilding(ctx, 'ruine', x, z, rng.float(0, 3), rng.float(6, 9), rng.float(5, 7), { ruined: true, stone: ancient });
    }
    for (let i = 0; i < 8; i++) decor(L, 'gravats', s.x + rng.float(-22, 22), s.z + rng.float(-22, 22), rng.float(0, 3), rng.float(0.6, 1.4));
    if (ancient) {
      const poi = civ.pois.find((p) => p.settlementId === s.id && p.dungeonId >= 0);
      if (poi) addBuilding(ctx, 'mausolée', s.x + 9, s.z + 9, rng.float(0, 3), 5, 6, { stone: true, dungeonId: poi.dungeonId });
    }
    return L;
  }

  // implantations vivantes
  const isTown = TOWN.has(t);
  const plazaR = t === 'capitale' ? 16 : t === 'ville' ? 14 : t === 'bourg' ? 11 : t === 'hameau' ? 0 : 8;
  if (plazaR) L.plaza = { x: s.x, z: s.z, r: plazaR, cobble: isTown };
  const kinds: BuildingKind[] = [];
  if (t === 'hameau') kinds.push('maison', 'maison', 'maison', ...(rng.chance(0.5) ? ['maison' as const] : []));
  else {
    kinds.push('auberge', 'forge', 'échoppe', isTown ? 'temple' : 'chapelle', 'corps de garde');
    if (isTown) kinds.push('auberge', 'échoppe', 'échoppe', 'caserne');
    const houses = t === 'capitale' ? 30 : t === 'ville' ? 24 : t === 'bourg' ? 16 : 9 + rng.int(0, 3);
    for (let i = 0; i < houses; i++) kinds.push('maison');
  }
  lots(ctx, kinds, s.radius, isTown ? 10 : 12, plazaR);
  if (L.plaza) {
    if (isTown) decor(L, t === 'capitale' ? 'statue' : 'fontaine', s.x, s.z); else decor(L, 'puits', s.x + 2, s.z + 2);
    decor(L, 'brasero', s.x + plazaR * 0.7, s.z - plazaR * 0.7);
    if (isTown) for (let i = 0; i < 3; i++) { const a = rng.float(0, Math.PI * 2); decor(L, 'étal', s.x + Math.cos(a) * plazaR * 0.6, s.z + Math.sin(a) * plazaR * 0.6, a); }
  } else decor(L, 'puits', s.x, s.z);
  // lanternes le long des rues des villes
  if (isTown) for (const st of streets(ctx, s.radius)) for (let i = 0; i < st.length; i += 6) {
    const p = st[i]; if (Math.hypot(p.x - s.x, p.z - s.z) > plazaR + 4) decor(L, 'lanterne', p.x + 3.5, p.z + 3.5);
  }
  // enceintes
  if (t === 'bourg') ring(ctx, s.radius + 6, false, true);
  if (t === 'ville' || t === 'capitale') ring(ctx, s.radius + 8, true, true);
  // fermes et champs en périphérie
  const farms = t === 'hameau' ? 1 : isTown ? 3 : 2 + rng.int(0, 2);
  for (let i = 0, tries = 0; i < farms && tries < 40; tries++) {
    const a = rng.float(0, Math.PI * 2), d = s.radius + rng.float(14, 40) + (isTown ? 12 : 0);
    const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
    if (overlaps(L, x, z, 14) || !terrainOk(civ, x, z, 8)) continue;
    const yaw = a + Math.PI / 2;
    addBuilding(ctx, 'ferme', x, z, yaw + Math.PI, 8, 6, { stone: false });
    const fx = x + Math.cos(a) * 18, fz = z + Math.sin(a) * 18;
    if (terrainOk(civ, fx, fz, 10)) {
      L.fields.push({ x: fx, z: fz, w: 26, d: 16, yaw, crop: rng.chance(0.7) ? 1 : 2 });
      if (rng.chance(0.6)) addBuilding(ctx, 'grange', x + Math.cos(yaw) * 9, z + Math.sin(yaw) * 9, yaw, 9, 7, { stone: false });
    }
    i++;
  }
  // moulin au bord de la rivière
  const riv = civ.macro.riverIndex.nearest(s.x, s.z);
  if (riv && riv.d < s.radius + 60 && t !== 'hameau') {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, x = s.x + Math.cos(a) * (riv.d - riv.width / 2 - 7), z = s.z + Math.sin(a) * (riv.d - riv.width / 2 - 7);
      const r2 = civ.macro.riverIndex.nearest(x, z);
      if (!r2 || r2.d > r2.width / 2 + 11 || r2.d < r2.width / 2 + 5 || overlaps(L, x, z, 6)) continue;
      const b = addBuilding(ctx, 'moulin', x, z, 0, 7, 7, { stone: false });
      // façade vers le village, roue côté rivière
      b.yaw = Math.atan2(s.x - x, s.z - z);
      decor(L, 'roue', x - Math.sin(b.yaw) * 4.6, z - Math.cos(b.yaw) * 4.6, b.yaw);
      break;
    }
  }
  // cimetière près des villages et des villes
  if (t !== 'hameau') {
    const a = rng.float(0, Math.PI * 2), x = s.x + Math.cos(a) * (s.radius + 12), z = s.z + Math.sin(a) * (s.radius + 12);
    if (!overlaps(L, x, z, 8) && terrainOk(civ, x, z, 6)) for (let i = 0; i < 8; i++) decor(L, i % 3 ? 'tombe' : 'croix', x + (i % 4) * 2.2 - 3.3, z + Math.floor(i / 4) * 2.6 - 1.3, a);
  }
  return L;
}

function poiLayout(civ: Civilization, p: Poi): Layout | null {
  const rng = civ.seed.stream('layout', 'poi', p.id);
  const L: Layout = { sid: -1, poiId: p.id, x: p.x, z: p.z, radius: 14, plaza: null, buildings: [], walls: [], towers: [], decor: [], fields: [] };
  const ctx: Ctx = { civ, L, rng, s: null };
  switch (p.kind) {
    case 'statue': decor(L, 'statue', p.x, p.z, 0, 1.3); break;
    case 'menhirs': for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; decor(L, 'menhir', p.x + Math.cos(a) * 7, p.z + Math.sin(a) * 7, a, rng.float(0.8, 1.3)); } decor(L, 'menhir', p.x, p.z, 0, 0.7); break;
    case 'sanctuaire': decor(L, 'sanctuaire', p.x, p.z, rng.float(0, 6)); break;
    case 'arbre remarquable': decor(L, 'arbre géant', p.x, p.z, 0, 1); break;
    case 'tour de guet': decor(L, 'tour de guet', p.x, p.z, rng.float(0, 6)); break;
    case 'cimetière': for (let i = 0; i < 14; i++) decor(L, i % 4 ? 'tombe' : 'croix', p.x + (i % 5) * 2.4 - 4.8, p.z + Math.floor(i / 5) * 2.8 - 2.8, 0); decor(L, 'arbre géant', p.x + 9, p.z - 4, 0, 0.6); break;
    case 'champ de bataille':
      for (let i = 0; i < 26; i++) decor(L, rng.chance(0.4) ? 'croix' : rng.chance(0.5) ? 'lance brisée' : 'ossements', p.x + rng.float(-30, 30), p.z + rng.float(-30, 30), rng.float(0, 6));
      break;
    case 'tanière de loups': case "nid d'araignées": case 'antre du troll':
      decor(L, 'tanière', p.x, p.z, rng.float(0, 6), p.kind === 'antre du troll' ? 1.8 : 1);
      for (let i = 0; i < 6; i++) decor(L, 'ossements', p.x + rng.float(-6, 6), p.z + rng.float(-6, 6), rng.float(0, 6));
      break;
    case 'repaire de gobelins': decor(L, 'entrée grotte', p.x, p.z, rng.float(0, 6), 1, p.dungeonId); for (let i = 0; i < 4; i++) decor(L, 'ossements', p.x + rng.float(-5, 5), p.z + rng.float(-5, 5), 0); break;
    case 'mine': decor(L, 'entrée mine', p.x, p.z, rng.float(0, 6), 1, p.dungeonId); decor(L, 'caisse', p.x + 3, p.z + 2, 0.4); decor(L, 'caisse', p.x + 3.6, p.z + 3, 1); break;
    case 'crypte': addBuilding(ctx, 'mausolée', p.x, p.z, rng.float(0, 6), 6, 7, { stone: true, dungeonId: p.dungeonId }); for (let i = 0; i < 6; i++) decor(L, 'tombe', p.x + rng.float(-9, 9), p.z + rng.float(-9, 9), 0); break;
    default: return null;
  }
  return L;
}

/** Tous les plans du monde (calculés une fois à la création, déterministes). */
export function generateLayouts(civ: Civilization): Layout[] {
  const out: Layout[] = [];
  for (const s of civ.settlements) out.push(settlementLayout(civ, s));
  for (const p of civ.pois) { const l = poiLayout(civ, p); if (l) out.push(l); }
  return out;
}

/** Distance d'un point à un mur (utile aux tests et à l'IA). */
export function wallDist(w: WallSeg, x: number, z: number): number { return segDist(x, z, w.ax, w.az, w.bx, w.bz).d; }
