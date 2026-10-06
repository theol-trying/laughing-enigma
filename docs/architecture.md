# ASCII FORT — architecture

Ce document décrit comment le jeu est construit, pourquoi, et comment l'étendre.

## Vue d'ensemble

```
seed ─► WorldSeed ─► flux RNG dérivés (terrain, climate, hydrology, regions, settlements, roads,
                       history, layout, poi, npc, dungeon, monsters, loot, names, weather, economy…)
        │
        ├─► MacroWorld (grille 256², 32 m)        relief, hydrologie, climat, biomes, régions, noms
        ├─► Civilization                           factions, histoire, implantations, routes, POI, donjons
        ├─► CivWorld (plans + géométrie)           bâtiments meublés, enceintes, ponts, décors, horizon
        ├─► TerrainSampler h(x,z) pur              relief détaillé + rivières + routes/places/champs
        └─► ChunkManager (64 m, à la demande)      maillage terrain, eau, végétation, constructions
                                                    collisions, planchers, lumières, objets interactifs
Game (boucle)
  ├─ Player + PlayerCombat + Character             contrôle FPS, combat, fiche, inventaire
  ├─ EntityManager                                 PNJ et créatures actifs près du joueur
  ├─ Reputation · Economy · Rumors · QuestSystem · DialogueSystem · Weather
  ├─ WorldState                                    différences avec le monde généré (sauvegarde)
  └─ Renderer (WebGL2)                              G-buffer → glyphes → écran
```

## Bibliothèques (workspaces npm)

```
packages/core          @ascii-fort/core          déterminisme, bruit, maths, événements, temps (pur TS)
packages/ascii-engine  @ascii-fort/ascii-engine  rendu 3D → caractères (WebGL2), interface texte, entrées
packages/worldgen      @ascii-fort/worldgen      monde procédural (macro, hydrologie, civilisation, chunks)
packages/sim           @ascii-fort/sim           entités, IA, gameplay
src/                   le jeu (boucle Game, écrans, audio, sauvegarde, main.ts)
```

Dépendances à sens unique : core ← ascii-engine ← worldgen ← sim ← jeu. Chaque bibliothèque
expose ses modules par sous-chemin (`import { RNG } from '@ascii-fort/core/RNG'`) et a son README.

## Principes

- **Le monde est une fonction de la seed.** Tout ce qui est permanent (relief, rivières, villes,
  routes, noms, PNJ, histoire, donjons, contenu des coffres) se régénère à l'identique. Chaque
  système tire ses nombres d'un flux qui lui est propre : `seed.stream('settlements')`,
  `seed.stream('npc', sid)`… Un flux est dérivé de *la clé* (seed + nom), jamais de l'état
  d'un autre flux : ajouter un tirage dans un système ne déplace rien ailleurs.
- **Macro avant micro.** Le monde global (256 × 256 cellules de 32 m) est calculé d'abord ; un
  chunk ne fait qu'interpoler et détailler ce que le macro a décidé.
- **Version du générateur.** `packages/core/src/version.ts` : toute modification qui change le monde incrémente
  `GENERATOR_VERSION`, affichée en jeu et stockée dans les sauvegardes. Les tests de déterminisme
  (`tests/determinism.test.ts`) fixent des points de contrôle de la seed `TEST-001`.
- **Systèmes branchés entre eux** par un bus d'événements (`@ascii-fort/core/Events`) : `entity:killed`,
  `player:crime`, `camp:cleared`, `quest:completed`, `weather:changed`…

## Rendu : de la 3D aux caractères (`packages/ascii-engine`)

