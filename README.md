# ASCII FORT

**Un RPG 3D procédural en vue subjective, jouable dans le navigateur, dont tout ce qui s'affiche
est fait de caractères ASCII / ANSI / Unicode colorés.**

On arrive au sommet d'une colline, on voit au loin un village au bord d'une rivière, un château
sur sa hauteur, des montagnes enneigées — et on peut réellement s'y rendre. Le monde entier est une
fonction de sa *seed* : la même seed redonne toujours les mêmes continents, rivières, routes,
villes, personnages, histoire et donjons.

> **État : jalon 2** — modèles procéduraux articulés, rendu plus fin, bibliothèques réutilisables,
> **multijoueur coopératif en ligne** (Cloudflare, offre gratuite). Avancement détaillé : [`PROGRESS.md`](PROGRESS.md).
> Architecture : [`docs/architecture.md`](docs/architecture.md).

## Lancer le jeu

Prérequis : Node.js 20 ou plus.

```bash
npm install
npm run dev        # http://localhost:5199
npm run build      # site statique dans dist/ (servir le dossier tel quel)
npm test           # 21 tests : déterminisme, RNG, monde, chunks, civilisation, PNJ, donjons
```

Multijoueur en local (deux terminaux) :

```bash
npm run dev:server     # serveur de salons Cloudflare simulé en local : http://localhost:8787
npm run dev            # le jeu : http://localhost:5199 → Multijoueur en ligne
npm run test:room      # 17 vérifications du serveur de salons (avec dev:server lancé)
npm run bot -- CODE    # un compagnon scripté rejoint le salon CODE et vous suit
```

## Jouer en ligne (coopératif)

Écran titre → **Multijoueur en ligne** : choisissez un nom, puis **créez un salon** (une seed, au
hasard ou choisie) ou **rejoignez** celui d'un ami avec son code à 6 caractères. Le lien
`…/?salon=CODE` ouvre directement l'invitation. Jusqu'à 8 joueurs, chacun sur son PC.

- Tout le monde explore **le même monde** : il est régénéré par chaque PC à partir de la seed, seules
  les différences circulent (positions, coups, coffres ouverts…), d'où un trafic minuscule.
- **Créatures et PNJ partagés** : le premier joueur arrivé dans une zone (village, repaire, donjon)
  la simule pour tous ; s'il s'en va, un autre prend le relais sans interruption.
- **Combats partagés** : les coups portés à une créature simulée par un autre joueur lui sont
  transmis, le coup fatal rapporte l'XP à celui qui l'a porté ; les créatures attaquent n'importe
  quel joueur.
- **Monde persistant** : coffres et cadavres reviennent au premier qui les fouille ; camps démantelés,
  boss tués, PNJ morts, portes ouvertes et pièges désamorcés sont gardés par le salon.
- **Personnage propre à chacun** (inventaire, niveau, quêtes, réputation), sauvegardé dans le salon
  toutes les 30 s : on le retrouve en revenant, même depuis un autre jour.
- **Heure commune** (le temps ne s'arrête pas : dormir soigne sans avancer l'horloge) ; `Entrée` pour
  discuter ; les noms s'affichent au-dessus des têtes.
- **Tirs et sorts visibles chez tous** (flèches, traits de feu, soins) et **échanges d'objets** : regardez
  un autre joueur et appuyez sur `E` ; chacun compose son offre (objets, or), l'échange se fait quand les
  deux ont validé les mêmes offres.

## Mettre le jeu en ligne (Cloudflare, gratuit)

Tout tient dans **un seul Worker Cloudflare** : il sert le jeu (fichiers statiques) et les salons
(un *Durable Object* par salon, stockage SQLite). L'offre gratuite suffit pour jouer entre amis.

