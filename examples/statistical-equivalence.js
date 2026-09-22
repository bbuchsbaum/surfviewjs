import assert from 'node:assert/strict';
import { tToZ } from 'surfview';

const positive = tToZ(2, 10);
assert.ok(Math.abs(positive - 1.79040993226883) < 1e-8);
assert.equal(tToZ(0, 10), 0);
assert.ok(Math.abs(tToZ(-2, 10) + positive) < 1e-12);
assert.throws(() => tToZ(2, 0), /Degrees of freedom/);

process.stdout.write(`t=2, df=10 -> z=${positive.toFixed(6)}\n`);
