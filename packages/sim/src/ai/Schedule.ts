import type { NPCData, ScheduleBlock, Profession } from '../entities/NPC';
import type { Layout, Building, FurnitureKind, Stall } from '@ascii-fort/worldgen/civilization/Layout';
import { hash2i } from '@ascii-fort/core/RNG';

// Emploi du temps → lieu concret : le lit du PNJ, l'enclume du forgeron, le comptoir de
// l'aubergiste, un banc de la chapelle, un point de la place ou du champ…

export interface Spot { x: number; z: number; building: number; lying: boolean; face: number | null; outdoor: boolean }

export function blockAt(n: NPCData, minute: number): ScheduleBlock {
  const m = ((minute % 1440) + 1440) % 1440;
  return n.schedule.find((b) => m >= b.from && m < b.to) ?? n.schedule[0];
}

function world(b: Building, lx: number, lz: number) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}

const WORK_FURNITURE: Partial<Record<Profession, FurnitureKind[]>> = {
  forgeron: ['enclume', 'foyer de forge', 'établi'], marchand: ['comptoir'], aubergiste: ['comptoir', 'tonneau'],
  prêtre: ['autel'], moine: ['autel', 'banc'], meunier: ['meule'], noble: ['trône', 'table'], garde: ['râtelier', 'table'],
  soldat: ['râtelier', 'table'], artisan: ['établi', 'table'], tavernier: ['comptoir'],
};

/** Marché ouvert (heures de jeu) : étals garnis, marchands à leur poste, flâneurs. */
export const MARKET_OPEN = 7, MARKET_CLOSE = 18.5;
/** Le barde se repose ce soir-là (un soir sur quatre environ). */
export function bardRests(n: Pick<NPCData, 'id'>, day: number): boolean { return hash2i(n.id.length * 131 + n.id.charCodeAt(n.id.length - 1), day, 9) % 4 === 0; }
/** Taverne où joue le barde ce soir (il en change selon le jour s'il y en a plusieurs). */
export function bardTavern(n: Pick<NPCData, 'id'>, taverns: readonly number[], day: number): number {
  return taverns.length ? taverns[hash2i(n.id.charCodeAt(n.id.length - 1), day, 17) % taverns.length] : -1;
}

/** Position d'un étal du marché : côté marchand (−z local) ou côté clients (+z, décalage latéral lx). */
export function stallSpot(st: { x: number; z: number; yaw: number }, seller: boolean, lx = 0): { x: number; z: number; face: number } {
  const c = Math.cos(st.yaw), s = Math.sin(st.yaw), lz = seller ? -1.7 : 1.8;
  const x = st.x + lx * c + lz * s, z = st.z - lx * s + lz * c;
  return { x, z, face: Math.atan2(st.x - x, -(st.z - z)) };
}

/** Point d'un meuble où se tenir (devant, derrière un comptoir, couché sur un lit). */
function furnitureSpot(b: Building, kinds: FurnitureKind[], salt: number, lying = false): Spot | null {
  const list = b.furniture.map((f, i) => ({ f, i })).filter(({ f }) => kinds.includes(f.kind));
  if (!list.length) return null;
  const { f } = list[salt % list.length];
  const behind = f.kind === 'comptoir' ? -0.9 : f.kind === 'lit' ? 0 : 0.9;
  const fy = b.yaw + f.yaw;
  const lz = f.lz + behind * Math.cos(f.yaw), lx = f.lx + behind * Math.sin(f.yaw);
  const p = world(b, f.kind === 'lit' ? f.lx : lx, f.kind === 'lit' ? f.lz : lz);
  // regarder le meuble (cap = direction vers lui)
  const t = world(b, f.lx, f.lz);
  const face = f.kind === 'lit' ? null : Math.atan2(t.x - p.x, -(t.z - p.z));
  void fy;
  return { ...p, building: b.id, lying, face, outdoor: false };
}

function interior(b: Building, salt: number): Spot {
  const lx = ((salt % 7) / 7 - 0.5) * (b.w - 2.5), lz = (((salt >> 3) % 5) / 5 - 0.5) * (b.d - 2.5);
  return { ...world(b, lx, lz), building: b.id, lying: false, face: null, outdoor: false };
}

