'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EconomyStore } = require('../src/economy-store');

const guildId = '123456789012345678';
const alice = '223456789012345678';
const bob = '323456789012345678';

test('daily and work rewards persist and enforce their cooldowns', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-economy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EconomyStore(path.join(root, 'economy.json'), { rollWork: () => 50 });
  await store.load();
  const first = await store.claim(guildId, alice, 'daily', new Date('2026-10-09T00:00:00.000Z'));
  assert.deepEqual(first, { claimed: true, reward: 100, balance: 100 });
  const blocked = await store.claim(guildId, alice, 'daily', new Date('2026-10-09T01:00:00.000Z'));
  assert.equal(blocked.claimed, false);
  assert.equal(blocked.nextAt, '2026-10-10T00:00:00.000Z');
  assert.equal((await store.claim(guildId, alice, 'work', new Date('2026-10-09T01:00:00.000Z'))).balance, 150);
  assert.equal(store.balance(guildId, alice), 150);
  const reloaded = new EconomyStore(path.join(root, 'economy.json'));
  await reloaded.load();
  assert.equal(reloaded.balance(guildId, alice), 150);
});

test('concurrent transfers cannot overspend and leaderboard is ordered per server', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-economy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EconomyStore(path.join(root, 'economy.json'));
  await store.load();
  await store.claim(guildId, alice, 'daily', new Date('2026-10-09T00:00:00.000Z'));
  const attempts = await Promise.allSettled([
    store.transfer(guildId, alice, bob, 80),
    store.transfer(guildId, alice, '423456789012345678', 80)
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 1);
  assert.equal(store.balance(guildId, alice), 20);
  assert.deepEqual(store.leaderboard(guildId, 2).map((account) => account.balance), [80, 20]);
  assert.equal(await store.transfer(guildId, alice, alice, 1).catch((error) => error.message), 'You cannot transfer coins to yourself.');
});

test('refuses malformed economy data without replacing the source file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-economy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'economy.json');
  const original = '{"version":1,"accounts":[{"balance":-1}]}\n';
  await fs.writeFile(file, original);
  await assert.rejects(new EconomyStore(file).load(), /invalid records/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('failed durable transfers roll back both balances and failed claims roll back cooldowns', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-economy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EconomyStore(path.join(root, 'economy.json'));
  await store.load();
  const now = new Date('2026-10-09T00:00:00Z');
  await store.claim(guildId, alice, 'daily', now);
  const blocker = path.join(root, 'blocker');
  await fs.writeFile(blocker, 'not a directory');
  store.filePath = path.join(blocker, 'economy.json');
  await assert.rejects(store.transfer(guildId, alice, bob, 80));
  assert.equal(store.balance(guildId, alice), 100);
  assert.equal(store.balance(guildId, bob), 0);
  await assert.rejects(store.claim(guildId, bob, 'daily', now));
  assert.equal(store.balance(guildId, bob), 0);
  store.filePath = path.join(root, 'economy.json');
  assert.equal((await store.claim(guildId, bob, 'daily', now)).claimed, true);
});
