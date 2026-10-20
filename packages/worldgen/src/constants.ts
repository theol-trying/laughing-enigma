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
// Étages inférieurs des donjons (étape 55) : même tranche en x que le niveau 1 (z ≈ 1000), décalés de 400 m en z par étage.
export const FLOOR_Z0 = 1000, FLOOR_STEP = 400;
// Grottes (étape 55) : une case de 400 m par réseau, 24 par rangée, à partir de z = 6000 (loin des étages des donjons).
export const CAVE_ORIGIN_Z = 6000, CAVE_SLOT = 400, CAVE_COLS = 24;
// Codes des mondes souterrains (Companions.worldOf) : donjon d (niveau 1) = d, étage n = d + 1000 × (n − 1), grotte g = 100000 + g.
export const FLOOR_CODE = 1000, CAVE_CODE = 100000;
export const NEIGH8: readonly [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const NEIGH4: readonly [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
