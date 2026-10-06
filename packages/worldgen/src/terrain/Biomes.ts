import { M } from '@ascii-fort/ascii-engine/Materials';

export const B = {
  OCEAN: 0, LAKE: 1, BEACH: 2, PLAINS: 3, FOREST: 4, TAIGA: 5, SWAMP: 6, HEATH: 7, MOUNTAIN: 8, SNOW: 9,
} as const;
export type BiomeId = number;

export interface BiomeDef {
  name: string;
  ground: number;        // matière du sol
  color: number;         // couleur du sol
  color2: number;        // variation
  rough: number;         // relief de détail (m)
  trees: number;         // densité d'arbres (par 100 m²)
  pine: number;          // part de conifères
  bushes: number;
  rocks: number;
  grassTufts: number;
  danger: number;        // 0..1 : dangerosité naturelle
}

export const BIOMES: BiomeDef[] = [];
BIOMES[B.OCEAN] = { name: 'océan', ground: M.SAND, color: 0x8a7a50, color2: 0x6a6040, rough: 1, trees: 0, pine: 0, bushes: 0, rocks: 0, grassTufts: 0, danger: 0 };
BIOMES[B.LAKE] = { name: 'lac', ground: M.MUD, color: 0x5a5236, color2: 0x4a4430, rough: 0.5, trees: 0, pine: 0, bushes: 0, rocks: 0, grassTufts: 0, danger: 0 };
BIOMES[B.BEACH] = { name: 'côte', ground: M.SAND, color: 0xcdb880, color2: 0xb8a470, rough: 0.6, trees: 0.02, pine: 0.5, bushes: 0.05, rocks: 0.05, grassTufts: 0.1, danger: 0.1 };
BIOMES[B.PLAINS] = { name: 'plaine', ground: M.GRASS, color: 0x5f9a3e, color2: 0x7aa84a, rough: 1.6, trees: 0.05, pine: 0.1, bushes: 0.12, rocks: 0.03, grassTufts: 1, danger: 0.15 };
BIOMES[B.FOREST] = { name: 'forêt', ground: M.DIRT, color: 0x46642e, color2: 0x5a5a2c, rough: 2.2, trees: 0.9, pine: 0.15, bushes: 0.35, rocks: 0.05, grassTufts: 0.4, danger: 0.45 };
BIOMES[B.TAIGA] = { name: 'forêt de pins', ground: M.DIRT, color: 0x4a5a3a, color2: 0x5a6048, rough: 2.6, trees: 0.75, pine: 0.9, bushes: 0.15, rocks: 0.1, grassTufts: 0.3, danger: 0.5 };
BIOMES[B.SWAMP] = { name: 'marais', ground: M.MUD, color: 0x4a5a32, color2: 0x3a4a30, rough: 0.6, trees: 0.25, pine: 0, bushes: 0.4, rocks: 0, grassTufts: 0.8, danger: 0.65 };
BIOMES[B.HEATH] = { name: 'lande', ground: M.HEATH, color: 0x7a7a46, color2: 0x8a6a50, rough: 2.5, trees: 0.03, pine: 0.6, bushes: 0.3, rocks: 0.25, grassTufts: 0.5, danger: 0.35 };
BIOMES[B.MOUNTAIN] = { name: 'montagne', ground: M.ROCK, color: 0x7a766c, color2: 0x8a8478, rough: 7, trees: 0.08, pine: 1, bushes: 0.05, rocks: 0.6, grassTufts: 0.1, danger: 0.7 };
BIOMES[B.SNOW] = { name: 'cimes enneigées', ground: M.SNOW, color: 0xe6ecf2, color2: 0xd0d8e4, rough: 6, trees: 0.02, pine: 1, bushes: 0, rocks: 0.3, grassTufts: 0, danger: 0.85 };
