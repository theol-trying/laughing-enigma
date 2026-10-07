import { Entity, type MonsterState } from './Entity';
import { creatureModel } from './Models';
import type { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import type { WorldSeed } from '@ascii-fort/core/Seed';
import { B } from '@ascii-fort/worldgen/terrain/Biomes';
import { W_NONE } from '@ascii-fort/worldgen/terrain/Hydrology';
import { WORLD } from '@ascii-fort/worldgen/constants';

// Familles de créatures adaptées aux biomes et aux lieux, avec comportement, perception,
// territoire, agressivité, statistiques et butin.

export interface MonsterDef {
  name: string; hp: number; damage: number; armor: number; walk: number; run: number; reach: number; attackCd: number;
  perception: number; aggro: number; nocturnal: boolean; flee: number; xp: number; loot: string; element?: 'poison' | 'feu' | 'givre';
  undead?: boolean; hover?: number;
  /** gibier : détale dès qu'il perçoit un chasseur */
  prey?: boolean;
  /** s'envole en fuyant */
  flyer?: boolean;
}

export const MONSTERS: Record<string, MonsterDef> = {
  loup: { name: 'Loup', hp: 30, damage: 5, armor: 0, walk: 2, run: 6.4, reach: 1.6, attackCd: 1.5, perception: 30, aggro: 0.7, nocturnal: true, flee: 0.25, xp: 20, loot: 'loup' },
  bandit: { name: 'Bandit', hp: 45, damage: 9, armor: 2, walk: 1.6, run: 4.9, reach: 2, attackCd: 1.3, perception: 28, aggro: 0.85, nocturnal: false, flee: 0.2, xp: 35, loot: 'bandit' },
  'chef bandit': { name: 'Chef des bandits', hp: 95, damage: 14, armor: 5, walk: 1.6, run: 4.6, reach: 2.2, attackCd: 1.4, perception: 30, aggro: 1, nocturnal: false, flee: 0, xp: 100, loot: 'chef bandit' },
  gobelin: { name: 'Gobelin', hp: 25, damage: 6, armor: 1, walk: 1.8, run: 5.2, reach: 1.5, attackCd: 0.9, perception: 22, aggro: 0.75, nocturnal: false, flee: 0.3, xp: 18, loot: 'gobelin' },
  'chef gobelin': { name: 'Chef gobelin', hp: 85, damage: 12, armor: 3, walk: 1.6, run: 4.6, reach: 1.9, attackCd: 1.2, perception: 26, aggro: 1, nocturnal: false, flee: 0, xp: 85, loot: 'chef gobelin' },
  squelette: { name: 'Squelette', hp: 40, damage: 8, armor: 2, walk: 1.2, run: 3.6, reach: 1.9, attackCd: 1.3, perception: 18, aggro: 1, nocturnal: true, flee: 0, xp: 30, loot: 'squelette', undead: true },
  spectre: { name: 'Spectre', hp: 35, damage: 9, armor: 0, walk: 1.4, run: 4, reach: 1.8, attackCd: 1.4, perception: 22, aggro: 1, nocturnal: true, flee: 0, xp: 40, loot: 'spectre', element: 'givre', undead: true, hover: 0.35 },
  araignée: { name: 'Araignée géante', hp: 35, damage: 7, armor: 1, walk: 1.8, run: 5.6, reach: 1.7, attackCd: 1.0, perception: 20, aggro: 0.8, nocturnal: true, flee: 0.2, xp: 30, loot: 'araignée', element: 'poison' },
  troll: { name: 'Troll des montagnes', hp: 230, damage: 26, armor: 6, walk: 1.6, run: 5, reach: 3, attackCd: 2.0, perception: 32, aggro: 0.9, nocturnal: false, flee: 0, xp: 230, loot: 'troll' },
  'roi-squelette': { name: 'Roi-Squelette', hp: 210, damage: 20, armor: 6, walk: 1.3, run: 3.8, reach: 2.4, attackCd: 1.5, perception: 26, aggro: 1, nocturnal: false, flee: 0, xp: 260, loot: 'boss', undead: true },
  cerf: { name: 'Cerf', hp: 34, damage: 4, armor: 0, walk: 1.5, run: 8.5, reach: 1.6, attackCd: 1.6, perception: 36, aggro: 0, nocturnal: false, flee: 1, xp: 14, loot: 'cerf', prey: true },
  sanglier: { name: 'Sanglier', hp: 48, damage: 9, armor: 1, walk: 1.3, run: 6.2, reach: 1.5, attackCd: 1.3, perception: 20, aggro: 0.3, nocturnal: false, flee: 0.15, xp: 26, loot: 'sanglier' },
  perdrix: { name: 'Perdrix', hp: 6, damage: 0, armor: 0, walk: 0.8, run: 7, reach: 0.5, attackCd: 2, perception: 16, aggro: 0, nocturnal: false, flee: 1, xp: 5, loot: 'perdrix', prey: true, flyer: true },
  'gardien des tombes': { name: 'Gardien des tombes', hp: 140, damage: 15, armor: 5, walk: 1.3, run: 3.6, reach: 2.2, attackCd: 1.5, perception: 22, aggro: 1, nocturnal: false, flee: 0, xp: 150, loot: 'boss', undead: true },
};

/** Repaire : population agrégée, simulée sans incarner les créatures tant que le joueur est loin. */
export interface Lair {
  key: string;
  poiId: number; sid: number;
  x: number; z: number;
  type: string; leader: string | null;
  max: number; alive: number;          // population courante (évolue hors champ)
  leaderAlive: boolean;
  territory: number;
  why: string;
}

/** Repaires dérivés des points d'intérêt et des camps (déterministe). */
export function buildLairs(civ: Civilization, seed: WorldSeed): Lair[] {
  const out: Lair[] = [];
  for (const p of civ.pois) {
    const rng = seed.stream('monsters', p.id);
    let type = '', leader: string | null = null, max = 0, territory = 40;
    switch (p.kind) {
      case 'tanière de loups': type = 'loup'; max = rng.int(2, 4); territory = 120; break;
      case "nid d'araignées": type = 'araignée'; max = rng.int(3, 5); territory = 50; break;
      case 'antre du troll': type = 'troll'; max = 1; territory = 90; break;
      case 'camp de bandits': type = 'bandit'; max = rng.int(3, 5); leader = 'chef bandit'; territory = 70; break;
      case 'repaire de gobelins': type = 'gobelin'; max = rng.int(2, 3); territory = 50; break;
      case 'champ de bataille': type = 'squelette'; max = rng.int(2, 3); territory = 45; break;
      case 'cimetière': type = 'spectre'; max = 1; territory = 30; break;
      case 'ruines': type = 'squelette'; max = rng.int(2, 4); territory = 50; break;
      default: continue;
    }
    out.push({ key: `lair:${p.id}`, poiId: p.id, sid: p.settlementId, x: p.x, z: p.z, type, leader, max, alive: max, leaderAlive: !!leader, territory, why: p.why });
  }
  return out;
}

/**
 * Gibier en hardes : un tirage par case de 320 m sur un flux à part (« faune »), sans rien changer
 * au reste du monde. Cerfs en forêt, taïga et prairies, sangliers en forêt et marais, perdrix dans les landes.
 */
export function buildHerds(civ: Civilization, seed: WorldSeed): Lair[] {
  const out: Lair[] = [], G = 320, n = Math.floor(WORLD / G), macro = civ.macro;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const rng = seed.stream('faune', j * n + i);
    if (!rng.chance(0.55)) continue;
    const x = (i + 0.15 + rng.next() * 0.7) * G, z = (j + 0.15 + rng.next() * 0.7) * G;
    const c = macro.cellOf(x, z);
    if (macro.hydro.water[c] !== W_NONE || macro.elev[c] <= 1) continue;
    if (civ.settlements.some((s) => !s.abandoned && Math.hypot(s.x - x, s.z - z) < s.radius + 110)) continue;
    const b = macro.biome[c], r = rng.next();
    const type = b === B.FOREST ? (r < 0.5 ? 'cerf' : 'sanglier') : b === B.TAIGA ? 'cerf' : b === B.SWAMP ? 'sanglier'
      : b === B.PLAINS || b === B.HEATH ? (r < 0.55 ? 'cerf' : 'perdrix') : '';
    if (!type) continue;
    const max = type === 'cerf' ? rng.int(3, 6) : type === 'sanglier' ? rng.int(2, 4) : rng.int(3, 5);
    out.push({ key: `herd:${j * n + i}`, poiId: -1, sid: -1, x, z, type, leader: null, max, alive: max, leaderAlive: false, territory: type === 'perdrix' ? 30 : 70, why: '' });
  }
  return out;
}

