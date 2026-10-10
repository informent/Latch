'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { directory, ids, epoch } = require('./feature-fixtures');
const { EconomyStore } = require('../src/economy-store');

test('economy readers see only committed balances while a transfer is writing', async (t) => {
  const store = new EconomyStore(path.join(await directory(t), 'coins.json'));
  await store.claim(ids.guild, ids.user, 'daily', new Date(epoch));
  const original = fs.rename; let release; let entered;
  const writing = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  fs.rename = async (...args) => { entered(); await gate; return original(...args); };
  const transfer = store.transfer(ids.guild, ids.user, ids.actor, 40);
  let before;
  try { await writing; before = [store.balance(ids.guild, ids.user), store.balance(ids.guild, ids.actor)]; }
  finally { release(); await transfer; fs.rename = original; }
  assert.deepEqual(before, [100, 0]);
  assert.deepEqual([store.balance(ids.guild, ids.user), store.balance(ids.guild, ids.actor)], [60, 40]);
});
test('beg claims serialize, zero rewards consume cooldown and reload retains readiness', async (t) => {
  const root = await directory(t); const file = path.join(root, 'coins.json'); const store = new EconomyStore(file, { rollBeg: () => 0 }); await store.load();
  const claims = await Promise.all(Array.from({ length: 20 }, () => store.claim(ids.guild, ids.user, 'beg', new Date(epoch))));
  assert.equal(claims.filter((claim) => claim.claimed).length, 1); assert.equal(store.balance(ids.guild, ids.user), 0);
  const reloaded = new EconomyStore(file); await reloaded.load(); assert.equal((await reloaded.claim(ids.guild, ids.user, 'beg', new Date(epoch + 899999))).claimed, false);
  assert.equal((await reloaded.claim(ids.guild, ids.user, 'beg', new Date(epoch + 900000))).claimed, true);
});
test('profession ranks use previous rank bonus, persist, and cannot bypass work/change cooldowns', async (t) => {
  const root = await directory(t); const store = new EconomyStore(path.join(root, 'coins.json'), { rollWork: () => 25 });
  await store.chooseProfession(ids.guild, ids.user, 'developer', new Date(epoch));
  for (let index = 0; index < 41; index++) {
    const result = await store.claim(ids.guild, ids.user, 'work', new Date(epoch + index * 3600000));
    assert.equal(result.bonus, Math.min(5, 1 + Math.floor(index / 10)) * 5); assert.equal(result.profession.rank, Math.min(5, 1 + Math.floor((index + 1) / 10)));
  }
  const copy = store.profile(ids.guild, ids.user); copy.profession.works = 0; assert.equal(store.profile(ids.guild, ids.user).profession.works, 41);
  assert.equal((await store.chooseProfession(ids.guild, ids.user, 'developer', new Date(epoch))).unchanged, true);
  assert.equal((await store.chooseProfession(ids.guild, ids.user, 'artist', new Date(epoch + 1000))).claimed, false);
  await store.chooseProfession(ids.guild, ids.user, 'artist', new Date(epoch + 41 * 3600000)); assert.equal(store.profile(ids.guild, ids.user).profession.works, 0);
  assert.equal((await store.claim(ids.guild, ids.user, 'work', new Date(epoch + 40 * 3600000 + 1))).claimed, false);
  const reloaded = new EconomyStore(store.filePath); await reloaded.load(); assert.equal(reloaded.profile(ids.guild, ids.user).profession.name, 'artist');
  const leader = reloaded.leaderboard(ids.guild)[0]; leader.profession.name = 'builder'; assert.equal(reloaded.profile(ids.guild, ids.user).profession.name, 'artist');
});
test('economy invalid rewards and failed profession writes cannot poison balances', async (t) => {
  const root = await directory(t); const store = new EconomyStore(path.join(root, 'coins.json'), { rollBeg: () => -1, rollWork: () => 101 });
  await assert.rejects(store.claim(ids.guild, ids.user, 'beg', new Date(epoch))); await assert.rejects(store.claim(ids.guild, ids.user, 'work', new Date(epoch))); assert.equal(store.balance(ids.guild, ids.user), 0);
  await assert.rejects(store.chooseProfession(ids.guild, ids.user, 'invalid', new Date(epoch)));
  const blocked = path.join(root, 'blocked.json'); await fs.mkdir(blocked); store.filePath = blocked;
  await assert.rejects(store.chooseProfession(ids.guild, ids.user, 'builder', new Date(epoch))); assert.equal(store.profile(ids.guild, ids.user).profession, undefined);
});
for (const [name, metadata] of [['negative works', { name: 'artist', works: -1, changedAt: new Date(epoch).toISOString() }], ['unknown profession', { name: 'unknown', works: 0, changedAt: new Date(epoch).toISOString() }], ['unknown property', { name: 'artist', works: 0, changedAt: new Date(epoch).toISOString(), rank: 999 }]]) {
  test(`economy load rejects ${name}`, async (t) => {
    const root = await directory(t); const file = path.join(root, 'coins.json');
    await fs.writeFile(file, JSON.stringify({ version: 1, accounts: [{ guildId: ids.guild, userId: ids.user, balance: 0, lastDaily: null, lastWork: null, profession: metadata }] }));
    await assert.rejects(new EconomyStore(file).load());
  });
}
