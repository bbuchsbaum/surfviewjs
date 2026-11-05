#!/usr/bin/env node
// Cut a release in one command. CI publishes it to npm; nothing is published
// from this machine and no npm login is needed.
//
// Usage:
//   npm run release -- <patch|minor|major|prerelease|x.y.z[-pre]> [--dry-run] [--check] [--no-watch]
//
// Steps:
//   1. Preflight: on main, clean tree, in sync with origin, gh authenticated,
//      tag absent, CHANGELOG has a non-empty Unreleased section (stable only;
//      a prerelease uses Unreleased as its notes and leaves CHANGELOG alone).
//   2. (--check) run the local release gate first.
//   3. Bump package.json + package-lock.json, date the CHANGELOG section
//      (and update Keep-a-Changelog compare links if the file has them).
//   4. Commit "Release vX.Y.Z", push main.
//   5. gh release create vX.Y.Z with the CHANGELOG section as notes
//      (--prerelease for versions with a suffix). This triggers
//      .github/workflows/release.yml, which gates, publishes with npm
//      Trusted Publishing (OIDC + provenance) and verifies the result.
//   6. Watch that workflow run unless --no-watch.
//
// --dry-run prints what would happen and changes nothing.
// No dependencies beyond Node's standard library.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const HELP = `usage: npm run release -- <patch|minor|major|prerelease|x.y.z[-pre]> [--dry-run] [--check] [--no-watch]`;
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('-')));
const positional = args.filter((a) => !a.startsWith('-'));
if (flags.has('-h') || flags.has('--help')) {
  console.log(HELP);
  process.exit(0);
}
for (const f of flags) {
  if (!['--dry-run', '--check', '--no-watch'].includes(f)) die(`unknown option ${f}\n${HELP}`);
}
if (positional.length !== 1) die(HELP);
const dryRun = flags.has('--dry-run');

