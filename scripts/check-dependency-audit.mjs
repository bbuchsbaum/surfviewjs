import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cacheDirectory = mkdtempSync(join(tmpdir(), 'surfview-npm-audit-'));

function audit(extraArguments = []) {
  const result = spawnSync(npmCommand, [
    '--cache', cacheDirectory,
    'audit',
    '--json',
    ...extraArguments
  ], { encoding: 'utf8' });

  if (!result.stdout.trim()) {
    throw new Error([
      'npm audit returned no JSON output.',
      result.stderr
    ].filter(Boolean).join('\n'));
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Could not parse npm audit output: ${error.message}\n${result.stdout}`);
  }
}

try {
  const runtime = audit(['--omit=dev']);
  assert.deepEqual(runtime.metadata.vulnerabilities, {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0
  }, 'Published runtime dependency audit must remain empty');

  const complete = audit();
  const vulnerabilities = Object.values(complete.vulnerabilities);
  const critical = vulnerabilities.filter(item => item.severity === 'critical');
  assert.deepEqual(
    critical.map(item => item.name),
    [],
    'No critical development advisory is allowlisted'
  );

  const high = vulnerabilities.filter(item => item.severity === 'high');
  assert.deepEqual(
    high.map(item => item.name).sort(),
    ['vite'],
    'Only the reviewed VitePress-nested Vite advisory may remain high'
  );

  const nestedVite = high[0];
  assert.equal(nestedVite.isDirect, false);
  assert.deepEqual(nestedVite.nodes, ['node_modules/vitepress/node_modules/vite']);
  const highAdvisoryUrls = nestedVite.via
    .filter(item => typeof item === 'object' && item.severity === 'high')
    .map(item => item.url)
    .sort();
  assert.deepEqual(highAdvisoryUrls, [
    'https://github.com/advisories/GHSA-fx2h-pf6j-xcff'
  ]);

  const remaining = vulnerabilities
    .map(item => `${item.name}:${item.severity}`)
    .sort()
    .join(', ');
  process.stdout.write(
    'dependency audit policy passed: runtime=0; critical=0; ' +
    `reviewed development findings=${remaining}\n`
  );
} finally {
  rmSync(cacheDirectory, { recursive: true, force: true });
}
