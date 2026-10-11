'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { createBackup, verifyBackup, main, storeDefinitions } = require('../scripts/backup');
const { inspectSetup } = require('../scripts/doctor');
const { directory, ids, epoch } = require('./feature-fixtures');
async function fixture(t, missing = false) {
  const root = await directory(t), config = { guildId: ids.guild }; await fs.mkdir(path.join(root, 'data'));
  for (const definition of storeDefinitions) {
    const file = path.join(root, 'data', definition.file); config[definition.key] = file;
    if (missing) continue;
    const store = definition.guildBound ? new definition.Store(file, ids.guild) : new definition.Store(file);
    const state = store.state || (definition.key === 'storePath' ? { version: 1, tickets: [] } : definition.key === 'moderationStorePath' ? { version: 1, warnings: [] } : definition.key === 'communityStorePath' ? { version: 2, jobs: [] } : { version: 1, accounts: [] });
    await fs.writeFile(file, JSON.stringify(state));
  }
  const destination = path.join(root, 'backup');
  const create = () => createBackup(config, destination, { now: () => new Date(epoch) });
  return { root, config, destination, create };
}
async function manifest(f, edit) { const file = path.join(f.destination, 'manifest.json'), value = JSON.parse(await fs.readFile(file, 'utf8')); edit(value); await fs.writeFile(file, JSON.stringify(value)); }
test('complete backup verifies all twelve stores, preserves exact bytes and omits source paths and credentials', async (t) => {
  const f = await fixture(t); f.config.botToken = 'secret-never-copy'; const result = await f.create(); assert.equal(result.present, 12); assert.deepEqual(result.missing, []);
  const raw = await fs.readFile(path.join(f.destination, 'manifest.json'), 'utf8'); assert.doesNotMatch(raw, /secret-never-copy|[A-Z]:\\/);
  for (const definition of storeDefinitions) assert.deepEqual(await fs.readFile(f.config[definition.key]), await fs.readFile(path.join(f.destination, definition.file)));
  assert.deepEqual(await verifyBackup(f.destination, ids.guild), result);
});
test('fresh-install backup explicitly records every missing store without creating source files', async (t) => {
  const f = await fixture(t, true); const result = await f.create(); assert.equal(result.present, 0); assert.equal(result.missing.length, 12); assert.deepEqual(await fs.readdir(path.join(f.root, 'data')), []); assert.deepEqual(await fs.readdir(f.destination), ['manifest.json']);
});
test('backup preserves an existing destination and all source files', async (t) => {
  const f = await fixture(t); await f.create(); const before = await fs.readFile(path.join(f.destination, 'manifest.json')); await assert.rejects(f.create(), /EEXIST/); assert.deepEqual(await fs.readFile(path.join(f.destination, 'manifest.json')), before);
});
test('backup refuses a destination containing source files before writing', async (t) => {
  const f = await fixture(t); await assert.rejects(createBackup(f.config, f.root), /destination/); await assert.rejects(createBackup(f.config, f.config.storePath));
});
test('invalid source leaves no completed manifest and never modifies the source', async (t) => {
  const f = await fixture(t); await fs.writeFile(f.config.storePath, 'corrupt'); await assert.rejects(f.create()); assert.equal(await fs.readFile(f.config.storePath, 'utf8'), 'corrupt'); await assert.rejects(fs.access(path.join(f.destination, 'manifest.json')));
});
test('source changes detected after snapshot prevent completion', async (t) => {
  const f = await fixture(t), read = fs.readFile; let changed = false;
  t.mock.method(fs, 'readFile', async (...args) => { const value = await read(...args); if (args[0] === f.config.storePath && !changed) { changed = true; await fs.writeFile(f.config.storePath, '{"version":1,"tickets":[]}\n'); } return value; });
  await assert.rejects(f.create(), /changed during backup/); await assert.rejects(fs.access(path.join(f.destination, 'manifest.json')));
});
test('backup detects newly appearing missing stores during snapshot', async (t) => {
  const f = await fixture(t, true), lstat = fs.lstat; let seen = 0;
  t.mock.method(fs, 'lstat', async (...args) => { if (args[0] === f.config.storePath && ++seen === 2) await fs.writeFile(f.config.storePath, '{"version":1,"tickets":[]}'); return lstat(...args); });
  await assert.rejects(f.create(), /changed during backup/);
});
for (const [name, change] of [
  ['wrong version', (m) => { m.version = 2; }], ['invalid guild', (m) => { m.guildId = 'bad'; }], ['invalid timestamp', (m) => { m.createdAt = 'bad'; }],
  ['extra manifest field', (m) => { m.extra = true; }], ['missing store', (m) => { m.stores.pop(); }], ['duplicate store', (m) => { m.stores[1] = m.stores[0]; }],
  ['path traversal', (m) => { m.stores[0].file = '../tickets.json'; }], ['absolute path', (m) => { m.stores[0].file = 'C:/tickets.json'; }],
  ['invalid digest', (m) => { m.stores[0].sha256 = 'bad'; }], ['invalid bytes', (m) => { m.stores[0].bytes = -1; }], ['checksum mismatch', (m) => { m.stores[0].sha256 = 'a'.repeat(64); }]
]) test(`backup verifier rejects ${name}`, async (t) => { const f = await fixture(t); await f.create(); await manifest(f, change); await assert.rejects(verifyBackup(f.destination)); });
test('backup verifier rejects an expected guild mismatch', async (t) => { const f = await fixture(t); await f.create(); await assert.rejects(verifyBackup(f.destination, ids.owner), /guild mismatch/); });
test('backup verifier rejects extra files and missing required files', async (t) => {
  const f = await fixture(t); await f.create(); await fs.writeFile(path.join(f.destination, '.env'), 'secret'); await assert.rejects(verifyBackup(f.destination), /unexpected files/); await fs.unlink(path.join(f.destination, '.env')); await fs.unlink(path.join(f.destination, 'tickets.json')); await assert.rejects(verifyBackup(f.destination));
});
test('backup verifier validates store schema even if altered bytes match a new checksum', async (t) => {
  const f = await fixture(t); await f.create(); const bad = Buffer.from('{"version":1,"tickets":"bad"}'); await fs.writeFile(path.join(f.destination, 'tickets.json'), bad);
  await manifest(f, (m) => { m.stores[0].sha256 = crypto.createHash('sha256').update(bad).digest('hex'); m.stores[0].bytes = bad.length; }); await assert.rejects(verifyBackup(f.destination), /unsupported format/);
});
test('backup verifier rejects an unexpected file for a missing store', async (t) => { const f = await fixture(t, true); await f.create(); await fs.writeFile(path.join(f.destination, 'tickets.json'), '{}'); await assert.rejects(verifyBackup(f.destination), /missing store/); });
test('backup refuses directories used as store files', async (t) => { const f = await fixture(t); await fs.unlink(f.config.storePath); await fs.mkdir(f.config.storePath); await assert.rejects(f.create(), /regular file/); });
test('backup verifier rejects incomplete and oversized manifests', async (t) => {
  const f = await fixture(t); await fs.mkdir(f.destination); await assert.rejects(verifyBackup(f.destination)); await fs.writeFile(path.join(f.destination, 'manifest.json'), ' '.repeat(65537)); await assert.rejects(verifyBackup(f.destination), /regular file/);
});
test('backup verifier detects backup changes during schema verification', async (t) => {
  const f = await fixture(t); await f.create(); const read = fs.readFile, file = path.join(f.destination, 'tickets.json'); let reads = 0;
  t.mock.method(fs, 'readFile', async (...args) => { const value = await read(...args); if (args[0] === file && ++reads === 2) await fs.writeFile(file, '{"version":1,"tickets":[]}\n'); return value; }); await assert.rejects(verifyBackup(f.destination), /changed during verification/);
});
test('backup command rejects unknown and incomplete arguments', async () => { for (const args of [[], ['create'], ['delete', 'folder'], ['verify', ''], ['verify', 'folder', 'extra']]) await assert.rejects(main(args), /Usage/); });
test('backup verification command needs no Discord configuration or token', async (t) => {
  const f = await fixture(t); await f.create(); const output = []; t.mock.method(console, 'log', (value) => output.push(value)); await main(['verify', f.destination]); assert.equal(JSON.parse(output[0]).present, 12);
});
test('doctor and backups share the complete twelve-store registry', async (t) => {
  const f = await fixture(t, true); const env = { DISCORD_APPLICATION_ID: ids.bot, DISCORD_GUILD_ID: ids.guild, DISCORD_PUBLIC_KEY: 'a'.repeat(64), DISCORD_BOT_TOKEN: 'fixture' };
  const envKeys = ['TICKET_STORE_PATH', 'MODERATION_STORE_PATH', 'ECONOMY_STORE_PATH', 'LEVEL_STORE_PATH', 'COMMUNITY_STORE_PATH', 'VOICE_STORE_PATH', 'ROLE_MENU_STORE_PATH', 'TEMPLATE_STORE_PATH', 'RESPONDER_STORE_PATH', 'TIMER_STORE_PATH', 'TICKET_PANEL_STORE_PATH', 'LEVEL_REWARD_STORE_PATH'];
  storeDefinitions.forEach((definition, index) => { env[envKeys[index]] = f.config[definition.key]; }); const result = await inspectSetup(env);
  assert.equal(result.ok, true); for (const definition of storeDefinitions) assert.equal(result.checks.find((check) => check.name === `${definition.name} store`).status, 'pass');
});

test('backup verifier rejects a manifest changed while store schemas are checked', async (t) => {
  const f = await fixture(t); await f.create(); const read = fs.readFile, file = path.join(f.destination, 'manifest.json'); let first = true;
  t.mock.method(fs, 'readFile', async (...args) => { const value = await read(...args); if (args[0] === file && first) { first = false; await fs.writeFile(file, value.toString() + '\n'); } return value; }); await assert.rejects(verifyBackup(f.destination), /Manifest changed/);
});

test('backup source and verification reject symbolic file metadata', async (t) => {
  const f = await fixture(t), stat = fs.lstat;
  t.mock.method(fs, 'lstat', async (...args) => { const value = await stat(...args); if (args[0] === f.config.storePath) return { size: value.size, isFile: () => true, isSymbolicLink: () => true }; return value; });
  await assert.rejects(f.create(), /regular file/);
});
