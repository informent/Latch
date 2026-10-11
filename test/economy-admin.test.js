'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { EconomyStore } = require('../src/economy-store'), { createInteractionHandler } = require('../src/interactions');
const { directory, ids, epoch, fakeDiscord, interaction } = require('./feature-fixtures');
const request = (extra = {}) => ({ id: ids.menu, guildId: ids.guild, actorId: ids.actor, userId: ids.user, action: 'grant', amount: 100, reason: 'Event prize', ...extra });
async function fixture(t) {
  const root = await directory(t), f = fakeDiscord(), store = new EconomyStore(path.join(root, 'coins.json')); f.roles.find((role) => role.id === ids.actorRole).permissions = '32';
  const config = { guildId: ids.guild, applicationId: ids.bot }, logs = [];
  const handler = createInteractionHandler({ config, economy: store, discord: f.discord, logger: (...args) => logs.push(args), now: () => new Date(epoch) });
  const invoke = (action, values, id = ids.menu, permission = '32') => { const payload = interaction('economyadmin', action, values, permission); payload.id = id; return handler(payload); };
  const run = async (...args) => { const result = await invoke(...args); if (!result.work) return result.immediate.data; assert.equal(result.immediate.type, 5); assert.equal(result.immediate.data.flags, 64); await result.work(); const body = f.calls.filter((call) => call[0] === 'response').at(-1)[3]; assert.deepEqual(body.allowed_mentions, { parse: [] }); return body; };
  return { root, ...f, store, config, logs, invoke, run };
}
test('staff coin grant/remove/set persist balances and audit receipts across restart', async (t) => {
  const f = await fixture(t); const grant = await f.store.adjustCoins(request(), new Date(epoch)); assert.equal(grant.before, 0); assert.equal(grant.after, 100);
  await f.store.adjustCoins(request({ id: ids.message, action: 'remove', amount: 40 }), new Date(epoch + 1)); await f.store.adjustCoins(request({ id: ids.owner, action: 'set', amount: 0 }), new Date(epoch + 2));
  const loaded = new EconomyStore(f.store.filePath); await loaded.load(); assert.equal(loaded.balance(ids.guild, ids.user), 0); assert.equal(loaded.adjustmentHistory(ids.guild).length, 3); assert.equal(loaded.adjustment(ids.guild, ids.menu).reason, 'Event prize'); assert.equal(JSON.parse(await fs.readFile(f.store.filePath)).version, 3);
});
test('duplicate adjustment requests apply once, survive restart and reject conflicting reuse', async (t) => {
  const f = await fixture(t); const results = await Promise.all(Array.from({ length: 12 }, () => f.store.adjustCoins(request(), new Date(epoch)))); assert.equal(results.filter((entry) => !entry.duplicate).length, 1); assert.equal(f.store.balance(ids.guild, ids.user), 100);
  const loaded = new EconomyStore(f.store.filePath); await loaded.load(); assert.equal((await loaded.adjustCoins(request(), new Date(epoch + 60000))).duplicate, true);
  for (const extra of [{ amount: 101 }, { actorId: ids.owner }, { reason: 'Different' }, { userId: ids.actor }, { action: 'remove' }, { guildId: ids.owner }]) await assert.rejects(loaded.adjustCoins(request(extra), new Date(epoch)), /conflict/);
});
for (const [label, extra] of [['negative', { amount: -1 }], ['zero grant', { amount: 0 }], ['huge', { amount: 1000000001 }], ['fraction', { amount: 1.5 }], ['blank reason', { reason: '  ' }], ['long reason', { reason: 'x'.repeat(401) }], ['invalid actor', { actorId: 'bad' }], ['invalid action', { action: 'delete' }]]) test(`coin adjustment rejects ${label}`, async (t) => {
  const f = await fixture(t); assert.throws(() => f.store.adjustCoins(request(extra), new Date(epoch))); assert.equal(f.store.balance(ids.guild, ids.user), 0); assert.equal(f.store.adjustmentHistory(ids.guild).length, 0);
});
test('coin removal refuses overdrafts and failed writes preserve both balance and ledger', async (t) => {
  const f = await fixture(t); await f.store.adjustCoins(request(), new Date(epoch)); await assert.rejects(f.store.adjustCoins(request({ id: ids.owner, action: 'remove', amount: 101 }), new Date(epoch)), /balance limits/);
  const file = f.store.filePath, bytes = await fs.readFile(file); const blocker = path.join(f.root, 'blocker'); await fs.writeFile(blocker, 'x'); f.store.filePath = path.join(blocker, 'coins.json');
  await assert.rejects(f.store.adjustCoins(request({ id: ids.owner }), new Date(epoch))); assert.equal(f.store.balance(ids.guild, ids.user), 100); assert.equal(f.store.adjustmentHistory(ids.guild).length, 1); assert.deepEqual(await fs.readFile(file), bytes);
});
test('adjustment preserves reward cooldowns, professions and inventory', async (t) => {
  const f = await fixture(t); await f.store.claim(ids.guild, ids.user, 'daily', new Date(epoch)); await f.store.chooseProfession(ids.guild, ids.user, 'artist', new Date(epoch));
  await f.store.saveItem('create', { guildId: ids.guild, id: 'cookie', title: 'Cookie', description: 'Virtual item', price: 10, stock: 10, enabled: false }); await f.store.enableItem(ids.guild, 'cookie', true);
  await f.store.transactItem({ id: ids.message, guildId: ids.guild, userId: ids.user, kind: 'buy', itemId: 'cookie', quantity: 1, targetId: null }, new Date(epoch));
  const before = f.store.profile(ids.guild, ids.user); await f.store.adjustCoins(request(), new Date(epoch)); const after = f.store.profile(ids.guild, ids.user); after.balance = before.balance; assert.deepEqual(after, before);
});
test('adjustments capture queued caller input and return isolated history snapshots', async (t) => {
  const f = await fixture(t); let release; f.store.queue = new Promise((r) => { release = r; }); t.after(() => release()); const input = request(), write = f.store.adjustCoins(input, new Date(epoch)); input.amount = 999; release(); await write;
  const history = f.store.adjustmentHistory(ids.guild); history[0].reason = 'Changed'; assert.equal(f.store.adjustment(ids.guild, ids.menu).reason, 'Event prize'); assert.equal(f.store.balance(ids.guild, ids.user), 100); assert.equal(f.store.adjustment(ids.owner, ids.menu), null);
});
for (const [label, mutate] of [['permission revoked', (f) => { f.roles.find((r) => r.id === ids.actorRole).permissions = '0'; }], ['staff bot', (f) => { f.members.get(ids.actor).user.bot = true; }], ['staff screening', (f) => { f.members.get(ids.actor).pending = true; }], ['target bot', (f) => { f.members.get(ids.user).user.bot = true; }], ['target screening', (f) => { f.members.get(ids.user).pending = true; }], ['foreign target identity', (f) => { f.members.get(ids.user).user.id = ids.owner; }], ['missing role', (f) => { f.members.get(ids.actor).roles = [ids.owner]; }]]) test(`economy administration rejects ${label}`, async (t) => {
  const f = await fixture(t); mutate(f); assert.match((await f.run('grant', { user: ids.user, amount: 100, reason: 'Prize' })).content, /failed/); assert.equal(f.store.balance(ids.guild, ids.user), 0); assert.equal(f.store.adjustmentHistory(ids.guild).length, 0);
});
test('economy admin command workflow privately records history and full reasons', async (t) => {
  const f = await fixture(t); assert.match((await f.run('grant', { user: ids.user, amount: 50, reason: '@everyone event prize' })).content, /Adjustment saved/);
  assert.match((await f.run('grant', { user: ids.user, amount: 50, reason: '@everyone event prize' })).content, /Previously saved/); assert.equal(f.store.balance(ids.guild, ids.user), 50);
  assert.match((await f.run('history', { user: ids.user })).content, /0 -> 50/); assert.match((await f.run('receipt', { id: ids.menu })).content, /Reason:/); assert.doesNotMatch((await f.run('receipt', { id: ids.menu })).content, /@everyone/);
  assert.match((await f.run('history', { user: ids.actor })).content, /No adjustments/); assert.match((await f.run('receipt', { id: ids.owner })).content, /failed/);
});
test('economy admin rejects missing interaction permission and invalid options before API work', async (t) => {
  const f = await fixture(t); assert.match((await f.run('history', {}, ids.menu, '0')).content, /Manage Server/);
  for (const [action, values] of [['history', { page: 0 }], ['receipt', { id: '../bad' }], ['history', { user: 'bad' }], ['other', {}]]) assert.equal((await f.invoke(action, values)).work, undefined); assert.equal(f.calls.length, 0);
});
test('economy administrator with current Administrator permission can adjust coins', async (t) => {
  const f = await fixture(t); f.roles.find((r) => r.id === ids.actorRole).permissions = '8'; assert.match((await f.run('set', { user: ids.user, amount: 100, reason: 'Reset event' }, ids.menu, '8')).content, /Adjustment saved/);
});
test('lost adjustment response preserves one committed result and retry returns its receipt', async (t) => {
  const f = await fixture(t), edit = f.discord.editOriginalResponse; let first = true;
  f.discord.editOriginalResponse = async (...args) => { if (first) { first = false; throw new Error('secret-token'); } return edit(...args); };
  await f.run('grant', { user: ids.user, amount: 100, reason: 'Event prize' }); assert.equal(f.store.balance(ids.guild, ids.user), 100);
  assert.match((await f.run('grant', { user: ids.user, amount: 100, reason: 'Event prize' })).content, /Previously saved/); assert.equal(f.store.balance(ids.guild, ids.user), 100); assert.doesNotMatch(JSON.stringify(f.logs), /secret/);
});
for (const [label, edit] of [['duplicate IDs', (s) => { s.adjustments.push(s.adjustments[0]); }], ['wrong balance arithmetic', (s) => { s.adjustments[0].after++; }], ['unknown field', (s) => { s.adjustments[0].extra = true; }], ['missing ledger', (s) => { delete s.adjustments; }]]) test(`economy format 3 rejects ${label} without overwriting`, async (t) => {
  const f = await fixture(t); await f.store.adjustCoins(request(), new Date(epoch)); const data = JSON.parse(await fs.readFile(f.store.filePath)); edit(data); const bytes = JSON.stringify(data); await fs.writeFile(f.store.filePath, bytes); const loaded = new EconomyStore(f.store.filePath); await assert.rejects(loaded.load()); assert.equal(await fs.readFile(f.store.filePath, 'utf8'), bytes);
});
test('format 2 migration preserves accounts, items and shop receipts until successful format 3 save', async (t) => {
  const f = await fixture(t); const old = { version: 2, accounts: [{ guildId: ids.guild, userId: ids.user, balance: 75, lastDaily: null, lastWork: null }], items: [], receipts: [] }; await fs.writeFile(f.store.filePath, JSON.stringify(old)); await f.store.load(); assert.equal(JSON.parse(await fs.readFile(f.store.filePath)).version, 2);
  await f.store.adjustCoins(request(), new Date(epoch)); assert.equal(f.store.balance(ids.guild, ids.user), 175); assert.equal(JSON.parse(await fs.readFile(f.store.filePath)).version, 3);
});

