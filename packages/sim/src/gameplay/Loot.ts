import type { WorldSeed } from '@ascii-fort/core/Seed';
import type { RNG } from '@ascii-fort/core/RNG';
import { B } from '@ascii-fort/worldgen/terrain/Biomes';

// Butin : dépend du type de créature, du biome, du lieu, de la faction et de la difficulté.
// Le contenu d'un coffre est fixe (seed + clé) ; l'ouvrir est mémorisé dans l'état du monde.

export interface LootLine { id: string; qty: number }
export interface LootCtx { biome?: number; depth?: number; building?: string; questItem?: string | null }

type Entry = [id: string, chance: number, min: number, max: number];
const TABLES: Record<string, Entry[]> = {
  loup: [['peau de loup', 0.8, 1, 1], ['croc de loup', 0.5, 1, 2], ['viande crue', 0.5, 1, 2]],
  cerf: [['viande crue', 1, 2, 3], ['peau de cerf', 0.9, 1, 1], ['bois de cerf', 0.5, 1, 1]],
  sanglier: [['viande crue', 1, 2, 4], ['peau de sanglier', 0.8, 1, 1], ['défense de sanglier', 0.5, 1, 2]],
  perdrix: [['plume', 1, 2, 5], ['viande crue', 0.6, 1, 1]],
  bandit: [['or', 1, 4, 18], ['pain', 0.35, 1, 1], ['épée courte', 0.15, 1, 1], ['tunique de cuir', 0.12, 1, 1], ['potion de soin', 0.2, 1, 1], ['flèche', 0.3, 3, 8], ['bière', 0.25, 1, 1]],
  'chef bandit': [['or', 1, 40, 85], ['épée longue', 0.45, 1, 1], ['cotte de mailles', 0.25, 1, 1], ['potion de soin', 1, 1, 2], ['bague en or', 0.4, 1, 1]],
  gobelin: [['or', 0.7, 1, 7], ['dague', 0.15, 1, 1], ['os', 0.4, 1, 2], ['pomme', 0.3, 1, 2]],
  'chef gobelin': [['or', 1, 18, 45], ['hache', 0.5, 1, 1], ['minerai de fer', 0.6, 2, 4], ['potion de soin', 0.6, 1, 1]],
  squelette: [['os', 0.9, 1, 3], ['pièces anciennes', 0.35, 1, 2], ['épée courte', 0.1, 1, 1]],
  spectre: [['essence spectrale', 0.85, 1, 1]],
  araignée: [['soie d’araignée', 0.85, 1, 2], ['glande à venin', 0.45, 1, 1]],
  troll: [['or', 1, 60, 120], ['cœur de troll', 1, 1, 1], ['gemme', 0.5, 1, 1]],
  boss: [['or', 1, 80, 150], ['grande potion de soin', 1, 1, 1], ['gemme', 0.6, 1, 2]],
  // contenants
  maison: [['or', 0.6, 2, 15], ['pain', 0.5, 1, 2], ['pomme', 0.4, 1, 3], ['étoffe', 0.2, 1, 1], ['antidote', 0.1, 1, 1]],
  auberge: [['or', 0.8, 10, 35], ['bière', 0.7, 1, 4], ['pain', 0.6, 1, 3], ['fromage', 0.5, 1, 2], ['hydromel', 0.3, 1, 1]],
  forge: [['lingot de fer', 0.7, 1, 3], ['outils', 0.5, 1, 1], ['épée courte', 0.25, 1, 1], ['minerai de fer', 0.5, 1, 3], ['or', 0.5, 5, 25]],
  échoppe: [['or', 0.8, 15, 50], ['étoffe', 0.5, 1, 2], ['sel', 0.4, 1, 2], ['potion de soin', 0.3, 1, 1], ['outils', 0.3, 1, 1]],
  chapelle: [['potion de soin', 0.6, 1, 2], ['antidote', 0.5, 1, 1], ['or', 0.5, 5, 20], ['coupe d’argent', 0.15, 1, 1]],
  garde: [['flèche', 0.7, 5, 15], ['épée courte', 0.3, 1, 1], ['casque de cuir', 0.3, 1, 1], ['pain', 0.4, 1, 1]],
  camp: [['or', 1, 10, 40], ['potion de soin', 0.4, 1, 1], ['viande crue', 0.4, 1, 2], ['flèche', 0.4, 4, 10], ['étoffe', 0.3, 1, 2]],
  coffre1: [['or', 1, 10, 30], ['potion de soin', 0.6, 1, 1], ['antidote', 0.3, 1, 1], ['flèche', 0.4, 5, 12]],
  coffre2: [['or', 1, 30, 70], ['grande potion de soin', 0.5, 1, 1], ['casque de fer', 0.3, 1, 1], ['bouclier de fer', 0.2, 1, 1], ['bague en or', 0.4, 1, 1]],
  coffre3: [['or', 1, 70, 140], ['gemme', 0.7, 1, 2]],
};
const RARES = ['épée ardente', 'hache de givre', 'dague venimeuse', 'arc long'];

function roll(rng: RNG, t: Entry[], out: LootLine[], mult = 1) {
  for (const [id, ch, a, b] of t) if (rng.chance(Math.min(1, ch * mult))) out.push({ id, qty: rng.int(a, b) });
}

/** Butin d'une créature (déterministe par clé). */
export function creatureLoot(seed: WorldSeed, table: string, key: string, ctx: LootCtx = {}): LootLine[] {
  const rng = seed.stream('loot', key);
  const out: LootLine[] = [];
  roll(rng, TABLES[table] ?? [], out);
  // milieu : herbes en forêt et au marais, minerai en montagne
  if (ctx.biome === B.FOREST || ctx.biome === B.SWAMP) { if (rng.chance(0.25)) out.push({ id: 'herbe médicinale', qty: rng.int(1, 2) }); }
  if (ctx.biome === B.MOUNTAIN && rng.chance(0.3)) out.push({ id: 'minerai de fer', qty: 1 });
  if (table === 'boss' || table === 'troll') out.push({ id: rng.pick(RARES), qty: 1 });
  if (ctx.questItem) out.push({ id: ctx.questItem, qty: 1 });
  return merge(out);
}

/** Contenu d'un contenant (coffre, tonneau, caisse) selon le lieu. */
export function containerLoot(seed: WorldSeed, key: string, ctx: LootCtx): LootLine[] {
  const rng = seed.stream('loot', key);
  const out: LootLine[] = [];
  const b = ctx.building ?? 'maison';
  const table = b === 'auberge' ? 'auberge' : b === 'forge' ? 'forge' : b === 'échoppe' ? 'échoppe' : b === 'chapelle' || b === 'temple' ? 'chapelle'
    : b === 'corps de garde' || b === 'caserne' ? 'garde' : b === 'camp' ? 'camp' : b.startsWith('coffre') ? b : 'maison';
  roll(rng, TABLES[table], out, 1 + (ctx.depth ?? 0) * 0.1);
  if (table === 'coffre3' || (table === 'coffre2' && rng.chance(0.25))) out.push({ id: rng.pick(RARES), qty: 1 });
  if (ctx.questItem) out.push({ id: ctx.questItem, qty: 1 });
  return merge(out);
}

function merge(l: LootLine[]): LootLine[] {
  const m = new Map<string, number>();
  for (const x of l) m.set(x.id, (m.get(x.id) ?? 0) + x.qty);
  return [...m].map(([id, qty]) => ({ id, qty }));
}
