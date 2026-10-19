export const meta = {
  name: 'ascii-fort-step',
  description: "Implémente une étape du jalon 7 d'ASCII FORT : cartographie, conception, implémentation, revue contradictoire, corrections",
  whenToUse: "Pour chaque étape restante du jalon 7 d'ASCII FORT (args: step, title, brief, areas)",
  phases: [
    { title: 'Cartographie', detail: 'lecteurs en parallèle des sous-systèmes concernés' },
    { title: 'Conception', detail: 'deux conceptions indépendantes puis arbitrage' },
    { title: 'Implémentation', detail: 'un seul agent modifie le code' },
    { title: 'Revue', detail: 'relectures par angle puis contre-vérification de chaque constat' },
    { title: 'Corrections', detail: 'constats confirmés appliqués, typecheck et tests' },
  ],
}

// dossier du projet : args.root (chemin absolu, passé à l'appel) ou répertoire courant
const ROOT = (args && args.root) || '.'
const GLYPH = `node ${ROOT}/scripts/glyphcheck.mjs`
const RULES = `Contexte : projet ASCII FORT dans le dossier ${ROOT} (RPG 3D procédural rendu en caractères ; TypeScript, Vite, WebGL2 ; monorepo npm : packages/core, packages/ascii-engine, packages/worldgen, packages/sim, packages/net ; application dans src/ (game/, ui/, audio/, net/) ; serveur Cloudflare dans server/worker.ts ; imports en sous-chemins @ascii-fort/<pkg>/<module>).
Règles impératives :
- NE PAS lancer d'autosave, NE PAS faire de commit/push/checkpoint, NE PAS modifier PROGRESS.md, README.md ni CLAUDE.md, NE PAS lancer de serveur ni de navigateur : l'orchestrateur s'en charge.
- Textes du jeu en français. Tout caractère non ASCII affiché doit exister dans l'atlas (packages/ascii-engine/src/GlyphAtlas.ts) : vérifier avec \`${GLYPH}\` (sortie vide = OK).
- Ne PAS incrémenter GENERATOR_VERSION (cela changerait tous les mondes et invaliderait les salons en ligne). Génération procédurale uniquement via WorldSeed.stream() (on peut ajouter un nouveau nom de flux à StreamName : cela ne change pas les flux existants) ; jamais Math.random dans la génération du monde (autorisé pour le gameplay et les effets).
- Sauvegardes : rester compatible avec les sauvegardes existantes (champ absent → valeur par défaut).
- Multijoueur : protocole dans packages/net/src/protocol.ts + server/worker.ts ; n'incrémenter PROTOCOL que si c'est incompatible.
- Ne jamais écrire d'email, de chemin utilisateur local ni de jeton dans les fichiers du dépôt (dépôt public).
- Vérifier avec \`npm run typecheck\` et \`npm test\` depuis ${ROOT}. Code au style du code existant (commentaires en français, même densité).`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' }, line: { type: 'number' },
          severity: { type: 'string', enum: ['bloquant', 'majeur', 'mineur'] },
          summary: { type: 'string' }, scenario: { type: 'string' }, fix: { type: 'string' },
        },
        required: ['file', 'severity', 'summary', 'scenario', 'fix'],
      },
    },
  },
  required: ['findings'],
}
const VERDICT = { type: 'object', properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } }, required: ['refuted', 'reason'] }
const IMPL = {
  type: 'object',
  properties: {
    summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } },
    typecheck: { type: 'string' }, tests: { type: 'string' }, glyphs: { type: 'string' },
    open_issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'files', 'typecheck', 'tests', 'glyphs', 'open_issues'],
}
const FIX = {
  type: 'object',
  properties: {
    applied: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'object', properties: { summary: { type: 'string' }, reason: { type: 'string' } }, required: ['summary', 'reason'] } },
    typecheck: { type: 'string' }, tests: { type: 'string' }, glyphs: { type: 'string' },
  },
  required: ['applied', 'skipped', 'typecheck', 'tests', 'glyphs'],
}

const { step, title, brief, areas } = args
// agents sur Sonnet 5.5 (demande de l'utilisateur : Opus consomme trop de son forfait)
const MODEL = args.model ?? 'sonnet'
const HEAD = `Étape ${step} : ${title}\n\nCahier des charges :\n${brief}`