1. **Passe scène** (`shaders.ts` : `STATIC_VS`, `INSTANCED_VS`, `SCENE_FS`) à 2 × 2 sous-échantillons
   par caractère, dans un G-buffer de 3 cibles + profondeur : couleur éclairée et intensité,
   matière + hachage stable lié au monde + normale octaédrique, lettre d'entité + drapeaux.
   Éclairage : soleil/lune avec ombres (carte d'ombre 2048², PCF), ambiance hémisphérique,
   24 lumières ponctuelles (torches, âtres, lanternes), matières émissives, eau animée.
   Rendu relatif à la caméra (précision float stable). Terrain lointain = grille macro entière,
   dessinée au-delà du rayon des chunks (découpe par distance dans le shader).
2. **Passe cellule** (`CELL_FS`) à 1 pixel par caractère : regroupe les 4 sous-échantillons ;
   si la case chevauche une rupture de profondeur ou de plan (silhouette), elle devient un glyphe
   quadrant (`▘▝▀▄▌▐▚▞▙▛▜▟`) avec couleur de premier plan et de fond ; sinon la matière choisit
   son glyphe dans sa rampe (selon la lumière, le brouillard, la distance, l'orientation pour
   les toits, une phase animée pour l'eau et le feu). Ciel procédural (dégradé, soleil, lune,
   étoiles, nuages), pluie et neige, liseré de douleur, puis fusion de l'interface (`TextGrid`).
3. **Passe présentation** (`PRESENT_FS`) : chaque pixel lit sa cellule et le masque du glyphe dans
   l'atlas (rendu au démarrage à la taille exacte de la cellule ; blocs et traits de boîte
   dessinés procéduralement pour se raccorder sans jour).

Les matières et leurs vocabulaires de glyphes sont dans `Materials.ts` (table R16UI lue par le
shader). Les créatures sont des volumes en boîtes animés (`entities/Models.ts`) ; au-delà de 22 m,
le renderer les remplace par leur lettre (style roguelike).

## Génération du monde (`packages/worldgen`)

- `MacroWorld.ts` : continent (bruit déformé + atténuation radiale), montagnes (bruit « crêtes »
  masqué), climat (latitude, altitude, humidité, proximité de l'eau), biomes, régions (Dijkstra
  depuis des graines espacées : reliefs et rivières font frontière).