export function makeMonster(id: string, type: string, x: number, z: number, homeX: number, homeZ: number, territory: number, extra: Partial<MonsterState> = {}): Entity {
  const d = MONSTERS[type] ?? MONSTERS.loup;
  const e = new Entity(id, 'monster', type, d.name, creatureModel(type), d.hp);
  e.x = x; e.z = z; e.speed = d.walk;
  e.pose.hover = d.hover ?? 0;
  const lv = Math.max(1, Math.min(20, extra.level ?? 1));
  e.hp = e.maxHp = Math.round(d.hp * (1 + 0.22 * (lv - 1)));
  e.mon = {
    def: type, homeX, homeZ, territory, aggro: d.aggro, perception: d.perception, nocturnal: d.nocturnal,
    damage: d.damage, armor: d.armor, attackCd: d.attackCd, reach: d.reach, state: 'repos', targetId: null, cooldown: 0,
    alerted: false, campId: -1, poiId: -1, unique: '', leader: false, loot: d.loot, element: d.element, xp: d.xp, windup: 0, lair: '', ...extra,
    level: lv,
  };
  // plus loin, plus fort : dégâts, armure et expérience suivent le niveau
  e.mon.damage = Math.round(d.damage * (1 + 0.14 * (lv - 1)) * 10) / 10;
  e.mon.armor = d.armor + Math.floor((lv - 1) / 2);
  e.mon.xp = Math.round(d.xp * (1 + 0.3 * (lv - 1)));
  return e;
}

/** Niveau de danger d'un lieu : 1 autour du village de départ, puis +1 tous les 650 m environ (max 12). */
export function dangerAt(civ: Civilization, x: number, z: number): number {
  const s = civ.settlements[civ.startId];
  return s ? Math.max(1, Math.min(12, 1 + Math.floor(Math.hypot(x - s.x, z - s.z) / 650))) : 1;
}

/** Niveau des créatures d'un donjon : danger du lieu de son entrée + profondeur. */
export function dungeonLevel(civ: Civilization, d: { poiId: number; depth: number }): number {
  const p = civ.pois[d.poiId]?.id === d.poiId ? civ.pois[d.poiId] : civ.pois.find((x) => x.id === d.poiId);
  return (p ? dangerAt(civ, p.x, p.z) : 1) + Math.max(0, (d.depth ?? 1) - 1);
}
