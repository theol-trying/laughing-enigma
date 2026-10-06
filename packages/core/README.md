# @ascii-fort/core

Déterminisme et utilitaires, en TypeScript pur (aucune dépendance au navigateur) : utilisable
dans un jeu, un outil, un test ou un serveur.

| Module | Contenu |
|---|---|
| `RNG` | PRNG rapide (cyrb128 + sfc32), `fork`, `int`, `pick`, `chance`… ; `hash2i` |
| `Seed` | `WorldSeed` : une seed texte → des **flux dérivés** indépendants (`seed.stream('npc', id)`) |
| `Noise` | bruit simplex 2D, fbm, « ridged » |
| `math` | matrices 4×4, projection, `lookAt`, utilitaires |
| `Heap` | tas binaire (A*, priority-flood) |
| `Events` | bus d'événements typé |
| `Time` | horloge de jeu (jour, heure, vitesse) |
| `version` | `GENERATOR_VERSION` : à incrémenter dès que le monde généré change |

```ts
import { WorldSeed } from '@ascii-fort/core/Seed';
const seed = new WorldSeed('TEST-001');
const rng = seed.stream('villages', 12); // même seed + même nom ⇒ mêmes tirages, toujours
```
