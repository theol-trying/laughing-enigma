# ASCII FORT — journal de progression (fichier de reprise)

> **Reprendre après une coupure :** lire ce fichier, puis `git log --oneline | head`.
> La section « ➜ REPRENDRE ICI » indique l'étape exacte. Chaque étape terminée = 1 commit
> (`npm run checkpoint -- "message"`). Ne jamais refaire une étape cochée.
> Économie : travailler seul (pas d'agents en parallèle), pas de relecture inutile de fichiers.

## ➜ REPRENDRE ICI
Jalon 2 (demandé le 2026-10-06) : modèles plus fins, police plus fine, bibliothèques, multi en ligne Cloudflare.
Décisions validées par l'utilisateur : **un seul Worker Cloudflare** (assets statiques = build Vite + Durable Object
par salon), **autorité par zone chez les joueurs** (le DO relaie + garde l'état persistant du monde), **coop complet**
(créatures/combats partagés, coffres/camps/morts partagés et persistants, quêtes et inventaire propres à chacun).
Prochaine étape non cochée ci-dessous = où reprendre. Si du travail non committé a été perdu, regarder
`git diff HEAD refs/autosave/latest` (instantanés locaux toutes les 10 min, `npm run autosave`).

## Étapes
- [x] 0. Setup : Vite 8 + TS 7 + Vitest 5, git (identité theol-trying noreply), PROGRESS/CLAUDE.md
- [x] 1. Cœur : RNG seedé (cyrb128 + sfc32, flux dérivés), Noise (simplex 2D, fbm, ridged), math (mat4), Time, Events
- [x] 2. Renderer : GL utils, atlas de glyphes, TextGrid (UI), passe scène MRT 2×2, passe cellule (rampes par matière, quadrants, arêtes, brouillard, ciel, pluie), passe présentation, caméra pointer-lock
- [x] 3. Monde macro : élévation, hydrologie (priority-flood, D8, rivières polylignes, lacs, vallées), climat, biomes, régions, noms + tests déterminisme
- [x] 4. Chunks : TerrainSampler (h(x,z) pur), maillage chunk, eau, végétation, streaming, terrain lointain ; joueur + collisions
- [x] 5. Civilisation : factions, histoire, implantations, routes A* + ponts, plans de village (bâtiments visitables meublés), POI, donjons 3D (entrée/sortie E)
- [x] 6. Entités & IA : PNJ (identité, emplois du temps, nav locale), monstres (repaires, écologie, perception, utility AI, meutes), simulation par niveaux
- [x] 7. Gameplay : objets, inventaire, combat, butin, XP, réputation/mémoire, économie, dialogues, rumeurs, quêtes systémiques
- [x] 8. UI terminal : titre/nouvelle partie, HUD, inventaire, journal, stats, carte, dialogue, commerce, pause/options
- [x] 9. Ambiance : jour/nuit, météo, torches/lanternes/fenêtres, ombres soleil, eau, audio Web Audio
- [x] 10. Sauvegarde IndexedDB (diff), outils debug (console F1, overlay F3), docs (README, docs/architecture.md)
- [x] 11. Vérification du vertical slice (18 étapes) dans le navigateur
### Jalon 2
- [x] 12. Modèles procéduraux plus fins (formes effilées/arrondies, membres articulés, équipements visibles)
- [x] 13. Finesse d'affichage : police plus petite pour le monde (option), interface lisible
- [ ] 14. Découpage en bibliothèques (workspaces npm : core, worldgen, render-ascii, sim, net ; apps client/serveur)
- [ ] 15. Serveur Cloudflare : Worker (assets + /ws) + Durable Object « Room » (salon, relais, état persistant SQLite), wrangler
- [ ] 16. Client réseau : salons (créer/rejoindre par code), présence, joueurs distants interpolés, heure commune
- [ ] 17. Autorité par zone : créatures/PNJ simulés par un propriétaire, combats partagés (dégâts, morts, butin)
- [ ] 18. Monde partagé persistant (coffres, camps, morts uniques), quêtes perso, sauvegarde du perso dans le salon
- [ ] 19. Vérification à 2 clients en local (wrangler dev), docs (README, architecture, guide de déploiement)

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
- 2026-10-06 : 6b fait (18 tests). Repaires (loups, araignées, troll, bandits + chef, gobelins, squelettes, spectre),
  créatures de donjon, IA (repos nocturne, errance élargie la nuit, chasse, attaque avec élan, 2 assaillants max, fuite,
  retour), gardes qui combattent, civils qui fuient, mort/réveil à l'auberge, attaque de base (clic), blocage (clic droit).
- 2026-10-06 : 7a fait. Combat (léger/lourd/blocage/esquive V/arc B/sorts R F/potion H), butin, coffres (vol + témoins),
  auberge (10 or), prière, puits, cuisson, forge de flèches, potions, clé + porte de donjon, pièges, XP/niveaux, découvertes.
- 2026-10-06 : 7b fait. Chaîne systémique vérifiée : camp sur la route → pénurie d'outils (31 or) → dialogue du marchand →
  quête → camp démantelé → route débloquée → récompense, opinion +44 → prix revenus à 15 or en 4 jours.
- 2026-10-06 : 8 fait. Écran titre animé, nouvelle partie (seed, RANDOMIZE, aperçu + mini-carte), chargement, HUD
  (barres, boussole + repère de quête, heure, lieu, cible, messages, F3), inventaire, journal, carte (brouillard, zoom),
  personnage (points, compétences, réputation), pause/options (taille, sensibilité, FOV, volume, vitesse du temps).
- 2026-10-06 : 9 fait. Météo par région (périodes de 8 h, transitions, neige en altitude, brouillard au marais, orages
  et éclairs), abri sous les toits, lanternes des gardes, audio Web Audio (vent, pluie, feu, pas, impacts, tonnerre).
- 2026-10-06 : 10 fait (21 tests, build OK). Sauvegarde IndexedDB vérifiée (F5/F9 : or, objets, position, heure,
  coffres ouverts restaurés), autosave 2 min, Continuer au titre, console F1, instantané TEST-001, README + architecture.
- 2026-10-06 : 11 fait. Parcours 18 étapes vérifié de bout en bout dans le navigateur (seed TEST-001 : apparition,
  village, 14 PNJ, dialogue, achat, quête des convois, camp démantelé, butin, retour, quête rendue, sauvegarde, rechargement).
- 2026-10-06 : 12 fait. Formes instanciées (boîte, cylindre, sphère, tronc de cône, cône ; tri par forme, normales
  correctes sous échelle), modèles à squelette (genoux, coudes, cou, mâchoire, queue), barbes, capes, tabliers, capuches,
  armes détaillées, yeux lumineux (squelettes, spectre, araignée, gobelins), araignée à pattes articulées.
- 2026-10-06 : 13 fait. Deux grilles superposées : monde en police plus petite (option « Finesse du monde » :
  normale / fine ×0,75 par défaut / très fine ×0,6, jamais sous 8 px), interface à la taille de lecture ; composition
  dans la passe de présentation (la passe cellule ne fusionne plus l’UI). shaders.ts repassé en fins de ligne LF.
