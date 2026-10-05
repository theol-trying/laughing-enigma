# ASCII FORT — consignes pour Claude

- **Toujours commencer par lire `PROGRESS.md`** (section « ➜ REPRENDRE ICI »). Mettre à jour ce
  fichier et faire `npm run checkpoint -- "message"` après chaque étape : l'utilisateur veut
  pouvoir reprendre sans rien refaire en cas de coupure ou de limite de crédits.
- Être économe : pas d'agents en parallèle, pas de relecture inutile, pas de captures superflues.
- Identité git locale : `theol-trying` / `290863944+theol-trying@users.noreply.github.com`.
  Dépôt public : ne jamais committer avec une autre identité, et vérifier avant chaque push
  qu'aucun fichier ne contient de donnée personnelle (chemin utilisateur, email pro, token).
- Langue du jeu et des textes : français.
- Génération procédurale : uniquement via `WorldSeed.stream()` / `RNG` (jamais `Math.random`).
  Toute modif de génération qui change le monde ⇒ incrémenter `GENERATOR_VERSION` (src/version.ts)
  et mettre à jour les tests de déterminisme (`tests/determinism.test.ts`).
- Vérifier après chaque étape : `npm run typecheck`, `npm test`, et le rendu dans le navigateur
  (preview `ascii-fort` dans `.claude/launch.json`) quand c'est pertinent.
