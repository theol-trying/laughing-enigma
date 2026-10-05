# ASCII FORT

**Un RPG 3D procédural en vue subjective, jouable dans le navigateur, dont tout ce qui s'affiche
est fait de caractères ASCII / ANSI / Unicode colorés.**

Collines, rivières, forêts, villages, châteaux : on arrive au sommet d'une colline, on voit au loin
un village fumer au bord d'une rivière, et on peut réellement s'y rendre. Le monde entier est une
fonction de sa *seed* : la même seed redonne toujours les mêmes continents, rivières, routes,
villes, personnages et l'histoire du monde.

> 🚧 **En développement.** Le premier jalon vise un *vertical slice* complet et jouable : générer un
> monde, explorer, rejoindre un village, parler aux PNJ, commercer, recevoir une quête, combattre,
> ramasser du butin, terminer la quête, sauvegarder et recharger.
> Avancement détaillé, étape par étape : [`PROGRESS.md`](PROGRESS.md).

---

## Principes

1. **Tout est glyphe.** La vue 3D est rastérisée sur le GPU puis convertie en une grille de
   caractères colorés. Aucune texture bitmap ne représente un arbre, un personnage, un bâtiment
   ou le terrain : chaque matière a son propre vocabulaire de glyphes, choisi selon la lumière,
   la distance, la normale, le brouillard, l'heure et la météo.
2. **Le monde est une fonction de la seed.** Génération entièrement déterministe, avec des flux
   pseudo-aléatoires dérivés par système (`terrain`, `climate`, `hydrology`, `settlements`,
   `history`, `npc`, `dungeon`…). Modifier la génération des monstres ne déplace pas les villes.
3. **Le macro avant le micro.** Une carte globale du monde (altitude, climat, bassins versants,
   rivières, biomes, régions) est générée d'abord ; les chunks détaillés en dérivent ensuite.
   Les rivières naissent en altitude, suivent la pente, se rejoignent et rejoignent la mer.
4. **Chaque chose existe pour une raison.** Un village est là parce qu'il y a de l'eau, des terres
   cultivables et une route ; un fort tient un col ; des bandits attaquent la route commerciale,
   ce qui crée une pénurie, une hausse des prix, des rumeurs et une quête.
5. **Des systèmes qui interagissent vraiment** plutôt que des dizaines de systèmes de façade :
   météo → PNJ qui s'abritent → visibilité ; bandits → commerce perturbé → prix → rumeur → quête
   → résolution → retour progressif à la normale.
6. **100 % local.** Aucun LLM ni API externe : dialogues, rumeurs et quêtes sont produits par des
   règles et des modèles de phrases à partir de l'état du monde.

## Rendu : de la 3D aux caractères

Le moteur de rendu est écrit à la main en WebGL2, en trois passes :

