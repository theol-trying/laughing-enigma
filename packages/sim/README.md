# @ascii-fort/sim

Simulation du jeu, branchée sur `@ascii-fort/worldgen`.

| Dossier | Contenu |
|---|---|
| `entities/` | joueur, PNJ (identité, métier, emploi du temps, mémoire), créatures, `EntityManager` (niveaux de détail, repaires), `Models` (modèles procéduraux à squelette animé) |
| `ai/` | navigation (grille 1 m, A*), emplois du temps, perception (lumière, brouillard, discrétion), IA des créatures |
| `gameplay/` | objets, fiche (caractéristiques, compétences), combat, butin, réputation, économie, rumeurs, quêtes systémiques, dialogues, météo, `WorldState` (différences sauvegardées) |
