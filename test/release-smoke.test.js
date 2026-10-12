'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { runSmoke, main } = require('../scripts/release-smoke');
test('isolated release smoke covers startup, signed runtime, duplicate handling and backup recovery', async () => {
  const result = await runSmoke(); assert.equal(result.ok, true); assert.equal(result.container, false); assert.equal(result.checks.length, 43);
});
test('release smoke CLI rejects unknown or duplicate options', async () => {
  await assert.rejects(main(['--live']), /Usage/); await assert.rejects(main(['--container', '--container']), /Usage/);
});
test('release smoke CLI prints structured evidence without credentials', async (t) => {
  const output = []; t.mock.method(console, 'log', (value) => output.push(value)); await main([]); const evidence = JSON.parse(output[0]); assert.equal(evidence.ok, true); assert.ok(evidence.checks.includes('economy-recovery')); assert.doesNotMatch(output[0], /placeholder|token|reason/i);
});