1. Créer un compte gratuit sur [dash.cloudflare.com](https://dash.cloudflare.com) (aucune carte bancaire).
2. **Workers & Pages** → **Créer** → **Importer un dépôt** → connecter GitHub et choisir ce dépôt.
3. Commande de build : `npm run build` · commande de déploiement : `npx wrangler deploy` → **Déployer**.
4. Le jeu est en ligne sur `https://ascii-fort.<votre-sous-domaine>.workers.dev` ; chaque `git push`
   le redéploie.

Variante en ligne de commande : `npx wrangler login` puis `npm run deploy`.
Limites gratuites utiles : 100 000 requêtes par jour (les messages WebSocket entrants comptent pour
1/20 de requête : 4 joueurs ensemble en consomment 10 000 à 15 000 par heure, soit environ
7 h de jeu à quatre par jour) et ≈ 28 h de salon
actif par jour ; les fichiers du jeu sont servis sans limite. Un salon resté vide 30 jours est effacé.

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

**Corps et environnement** — pentes trop raides infranchissables (on glisse), saut au-dessus des
obstacles bas, eau qui ralentit, nage qui fatigue, plongée (image bleutée et ondulante), noyade ;
pluie visible dans le décor (gouttes à plusieurs profondeurs, éclaboussures, sol mouillé et flaques
qui sèchent ensuite). Les murs bloquent la vue, l'ouïe (en partie) et les interactions ; accroupi, un
indicateur dit si l'on est caché ou repéré, et chaque vol annonce s'il a des témoins.

**Progression** — les créatures sont plus fortes loin du village de départ (niveau affiché, ≈ +1 tous
les 650 m, plus encore dans les donjons profonds) et rapportent plus d'expérience ; chaque niveau
apporte PV, endurance, mana, dégâts et un point de caractéristique (touche `P`) ; bonus temporaires :
prière (béni), puits (désaltéré), repas chaud (rassasié), nuit à l'auberge (reposé). Le butin ramassé
s'affiche à l'écran.

**Gameplay** — combat temps réel (attaque légère, lourde en maintenant, blocage, esquive, arc et
flèches, sorts, feu/givre/poison), caractéristiques et compétences qui progressent à l'usage,
niveaux, inventaire et équipement, butin contextuel, coffres (le vol devant témoins est un délit),
auberge, prière, cuisson, forge de flèches, potions ; réputation globale/faction/locale et mémoire
des PNJ ; amendes et gardes hostiles ; économie régionale (une route tenue par des bandits crée une
pénurie et fait monter les prix, qui reviennent une fois la route libérée) ; rumeurs qui circulent
de village en village ; dialogues procéduraux ancrés dans le monde ; quêtes systémiques (convois
attaqués, loups, relique de la crypte, expédition perdue, mine envahie) ; météo régionale ; cycle
jour/nuit.

**Musique et son (tout synthétisé, aucun fichier audio)** — musique procédurale adaptative jouée par un
petit ensemble médiéval (luth en cordes pincées Karplus-Strong, flûte avec souffle et vibrato, bourdon
de vielle, tambour sur cadre, tambourin) : thèmes d'exploration (dorien), de village (mixolydien, plus
enjoué), de nuit, de donjon et de combat (qui démarre dès qu'une créature vous prend en chasse), accords
et mélodies tirés au fil du jeu, fondus et silences. Ambiances : vent, pluie, oiseaux le jour, grillons
la nuit, rumeur du village, marteau du forgeron, rivière, lac ou mer. Son spatialisé : cris des
créatures (alerte, attaque, mort), hurlements de loups la nuit, coups et tirs des autres joueurs ; tout
est assourdi sous l'eau. Volume de la musique réglable dans les options.

**Modèles animés** — personnages et créatures sont des squelettes articulés (hanches, genoux,
épaules, coudes, cou, mâchoire, queue) habillés de volumes arrondis (sphères, troncs de cône,
cylindres) : barbes, chevelures, capes, tabliers, capuches, casques, armes détaillées, boucliers ;
gobelins voûtés aux oreilles pointues, troll massif à défenses, squelettes et spectre aux yeux
luisants, araignées à huit pattes articulées. Les autres joueurs portent leur équipement.

**Finesse** — le monde est dessiné avec une police plus petite que l'interface (deux grilles de
caractères superposées) : plus de détails à l'écran, des textes toujours lisibles. Réglable dans les
options (normale, fine, très fine).

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
| `Maj` | sprinter · `Espace` sauter (≈ 1,2 m) · `C` s'accroupir / se relever (discrétion ; en nageant : plonger) |
| `E` | interagir / parler / fouiller |
| Clic gauche | attaquer (maintenir : attaque lourde ; arc : bander) |
| Clic droit | bloquer |
| `V` ou double appui | esquiver |
| `B` | arc ↔ arme de mêlée · `R` trait de feu · `F` soin · `H` potion |
| `Tab` inventaire · `M` carte · `J` journal · `P` personnage (dépenser ses points) | |
| `Échap` | pause (sauvegarder, charger, options) · `F5`/`F9` sauvegarde/chargement rapides |
| `F3` | informations de débogage · `F1` console (`help`) |
| `Entrée` | (en ligne) écrire un message aux autres joueurs · `E` face à un joueur : proposer un échange |

## Volontairement simplifié

- Les PNJ non actifs ne sont pas simulés pas à pas : leur position découle de leur emploi du temps.
- Un seul niveau par donjon ; portes de bâtiments toujours ouvertes (seule la porte du boss se verrouille).
- Magie limitée à deux sorts ; artisanat limité à quelques recettes (flèches, potions, cuisson).
- La création du monde bloque quelques centaines de millisecondes (écran de chargement).
- En ligne : économie, réputation et rumeurs restent propres à chaque joueur (les camps démantelés,
  eux, sont communs) ; les gardes ne poursuivent que le joueur qui simule le village ; objets posés au
  sol non partagés ; pas de combat entre joueurs.

## Pistes suivantes

En ligne : gardes et réputation partagés, groupe et quêtes partagées, liste des salons publics. Monde plus vaste et génération dans un Web Worker ; villes plus denses (quartiers, marchés vivants) ;
voyageurs et caravanes réellement simulés sur les routes ; donjons multi-niveaux ; plus de types de
quêtes et de dialogues ; montures ; réflexions d'eau en espace écran ; ombres des torches.

## Stack

TypeScript, Vite, WebGL2, Vitest ; Cloudflare Workers + Durable Objects (wrangler) pour le
multijoueur. Aucun moteur de jeu ni bibliothèque 3D : rendu, génération et
systèmes sont implémentés dans le projet. Aucun appel à un LLM ni à une API externe.

## Bibliothèques réutilisables

Le code est découpé en workspaces npm, réutilisables dans d'autres projets (chacun a son README) :

| Paquet | Rôle |
|---|---|
| [`@ascii-fort/core`](packages/core) | déterminisme (RNG à flux dérivés, seeds), bruit, maths, événements, temps — pur TS |
| [`@ascii-fort/ascii-engine`](packages/ascii-engine) | rendu 3D → caractères en WebGL2, interface texte, entrées |
| [`@ascii-fort/worldgen`](packages/worldgen) | monde procédural : relief, rivières, biomes, civilisation, histoire, routes, donjons, chunks |
| [`@ascii-fort/sim`](packages/sim) | PNJ, créatures et modèles animés, IA, combat, économie, réputation, rumeurs, quêtes |
| [`@ascii-fort/net`](packages/net) | protocole multijoueur partagé entre le jeu et le serveur (`server/worker.ts`) |

Le jeu lui-même (`src/`) assemble ces bibliothèques : boucle de jeu, écrans, audio, sauvegarde,
client réseau (`src/net/`). Le serveur de salons est dans `server/`.
