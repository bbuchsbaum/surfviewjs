#!/usr/bin/env node
// Verify that a version published to npm matches a tarball packed from source,
// and that its provenance attestation describes the expected build.
//
// Usage:
//   node scripts/verify-published.mjs <version> [options]
//
// Options:
//   --local-tarball <path>      Reference tarball (default: `npm pack` of --pack-dir).
//                               When given, the registry's dist.integrity must equal
//                               its sha512: the bytes must be identical.
//   --pack-dir <dir>            Directory to `npm pack --ignore-scripts` when no
//                               --local-tarball is given (default: repo root). Its
//                               dist/ must already be built.
//   --published-tarball <path>  Use this file instead of downloading from npm
//                               (tests the comparison only; no registry checks).
//   --package <name>            Package name (default: name in package.json of --pack-dir).
//   --require-provenance        Fail unless a valid SLSA provenance attestation exists.
//   --expected-repo <url>       Source repository the provenance must name
//                               (default: https://github.com/bbuchsbaum/surfviewjs).
//   --expected-workflow <path>  Workflow path the provenance must name
//                               (default: .github/workflows/release.yml).
//   --retries <n>               Attempts for registry lookups while the registry
//                               propagates (default 1).
//   --retry-delay <seconds>     Delay between attempts (default 15).
//   -h, --help                  Print this help.
//
// Compares the file list, file modes and SHA-256 of every file in the two
// tarballs; duplicate entries are an error. The provenance check decodes the
// SLSA statement in the attestation's DSSE envelope and checks its subject
// digest, source repository and workflow path. It does not verify the Sigstore
// signature itself; `npm audit signatures` does that.
//
// Exit status: 0 = all checks passed, 1 = a check failed, 2 = usage or runtime error.
// No dependencies beyond Node's standard library.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://registry.npmjs.org';
const SLSA_PREDICATE = /^https:\/\/slsa\.dev\/provenance\//;
const DEFAULT_REPO = 'https://github.com/bbuchsbaum/surfviewjs';
const DEFAULT_WORKFLOW = '.github/workflows/release.yml';

const HELP = `usage: node scripts/verify-published.mjs <version> [options]

  --local-tarball <path>      reference tarball; registry integrity must match it exactly
  --pack-dir <dir>            directory to npm pack when no --local-tarball (default: repo root)
  --published-tarball <path>  compare against this file instead of downloading (no registry checks)
  --package <name>            package name (default: from package.json of --pack-dir)
  --require-provenance        fail unless a matching SLSA provenance attestation exists
  --expected-repo <url>       provenance source repository (default: ${DEFAULT_REPO})
  --expected-workflow <path>  provenance workflow path (default: ${DEFAULT_WORKFLOW})
  --retries <n>               attempts for registry lookups (default 1)
  --retry-delay <seconds>     delay between attempts (default 15)
  -h, --help                  print this help

Exit status: 0 all checks passed, 1 a check failed, 2 usage or runtime error.`;

function usage(message) {
  console.error(`error: ${message}\n\n${HELP}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    retries: 1,
    retryDelay: 15,
    requireProvenance: false,
    packDir: repositoryRoot,
    expectedRepo: DEFAULT_REPO,
    expectedWorkflow: DEFAULT_WORKFLOW,
  };
  const valued = {
    '--local-tarball': 'localTarball',
    '--pack-dir': 'packDir',
    '--published-tarball': 'publishedTarball',
    '--package': 'packageName',
    '--expected-repo': 'expectedRepo',
    '--expected-workflow': 'expectedWorkflow',
    '--retries': 'retries',
    '--retry-delay': 'retryDelay',
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--require-provenance') options.requireProvenance = true;
    else if (arg === '-h' || arg === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (valued[arg]) {
      if (i + 1 >= argv.length) usage(`${arg} needs a value`);
      options[valued[arg]] = argv[++i];
    } else if (arg.startsWith('-')) usage(`unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) usage('exactly one <version> is required');
  options.version = positional[0].replace(/^v/, '');
  options.retries = Number(options.retries);
  options.retryDelay = Number(options.retryDelay);
  if (!Number.isInteger(options.retries) || options.retries < 1) usage('--retries must be a positive integer');
  if (!(options.retryDelay >= 0)) usage('--retry-delay must be a non-negative number');
  options.packDir = resolve(options.packDir);
  return options;
}

function npm(args, cwd) {
  return execFileSync('npm', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function withRetries(label, retries, retryDelay, action) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= retries) throw error;
      console.log(`  ${label} failed (attempt ${attempt}/${retries}: ${error.message.split('\n')[0]}); retrying in ${retryDelay}s`);
      await sleep(retryDelay * 1000);
    }
  }
}