test('old ledger records prune on new adjustments while balances remain and retained IDs still deduplicate', async (t) => {
  const f = await fixture(t); await f.store.adjustCoins(request(), new Date(epoch)); await f.store.adjustCoins(request({ id: ids.owner }), new Date(epoch + 8 * 86400000)); assert.equal(f.store.balance(ids.guild, ids.user), 200); assert.equal(f.store.adjustmentHistory(ids.guild).length, 1); assert.equal(f.store.adjustment(ids.guild, ids.menu), null);
});
test('coin grant refuses the global balance ceiling', async (t) => {
  const f = await fixture(t); await fs.writeFile(f.store.filePath, JSON.stringify({ version: 1, accounts: [{ guildId: ids.guild, userId: ids.user, balance: 9000000000000000, lastDaily: null, lastWork: null }] })); await f.store.load(); await assert.rejects(f.store.adjustCoins(request(), new Date(epoch)), /balance limits/); assert.equal(f.store.balance(ids.guild, ids.user), 9000000000000000);
});
test('failed adjustment migration leaves legacy bytes and balances unchanged', async (t) => {
  const f = await fixture(t), old = JSON.stringify({ version: 1, accounts: [] }); await fs.writeFile(f.store.filePath, old); await f.store.load(); const file = f.store.filePath;
  const blocker = path.join(f.root, 'blocker'); await fs.writeFile(blocker, 'x'); f.store.filePath = path.join(blocker, 'coins.json'); await assert.rejects(f.store.adjustCoins(request(), new Date(epoch))); assert.equal(await fs.readFile(file, 'utf8'), old); assert.equal(f.store.adjustmentHistory(ids.guild).length, 0);
});
test('economy history pages five entries and guild-bound receipts hide foreign records', async (t) => {
  const f = await fixture(t); for (let i = 0; i < 6; i++) await f.store.adjustCoins(request({ id: String(BigInt(ids.menu) + BigInt(i)) }), new Date(epoch + i)); const result = await f.run('history', { page: 2 }); assert.match(result.content, /page 2\/2/); assert.equal((result.content.match(/Event prize/g) || []).length, 1);
  await f.store.adjustCoins(request({ id: ids.owner, guildId: ids.owner }), new Date(epoch)); assert.match((await f.run('receipt', { id: ids.owner })).content, /failed/);
});
test('signed HTTP economy adjustments save once and receipts survive store reload', async (t) => {
  const crypto = require('node:crypto'), { once } = require('node:events'), { createServerRuntime } = require('../src/server'), { publicKeyFromHex } = require('../src/interactions'), { TicketStore } = require('../src/ticket-store');
  const f = await fixture(t); const config = { ...f.config, host: '127.0.0.1', port: 0, gatewayEnabled: false, storePath: path.join(f.root, 'tickets.json'), moderationStorePath: path.join(f.root, 'warnings.json'), economyStorePath: f.store.filePath, levelStorePath: path.join(f.root, 'levels.json'), communityStorePath: path.join(f.root, 'community.json') }, pair = crypto.generateKeyPairSync('ed25519');
  const server = await createServerRuntime({ config, discord: f.discord, store: new TicketStore(config.storePath), economy: f.store, publicKey: publicKeyFromHex(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')) });
  t.after(async () => { await server.drain(); if (server.listening) await new Promise((r) => server.close(r)); await Promise.all([server.community.stop(), server.voice.stop(), server.roleMenus.stop(), server.timers.stop(), server.ticketPanels.stop(), server.levelRewards.stop()]); }); await once(server, 'listening');
  const send = async (action, options) => {
    const raw = Buffer.from(JSON.stringify(interaction('economyadmin', action, options, '32'))), timestamp = String(Math.floor(Date.now() / 1000)); const result = await fetch(`http://127.0.0.1:${server.address().port}/interactions`, { method: 'POST', body: raw, headers: { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': crypto.sign(null, Buffer.concat([Buffer.from(timestamp), raw]), pair.privateKey).toString('hex') } });
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { type: 5, data: { flags: 64 } }); await server.drain(); return f.calls.filter((call) => call[0] === 'response').at(-1)[3];
  };
  const options = { user: ids.user, amount: 100, reason: 'HTTP event award' }; assert.match((await send('grant', options)).content, /Adjustment saved/); assert.match((await send('grant', options)).content, /Previously saved/); assert.match((await send('receipt', { id: ids.menu })).content, /HTTP event award/);
  const loaded = new EconomyStore(config.economyStorePath); await loaded.load(); assert.equal(loaded.balance(ids.guild, ids.user), 100); assert.equal(loaded.adjustmentHistory(ids.guild).length, 1);
});

test('timed-out staff cannot adjust coins despite a stale permitted interaction', async (t) => {
  const f = await fixture(t); f.members.get(ids.actor).communication_disabled_until = new Date(epoch + 60000).toISOString(); assert.match((await f.run('grant', { user: ids.user, amount: 100, reason: 'Prize' })).content, /failed/); assert.equal(f.store.balance(ids.guild, ids.user), 0);
});

test('complete backup verification preserves format 3 economy balances and audit ledger', async (t) => {
  const f = await fixture(t), { createBackup, verifyBackup, storeDefinitions } = require('../scripts/backup'); await f.store.adjustCoins(request(), new Date(epoch)); const config = { guildId: ids.guild };
  for (const definition of storeDefinitions) config[definition.key] = definition.key === 'economyStorePath' ? f.store.filePath : path.join(f.root, 'missing', definition.file);
  const destination = path.join(f.root, 'snapshot'); assert.equal((await createBackup(config, destination)).present, 1); assert.equal((await verifyBackup(destination, ids.guild)).present, 1);
  const loaded = new EconomyStore(path.join(destination, 'economy.json')); await loaded.load(); assert.equal(loaded.balance(ids.guild, ids.user), 100); assert.deepEqual(loaded.adjustment(ids.guild, ids.menu), f.store.adjustment(ids.guild, ids.menu));
});