- `terrain/Hydrology.ts` : priority-flood depuis la mer (arbre d'écoulement), accumulation,
  lacs (dépressions profondes, budget ≈ 2,5 % des terres, les autres comblées), rivières tracées
  de la source à l'embouchure, vallées creusées, polylignes lissées avec méandres + index spatial.
- `terrain/TerrainSampler.ts` : fonction pure `h(x, z)` (bicubique macro + détail fractal par
  biome + lit de rivière + berges + « features » de la civilisation), matière et couleur.
- `civilization/` : `History.ts` (royaumes, ordre, guilde, bandits, culte ; chute d'un royaume
  ancien → ruines et donjon ; peste → village abandonné et cimetière ; troll → hameau rasé et
  antre ; schisme → monastère ; mines → village minier envahi de gobelins ; guerre → champ de
  bataille, fort au col, statue ; révolte → bandits ; expédition perdue), `Civilization.ts`
  (habitabilité : eau, fertilité, pente, côte ; capitales, châteaux, villes, bourgs, villages,
  hameaux, ports, villages miniers, monastère ; productions et besoins ; village de départ),
  `Roads.ts` (A* sur la grille macro, réutilisation des routes, ponts), `Pois.ts` (camps de
  bandits sur les routes commerciales, tanières, grottes, crypte, tours, sanctuaires, menhirs,
  arbres remarquables), `Layout.ts` (plans : rues = routes réelles, bâtiments indispensables puis
  maisons, fermes et champs, moulin au bord de l'eau, enceintes, forts, châteaux, camps, ruines),
  `Builders.ts` (géométrie, intérieurs à double paroi, collisions, planchers, lumières, objets),
  `CivWorld.ts` (raccord terrain/chunks/horizon, point de départ).
- `dungeons/DungeonGenerator.ts` : graphe de salles sur grille (arbre + boucles), salle du boss au
  plus loin, porte verrouillée sur son seul accès, clé dans une salle annexe, pièges, coffres,
  créatures selon le type (crypte, forteresse, mine, grotte). Les donjons vivent hors de la carte
  (x ≥ 20 000) : on y entre et en sort par des objets interactifs.

## Simulation (`packages/sim`)

- **Niveaux de détail** : une implantation à moins de 250 m est « active » (PNJ incarnés, grille
  de navigation de 1 m construite depuis les vraies collisions, portes rouvertes, zones connexes) ;
  au-delà, les PNJ ne sont que des données (`NPCData`) et leur position découle de leur emploi du
  temps. Les repaires (meutes, camps, nids) sont des populations agrégées qui évoluent chaque jour
  (les loups prospèrent près des troupeaux, les camps démantelés ne reviennent pas).
- **PNJ** (`NPC.ts`) : identité, âge, métier, domicile et lieu de travail (bâtiments du plan),
  faction, traits, relations, richesse, besoins, connaissances (lieux, événements, routes),
  objectif, emploi du temps ; mémoire des actes du joueur.
- **IA** : PNJ par fonctions d'utilité (emploi du temps, s'abriter sous la pluie, fuir ou combattre
  selon le métier et la bravoure, parler) ; créatures (`MonsterAI.ts`) : repos nocturne, errance,
  patrouille, garde, chasse, attaque avec élan (2 assaillants au plus), fuite, retour au
  territoire, alerte de la meute ; perception (`Perception.ts`) : vue × lumière × brouillard ×
  discrétion, cône, ligne de vue, ouïe.
- **Gameplay** : `Items.ts`, `Character.ts` (6 caractéristiques, 6 compétences qui progressent à
  l'usage, niveaux), `PlayerCombat.ts` (léger/lourd, blocage, esquive, arc, sorts, éléments),
  `Combat.ts` (armure, parade, effets), `Loot.ts` (tables par créature, lieu, biome, difficulté),
  `Reputation.ts` (globale, par faction, locale, amendes, mémoire), `Economy.ts` (offre par
  bien et par implantation, routes bloquées par les camps → pénuries et prix), `Rumors.ts`
  (propagation le long des routes), `QuestSystem.ts` (quêtes dérivées de l'état du monde),
  `Dialogue.ts` (modèles et règles), `Weather.ts` (périodes régionales, transitions).

### Exemple de chaîne systémique (vérifiée)

camp de bandits sur la route Guéecourt–Gué-Marain → route bloquée → l'offre d'outils de Gué-Marain
chute → le marchand vend plus cher et en parle → rumeur dans les auberges → quête « Les convois de
Guéecourt » → le joueur repère puis démantèle le camp → `camp:cleared` → route débloquée,
réputation, rumeur → récompense → les prix reviennent progressivement (31 → 15 or en 4 jours).

## Sauvegarde (`src/game/SaveManager.ts`)

IndexedDB (repli localStorage). Une sauvegarde contient la seed, la version du générateur et
uniquement des différences : joueur, fiche, inventaire, équipement, heure, `WorldState`
(contenants ouverts, objets posés, drapeaux, lieux découverts, brouillard de la carte compressé
en bits), PNJ (vie, PV, richesse, mémoires), réputation, amendes, offre économique, quêtes,
rumeurs, populations des repaires, créatures uniques tuées, camps démantelés. Au chargement, le
monde est régénéré depuis la seed puis les différences sont appliquées.

## Étendre le jeu

- **Une créature** : une entrée dans `MONSTERS` (`entities/Monster.ts`), un modèle dans
  `creatureModel()` (`Models.ts`), une table de butin dans `Loot.ts`, et un type de repaire dans
  `buildLairs()` (ou un spawn de donjon).
- **Un objet** : une ligne dans `Items.ts` (avec `good` pour l'économie) ; il apparaîtra chez les
  marchands concernés via `Economy.stock()`.
- **Un biome** : `terrain/Biomes.ts` (paramètres) + règle dans `MacroWorld.genBiomes()` + glyphes
  de carte (`ui/GameScreens.ts`).
- **Une matière** : `rendering/Materials.ts` (rampe de glyphes, drapeaux).
- **Un type de quête** : un bloc dans `QuestSystem.generate()` qui lit l'état du monde, des étapes,
  et l'écoute des événements qui le font avancer.