// Parse pax extended-header records ("<len> key=value\n") on raw bytes: <len>
// counts bytes, not characters, so it must not be applied to a decoded string.
function parsePax(body) {
  const records = {};
  let cursor = 0;
  while (cursor < body.length) {
    const space = body.indexOf(0x20, cursor);
    if (space === -1) break;
    const length = parseInt(body.subarray(cursor, space).toString('ascii'), 10);
    if (!(length > 0) || cursor + length > body.length) throw new Error('malformed pax header');
    const record = body.subarray(space + 1, cursor + length - 1); // drop trailing "\n"
    const eq = record.indexOf(0x3d);
    if (eq !== -1) records[record.subarray(0, eq).toString('utf8')] = record.subarray(eq + 1).toString('utf8');
    cursor += length;
  }
  return records;
}

// Minimal ustar/pax reader. Returns { files: Map<path, {sha256, mode}>, duplicates: string[] },
// with paths relative to the top-level "package/" directory.
function readTarball(file) {
  const data = gunzipSync(readFileSync(file));
  const files = new Map();
  const duplicates = [];
  const field = (block, start, length) => {
    const raw = block.subarray(start, start + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? length : end).toString('utf8');
  };
  let offset = 0;
  let pax = {};
  let gnuLongName = null;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = parseInt(field(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const body = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      pax = parsePax(body);
      continue;
    }
    if (type === 'g') continue;
    if (type === 'L') {
      gnuLongName = body.toString('utf8').replace(/\0+$/, '');
      continue;
    }

    const prefix = field(header, 345, 155);
    let name = pax.path ?? gnuLongName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    pax = {};
    gnuLongName = null;
    if (type !== '0' && type !== '\0') continue; // only regular files carry content
    name = name.replace(/^[^/]+\//, ''); // strip the top-level "package/" directory
    const mode = (parseInt(field(header, 100, 8).trim() || '0', 8) & 0o7777).toString(8).padStart(4, '0');
    if (files.has(name)) duplicates.push(name);
    files.set(name, { sha256: createHash('sha256').update(body).digest('hex'), mode });
  }
  return { files, duplicates };
}

function sri(file) {
  return `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`);
  return response.json();
}

const normalizeRepo = (url) => String(url ?? '').replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();

// Returns { problems, source }; no problems means the provenance checks passed.
function checkStatement(entry, { packageName, version, integrity, expectedRepo, expectedWorkflow }) {
  const problems = [];
  const envelope = entry.bundle?.dsseEnvelope;
  if (!envelope?.payload) return { problems: ['SLSA attestation has no DSSE payload'] };
  if (envelope.payloadType !== 'application/vnd.in-toto+json') problems.push(`unexpected payloadType ${envelope.payloadType}`);
  let statement;
  try {
    statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
  } catch {
    return { problems: ['DSSE payload is not valid JSON'] };
  }

  const expectedSha512 = integrity?.startsWith('sha512-')
    ? Buffer.from(integrity.slice(7), 'base64').toString('hex')
    : null;
  if (!expectedSha512) problems.push(`registry integrity ${integrity} is not sha512`);
  const subjectName = `pkg:npm/${packageName.replace(/^@/, '%40')}@${version}`;
  const subject = (statement.subject ?? []).find((item) => item.name === subjectName);
  if (!subject) problems.push(`no subject named ${subjectName}`);
  else if (expectedSha512 && subject.digest?.sha512 !== expectedSha512) {
    problems.push(`subject sha512 ${subject.digest?.sha512} does not match the published tarball (${expectedSha512})`);
  }

  const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow ?? {};
  if (normalizeRepo(workflow.repository) !== normalizeRepo(expectedRepo)) {
    problems.push(`source repository ${workflow.repository} is not ${expectedRepo}`);
  }
  if (workflow.path !== expectedWorkflow) {
    problems.push(`workflow path ${workflow.path} is not ${expectedWorkflow}`);
  }
  return { problems, source: `${workflow.repository} ${workflow.path} @ ${workflow.ref}` };
}

