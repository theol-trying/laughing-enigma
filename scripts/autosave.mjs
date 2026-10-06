// Sauvegarde locale automatique : `npm run autosave` (toutes les 10 min) ou `npm run autosave -- 5`
// (`-- once` pour un seul instantané). Chaque instantané est un commit sur la réf locale
// refs/autosave/latest, construit avec un index temporaire : ni la branche, ni l'index, ni les
// fichiers ne sont touchés. Historique des instantanés : `git reflog refs/autosave/latest`.
// Restaurer le dernier : `git checkout refs/autosave/latest -- .`
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REF = 'refs/autosave/latest';
const arg = process.argv[2] ?? '10';
const git = (args, env = {}) => execFileSync('git', args, { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const tryGit = (args) => { try { return git(args); } catch { return ''; } };
const stamp = () => new Date().toLocaleTimeString('fr-FR');

function snapshot() {
  const dir = mkdtempSync(join(tmpdir(), 'autosave-'));
  try {
    const env = { GIT_INDEX_FILE: join(dir, 'index') };
    git(['read-tree', 'HEAD'], env);
    git(['add', '-A'], env);
    const tree = git(['write-tree'], env);
    const prev = tryGit(['rev-parse', '-q', '--verify', REF]);
    if (tree === git(['rev-parse', 'HEAD^{tree}']) || (prev && tree === git(['rev-parse', prev + '^{tree}']))) {
      console.log(`[autosave ${stamp()}] rien de nouveau`);
      return;
    }
    const commit = git(['commit-tree', tree, '-p', 'HEAD', '-m', `autosave ${new Date().toISOString()}`]);
    git(['update-ref', '--create-reflog', '-m', 'autosave', REF, commit]);
    console.log(`[autosave ${stamp()}] instantané ${commit.slice(0, 7)}`);
  } catch (e) {
    console.log(`[autosave ${stamp()}] échec : ${String(e.message).split('\n')[0]}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

snapshot();
if (arg !== 'once') setInterval(snapshot, Math.max(1, Number(arg) || 10) * 60_000);
