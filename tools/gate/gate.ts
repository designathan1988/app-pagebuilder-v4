// npm run gate -- <message-file> <log-name> <path>...: the one way a change reaches main (CLAUDE.md, Commits). It
// commits the paths named and nothing else, and it checks exactly what it commits:
//
//   1. the branch is main and origin is the project's repository;
//   2. the QA-LOG rows earlier commits left as "(this commit)" get their hashes (the commit that added each row);
//   3. one change per commit: the QA-LOG gains one row at most;
//   4. the named paths are staged; everything else in the tree (unfinished work, other files) is set aside with
//      git stash push --keep-index --include-untracked, so the tree holds only what will be committed (git's own
//      "Testing partial commits", https://git-scm.com/docs/git-stash). Before this gate, check:fast ran on the whole
//      tree and the commit took only the paths named: 9af8cbe passed and left its code out (5bd5c9d carried it);
//   5. npm run gen and npm run inventory regenerate their files from that tree, and those files join the commit
//      (they are derived, never edited by hand, so they are left out of what is set aside);
//   6. npm run check:fast; on success the commit and the push to origin main;
//   7. the work set aside comes back (git stash pop) whatever happened; if it cannot, the stash is kept and named.
//
// Every step is written to .cache/logs/gate-<log-name>.txt, check:fast to .cache/logs/check-fast-<log-name>.txt.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../manifest/load.ts';
import { INVENTORY_JSON, INVENTORY_MD } from '../inventory/generate.ts';
import { FEATURES_MD } from '../inventory/features.ts';
import { addedRows, fillHashes, pendingMark, pendingRows } from './qa-log.ts';
import { outsideTheIndex } from './status.ts';

const ORIGIN = 'https://github.com/designathan1988/app-pagebuilder-v4.git';
const QA_LOG = 'docs/QA-LOG.md';
const posix = (file: string) => file.split(path.sep).join('/');
const INVENTORY_FILES = [INVENTORY_JSON, INVENTORY_MD, FEATURES_MD].map(posix);
const LOGS = path.join(REPO_ROOT, '.cache', 'logs');

class Refusal extends Error {}
const refuse = (reason: string): never => {
  throw new Refusal(reason);
};

const [messageFile, logName, ...named] = process.argv.slice(2);
if (messageFile === undefined || logName === undefined || named.length === 0) {
  console.error('usage: npm run gate -- <message-file> <log-name> <path>...');
  process.exit(2);
}

fs.mkdirSync(LOGS, { recursive: true });
const logFile = path.join(LOGS, `gate-${logName}.txt`);
fs.writeFileSync(logFile, `gate ${logName}: ${named.join(' ')}\n`);
const say = (line: string) => {
  console.log(line);
  fs.appendFileSync(logFile, `${line}\n`);
};

