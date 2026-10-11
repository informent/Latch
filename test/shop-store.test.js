'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EconomyStore } = require('../src/economy-store');
const { LIMITS } = require('../src/shop-schema');
const { directory, ids, epoch } = require('./feature-fixtures');
const item = (extra = {}) => ({ guildId: ids.guild, id: 'cookie', title: 'Cookie', description: 'A virtual treat.', price: 10, stock: 10, enabled: false, ...extra });
const request = (extra = {}) => ({ id: ids.message, guildId: ids.guild, userId: ids.user, kind: 'buy', itemId: 'cookie', quantity: 2, targetId: null, ...extra });
async function fixture(t) {
  const file = path.join(await directory(t), 'economy.json'); const store = new EconomyStore(file);
  await store.claim(ids.guild, ids.user, 'daily', new Date(epoch)); await store.saveItem('create', item()); await store.enableItem(ids.guild, 'cookie', true);
  return { store, file };
}
test('shop migration preserves v1 balances, cooldowns and professions until an atomic v3 write', async (t) => {
  const file = path.join(await directory(t), 'economy.json');
  const old = { version: 1, accounts: [{ guildId: ids.guild, userId: ids.user, balance: 75, lastDaily: new Date(epoch).toISOString(), lastWork: null, profession: { name: 'artist', works: 12, changedAt: new Date(epoch).toISOString() } }] };
  await fs.writeFile(file, JSON.stringify(old)); const store = new EconomyStore(file); await store.load();
  assert.equal(JSON.parse(await fs.readFile(file)).version, 1); await store.saveItem('create', item());
  const saved = JSON.parse(await fs.readFile(file)); assert.equal(saved.version, 3); assert.deepEqual(saved.accounts, old.accounts);
  const reloaded = new EconomyStore(file); await reloaded.load(); assert.equal(reloaded.profile(ids.guild, ids.user).profession.rank, 2);
});
test('failed migration preserves the original v1 file and all in-memory state', async (t) => {
  const file = path.join(await directory(t), 'economy.json'); const old = '{"version":1,"accounts":[]}'; await fs.writeFile(file, old);
  const store = new EconomyStore(file); await store.load(); const blocker = path.join(path.dirname(file), 'blocker'); await fs.writeFile(blocker, 'x'); store.filePath = path.join(blocker, 'bad.json');
  await assert.rejects(store.saveItem('create', item())); assert.equal(await fs.readFile(file, 'utf8'), old); assert.deepEqual(store.shop(ids.guild, { includeDisabled: true }), []);
});
test('purchases persist coins, stock, inventory and duplicate receipts together across restart', async (t) => {
  const { store, file } = await fixture(t); const receipt = await store.transactItem(request(), new Date(epoch));
  assert.equal(receipt.total, 20); assert.equal(store.balance(ids.guild, ids.user), 80); assert.equal(store.item(ids.guild, 'cookie').stock, 8); assert.equal(store.inventory(ids.guild, ids.user)[0].quantity, 2);
  const reloaded = new EconomyStore(file); await reloaded.load(); const duplicate = await reloaded.transactItem(request(), new Date(epoch + 1));
  assert.equal(duplicate.duplicate, true); assert.equal(reloaded.balance(ids.guild, ids.user), 80); assert.equal(reloaded.history(ids.guild, ids.user).length, 1);
  await assert.rejects(reloaded.transactItem(request({ quantity: 1 }), new Date(epoch)), /conflict/);
  await assert.rejects(reloaded.transactItem(request({ userId: ids.actor }), new Date(epoch)), /conflict/);
});
test('concurrent same-ID purchases charge once and limited stock cannot oversell', async (t) => {
  const { store } = await fixture(t); await store.saveItem('update', item({ stock: 3 }));
  const duplicate = await Promise.all(Array.from({ length: 20 }, () => store.transactItem(request(), new Date(epoch))));
  assert.equal(duplicate.filter((entry) => !entry.duplicate).length, 1);
  const attempts = await Promise.allSettled([store.transactItem(request({ id: ids.menu, quantity: 1 }), new Date(epoch)), store.transactItem(request({ id: ids.lobby, quantity: 1 }), new Date(epoch))]);
  assert.equal(attempts.filter((entry) => entry.status === 'fulfilled').length, 1); assert.equal(store.item(ids.guild, 'cookie').stock, 0); assert.equal(store.balance(ids.guild, ids.user), 70);
});
test('gifting and consumption are atomic, idempotent and work with disabled items', async (t) => {
  const { store, file } = await fixture(t); await store.transactItem(request(), new Date(epoch)); await store.enableItem(ids.guild, 'cookie', false);
  const gift = request({ id: ids.menu, kind: 'gift', targetId: ids.actor, quantity: 1 });
  await store.transactItem(gift, new Date(epoch)); await store.transactItem(gift, new Date(epoch));
  assert.equal(store.inventory(ids.guild, ids.user)[0].quantity, 1); assert.equal(store.inventory(ids.guild, ids.actor)[0].quantity, 1); assert.equal(store.history(ids.guild, ids.actor).length, 1);
  const consume = request({ id: ids.lobby, kind: 'use', quantity: 1 }); await store.transactItem(consume, new Date(epoch)); await store.transactItem(consume, new Date(epoch)); assert.deepEqual(store.inventory(ids.guild, ids.user), []);
  assert.equal(store.balance(ids.guild, ids.user), 80); assert.equal(store.item(ids.guild, 'cookie').stock, 8);
  const reloaded = new EconomyStore(file); await reloaded.load(); assert.equal(reloaded.inventory(ids.guild, ids.actor)[0].quantity, 1);
});
test('shop rejects overspending, disabled purchases, self gifts and absent inventory', async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.transactItem(request({ quantity: 11 }), new Date(epoch)), /coins/);
  await store.enableItem(ids.guild, 'cookie', false); await assert.rejects(store.transactItem(request(), new Date(epoch)), /disabled/);
  assert.throws(() => store.transactItem(request({ kind: 'gift', targetId: ids.user }), new Date(epoch)), /Invalid/);
  await assert.rejects(store.transactItem(request({ kind: 'use' }), new Date(epoch)), /own enough/);
  assert.equal(store.balance(ids.guild, ids.user), 100); assert.equal(store.history(ids.guild, ids.user).length, 0);
});
test('failed persistence rolls back purchases and gifts completely and permits retry', async (t) => {
  const { store, file } = await fixture(t); const blocker = path.join(path.dirname(file), 'blocker'); await fs.writeFile(blocker, 'x');
  store.filePath = path.join(blocker, 'bad.json'); await assert.rejects(store.transactItem(request(), new Date(epoch)));
  assert.equal(store.balance(ids.guild, ids.user), 100); assert.equal(store.item(ids.guild, 'cookie').stock, 10); assert.deepEqual(store.inventory(ids.guild, ids.user), []); assert.equal(store.history(ids.guild, ids.user).length, 0);
  store.filePath = file; await store.transactItem(request(), new Date(epoch)); store.filePath = path.join(blocker, 'bad.json');
  await assert.rejects(store.transactItem(request({ id: ids.menu, kind: 'gift', targetId: ids.actor }), new Date(epoch)));
  assert.equal(store.inventory(ids.guild, ids.user)[0].quantity, 2); assert.deepEqual(store.inventory(ids.guild, ids.actor), []);
});
test('shop snapshots and queued caller inputs cannot change saved state', async (t) => {
  const { store } = await fixture(t); const input = item({ price: 12 }); const write = store.saveItem('update', input); input.price = 999; await write;
  const snapshot = store.shop(ids.guild); snapshot[0].price = 999; assert.equal(store.item(ids.guild, 'cookie').price, 12);
  await store.transactItem(request(), new Date(epoch)); const inventory = store.inventory(ids.guild, ids.user); inventory[0].quantity = 999;
  const profile = store.profile(ids.guild, ids.user); profile.inventory[0].quantity = 999; const history = store.history(ids.guild, ids.user); history[0].total = 999;
  assert.equal(store.inventory(ids.guild, ids.user)[0].quantity, 2); assert.equal(store.history(ids.guild, ids.user)[0].total, 24);
});
test('inventory caps prevent purchase overflow and recipient overflow without losing sender items', async (t) => {
  const { store } = await fixture(t); await store.saveItem('update', item({ stock: null, price: 1 }));
  const account = store.profile(ids.guild, ids.user); account.inventory = [{ itemId: 'cookie', quantity: LIMITS.quantity }]; store.accounts.set(`${ids.guild}:${ids.user}`, account);
  await assert.rejects(store.transactItem(request({ quantity: 1 }), new Date(epoch)), /quantity limit/); assert.equal(store.balance(ids.guild, ids.user), 100);
  store.accounts.set(`${ids.guild}:${ids.actor}`, { ...account, userId: ids.actor });
  await assert.rejects(store.transactItem(request({ kind: 'gift', targetId: ids.actor, quantity: 1 }), new Date(epoch)), /quantity limit/); assert.equal(store.inventory(ids.guild, ids.user)[0].quantity, LIMITS.quantity);
});
test('shop separates guild inventories and prunes receipts older than seven days during transactions', async (t) => {
  const { store } = await fixture(t); await store.transactItem(request(), new Date(epoch));
  assert.deepEqual(store.shop(ids.actor), []); assert.deepEqual(store.history(ids.actor, ids.user), []); assert.deepEqual(store.inventory(ids.actor, ids.user), []);
  await store.transactItem(request({ id: ids.menu, kind: 'use', quantity: 1 }), new Date(epoch + LIMITS.retention + 1)); assert.equal(store.history(ids.guild, ids.user).length, 1);
});
for (const [label, edit] of [
  ['duplicate item', (s) => s.items.push(s.items[0])], ['negative price', (s) => { s.items[0].price = -1; }],
  ['unknown inventory reference', (s) => { s.accounts[0].inventory[0].itemId = 'missing'; }], ['duplicate inventory', (s) => s.accounts[0].inventory.push(s.accounts[0].inventory[0])],
  ['invalid receipt', (s) => { s.receipts[0].total = -1; }], ['duplicate receipt', (s) => s.receipts.push(s.receipts[0])], ['unknown outer field', (s) => { s.extra = true; }],
  ['unsupported version', (s) => { s.version = 4; }]
]) test(`shop load refuses ${label} without replacing the original`, async (t) => {
  const { store, file } = await fixture(t); await store.transactItem(request(), new Date(epoch)); const saved = JSON.parse(await fs.readFile(file)); edit(saved); const original = JSON.stringify(saved); await fs.writeFile(file, original);
  await assert.rejects(new EconomyStore(file).load()); assert.equal(await fs.readFile(file, 'utf8'), original);
});
test('shop schema enforces item IDs, prices, quantity and catalog limits', async (t) => {
  const { store } = await fixture(t);
  for (const extra of [{ id: 'Bad ID' }, { price: 0 }, { stock: -2 }, { title: '' }]) assert.throws(() => store.saveItem('create', item(extra)), /Invalid/);
  for (const quantity of [0, 101, 1.1]) assert.throws(() => store.transactItem(request({ quantity }), new Date(epoch)), /Invalid/);
  await assert.rejects(store.saveItem('create', item()), /new item/); await assert.rejects(store.saveItem('update', item({ id: 'absent' })), /existing/);
  for (let i = 1; i < LIMITS.items; i++) store.items.set(`${ids.guild}:item-${i}`, item({ id: `item-${i}` }));
  await assert.rejects(store.saveItem('create', item({ id: 'overflow' })), /limit/);
});
