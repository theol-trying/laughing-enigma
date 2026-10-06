# ASCII FORT

**Un RPG 3D procédural en vue subjective, jouable dans le navigateur, dont tout ce qui s'affiche
est fait de caractères ASCII / ANSI / Unicode colorés.**

On arrive au sommet d'une colline, on voit au loin un village au bord d'une rivière, un château
sur sa hauteur, des montagnes enneigées — et on peut réellement s'y rendre. Le monde entier est une
fonction de sa *seed* : la même seed redonne toujours les mêmes continents, rivières, routes,
villes, personnages, histoire et donjons.

> **État : premier jalon (vertical slice) jouable.** Avancement détaillé : [`PROGRESS.md`](PROGRESS.md).
> Architecture : [`docs/architecture.md`](docs/architecture.md).

## Lancer le jeu

Prérequis : Node.js 20 ou plus.

```bash
npm install
npm run dev        # http://localhost:5199
npm run build      # site statique dans dist/ (servir le dossier tel quel)
npm test           # 21 tests : déterminisme, RNG, monde, chunks, civilisation, PNJ, donjons
```

## Ce qui est implémenté

**Rendu (WebGL2, écrit à la main)** — la scène 3D est rastérisée dans un G-buffer à 2 × 2
sous-échantillons par caractère, puis convertie en grille de glyphes colorés (texte + fond) :
silhouettes en quadrants `▘▝▀▄▌▐`, vocabulaire de glyphes par matière (pierre `░#▒▓█`, bois `│║`,
herbe `.,;:"`, eau `~≈` animée, feu `'^*!` animé, feuillage `+*♣♠`, toits `/ \` selon l'orientation),
ombres du soleil, lumières ponctuelles (torches, âtres, lanternes), brouillard, ciel procédural
(soleil, lune, étoiles, nuages), pluie, neige, éclairs, palette dynamique selon l'heure et la météo,
terrain lointain visible à des kilomètres. Au loin, les créatures deviennent une lettre roguelike.

**Monde déterministe** — continent de ~8 × 8 km : relief, hydrologie complète (bassins versants,
rivières de la source à la mer, lacs, vallées creusées), climat, 10 biomes, 14 régions nommées ;
factions (royaumes, ordre, guilde, bandits, culte) ; histoire procédurale (chute d'un royaume ancien,
guerre, peste, schisme, mines, révolte, expédition perdue…) qui laisse des ruines, forts, champs de
bataille, cimetières et rancunes ; ~45 implantations placées pour de bonnes raisons (eau, terres,
routes, cols) ; routes A* et ponts ; villages visitables (auberge, forge, échoppe, chapelle, corps
de garde, maisons, fermes et champs, moulin, enceintes, châteaux, forts, monastère) avec intérieurs
meublés et éclairés ; points d'intérêt ; donjons (crypte, forteresse, mine, grotte) avec boucles,
porte verrouillée, clé, pièges, butin et boss. Chunks générés à la demande et régénérés à
l'identique.

**Vie et simulation** — PNJ avec identité, métier, domicile, lieu de travail, traits, relations,
connaissances, objectifs et emplois du temps (le forgeron forge, l'aubergiste sert, la garde de nuit
dort le jour, la ronde passe) ; navigation locale réelle (portes comprises) ; ils s'abritent sous la
pluie, fuient ou combattent les créatures. Créatures (loups, bandits et leur chef, gobelins,
squelettes, spectre, araignées, troll…) avec perception, territoire, nocturnes, meutes qui
s'appellent ; écologie agrégée hors champ ; simulation par niveaux de détail.

**Gameplay** — combat temps réel (attaque légère, lourde en maintenant, blocage, esquive, arc et
flèches, sorts, feu/givre/poison), caractéristiques et compétences qui progressent à l'usage,
niveaux, inventaire et équipement, butin contextuel, coffres (le vol devant témoins est un délit),
auberge, prière, cuisson, forge de flèches, potions ; réputation globale/faction/locale et mémoire
des PNJ ; amendes et gardes hostiles ; économie régionale (une route tenue par des bandits crée une
pénurie et fait monter les prix, qui reviennent une fois la route libérée) ; rumeurs qui circulent
de village en village ; dialogues procéduraux ancrés dans le monde ; quêtes systémiques (convois
attaqués, loups, relique de la crypte, expédition perdue, mine envahie) ; météo régionale ; cycle
jour/nuit ; sons synthétiques (vent, pluie, feu, pas, impacts, tonnerre).

**Interface en caractères** — écran titre, nouvelle partie (seed, RANDOMIZE, aperçu du monde avec
mini-carte), HUD (barres, boussole et repère de quête, heure, météo, lieu, cible, messages),
inventaire, journal, carte ASCII avec brouillard de guerre, personnage, commerce, dialogues, pause et
options. Sauvegarde IndexedDB (seed + différences), sauvegarde auto, rapide (F5/F9). Console de
développement (F1).

## Contrôles

| Touche | Action |
|---|---|
| `Z Q S D` / `W A S D` | se déplacer (selon le clavier) |
| Souris | regarder (clic pour capturer) |
| `Maj` | sprinter · `Espace` sauter · `C` s'accroupir (discrétion) |
| `E` | interagir / parler / fouiller |
| Clic gauche | attaquer (maintenir : attaque lourde ; arc : bander) |
| Clic droit | bloquer |
| `V` ou double appui | esquiver |
| `B` | arc ↔ arme de mêlée · `R` trait de feu · `F` soin · `H` potion |
| `Tab` inventaire · `M` carte · `J` journal · `C` personnage | |
| `Échap` | pause (sauvegarder, charger, options) · `F5`/`F9` sauvegarde/chargement rapides |
| `F3` | informations de débogage · `F1` console (`help`) |

## Volontairement simplifié dans ce jalon

- Les créatures et PNJ sont des modèles en boîtes (lisibles une fois convertis en glyphes).
- Les PNJ non actifs ne sont pas simulés pas à pas : leur position découle de leur emploi du temps.
- Un seul niveau par donjon ; portes de bâtiments toujours ouvertes (seule la porte du boss se verrouille).
- Magie limitée à deux sorts ; artisanat limité à quelques recettes (flèches, potions, cuisson).
- La création du monde bloque quelques centaines de millisecondes (écran de chargement).

## Pistes suivantes

Monde plus vaste et génération dans un Web Worker ; villes plus denses (quartiers, marchés vivants) ;
voyageurs et caravanes réellement simulés sur les routes ; donjons multi-niveaux ; plus de types de
quêtes et de dialogues ; montures ; réflexions d'eau en espace écran ; ombres des torches.

## Stack

TypeScript, Vite, WebGL2, Vitest. Aucun moteur de jeu ni bibliothèque 3D : rendu, génération et
systèmes sont implémentés dans le projet. Aucun appel à un LLM ni à une API externe.

## Bibliothèques réutilisables

Le code est découpé en workspaces npm, réutilisables dans d'autres projets (chacun a son README) :

| Paquet | Rôle |
|---|---|
| [`@ascii-fort/core`](packages/core) | déterminisme (RNG à flux dérivés, seeds), bruit, maths, événements, temps — pur TS |
| [`@ascii-fort/ascii-engine`](packages/ascii-engine) | rendu 3D → caractères en WebGL2, interface texte, entrées |
| [`@ascii-fort/worldgen`](packages/worldgen) | monde procédural : relief, rivières, biomes, civilisation, histoire, routes, donjons, chunks |
| [`@ascii-fort/sim`](packages/sim) | PNJ, créatures et modèles animés, IA, combat, économie, réputation, rumeurs, quêtes |

Le jeu lui-même (`src/`) assemble ces bibliothèques : boucle de jeu, écrans, audio, sauvegarde.
