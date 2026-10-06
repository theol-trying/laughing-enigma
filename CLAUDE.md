# ASCII FORT — consignes pour Claude

- **Toujours commencer par lire `PROGRESS.md`** (section « ➜ REPRENDRE ICI »). Mettre à jour ce
  fichier et faire `npm run checkpoint -- "message"` après chaque étape : l'utilisateur veut
  pouvoir reprendre sans rien refaire en cas de coupure ou de limite de crédits.
- **Sauvegardes continues** (règle permanente) : lancer `npm run autosave` en arrière-plan au début de chaque
  session (instantané local toutes les 10 min sur `refs/autosave/latest`, restaurable par
  `git checkout refs/autosave/latest -- .`), et checkpoint + push après chaque étape ou sous-étape.
- Être économe : pas d'agents en parallèle, pas de relecture inutile, pas de captures superflues.
- Identité git locale : `theol-trying` / `290863944+theol-trying@users.noreply.github.com`.
  Dépôt public : ne jamais committer avec une autre identité, et vérifier avant chaque push
  qu'aucun fichier ne contient de donnée personnelle (chemin utilisateur, email pro, token).
- Langue du jeu et des textes : français.
- Génération procédurale : uniquement via `WorldSeed.stream()` / `RNG` (jamais `Math.random`).
  Toute modif de génération qui change le contenu du monde (relief, villes, PNJ, routes, histoire…) ⇒ incrémenter
  `GENERATOR_VERSION` (packages/core/src/version.ts) et mettre à jour les tests de déterminisme. Attention : la version
  entre dans le hachage des seeds, la changer change TOUS les mondes et invalide les salons en ligne. Une correction
  purement visuelle (meuble décalé, face qui scintille) ne l'exige pas.
- Multijoueur : `npm run dev:server` (wrangler dev, :8787) + `npm run dev` ; `npm run test:room` ; `npm run bot -- CODE`
  pour un second joueur scripté ; `?cle=xxx` = identité distincte par onglet. Toute modif du protocole :
  `packages/net/src/protocol.ts` (incrémenter `PROTOCOL` si incompatible) + `server/worker.ts`.
- Vérifier après chaque étape : `npm run typecheck`, `npm test`, et le rendu dans le navigateur
  (preview `ascii-fort` dans `.claude/launch.json`) quand c'est pertinent.
