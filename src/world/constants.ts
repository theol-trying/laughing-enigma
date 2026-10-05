// Dimensions du monde (mètres).
export const MACRO = 256;              // grille macro
export const CELL = 32;                // taille d'une cellule macro
export const WORLD = MACRO * CELL;     // 8192 m
export const CHUNK = 64;               // taille d'un chunk
export const CHUNK_RES = 32;           // quads par côté → un sommet tous les 2 m
export const STEP = CHUNK / CHUNK_RES; // 2 m
export const CHUNKS = WORLD / CHUNK;   // 128 chunks par côté
export const SEA_LEVEL = 0;
export const DUNGEON_ORIGIN_X = 20000; // les donjons vivent hors du monde
export const NEIGH8: readonly [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const NEIGH4: readonly [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