// ---------------------------------------------------------------- 1. cartographie
phase('Cartographie')
const maps = (await parallel(areas.map((a) => () => agent(
  `${RULES}\n\n${HEAD}\n\nTa mission (lecture seule, ne modifie aucun fichier) : cartographier le sous-système « ${a.key} » pour préparer cette étape.\n${a.prompt}\n\nRends une carte précise et dense : fichiers, fonctions/méthodes avec numéros de ligne, structures de données (champs exacts), conventions à respecter, points d'accroche exacts où brancher la nouvelle fonctionnalité, pièges repérés. Cite les signatures exactes. Pas de généralités.`,
  { model: MODEL, label: `carte:${a.key}`, phase: 'Cartographie' },
)))).filter(Boolean)
const MAPS = maps.map((m, i) => `### Carte « ${areas[i]?.key ?? i} »\n${m}`).join('\n\n')
log(`${maps.length} cartes reçues`)

// ---------------------------------------------------------------- 2. conception
phase('Conception')
const ANGLES = [
  "intégration robuste et économe : réutiliser au maximum l'existant, peu de nouveaux fichiers, risques minimaux pour les sauvegardes et le multijoueur",
  "expérience de jeu riche : interface claire et lisible en caractères, équilibrage réfléchi, retours visuels et sonores, découvrabilité (où le joueur apprend la fonctionnalité)",
]
const designs = (await parallel(ANGLES.map((angle, i) => () => agent(
  `${RULES}\n\n${HEAD}\n\nCartes du code (établies par des lecteurs) :\n${MAPS}\n\nTa mission (lecture seule, tu peux relire le code pour vérifier) : proposer une conception complète et concrète de cette étape selon l'angle : ${angle}.\nDonne : structures de données (types TypeScript exacts), fichiers à créer/modifier avec les fonctions précises, flux d'interface (touches, écrans, messages), données de jeu (listes d'objets/recettes/valeurs chiffrées), compatibilité des sauvegardes, effets en multijoueur, et une liste ordonnée des modifications. Couvre TOUT le cahier des charges.`,
  { model: MODEL, label: `conception:${i + 1}`, phase: 'Conception' },
)))).filter(Boolean)
const SPEC = await agent(
  `${RULES}\n\n${HEAD}\n\nCartes du code :\n${MAPS}\n\nDeux conceptions indépendantes :\n${designs.map((d, i) => `### Conception ${i + 1}\n${d}`).join('\n\n')}\n\nTa mission : arbitrer. Vérifie dans le code les points litigieux, choisis la meilleure base et greffe-y les meilleures idées de l'autre. Produis la SPÉCIFICATION FINALE, autonome et exécutable par un développeur qui n'a pas lu les conceptions : types exacts, fichiers et fonctions à modifier, données chiffrées complètes, textes français, touches, compatibilité sauvegarde/multijoueur, et l'ordre des modifications. Elle doit couvrir tout le cahier des charges, sans option laissée ouverte.`,
  { model: MODEL, label: 'arbitrage', phase: 'Conception' },
)

// ---------------------------------------------------------------- 3. implémentation
phase('Implémentation')
const impl = await agent(
  `${RULES}\n\n${HEAD}\n\nSpécification finale à implémenter intégralement :\n${SPEC}\n\nCartes du code (repères) :\n${MAPS}\n\nTa mission : implémenter toute la spécification dans ${ROOT}. Lis le code avant de le modifier, respecte le style existant. À la fin : \`npm run typecheck\`, \`npm test\` et la vérification des glyphes doivent passer (corrige jusqu'à ce que ce soit le cas). Rends le résumé structuré (fichiers touchés, état typecheck/tests/glyphes, points restés ouverts).`,
  { model: MODEL, label: 'implémentation', phase: 'Implémentation', schema: IMPL, effort: 'high' },
)
log(`Implémentation : typecheck ${impl?.typecheck}, tests ${impl?.tests}, glyphes ${impl?.glyphs}`)

