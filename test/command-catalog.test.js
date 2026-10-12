'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { commands } = require('../src/commands');
const { leaves, catalog, markdown, main } = require('../scripts/command-catalog');
const file = path.resolve(__dirname, '../COMMANDS.md');
test('command reference lists every registered leaf exactly once, with every option', () => {
  const reference = markdown(); assert.equal(catalog.length, 207); assert.equal(commands.length, 25); assert.equal(new Set(catalog.map((entry) => entry.command)).size, catalog.length);
  assert.equal((reference.match(/^### \//gm) || []).length, catalog.length);
  for (const entry of catalog) {
    assert.equal(reference.split(`### ${entry.command}\n`).length - 1, 1);
    const section = reference.split(`### ${entry.command}\n`)[1].split('\n### ')[0].split('\n## ')[0];
    for (const option of entry.options) assert.ok(section.includes(`| ${option.name} |`), `${entry.command} ${option.name}`);
  }
  assert.equal(reference.includes(String.fromCharCode(0x2014)), false);
});
test('command reference includes permissions, bounds, choices and channel restrictions', () => {
  const reference = markdown(); for (const text of ['Manage Server (32)', 'Manage Messages (8192)', 'Minimum: 1', 'Maximum: 1000', 'Minimum text length: 5', 'Choices:', 'Allowed Discord channel type IDs:', 'Runtime', 'Required']) {
    assert.ok(reference.toLowerCase().includes(text.toLowerCase()), text);
  }
});
test('committed command reference matches its generator across Windows line endings', () => {
  assert.equal(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'), markdown()); main(['--check']);
});
test('reference check rejects missing and stale files without modifying them', (t) => {
  const exists = fs.existsSync, read = fs.readFileSync; t.after(() => { fs.existsSync = exists; fs.readFileSync = read; });
  fs.existsSync = (target) => target === file ? false : exists(target); assert.throws(() => main(['--check']), /outdated/);
  fs.existsSync = exists; fs.readFileSync = (target, ...args) => target === file ? 'old reference' : read(target, ...args); assert.throws(() => main(['--check']), /outdated/);
});
test('catalog leaf traversal handles grouped commands and root options', () => {
  assert.deepEqual(leaves({ name: 'demo', options: [{ type: 2, name: 'group', options: [{ type: 1, name: 'run', description: 'Run', options: [{ type: 4, name: 'count', required: true }] }] }] }), [{ command: '/demo group run', description: 'Run', options: [{ type: 4, name: 'count', required: true }] }]);
  assert.equal(leaves(commands.find((command) => command.name === 'level'))[0].options[0].name, 'user');
});
test('catalog JSON retains all command options and rejects unsupported CLI arguments', (t) => {
  const write = process.stdout.write; let output = ''; process.stdout.write = (value) => { output += value; return true; }; t.after(() => { process.stdout.write = write; });
  main(['--json']); const data = JSON.parse(output); assert.equal(data.commands.length, 207); assert.equal(data.commands.find((entry) => entry.command === '/levelreward add').options.length, 2);
  output = ''; main(['--markdown']); assert.equal(output, markdown()); assert.throws(() => main(['--invalid']), /Usage/); assert.throws(() => main(['--json', '--check']), /Usage/);
});
