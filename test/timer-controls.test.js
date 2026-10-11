'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { directory, ids, epoch, fakeDiscord, interaction } = require('./feature-fixtures');
const { TimerStore } = require('../src/timer-store');
const { TimerService } = require('../src/timer-service');
const { createInteractionHandler } = require('../src/interactions');

async function fixture(t) {
  const root = await directory(t);
  const store = new TimerStore(path.join(root, 'timers.json'), ids.guild);
  const f = fakeDiscord(); let time = epoch;
  const config = { guildId: ids.guild, applicationId: ids.bot };
  const timers = new TimerService({ config, store, discord: f.discord, now: () => time });
  t.after(() => timers.stop());
  await timers.change('create', { name: 'notice', text: '@everyone notice', interval: 10, channelId: ids.channel });
  await timers.change('enable', { name: 'notice' });
  f.channels.set(ids.menu, { id: ids.menu, guild_id: ids.guild, type: 0 });
  const handler = createInteractionHandler({ config, ...f, timers, logger: () => {} });
  async function run(action, values, permissions = '32') {
    const result = await handler(interaction('timer', action, { name: 'notice', ...values }, permissions));
    assert.equal(result.immediate.data.flags, 64);
    if (result.work) await result.work();
    return f.calls.filter(([kind]) => kind === 'response').at(-1)?.[3] || result.immediate.data;
  }
  return { ...f, store, timers, run, advance: (ms) => { time += ms; } };
}

test('reschedule persists only a new deadline and resumes the original interval after delivery', async (t) => {
  const f = await fixture(t); const before = f.store.get('notice');
  const reply = await f.run('reschedule', { minutes: 5 });
  assert.match(reply.content, /rescheduled/); assert.deepEqual(reply.allowed_mentions, { parse: [] });
  assert.deepEqual(f.store.get('notice'), { ...before, nextAt: epoch + 300000 });
  const reopened = new TimerStore(f.store.filePath, ids.guild); await reopened.load();
  assert.deepEqual(reopened.get('notice'), f.store.get('notice'));
  f.advance(299999); await f.timers.tick(); assert.equal(f.calls.filter(([k]) => k === 'message').length, 0);
  f.advance(1); await f.timers.tick(); assert.equal(f.calls.filter(([k]) => k === 'message').length, 1);
  assert.equal(f.store.get('notice').nextAt, epoch + 900000);
});

for (const minutes of [undefined, null, '5', 4, 43201, 5.5, Infinity, NaN]) {
  test(`reschedule rejects invalid delay ${String(minutes)} without changing state`, async (t) => {
    const f = await fixture(t); const before = f.store.list();
    await assert.rejects(f.timers.change('reschedule', { name: 'notice', minutes }));
    assert.deepEqual(f.store.list(), before);
  });
}
test('reschedule rejects disabled and missing timers and accepts the upper delay boundary', async (t) => {
  const f = await fixture(t);
  await f.timers.change('reschedule', { name: 'notice', minutes: 43200 });
  assert.equal(f.store.get('notice').nextAt, epoch + 43200 * 60000);
  await f.timers.change('disable', { name: 'notice' });
  await assert.rejects(f.timers.change('reschedule', { name: 'notice', minutes: 5 }));
  await assert.rejects(f.timers.change('reschedule', { name: 'missing', minutes: 5 }));
  assert.equal(f.store.get('notice').nextAt, 0);
});

test('move preserves content and history, disables, persists and delivers only after enable', async (t) => {
  const f = await fixture(t); f.advance(600000); await f.timers.tick(); const before = f.store.get('notice');
  const reply = await f.run('move', { channel: ids.menu }); assert.match(reply.content, /disabled/);
  assert.deepEqual(f.store.get('notice'), { ...before, channelId: ids.menu, enabled: false, nextAt: 0 });
  const reopened = new TimerStore(f.store.filePath, ids.guild); await reopened.load(); assert.deepEqual(reopened.list(), f.store.list());
  f.advance(600000); await f.timers.tick(); assert.equal(f.calls.filter(([k]) => k === 'message').length, 1);
  await f.timers.change('enable', { name: 'notice' }); f.advance(600000); await f.timers.tick();
  assert.equal(f.calls.filter(([k]) => k === 'message').at(-1)[1], ids.menu);
});
for (const [name, mutate] of [
  ['foreign guild', c => { c.guild_id = ids.owner; }],
  ['wrong identity', c => { c.id = ids.channel; }],
  ...[1, 2, 4, 5, 10, 11, 15].map(type => [`type ${type}`, c => { c.type = type; }])
]) test(`move rejects ${name} without mutation`, async (t) => {
  const f = await fixture(t); mutate(f.channels.get(ids.menu)); const before = f.store.list();
  assert.match((await f.run('move', { channel: ids.menu })).content, /failed/); assert.deepEqual(f.store.list(), before);
});
for (const action of ['move', 'reschedule']) test(`${action} rejects nonstaff before API or store work`, async (t) => {
  const f = await fixture(t); const before = f.store.list();
  assert.match((await f.run(action, { channel: ids.menu, minutes: 5 }, '0')).content, /Manage Server/);
  assert.deepEqual(f.store.list(), before); assert.equal(f.calls.length, 0);
});
test('move rejects malformed channel IDs before API access', async (t) => {
  const f = await fixture(t); const before = f.store.list();
  assert.match((await f.run('move', { channel: '../secret' })).content, /failed/);
  assert.equal(f.calls.filter(([k]) => k === 'GET').length, 0); assert.deepEqual(f.store.list(), before);
});
test('move failure does not expose a remote error', async (t) => {
  const f = await fixture(t); f.discord.request = async () => { throw new Error('secret-token'); };
  const before = f.store.list(); const reply = await f.run('move', { channel: ids.menu });
  assert.match(reply.content, /failed/); assert.ok(!reply.content.includes('secret-token')); assert.deepEqual(f.store.list(), before);
});
for (const action of ['move', 'reschedule']) test(`${action} waits for an active delivery to finish`, async (t) => {
  const f = await fixture(t); let release; let started;
  const entered = new Promise(resolve => { started = resolve; }); const held = new Promise(resolve => { release = resolve; });
  f.discord.createMessage = async () => { started(); await held; return { id: ids.message }; };
  f.advance(600000); const tick = f.timers.tick(); await entered;
  let changed = false;
  const pending = f.timers.change(action, { name: 'notice', channelId: ids.menu, minutes: 5 }).then(() => { changed = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(changed, false);
  release(); await Promise.all([tick, pending]); assert.equal(f.store.get('notice').lastResult, 'sent');
  assert.equal(f.store.get('notice').nextAt, action === 'move' ? 0 : epoch + 900000);
});