function die(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}
function out(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function tryOut(cmd, cmdArgs) {
  try {
    return out(cmd, cmdArgs);
  } catch {
    return null;
  }
}
function run(cmd, cmdArgs, recovery = '') {
  console.log(`$ ${cmd} ${cmdArgs.join(' ')}`);
  if (dryRun) return;
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
  if (r.status !== 0) die(`'${cmd} ${cmdArgs.join(' ')}' failed${recovery ? `\n${recovery}` : ''}`);
}

// ---- version arithmetic -------------------------------------------------
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
function nextVersion(current, spec) {
  const m = SEMVER.exec(current);
  if (!m) die(`package.json version '${current}' is not x.y.z[-pre]`);
  let [maj, min, pat] = m.slice(1, 4).map(Number);
  const pre = m[4];
  switch (spec) {
    case 'major':
      return pre && min === 0 && pat === 0 ? `${maj}.0.0` : `${maj + 1}.0.0`;
    case 'minor':
      return pre && pat === 0 ? `${maj}.${min}.0` : `${maj}.${min + 1}.0`;
    case 'patch':
      return pre ? `${maj}.${min}.${pat}` : `${maj}.${min}.${pat + 1}`;
    case 'prerelease': {
      if (!pre) return `${maj}.${min}.${pat + 1}-rc.0`;
      const parts = pre.split('.');
      const last = Number(parts.at(-1));
      if (Number.isInteger(last)) parts[parts.length - 1] = String(last + 1);
      else parts.push('0');
      return `${maj}.${min}.${pat}-${parts.join('.')}`;
    }
    default:
      if (!SEMVER.test(spec)) die(`'${spec}' is not patch|minor|major|prerelease or x.y.z[-pre]`);
      return spec;
  }
}
function newer(a, b) {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
}

// ---- preflight ----------------------------------------------------------
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const current = pkg.version;
const version = nextVersion(current, positional[0]);
const tag = `v${version}`;
const prerelease = version.includes('-');
const problems = [];

const branch = tryOut('git', ['branch', '--show-current']);
if (branch !== 'main') problems.push(`not on main (on '${branch}')`);
if (tryOut('git', ['status', '--porcelain'])) problems.push('working tree is not clean (commit or stash first)');
if (tryOut('git', ['fetch', '--quiet', '--tags', 'origin']) === null) problems.push('git fetch origin failed');
const local = tryOut('git', ['rev-parse', 'HEAD']);
const remote = tryOut('git', ['rev-parse', 'origin/main']);
if (local !== remote) problems.push('main is not in sync with origin/main (pull or push first)');
if (tryOut('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])) problems.push(`tag ${tag} already exists`);
if (tryOut('gh', ['auth', 'status']) === null) problems.push("gh is not authenticated (run 'gh auth login')");
const latest = tryOut('npm', ['view', pkg.name, 'dist-tags.latest']);
if (!prerelease && latest && !newer(version, latest)) {
  problems.push(`${version} is not newer than npm 'latest' (${latest}); the workflow would refuse it`);
}

// ---- CHANGELOG ----------------------------------------------------------
// Local date, so an evening release is not dated tomorrow.
const now = new Date();
const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
let changelog = readFileSync('CHANGELOG.md', 'utf8').replace(/\r\n/g, '\n');
const unreleased = /^## (\[Unreleased\]|Unreleased)[ \t]*$/m.exec(changelog);
let notes = '';
let changelogChanged = false;
if (!unreleased) {
  problems.push("CHANGELOG.md has no '## Unreleased' or '## [Unreleased]' heading");
} else {
  const bracketed = unreleased[1].startsWith('[');
  const bodyStart = unreleased.index + unreleased[0].length;
  const nextHeading = changelog.slice(bodyStart).search(/^## |^\[Unreleased\]: /m);
  const bodyEnd = nextHeading === -1 ? changelog.length : bodyStart + nextHeading;
  const body = changelog.slice(bodyStart, bodyEnd);
  notes = body.trim();
  if (prerelease) {
    // A prerelease previews Unreleased without consuming it, so the final
    // release still gets the full section.
    if (!notes) notes = `Prerelease ${tag}. See the Unreleased section of CHANGELOG.md.`;
  } else {
    if (!notes) problems.push('the Unreleased section of CHANGELOG.md is empty; describe the release first');
    const heading = bracketed ? `## [${version}] - ${today}` : `## ${version} - ${today}`;
    changelog = `${changelog.slice(0, bodyStart)}\n\n${heading}\n${body.replace(/^\n*/, '\n')}${changelog.slice(bodyEnd)}`;
    changelogChanged = true;
    // Keep-a-Changelog compare links, when the file uses them.
    const linkRe = /^\[Unreleased\]: (https:\/\/github\.com\/[^/]+\/[^/]+)\/compare\/(\S+)\.\.\.HEAD$/m;
    const link = linkRe.exec(changelog);
    if (link) {
      const [, base, oldBase] = link;
      // Compare from the previous version's tag if it exists, else from whatever
      // the Unreleased link compared from.
      const prevTag = tryOut('git', ['rev-parse', '--verify', '--quiet', `refs/tags/v${current}`]) ? `v${current}` : oldBase;
      if (prevTag !== `v${current}`) console.warn(`release: tag v${current} does not exist; ${version} compare link starts at ${prevTag}`);
      changelog = changelog.replace(
        linkRe,
        `[Unreleased]: ${base}/compare/${tag}...HEAD\n[${version}]: ${base}/compare/${prevTag}...${tag}`,
      );
    }
  }
}

console.log(`${pkg.name}: ${current} -> ${version}${prerelease ? ' (prerelease, dist-tag next; CHANGELOG left as is)' : ''}`);
if (problems.length) die(`cannot release:\n  - ${problems.join('\n  - ')}`);

// ---- do it --------------------------------------------------------------
if (flags.has('--check')) {
  const gate = pkg.scripts?.['verify:release'] ? 'verify:release' : 'build';
  run('npm', ['run', gate]);
}

const notesFile = join(mkdtempSync(join(tmpdir(), 'release-')), 'notes.md');
writeFileSync(notesFile, `${notes}\n`);
const releaseArgs = (sha) => [
  'release', 'create', tag,
  '--target', sha,
  '--title', tag,
  '--notes-file', notesFile,
  ...(prerelease ? ['--prerelease'] : ['--latest']),
];
const undoLocal = 'Nothing was pushed. Undo the local changes with: git reset --hard origin/main';

run('npm', ['version', version, '--no-git-tag-version'], undoLocal);
if (changelogChanged) console.log(`$ (update CHANGELOG.md: Unreleased -> ${version} - ${today})`);
if (dryRun) {
  const preview = join(dirname(notesFile), 'CHANGELOG.md');
  writeFileSync(preview, changelog);
  console.log(`\n--- release notes ---\n${notes}\n---------------------`);
  console.log(`CHANGELOG.md preview: ${preview}\n`);
} else if (changelogChanged) {
  writeFileSync('CHANGELOG.md', changelog);
}

run('git', ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md'], undoLocal);
run('git', ['commit', '-m', `Release ${tag}`], undoLocal);
run('git', ['push', 'origin', 'main'], `${undoLocal}\n(Or fix the problem and run: git push origin main && gh ${releaseArgs('main').join(' ')})`);
const sha = dryRun ? '<release commit>' : out('git', ['rev-parse', 'HEAD']);
run(
  'gh',
  releaseArgs(sha),
  `main is already pushed with the release commit; do NOT rerun this script.\nFix the problem, then run:\n  gh ${releaseArgs(sha).join(' ')}`,
);

if (dryRun) {
  console.log('\nDry run: nothing was changed.');
  process.exit(0);
}

console.log(`\nReleased ${tag}. CI now gates, publishes and verifies it.`);
const listArgs = ['run', 'list', '-w', 'release.yml', '-e', 'release', '-c', sha, '-L', '1', '--json', 'databaseId'];
if (flags.has('--no-watch')) {
  console.log(`Follow it with: gh run watch $(gh ${listArgs.join(' ')} -q '.[0].databaseId')`);
  process.exit(0);
}
// The release event takes a few seconds to create the run.
let runId = null;
for (let i = 0; i < 20 && !runId; i++) {
  spawnSync('sleep', ['3']);
  const json = tryOut('gh', listArgs);
  runId = json ? JSON.parse(json)[0]?.databaseId : null;
}
if (!runId) die('could not find the Release workflow run; check the Actions tab');
const watch = spawnSync('gh', ['run', 'watch', String(runId), '--exit-status'], { stdio: 'inherit' });
if (watch.status !== 0) {
  die(`watching run ${runId} ended unsuccessfully. Check it with 'gh run view ${runId}'; if it failed, see RELEASING.md "When something fails"`);
}
console.log(`\nPublished: https://www.npmjs.com/package/${pkg.name}/v/${version}`);
