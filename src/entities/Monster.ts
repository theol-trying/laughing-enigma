import { Entity, type MonsterState } from './Entity';
import { creatureModel } from './Models';
import type { Civilization } from '../world/civilization/Civilization';
import type { WorldSeed } from '../core/Seed';

// Familles de créatures adaptées aux biomes et aux lieux, avec comportement, perception,
// territoire, agressivité, statistiques et butin.

export interface MonsterDef {
  name: string; hp: number; damage: number; armor: number; walk: number; run: number; reach: number; attackCd: number;
  perception: number; aggro: number; nocturnal: boolean; flee: number; xp: number; loot: string; element?: 'poison' | 'feu' | 'givre';
  undead?: boolean; hover?: number;
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

export function makeMonster(id: string, type: string, x: number, z: number, homeX: number, homeZ: number, territory: number, extra: Partial<MonsterState> = {}): Entity {
  const d = MONSTERS[type] ?? MONSTERS.loup;
  const e = new Entity(id, 'monster', type, d.name, creatureModel(type), d.hp);
  e.x = x; e.z = z; e.speed = d.walk;
  e.pose.hover = d.hover ?? 0;
  e.mon = {
    def: type, homeX, homeZ, territory, aggro: d.aggro, perception: d.perception, nocturnal: d.nocturnal,
    damage: d.damage, armor: d.armor, attackCd: d.attackCd, reach: d.reach, state: 'repos', targetId: null, cooldown: 0,
    alerted: false, campId: -1, poiId: -1, unique: '', leader: false, loot: d.loot, element: d.element, xp: d.xp, windup: 0, lair: '', ...extra,
  };
  return e;
}