async function checkRegistry(packageName, options) {
  const { version, retries, retryDelay } = options;
  const manifestUrl = `${REGISTRY}/${encodeURIComponent(packageName).replace('%40', '@')}/${version}`;
  const manifest = await withRetries('registry manifest', retries, retryDelay, () => fetchJson(manifestUrl));
  const integrity = manifest.dist?.integrity;
  const attestationsUrl = manifest.dist?.attestations?.url;
  if (!attestationsUrl) return { integrity, problems: ['no dist.attestations in registry manifest'] };

  const bundle = await withRetries('attestation lookup', retries, retryDelay, () => fetchJson(attestationsUrl));
  const slsa = (bundle.attestations ?? []).filter((entry) => SLSA_PREDICATE.test(entry.predicateType));
  if (!slsa.length) {
    const types = (bundle.attestations ?? []).map((entry) => entry.predicateType);
    return { integrity, problems: [`attestations found but no SLSA provenance: ${types.join(', ')}`] };
  }
  const results = slsa.map((entry) => checkStatement(entry, { ...options, packageName, integrity }));
  return { integrity, problems: results.flatMap((r) => r.problems), source: results[0].source };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageName = options.packageName ??
    JSON.parse(readFileSync(join(options.packDir, 'package.json'), 'utf8')).name;
  const spec = `${packageName}@${options.version}`;
  const scratch = mkdtempSync(join(tmpdir(), 'verify-published-'));
  // Separate directories: both tarballs have the same file name.
  const localDir = join(scratch, 'local');
  const publishedDir = join(scratch, 'published');
  mkdirSync(localDir);
  mkdirSync(publishedDir);
  const failures = [];

  try {
    let localTarball = options.localTarball && resolve(options.localTarball);
    if (!localTarball) {
      const localVersion = JSON.parse(readFileSync(join(options.packDir, 'package.json'), 'utf8')).version;
      if (localVersion !== options.version) {
        throw new Error(`package.json in ${options.packDir} is ${localVersion}, not ${options.version}; check out the matching tag first`);
      }
      const [result] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', localDir], options.packDir));
      localTarball = join(localDir, result.filename);
    }
    const publishedTarball = options.publishedTarball
      ? resolve(options.publishedTarball)
      : await withRetries(`npm pack ${spec}`, options.retries, options.retryDelay, () => {
        const [result] = JSON.parse(npm(['pack', spec, '--json', '--pack-destination', publishedDir], publishedDir));
        return join(publishedDir, result.filename);
      });

    console.log(`Comparing ${spec}`);
    console.log(`  published: ${publishedTarball}`);
    console.log(`  local:     ${localTarball}`);

    const published = readTarball(publishedTarball);
    const local = readTarball(localTarball);
    const pub = published.files;
    const loc = local.files;
    const onlyPublished = [...pub.keys()].filter((file) => !loc.has(file)).sort();
    const onlyLocal = [...loc.keys()].filter((file) => !pub.has(file)).sort();
    const shared = [...pub.keys()].filter((file) => loc.has(file)).sort();
    const differing = shared.filter((file) => loc.get(file).sha256 !== pub.get(file).sha256);
    const modeDiffers = shared
      .filter((file) => loc.get(file).mode !== pub.get(file).mode)
      .map((file) => `${file} (published ${pub.get(file).mode}, local ${loc.get(file).mode})`);

    const show = (label, list) => {
      if (!list.length) return;
      console.log(`  ${label} (${list.length}):`);
      for (const file of list.slice(0, 50)) console.log(`    ${file}`);
      if (list.length > 50) console.log(`    ... and ${list.length - 50} more`);
    };
    show('duplicate entries in published tarball', published.duplicates);
    show('duplicate entries in local tarball', local.duplicates);
    show('only in published tarball', onlyPublished);
    show('only in local tarball', onlyLocal);
    show('content differs', differing);
    show('mode differs', modeDiffers);

    const contentMatch = [published.duplicates, local.duplicates, onlyPublished, onlyLocal, differing, modeDiffers]
      .every((list) => !list.length);
    console.log(contentMatch
      ? `  MATCH: ${pub.size} files, identical paths, modes and SHA-256`
      : `  MISMATCH: published ${pub.size} files, local ${loc.size} files`);
    if (!contentMatch) failures.push('tarball contents differ');

    if (options.publishedTarball) {
      if (options.requireProvenance) failures.push('provenance cannot be checked with --published-tarball');
    } else {
      const registry = await checkRegistry(packageName, options);
      if (registry.integrity !== sri(publishedTarball)) {
        failures.push('downloaded tarball does not match registry dist.integrity');
      }
      const sameBytes = registry.integrity === sri(localTarball);
      if (options.localTarball) {
        console.log(`  tarball integrity: ${sameBytes ? 'identical to --local-tarball' : 'DIFFERS from --local-tarball'}`);
        if (!sameBytes) failures.push('registry dist.integrity differs from --local-tarball');
      } else {
        console.log(`  tarball integrity: ${sameBytes ? 'identical' : 'differs (local repack; per-file comparison is authoritative)'}`);
      }
      if (registry.problems.length) {
        console.log(`  provenance: ${options.requireProvenance ? 'FAILED' : 'not valid (not required)'}`);
        for (const problem of registry.problems) console.log(`    ${problem}`);
        if (options.requireProvenance) failures.push('provenance check failed');
      } else {
        console.log(`  provenance: OK (subject digest, repository and workflow match: ${registry.source})`);
      }
    }

    if (failures.length) console.log(`FAILED: ${failures.join('; ')}`);
    process.exitCode = failures.length ? 1 : 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(2);
});