| Passe | Résolution | Rôle |
|---|---|---|
| **Scène** | 2 × 2 sous-échantillons par caractère | Rastérise le monde 3D dans un G-buffer : couleur éclairée + intensité lumineuse, matière, normale, hachage stable lié au monde, lettre d'entité, profondeur. Soleil/lune, torches et lanternes (lumières ponctuelles), ombres, eau animée avec reflets. |
| **Cellule** | 1 pixel par caractère | Pour chaque case de la grille : choisit le glyphe et les couleurs de texte et de fond. Silhouettes en quadrants `▘▝▀▄▌▐▚▞▙▛▜▟` quand la case chevauche deux profondeurs, rampes de glyphes propres à chaque matière, toits orientés `/` `\`, eau et feu animés, brouillard, ciel (dégradé, soleil, lune, étoiles, nuages), pluie et neige. L'interface (elle aussi en caractères) est fusionnée ici. |
| **Présentation** | écran | Lit l'atlas de glyphes (rendu au démarrage dans la taille exacte de la cellule) et dessine chaque caractère net au pixel près. |

Vocabulaire de glyphes par matière (extraits) :

| Matière | Glyphes |
|---|---|
| Pierre | `░ # ▒ ▓ █` |
| Bois | `│ ║ ▒ ▓` |
| Herbe | `. , : ; " '` |
| Eau | `- ~ ≈` (animés) |
| Feu | `' ^ * ! ▲` (animés, émissifs) |
| Feuillage | `+ * ♣ ♠` |
| Toits | `/ \` selon l'orientation |

Le choix des glyphes fait aussi office de **niveau de détail** : de loin, une créature n'est
qu'une lettre façon *roguelike* (`w` un loup, `g` un gobelin, `B` un bandit…) ; de près, sa
silhouette en blocs apparaît.

## Génération du monde

- **Macro** (grille 256 × 256, cellules de 32 m → monde d'environ 8 × 8 km) : continentalité,
  montagnes, hydrologie (*priority-flood*, écoulement D8, accumulation, rivières en polylignes,
  lacs, creusement des vallées), température, humidité, biomes (plaine, forêt, montagne, neige,
  marais, côte…), régions et factions.
- **Civilisation** : histoire procédurale (guerres, chutes de royaumes, pestes, schismes, mines,
  expéditions disparues) qui laisse des traces physiques (ruines, forts abandonnés, tombes,
  champs de bataille) et sociales (rancunes entre factions, rumeurs, quêtes) ; implantations
  placées selon l'eau, les terres, les routes et la sécurité ; routes tracées par A* sur le
  terrain (vallées, cols, ponts) ; plans de villages avec bâtiments visitables.
- **Chunks** (64 m) générés à la demande autour du joueur, détruits et régénérés à l'identique.
  Au-delà, un terrain lointain basse résolution permet de voir montagnes, forêts et châteaux à
  des kilomètres.

## Simulation et gameplay (cibles du premier jalon)

- **PNJ** avec identité, métier, domicile, lieu de travail, faction, traits, relations, inventaire,
  besoins, mémoire, opinion du joueur et emploi du temps ; IA par fonctions d'utilité (s'abriter
  sous la pluie, fuir ou combattre, prévenir un garde, rentrer la nuit…) ; simulation à plusieurs
  niveaux de détail selon la distance.
- **Réputation** globale, par faction et locale ; **mémoire** des PNJ (aide, vol, agression…).
- **Dialogues** procéduraux cohérents avec le métier, le lieu, l'heure et les événements ;
  **rumeurs** qui circulent entre communautés.
- **Quêtes systémiques** issues de l'état du monde (route bloquée par des bandits, loups qui
  attaquent un troupeau, relique perdue dans une crypte…).
- **Combat** temps réel : attaques légère et lourde, blocage, esquive, arc et projectiles,
  endurance, armure, effets élémentaires.
- **Progression** : expérience, caractéristiques, compétences, équipement, inventaire, butin
  contextuel, marchands et économie régionale.
- **Monde vivant** : cycle jour/nuit complet, météo par région à transitions douces, torches,
  lanternes et fenêtres éclairées la nuit.
- **Sauvegarde** dans IndexedDB : la seed + uniquement les différences avec le monde généré.

## Lancer le projet

Prérequis : Node.js 20 ou plus.

```bash
npm install
npm run dev        # http://localhost:5199
npm run build      # site statique dans dist/
npm test           # tests (déterminisme, RNG, génération…)
```

## Contrôles (prévus)

| Touche | Action |
|---|---|
| `W A S D` (ou `Z Q S D`) | se déplacer |
| Souris | regarder (Pointer Lock) |
| `Shift` | sprinter |
| `Espace` | sauter |
| `E` | interagir |
| Clic gauche | attaque (maintenir : attaque lourde) |
| Clic droit | bloquer |
| `V` | esquiver |
| `Tab` | inventaire |
| `M` | carte |
| `J` | journal |
| `Échap` | menu |

## Architecture

```
src/
  core/        RNG seedé, seed et flux dérivés, bruit, maths, temps, événements, sauvegarde
  rendering/   WebGL2 : shaders, atlas de glyphes, matières, grille d'interface, caméra
  world/       monde macro, terrain, climat, hydrologie, chunks, civilisation, donjons
  entities/    joueur, PNJ, monstres, modèles en volumes animés
  ai/          perception, IA par utilité, emplois du temps, pathfinding, mémoire
  gameplay/    combat, objets, inventaire, butin, compétences, réputation, économie, quêtes, dialogues
  ui/          écrans en caractères : titre, HUD, inventaire, carte, journal, dialogue, commerce
  audio/       sons synthétisés avec Web Audio (vent, pluie, feu, pas, impacts)
tests/         tests Vitest
```

Stack : **TypeScript**, **Vite**, **WebGL2**, **Vitest**. Aucun moteur de jeu ni bibliothèque 3D :
le rendu, la génération et les systèmes sont implémentés dans le projet.

## Déterminisme

Chaque monde est identifié par sa seed **et** la version du générateur (`src/version.ts`),
affichées en jeu (`World: THE-ASHEN-KINGDOM-94721 · Generator: 0.1.0`). Toute modification qui
change le monde généré incrémente cette version. Des tests vérifient qu'une seed de référence
(`TEST-001`) produit toujours le même village de départ, la même rivière principale, les mêmes
noms de lieux et les mêmes points de contrôle.