function run(command: string, args: readonly string[], allowFailure = false): SpawnSyncReturns<string> {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  fs.appendFileSync(logFile, `$ ${command} ${args.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}(exit ${result.status})\n`);
  if (result.status !== 0 && !allowFailure) {
    const output = (result.stderr ?? '').trim() || (result.stdout ?? '').trim();
    throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status}): ${output.split('\n').slice(-10).join('\n')}`);
  }
  return result;
}
const git = (args: readonly string[], allowFailure = false) => run('git', ['-c', 'safe.directory=*', ...args], allowFailure);
const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
// npm's own script (set when the gate runs through npm run): npm.cmd cannot be spawned without a shell on Windows
const npmCli = process.env.npm_execpath;
const npm = (script: string, allowFailure = false) =>
  npmCli === undefined ? run('npm', ['run', script], allowFailure) : run(process.execPath, [npmCli, 'run', script], allowFailure);
const stashTop = () => git(['rev-parse', '-q', '--verify', 'refs/stash'], true).stdout.trim();

let stashed = false;
let committed = false;
try {
  if (!fs.existsSync(messageFile)) refuse(`the message file ${messageFile} does not exist`);

  // 1. where the commit goes
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  if (branch !== 'main') refuse(`the branch is ${branch}; work is committed on main (CLAUDE.md, One tree)`);
  const origin = git(['remote', 'get-url', 'origin']).stdout.trim();
  if (origin !== ORIGIN) refuse(`origin is ${origin}; the project's repository is ${ORIGIN}`);

  // 2. the hashes of the rows earlier commits added as "(this commit)"
  const committedLog = git(['show', `HEAD:${QA_LOG}`]).stdout;
  const workingLog = fs.readFileSync(path.join(REPO_ROOT, QA_LOG), 'utf8');
  const hashes = new Map<number, string>();
  for (const number of pendingRows(committedLog)) {
    const first = lines(git(['log', '--reverse', '--format=%h', '-S', pendingMark(number), '--', QA_LOG]).stdout)[0];
    if (first !== undefined) hashes.set(number, first);
  }
  const filledLog = fillHashes(workingLog, hashes);
  if (filledLog !== workingLog) {
    fs.writeFileSync(path.join(REPO_ROOT, QA_LOG), filledLog);
    say(`QA-LOG: rows ${[...hashes.keys()].join(', ')} now name their commits`);
  }

  // 3. one change per commit
  const added = addedRows(committedLog, filledLog);
  if (added.length > 1) refuse(`the QA-LOG gains ${added.length} rows (${added.join(', ')}): one change per commit, so each can be reverted alone`);

  // 4. the tree holds only what will be committed. The derived files are learnt from the generator's own report.
  const derived = [...lines(npm('gen').stdout).flatMap((line) => /^gen: wrote (.+)$/.exec(line)?.[1] ?? []).map(posix), ...INVENTORY_FILES];
  const paths = [...new Set([...named.map(posix), ...(filledLog === workingLog ? [] : [QA_LOG])])];
  git(['reset', '-q']);
  git(['add', '-A', '--', ...paths]);
  const outside = outsideTheIndex(git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout).filter((file) => !derived.includes(file));
  if (outside.length > 0) {
    say(`set aside while checking (${outside.length}): ${outside.slice(0, 8).join(', ')}${outside.length > 8 ? ', …' : ''}`);
    const before = stashTop();
    git(['stash', 'push', '--keep-index', '--include-untracked', '-m', `gate ${logName}: work outside the commit`, '--', '.', ...derived.map((file) => `:(exclude)${file}`)]);
    stashed = stashTop() !== before;
  }

  // 5. the derived files of exactly this tree join the commit
  npm('gen');
  npm('inventory');
  git(['add', '-A', '--', ...derived]);
  const staged = lines(git(['diff', '--cached', '--name-only']).stdout);
  if (staged.length === 0) refuse('nothing to commit in the paths named');
  say(`committing (${staged.length}): ${staged.join(', ')}`);

  // 6. the static gate on the tree as committed, then the commit and the push
  const check = npm('check:fast', true);
  fs.writeFileSync(path.join(LOGS, `check-fast-${logName}.txt`), `${check.stdout}${check.stderr}`);
  if (check.status !== 0) {
    const failures = lines(`${check.stdout}${check.stderr}`).filter((line) => /✗|error|FAIL|×|Error/.test(line)).slice(0, 15);
    refuse(`check:fast failed (.cache/logs/check-fast-${logName}.txt):\n${failures.join('\n')}`);
  }
  git(['commit', '-q', '-F', messageFile]);
  committed = true;
  git(['push', '-q', 'origin', 'main']);
  say(git(['log', '--oneline', '-1']).stdout.trim());
} catch (error) {
  say(error instanceof Refusal ? `GATE REFUSED: ${error.message}` : `GATE FAILED: ${error instanceof Error ? error.message : String(error)}`);
  if (committed) say('The commit exists locally; the push did not happen.');
  process.exitCode = 1;
} finally {
  // 7. the work set aside comes back, whatever happened above
  if (stashed) {
    const popped = git(['stash', 'pop'], true);
    if (popped.status !== 0) {
      say('GATE WARNING: the work set aside could not come back by itself; it is kept in the stash (git stash list).');
      say((popped.stderr ?? '').trim());
      process.exitCode = 1;
    }
  }
  if (!committed) git(['reset', '-q'], true);
}
