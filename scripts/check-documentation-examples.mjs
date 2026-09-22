import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');

function normalize(source) {
  return source.replaceAll('\r\n', '\n').trim();
}

function readMarkedFence(markdown, name) {
  const start = `<!-- example:${name}:start -->`;
  const end = `<!-- example:${name}:end -->`;
  const startIndex = markdown.indexOf(start);
  const endIndex = markdown.indexOf(end);
  assert.notEqual(startIndex, -1, `README.md is missing ${start}`);
  assert.notEqual(endIndex, -1, `README.md is missing ${end}`);
  assert.ok(endIndex > startIndex, `${end} must follow ${start}`);

  const section = markdown.slice(startIndex + start.length, endIndex).trim();
  const match = section.match(/^```(?:ts|typescript)\n([\s\S]*?)\n```$/);
  assert.ok(match, `${name} must contain exactly one TypeScript fence`);
  return match[1];
}

const [readme, gettingStarted, quickStart, reliability, quickstartSource, statisticsSource] =
  await Promise.all([
    readFile(join(projectRoot, 'README.md'), 'utf8'),
    readFile(join(projectRoot, 'docs/guide/getting-started.md'), 'utf8'),
    readFile(join(projectRoot, 'docs/guide/quick-start.md'), 'utf8'),
    readFile(join(projectRoot, 'docs/guide/reliability.md'), 'utf8'),
    readFile(join(projectRoot, 'examples/quickstart.ts'), 'utf8'),
    readFile(join(projectRoot, 'examples/statistical-equivalence.js'), 'utf8')
  ]);

assert.equal(
  normalize(readMarkedFence(readme, 'quickstart')),
  normalize(quickstartSource),
  'The README quickstart drifted from examples/quickstart.ts'
);
assert.ok(
  gettingStarted.includes('<<< ../../examples/quickstart.ts'),
  'Getting Started must include examples/quickstart.ts'
);
assert.ok(
  quickStart.includes('<<< ../../examples/quickstart.ts'),
  'Quick Start must include examples/quickstart.ts'
);
assert.ok(
  reliability.includes('<<< ../../examples/statistical-equivalence.js'),
  'Reliability must include examples/statistical-equivalence.js'
);
assert.ok(statisticsSource.includes("from 'surfview'"));

process.stdout.write(
  'documentation example linkage passed: README and guides use the canonical packed-consumer examples\n'
);
