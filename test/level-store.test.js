'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LevelStore, XP_COOLDOWN_MS, MAX_LEVEL_ACCOUNTS } = require('../src/level-store');

const guild = '123456789012345678';
const member = '223456789012345678';

test('awards XP with a cooldown, computes levels, and persists without message content', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-levels-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let now = Date.parse('2026-10-09T00:00:00.000Z');
  const file = path.join(root, 'levels.json');
  const store = new LevelStore(file, { now: () => now });
  await store.load();
  const first = await store.awardMessage(guild, member);
  assert.equal(first.awarded, true);
  assert.equal(first.xp, 15);
  assert.equal(first.level, 0);
  const throttled = await store.awardMessage(guild, member);
  assert.equal(throttled.awarded, false);
  assert.equal(store.accounts.size, 1);
  now += XP_COOLDOWN_MS;
  const next = await store.awardMessage(guild, member);
  assert.equal(next.xp, 30);
  assert.equal(next.xpToNextLevel, 70);
  assert.equal(await fs.readFile(file, 'utf8').then((text) => text.includes('content')), false);
  const reloaded = new LevelStore(file, { now: () => now + XP_COOLDOWN_MS });
  await reloaded.load();
  assert.equal(reloaded.get(guild, member).xp, 30);
});

test('levels only leaderboard is guild scoped and corrupt records are preserved', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-levels-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'levels.json');
  const store = new LevelStore(file, { now: () => Date.parse('2026-10-09T00:00:00.000Z') });
  await store.load();
  await Promise.all([store.awardMessage(guild, member), store.awardMessage(guild, '323456789012345678'), store.awardMessage('423456789012345678', member)]);
  assert.deepEqual(store.leaderboard(guild).map((account) => account.userId), [member, '323456789012345678']);
  const original = '{"version":1,"accounts":[{"xp":-1}]}\n';
  await fs.writeFile(file, original);
  await assert.rejects(new LevelStore(file).load(), /invalid records/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('account limit rejects a new member without changing existing balances', async () => {
  const store = new LevelStore('unused.json');
  for (let index = 0; index < MAX_LEVEL_ACCOUNTS; index++) {
    const userId = String(100000000000000000n + BigInt(index));
    store.accounts.set(`${guild}:${userId}`, Object.freeze({ guildId: guild, userId, xp: 15, lastAward: '2026-10-09T00:00:00.000Z' }));
  }
  await assert.rejects(store.awardMessage(guild, '999999999999999999'), /account limit/);
  assert.equal(store.accounts.size, MAX_LEVEL_ACCOUNTS);
  assert.equal(store.get(guild, member).xp, 0);
});

test('failed durable XP write rolls back the in-memory award', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-levels-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const blockedParent = path.join(root, 'is-a-directory');
  await fs.mkdir(blockedParent);
  const blockedPath = path.join(blockedParent, 'levels.json');
  const store = new LevelStore(blockedPath, { now: () => Date.parse('2026-10-09T00:00:00.000Z') });
  await store.load();
  await fs.rm(blockedParent, { recursive: true });
  await fs.writeFile(blockedParent, 'parent path is now a file');
  await assert.rejects(store.awardMessage(guild, member));
  assert.equal(store.accounts.size, 0);
  assert.equal(store.get(guild, member).xp, 0);
});