/** `day` : jour de jeu (le barde change de taverne selon le soir) ; 0 par défaut. */
export function resolveSpot(n: NPCData, block: ScheduleBlock, L: Layout, hour: number, day = 0): Spot {
  const salt = hash2i(n.id.length * 7919 + n.id.charCodeAt(n.id.length - 1), Math.floor(hour), n.id.charCodeAt(1));
  const byId = (id: number) => L.buildings[id];
  const home = byId(n.home), work = n.work >= 0 ? byId(n.work) : undefined;
  const kind = (k: string) => L.buildings.find((b) => b.kind === k);
  const outdoorAt = (x: number, z: number): Spot => ({ x, z, building: -1, lying: false, face: null, outdoor: true });
  switch (block.place) {
    case 'home': {
      const b = home ?? L.buildings[0];
      if (!b) break;
      if (block.act === 'dormir') {
        const idx = parseInt(n.id.split(':')[1], 10) || 0;
        return furnitureSpot(b, ['lit'], idx, true) ?? interior(b, salt);
      }
      return furnitureSpot(b, ['table', 'banc', 'âtre'], salt) ?? interior(b, salt);
    }
    case 'work': {
      const b = work ?? home;
      if (!b) break;
      if (n.profession === 'fermier' && b.kind === 'ferme') return fieldSpot(L, b, salt) ?? interior(b, salt);
      return furnitureSpot(b, WORK_FURNITURE[n.profession] ?? ['table'], salt) ?? interior(b, salt);
    }
    case 'inn': {
      // étape 55 : dans une ville à tavernes, un habitué sur deux boit son verre (ou mange) à la taverne de son quartier
      const T = L.district?.taverns;
      if (T?.length && block.act !== 'dormir' && (hash2i(n.id.length * 7919 + n.id.charCodeAt(n.id.length - 1), 7, n.id.charCodeAt(1)) & 1)) return tavernSeat(n, L, T, home, salt);
      const b = kind('auberge');
      if (b) return furnitureSpot(b, block.act === 'dormir' ? ['lit'] : ['banc', 'table', 'âtre'], salt, block.act === 'dormir') ?? interior(b, salt);
      break;
    }
    case 'temple': {
      const b = kind('chapelle') ?? kind('temple');
      if (b) return furnitureSpot(b, ['banc'], salt) ?? interior(b, salt);
      break;
    }
    case 'field': {
      const s = fieldSpot(L, home ?? L.buildings[0], salt);
      if (s) return s;
      break;
    }
    case 'wild': {
      const a = ((salt % 360) / 360) * Math.PI * 2, d = L.radius + 50 + (salt % 90);
      return outdoorAt(L.x + Math.cos(a) * d, L.z + Math.sin(a) * d);
    }
    // étape 55 : le marché (son étal, ou un étal où l'on flâne) et les tavernes des quartiers
    case 'market': {
      const S = L.district?.stalls;
      if (!S?.length) break;
      if (n.stall !== undefined && S[n.stall] && block.act !== 'loisir') { const p = stallSpot(S[n.stall], true); return { x: p.x, z: p.z, building: -1, lying: false, face: p.face, outdoor: true }; }
      return browse(S, salt, hour);
    }
    case 'tavern': {
      const T = L.district?.taverns ?? [];
      if (!T.length) {
        const b = kind('auberge');
        if (b) return furnitureSpot(b, block.act === 'dormir' ? ['lit'] : ['banc', 'table', 'âtre'], salt, block.act === 'dormir') ?? interior(b, salt);
        break;
      }
      if (n.profession === 'barde' && block.act === 'travailler') {
        // le barde joue près de la cheminée, tourné vers la salle ; certains soirs, il se repose chez lui
        if (bardRests(n, day)) { const hb = home ?? L.buildings[0]; return furnitureSpot(hb, ['table', 'banc', 'âtre'], salt) ?? interior(hb, salt); }
        const b = L.buildings[bardTavern(n, T, day)], sp = furnitureSpot(b, ['âtre'], 0);
        return sp ? { ...sp, face: sp.face === null ? null : sp.face + Math.PI } : interior(b, salt);
      }
      // client : la taverne la plus proche de chez soi (le tavernier : la sienne)
      return tavernSeat(n, L, T, home, salt);
    }
    default: break;
  }
  // un jour de marché, un flâneur sur deux s'arrête devant les étals plutôt qu'au milieu de la place
  const S = L.district?.stalls;
  if (block.place === 'plaza' && block.act === 'loisir' && S?.length && hour >= MARKET_OPEN && hour < MARKET_CLOSE && (salt & 1)) return browse(S, salt, hour);
  // place (ou repli) : un point autour du centre
  const r = L.plaza ? L.plaza.r : 8;
  const a = ((salt % 360) / 360) * Math.PI * 2, d = r * (0.35 + ((salt >> 4) % 50) / 100);
  return outdoorAt(L.x + Math.cos(a) * d, L.z + Math.sin(a) * d);
}

/** Place d'un client dans une taverne des quartiers : la plus proche de chez lui (le tavernier : la sienne). */
function tavernSeat(n: NPCData, L: Layout, T: readonly number[], home: Building | undefined, salt: number): Spot {
  const hb = home ?? L.buildings[0];
  let b = L.buildings[T[0]];
  for (const id of T) { const t = L.buildings[id]; if (Math.hypot(t.x - hb.x, t.z - hb.z) < Math.hypot(b.x - hb.x, b.z - hb.z)) b = t; }
  if (n.work >= 0 && T.includes(n.work)) b = L.buildings[n.work];
  return furnitureSpot(b, ['banc', 'table', 'âtre'], salt) ?? interior(b, salt);
}

/** Flâneur au marché : devant un étal (côté clients), un autre tous les quarts d'heure. */
function browse(S: readonly Stall[], salt: number, hour: number): Spot {
  const q = hash2i(salt, Math.floor(hour * 4), 31);
  const p = stallSpot(S[q % S.length], false, (((q >>> 8) % 5) - 2) * 0.45);
  return { x: p.x, z: p.z, building: -1, lying: false, face: p.face, outdoor: true };
}

function fieldSpot(L: Layout, near: Building | undefined, salt: number): Spot | null {
  if (!L.fields.length) return null;
  const f = near ? L.fields.reduce((a, b) => (Math.hypot(a.x - near.x, a.z - near.z) < Math.hypot(b.x - near.x, b.z - near.z) ? a : b)) : L.fields[0];
  const lx = ((salt % 100) / 100 - 0.5) * f.w * 0.8, lz = (((salt >> 7) % 100) / 100 - 0.5) * f.d * 0.8;
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c, building: -1, lying: false, face: null, outdoor: true };
}

/** Ronde des gardes : boucle autour de la place et le long des rues. */
export function patrolRoute(L: Layout): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  const r = Math.max(10, (L.plaza?.r ?? 8) + 6), R = L.radius * 0.8;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push({ x: L.x + Math.cos(a) * (i % 2 ? R : r), z: L.z + Math.sin(a) * (i % 2 ? R : r) });
  }
  return pts;
}
