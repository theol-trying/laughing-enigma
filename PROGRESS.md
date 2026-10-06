# ASCII FORT — journal de progression (fichier de reprise)

> **Reprendre après une coupure :** lire ce fichier, puis `git log --oneline | head`.
> La section « ➜ REPRENDRE ICI » indique l'étape exacte. Chaque étape terminée = 1 commit
> (`npm run checkpoint -- "message"`). Ne jamais refaire une étape cochée.
> Économie : travailler seul (pas d'agents en parallèle), pas de relecture inutile de fichiers.

## ➜ REPRENDRE ICI
Étape 6b — Monstres & IA de combat : entities/Monster.ts (définitions loup, bandit/chef bandit, gobelin/chef, squelette,
spectre, araignée, troll : stats, perception, territoire, agressivité, nocturne, butin), spawn depuis civ.pois (tanières,
camps = settlements type camp, antre, nid) et DungeonLayout.spawns, populations agrégées hors zone active
(écologie : proies/prédateurs, bandits sur routes, danger loin des villes, nocturnes), utility AI (errance, patrouille,
chasse, attaque, fuite, retour au territoire, garde du nid, appel des alliés), perception (vue + ouïe + lumière).
Déjà fait (6a) : entities/{NPC,Models,Entity,EntityManager}.ts, ai/{Pathfinding,Schedule}.ts, PNJ actifs < 250 m.

## Étapes
- [x] 0. Setup : Vite 8 + TS 7 + Vitest 5, git (identité theol-trying noreply), PROGRESS/CLAUDE.md
- [x] 1. Cœur : RNG seedé (cyrb128 + sfc32, flux dérivés), Noise (simplex 2D, fbm, ridged), math (mat4), Time, Events
- [x] 2. Renderer : GL utils, atlas de glyphes, TextGrid (UI), passe scène MRT 2×2, passe cellule (rampes par matière, quadrants, arêtes, brouillard, ciel, pluie), passe présentation, caméra pointer-lock
- [x] 3. Monde macro : élévation, hydrologie (priority-flood, D8, rivières polylignes, lacs, vallées), climat, biomes, régions, noms + tests déterminisme
- [x] 4. Chunks : TerrainSampler (h(x,z) pur), maillage chunk, eau, végétation, streaming, terrain lointain ; joueur + collisions
- [x] 5. Civilisation : factions, histoire, implantations, routes A* + ponts, plans de village (bâtiments visitables meublés), POI, donjons 3D (entrée/sortie E)
- [~] 6. Entités & IA (6a fait : PNJ + emplois du temps + pathfinding ; 6b : monstres) : PNJ (identité, emploi du temps), monstres, utility AI, perception, pathfinding local
- [ ] 7. Gameplay : objets, inventaire, équipement, combat (léger/lourd/blocage/esquive/arc), loot, XP/compétences, réputation/mémoire, économie, dialogues, rumeurs, quêtes systémiques
- [ ] 8. UI terminal : titre/nouvelle partie, HUD, inventaire, journal, stats, carte, dialogue, commerce, pause/options
- [ ] 9. Ambiance : jour/nuit, météo, torches/lanternes/fenêtres, ombres soleil, eau, audio Web Audio
- [ ] 10. Sauvegarde IndexedDB (diff), outils debug (console F1, overlay F3), docs (README, docs/architecture.md)
- [ ] 11. Vérification du vertical slice (18 étapes) dans le navigateur

## Décisions clés (ne pas re-débattre)
- Dev : `npm run dev` (port 5199). Dépôt : github.com/theol-trying/laughing-enigma (push à chaque checkpoint).
- Coordonnées : mètres, X est, Y haut, Z sud. Monde 8192 m = grille macro 256² × 32 m. Chunk 64 m, sommets tous les 2 m.
- Rendu : (1) scène 3D rastérisée en WebGL2 à 2× la grille de caractères dans un G-buffer
  (couleur+lumière, matière+hash+normale, lettre d'entité, profondeur) ; (2) passe « cellule »
  à la résolution de la grille → glyphe + couleur avant/fond (quadrants ▘▝▀▄… sur les
  silhouettes, rampes de glyphes par matière, brouillard, ciel, pluie, UI fusionnée) ;
  (3) passe présentation plein écran qui lit l'atlas de glyphes (texelFetch, net).
- UI : entièrement en caractères via TextGrid (pas de DOM), fusionnée dans la passe cellule.
- Créatures/PNJ : modèles en boîtes animées (aucune texture bitmap) ; au loin → lettre roguelike.
- Donjons : espace séparé hors du monde (x ≥ 20000), entrée/sortie par interaction.
- Déterminisme : `WorldSeed.stream(nom)` = PRNG dérivé de hash(seed + nom), jamais Math.random
  dans la génération. Version du générateur : `src/version.ts`.
- Sauvegarde : seed + diff (WorldState) dans IndexedDB.
- Touches : déplacements par `e.code` (ZQSD AZERTY OK), raccourcis lettres par `e.key`
  en évitant z/q/s/d/w/a. Esquive = V ou double-tap direction.

## Journal
- 2026-10-05 : étape 0 faite.
- 2026-10-05 : étape 1 faite (6 tests verts).
- 2026-10-05 : étape 2 faite. Renderer validé dans le navigateur (scène de test dans src/main.ts,
  à remplacer à l'étape 8). Preview : entrée « ascii-fort » ajoutée dans ~/.claude/launch.json.
  Astuce test : le panneau navigateur masqué suspend requestAnimationFrame → `__dbg.step(n)`.
- 2026-10-05 : étape 3 faite. Macro TEST-001 en ~200 ms, aperçu ASCII dans docs/map-TEST-001.txt (régénéré par les tests).
- 2026-10-05 : étape 4 faite (12 tests verts). Exploration à pied d'un monde TEST-001 à ~58 fps, chunks 2 ms.
  Pause demandée par l'utilisateur après cette étape.
- 2026-10-06 : 5a fait (15 tests). Bug corrigé : Dijkstra en Float32 (régions + vallées) → Float64. Rapport : docs/civ-TEST-001.txt.
- 2026-10-06 : 5b fait. Villages rendus (colombages, chaume, puits, places, champs, enceintes, ponts), intérieurs meublés
  éclairés (âtre, bougies), torches la nuit, silhouettes lointaines. Départ devant l'auberge. 60 fps.
- 2026-10-06 : 5c fait (16 tests). Donjons : graphe de salles + boucles, porte verrouillée devant le boss, clé en salle annexe,
  pièges, coffres, spawns ; espace x ≥ 20000 ; entrée/sortie par E. Étape 5 terminée.
- 2026-10-06 : 6a fait (18 tests). PNJ générés par implantation (identité, métier, foyer, relations, connaissances,
  objectifs), emplois du temps → lieux concrets, grille de nav 1 m (portes rouvertes, zones connexes), modèles animés.
