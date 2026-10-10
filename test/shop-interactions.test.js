'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { startServer } = require('../src/server');
const { publicKeyFromHex } = require('../src/interactions');
const { EconomyStore } = require('../src/economy-store');
const { createInteractionHandler } = require('../src/interactions');
const { ids, epoch, directory, fakeDiscord, interaction } = require('./feature-fixtures');
async function fixture(t) {
  const economy = new EconomyStore(path.join(await directory(t), 'coins.json')); const fake = fakeDiscord(); let sequence = BigInt(ids.message);
  const handler = createInteractionHandler({ config: { guildId: ids.guild, applicationId: ids.bot }, economy, discord: fake.discord, now: () => new Date(epoch) });
  const payload = (action, values = {}, permissions = '32', userId = ids.user) => {
    const data = interaction('shop', action, values, permissions); data.id = String(sequence++); data.member.user = { id: userId }; return data;
  };
  const run = async (data) => { const handled = await handler(data); assert.equal(handled.immediate.type, 5); assert.equal(handled.immediate.data.flags, 64); await handled.work(); const response = fake.calls.filter((call) => call[0] === 'response').at(-1)[3]; assert.deepEqual(response.allowed_mentions, { parse: [] }); return response.content; };
  await economy.claim(ids.guild, ids.user, 'daily', new Date(epoch));
  return { economy, ...fake, handler, payload, run };
}
const values = { item: 'cookie', title: 'Cookie', description: '@everyone treat', price: 10, stock: 4 };
for (const action of ['create', 'update', 'enable', 'disable']) test(`shop ${action} denies members without Manage Server before a write`, async (t) => {
  const f = await fixture(t); const result = await f.handler(f.payload(action, values, '0')); assert.match(result.immediate.data.content, /Manage Server/); assert.deepEqual(f.economy.shop(ids.guild), []); assert.equal(f.calls.length, 0);
});
test('shop commands cover staff creation/update, publication, purchase, gift, consumption and private history', async (t) => {
  const f = await fixture(t);
  assert.match(await f.run(f.payload('create', values)), /Disabled/);
  assert.match(await f.run(f.payload('update', { ...values, price: 12 })), /12 coins/);
  assert.match(await f.run(f.payload('list')), /disabled/);
  assert.match(await f.run(f.payload('list', {}, '0')), /No entries/);
  assert.match(await f.run(f.payload('enable', { item: 'cookie' })), /enabled/);
  assert.match(await f.run(f.payload('info', { item: 'cookie' }, '0')), /Price: 12/);
  const buy = f.payload('buy', { item: 'cookie', quantity: 2 }, '0'); assert.match(await f.run(buy), /Cost: 24/); assert.match(await f.run(buy), /no repeat transaction/);
  assert.match(await f.run(f.payload('inventory', {}, '0')), /x2/);
  assert.match(await f.run(f.payload('gift', { item: 'cookie', user: ids.actor }, '0')), /Gifted/);
  assert.match(await f.run(f.payload('history', {}, '0', ids.actor)), /from/);
  assert.match(await f.run(f.payload('use', { item: 'cookie' }, '0')), /Consumed/);
  assert.match(await f.run(f.payload('inventory', {}, '0')), /No entries/);
  assert.match(await f.run(f.payload('disable', { item: 'cookie' })), /disabled/);
  assert.match(await f.run(f.payload('info', { item: 'cookie' }, '0')), /not found/);
  assert.equal(f.economy.balance(ids.guild, ids.user), 76); assert.equal(f.economy.item(ids.guild, 'cookie').stock, 2);
});
for (const [label, member] of [['missing identity', { roles: [] }], ['mismatched identity', { user: { id: ids.owner } }], ['bot', { user: { id: ids.actor, bot: true } }], ['screening', { user: { id: ids.actor }, pending: true }]]) test(`shop gifts reject recipient ${label} without changing inventory`, async (t) => {
  const f = await fixture(t); await f.run(f.payload('create', values)); await f.run(f.payload('enable', { item: 'cookie' })); await f.run(f.payload('buy', { item: 'cookie' }, '0'));
  f.discord.getGuildMember = async () => member; assert.match(await f.run(f.payload('gift', { item: 'cookie', user: ids.actor }, '0')), /human member/);
  assert.equal(f.economy.inventory(ids.guild, ids.user)[0].quantity, 1); assert.deepEqual(f.economy.inventory(ids.guild, ids.actor), []);
});
test('shop hides transport and disk errors and keeps unsupported actions private', async (t) => {
  const f = await fixture(t); f.economy.saveItem = async () => { throw new Error('SECRET_TOKEN_ON_DISK'); };
  const content = await f.run(f.payload('create', values)); assert.match(content, /Shop action failed/); assert.ok(!content.includes('SECRET'));
  const unknown = await f.handler(f.payload('unknown')); assert.equal(unknown.immediate.data.flags, 64);
  const bot = f.payload('list'); bot.member.user.bot = true; assert.match((await f.handler(bot)).immediate.data.content, /human/);
});
test('shop pagination preserves bounds and safely renders user-authored item text', async (t) => {
  const f = await fixture(t); await f.run(f.payload('create', values));
  assert.match(await f.run(f.payload('info', { item: 'cookie' })), /＠everyone/);
  assert.match(await f.run(f.payload('list', { page: 0 })), /valid page/);
  assert.match(await f.run(f.payload('list', { page: 2 })), /1 to 1/);
});
test('signed HTTP shop purchases persist before response delivery and duplicate retries remain harmless', async (t) => {
  const f = await fixture(t); await f.run(f.payload('create', values)); await f.run(f.payload('enable', { item: 'cookie' }));
  const pair = crypto.generateKeyPairSync('ed25519');
  const server = startServer({ config: { host: '127.0.0.1', port: 0 }, publicKey: publicKeyFromHex(pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')), handle: f.handler, logger: () => {} });
  t.after(async () => { await server.drain(); await new Promise((resolve) => server.close(resolve)); }); await once(server, 'listening');
  const raw = Buffer.from(JSON.stringify(f.payload('buy', { item: 'cookie', quantity: 2 }, '0'))); const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': crypto.sign(null, Buffer.concat([Buffer.from(timestamp), raw]), pair.privateKey).toString('hex') };
  f.discord.editOriginalResponse = async () => { throw new Error('Response transport lost'); };
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/interactions`, { method: 'POST', body: raw, headers });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } }); await server.drain();
  }
  assert.equal(f.economy.balance(ids.guild, ids.user), 80); assert.equal(f.economy.inventory(ids.guild, ids.user)[0].quantity, 2); assert.equal(f.economy.item(ids.guild, 'cookie').stock, 2); assert.equal(f.economy.history(ids.guild, ids.user).length, 1);
  const reloaded = new EconomyStore(f.economy.filePath); await reloaded.load(); assert.equal(reloaded.balance(ids.guild, ids.user), 80);
});
