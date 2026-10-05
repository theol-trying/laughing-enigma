// Sauvegarde de progression : `npm run checkpoint -- "message"`
// → commit git de tout l'état courant, puis push vers GitHub (copie hors machine).
// Utilisé après chaque étape pour pouvoir reprendre après une coupure.
import { execSync } from 'node:child_process';
const msg = process.argv.slice(2).join(' ') || 'checkpoint';
const run = (c) => execSync(c, { stdio: 'pipe' }).toString().trim();
run('git add -A');
if (run('git status --porcelain')) {
  run(`git commit -q -m ${JSON.stringify('checkpoint: ' + msg)}`);
  console.log(run('git log --oneline -1'));
} else console.log('rien de nouveau à committer');
if (run('git remote')) {
  try { run('git push -q origin HEAD'); console.log('poussé sur GitHub'); }
  catch (e) { console.log('push impossible (sauvegarde locale conservée) :', String(e.message).split('\n')[0]); }
}
