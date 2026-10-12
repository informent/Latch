'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { verifyRelease, main, publicFiles, sourceDigest, testSummary, REQUIRED_SMOKE, executeNode } = require('../scripts/release-verify');
const { version } = require('../package.json');
const { directory } = require('./feature-fixtures');

const tap = '# tests 3\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
const execute = async (args) => ({ status: 0, stdout: args.includes('test/run.js') ? tap : args.includes('scripts/release-smoke.js') ? JSON.stringify({ ok: true, version, checks: REQUIRED_SMOKE }) : '' });

test('release verification combines every required gate and never marks simulated checks as live proof', async () => {
  const report = await verifyRelease({ execute }); assert.equal(report.ok, true); assert.equal(report.checks.length, 6);
  assert.ok(report.checks.every(check => check.passed)); assert.equal(report.tests.passed, 3); assert.equal(report.commandPaths, 207);
  assert.equal(report.liveDiscordValidated, false); assert.equal(report.stableReady, false); assert.match(report.sourceSha256, /^[a-f0-9]{64}$/);
});
test('a failed test process stops later gates and keeps remote error text out of evidence', async () => {
  let calls = 0; const report = await verifyRelease({ execute: async () => { calls++; return { status: 1, stdout: 'private-token remote-error' }; } });
  assert.equal(report.ok, false); assert.equal(calls, 1); assert.equal(report.checks[0].passed, false); assert.doesNotMatch(JSON.stringify(report), /private-token|remote-error/);
});
test('missing, incomplete, skipped or failed test evidence cannot pass a release', () => {
  assert.equal(testSummary(tap).passed, 3);
  for (const output of ['', tap.replace('# fail 0', '# fail 1'), tap.replace('# pass 3', '# pass 2'), tap.replace('# skipped 0', '# skipped 1'), tap.replace('# cancelled 0', '# cancelled 1'), tap.replace('# todo 0', '# todo 1')]) assert.equal(testSummary(output), null);
});
test('failed syntax, catalog and publication checks stop subsequent operations', async () => {
  for (const target of ['--check', 'scripts/command-catalog.js', 'scripts/check-publication-text.js']) {
    const seen = []; const report = await verifyRelease({ execute: async (args) => { seen.push(args); return args[0] === target ? { status: 1, stdout: 'private-token' } : execute(args); } });
    assert.equal(report.ok, false); assert.equal(report.checks.at(-1).passed, false); assert.ok(!seen.some(args => args[0] === 'scripts/release-smoke.js'));
  }
});
test('smoke verification requires the current version and every signed runtime and recovery check', async () => {
  for (const smoke of [{ ok: false, version, checks: REQUIRED_SMOKE }, { ok: true, version: '0.0.0', checks: REQUIRED_SMOKE }, { ok: true, version, checks: REQUIRED_SMOKE.slice(1) }, { ok: true, version, checks: [...REQUIRED_SMOKE, REQUIRED_SMOKE[0]] }]) {
    const report = await verifyRelease({ execute: async args => args.includes('scripts/release-smoke.js') ? { status: 0, stdout: JSON.stringify(smoke) } : execute(args) }); assert.equal(report.ok, false);
  }
});
test('source fingerprint covers public files and detects edits during verification', async (t) => {
  const root = await directory(t); const files = await publicFiles();
  for (const file of files) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.copyFile(path.join(__dirname, '..', file), path.join(root, file)); }
  assert.ok(!files.some(file => file === '.env' || file.startsWith('data/')));
  const before = await sourceDigest(files, root);
  const report = await verifyRelease({ root, execute: async args => { if (args.includes('scripts/release-smoke.js')) await fs.appendFile(path.join(root, 'README.md'), '\nChanged during verification\n'); return execute(args); } });
  assert.equal(report.ok, false); assert.equal(report.checks.at(-1).passed, false); assert.notEqual(await sourceDigest(files, root), before);
});
test('CLI writes a new evidence file and preserves an existing report', async (t) => {
  const root = await directory(t), output = path.join(root, 'evidence/report.json'); t.mock.method(console, 'log', () => {});
  const report = await verifyRelease({ execute }); await main(['--json', '--output', output], async () => report); const original = await fs.readFile(output, 'utf8'); assert.equal(JSON.parse(original).ok, true);
  await assert.rejects(main(['--output', output], async () => report), { code: 'EEXIST' }); assert.equal(await fs.readFile(output, 'utf8'), original);
  for (const args of [['--live'], ['--json', '--json'], ['--output'], ['--output', '.env'], ['--output', 'one.json', '--output', 'two.json']]) await assert.rejects(main(args, async () => report), /Usage/);
});
test('child execution failures yield failed checks and a nonzero CLI exit', async (t) => {
  const exit = process.exitCode; t.after(() => { process.exitCode = exit; }); t.mock.method(console, 'log', () => {});
  const report = await main([], () => verifyRelease({ execute: async () => { throw new Error('private-token'); } }));
  assert.equal(report.ok, false); assert.equal(process.exitCode, 1); assert.doesNotMatch(JSON.stringify(report), /private-token/);
});
test('verification child processes exclude live configuration and use bounded hidden execution', () => {
  let captured;
  const result = executeNode(['--version'], { environment: { PATH: 'local-path', DISCORD_BOT_TOKEN: 'private-token', COMMUNITY_STORE_PATH: 'private-path' }, spawn: (binary, args, options) => { captured = { binary, args, options }; return { status: null }; } });
  assert.deepEqual(result, { status: null, stdout: '' }); assert.equal(captured.binary, process.execPath); assert.deepEqual(captured.args, ['--version']);
  assert.deepEqual(captured.options.env, { PATH: 'local-path' }); assert.equal(captured.options.windowsHide, true); assert.equal(captured.options.timeout, 300000);
});