// ---------------------------------------------------------------- 4-5. revue contradictoire puis corrections (jusqu'à 2 tours)
const LENSES = [
  { key: 'bogues', prompt: "bogues d'exécution et de logique : déréférencements nuls, indices faux, états incohérents, calculs dépendant de dt, cas limites (inventaire vide, objet cassé, mort du joueur, donjon), conflits de touches avec les touches existantes (cherche toutes les touches déjà utilisées)." },
  { key: 'compatibilité', prompt: "compatibilité et robustesse : chargement d'anciennes sauvegardes, sauvegarde/restauration des nouveaux champs, multijoueur (coop, marionnettes, faits partagés, échanges entre joueurs, protocole), règles de déterminisme (GENERATOR_VERSION, flux du seed, Math.random dans la génération), performances (allocations ou boucles coûteuses à chaque image)." },
  { key: 'interface', prompt: "interface et textes : intégration aux écrans (API Screen de src/ui/UI.ts, ouverture/fermeture, capture de la souris wantsLock, saisie), lisibilité dans la grille de caractères, chevauchements du HUD, qualité du français (accents, accords, typographie), glyphes absents de l'atlas (lance la vérification des glyphes)." },
  { key: 'conformité', prompt: "conformité au cahier des charges et à la spécification : fonctionnalités manquantes ou incomplètes, code inatteignable (recette jamais accessible, objet jamais vendu ni trouvé, écran jamais ouvert), valeurs absurdes d'équilibrage, TODO ou bouchons laissés." },
]
const rounds = []
for (let round = 1; round <= 2; round++) {
  phase('Revue')
  const reviewed = await pipeline(
    LENSES,
    (lens) => agent(
      `${RULES}\n\n${HEAD}\n\nSpécification finale :\n${SPEC}\n\nTa mission (lecture seule) : relire les modifications non committées (\`git -C ${ROOT} diff HEAD\` et \`git -C ${ROOT} status --short\` pour les nouveaux fichiers, que tu liras en entier) sous l'angle : ${lens.prompt}\nNe rapporte que des défauts réels et vérifiés dans le code (fichier, ligne, scénario concret qui produit l'erreur, correctif précis). Pas de remarques de style. Liste vide si rien.`,
      { model: MODEL, label: `revue${round}:${lens.key}`, phase: 'Revue', schema: FINDINGS },
    ),
    (rev, lens) => parallel((rev?.findings ?? []).map((f, k) => () => {
      const n = f.severity === 'mineur' ? 1 : 2
      return parallel(Array.from({ length: n }, (_, j) => () => agent(
        `${RULES}\n\nUn relecteur (angle « ${lens.key} ») signale ce défaut dans les modifications non committées de ${ROOT} :\nFichier : ${f.file}${f.line ? ':' + f.line : ''}\nGravité : ${f.severity}\nDéfaut : ${f.summary}\nScénario : ${f.scenario}\nCorrectif proposé : ${f.fix}\n\nTa mission (lecture seule, vérificateur n°${j + 1}) : essaie de RÉFUTER ce constat en lisant le code réel. Il n'est confirmé que si le défaut existe vraiment et peut se produire en jeu. En cas de doute, refuted=true.`,
        { model: MODEL, label: `vérif${round}:${lens.key}:${k + 1}.${j + 1}`, phase: 'Revue', schema: VERDICT },
      ))).then((vs) => {
        const ok = vs.filter(Boolean)
        const kept = ok.filter((v) => !v.refuted).length
        return { ...f, lens: lens.key, confirmed: kept > 0 && kept * 2 >= ok.length, reasons: ok.map((v) => v.reason) }
      })
    })),
  )
  const all = reviewed.filter(Boolean).flat().filter(Boolean)
  const seen = new Set()
  const confirmed = all.filter((f) => f.confirmed).filter((f) => {
    const key = `${f.file}:${f.line ?? ''}:${f.summary.slice(0, 40)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  log(`Tour ${round} : ${all.length} constats, ${confirmed.length} confirmés`)
  if (!confirmed.length) { rounds.push({ round, found: all.length, confirmed: [], fix: null }); break }
  phase('Corrections')
  const fix = await agent(
    `${RULES}\n\n${HEAD}\n\nSpécification finale :\n${SPEC}\n\nDéfauts confirmés par relecture contradictoire dans les modifications non committées :\n${confirmed.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}${f.line ? ':' + f.line : ''} — ${f.summary}\n   Scénario : ${f.scenario}\n   Correctif proposé : ${f.fix}`).join('\n')}\n\nTa mission : corriger chacun de ces défauts dans ${ROOT} (relis le code d'abord ; si un défaut s'avère faux, ne le corrige pas et explique pourquoi). Puis \`npm run typecheck\`, \`npm test\` et la vérification des glyphes doivent passer.`,
    { model: MODEL, label: `corrections${round}`, phase: 'Corrections', schema: FIX, effort: 'high' },
  )
  rounds.push({ round, found: all.length, confirmed: confirmed.map((f) => `[${f.severity}/${f.lens}] ${f.file}:${f.line ?? ''} ${f.summary}`), fix })
}
return { spec: SPEC, impl, rounds }
