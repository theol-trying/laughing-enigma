# @ascii-fort/worldgen

Monde procédural **entièrement déterminé par la seed** (macro avant micro).

| Module | Contenu |
|---|---|
| `MacroWorld` | continent 256² × 32 m : relief, climat, biomes, régions, noms |
| `terrain/Hydrology` | priority-flood, bassins, rivières source → mer, lacs, vallées |
| `terrain/TerrainSampler` | `h(x, z)` pur : relief détaillé, lits de rivière, routes, places, champs |
| `terrain/Biomes` | paramètres des 10 biomes |
| `civilization/*` | factions, histoire (traces physiques), implantations, routes A* et ponts, POI, plans de villages, bâtiments meublés |
| `dungeons/DungeonGenerator` | donjons (graphe de salles, boucles, clé, boss, pièges) |
| `Chunk`, `ChunkManager`, `FarTerrain` | chunks de 64 m à la demande (maillages, collisions, lumières, objets), horizon lointain |
| `World` | assemblage : `new World(seed, gpu | null)` (`null` = sans affichage, pour tests et outils) |

Les données (relief, rivières, villes, routes, histoire) n'ont besoin d'aucun GPU : on peut s'en
servir pour une carte 2D, un outil de génération de campagnes ou un serveur.
