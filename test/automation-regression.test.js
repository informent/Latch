'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { directory, ids, epoch, fakeDiscord } = require('./feature-fixtures');
const { ResponderStore } = require('../src/responder-store');
const { ResponderService } = require('../src/responder-service');
const { TimerStore } = require('../src/timer-store');
const { TimerService } = require('../src/timer-service');

async function responderFixture(t) {
  const root = await directory(t); const store = new ResponderStore(path.join(root, 'responders.json'), ids.guild); await store.load();
  await store.change('create', { name: 'hello', channelId: ids.channel, trigger: 'hello', reply: '@everyone Hello', cooldown: 15 }); await store.change('enable', { name: 'hello' });
  const fixture = fakeDiscord(); let time = epoch; const logs = [];
  const service = new ResponderService({ config: { guildId: ids.guild, respondersEnabled: true }, store, discord: fixture.discord, now: () => time, logger: (...args) => logs.push(args) });
  const message = { id: ids.message, guild_id: ids.guild, channel_id: ids.channel, author: { id: ids.user }, type: 0, content: ' HELLO ', timestamp: new Date(time).toISOString() };
  return { ...fixture, service, store, message, logs, advance: (ms) => { time += ms; message.timestamp = new Date(time).toISOString(); } };
}
test('responders deliver exact normalized human matches and retain cooldown through reload', async (t) => {
  const f = await responderFixture(t); await f.service.dispatch('MESSAGE_CREATE', f.message);
  const sent = f.calls.find(([kind]) => kind === 'message'); assert.deepEqual(sent[2].allowed_mentions, { parse: [] }); assert.equal(sent[2].enforce_nonce, true);
  await f.service.dispatch('MESSAGE_CREATE', f.message); assert.equal(f.calls.filter(([kind]) => kind === 'message').length, 1);
  f.advance(16000); f.message.id = ids.menu; await f.service.dispatch('MESSAGE_CREATE', f.message); assert.equal(f.calls.filter(([kind]) => kind === 'message').length, 2);
  const restarted = new ResponderStore(f.store.filePath, ids.guild); await restarted.load(); assert.equal(restarted.get('hello').lastMessageId, ids.menu);
});
for (const [name, mutate] of [
  ['bot', (m) => { m.author.bot = true; }], ['webhook', (m) => { m.webhook_id = ids.bot; }], ['reply', (m) => { m.type = 19; }],
  ['wrong guild', (m) => { m.guild_id = ids.owner; }], ['wrong channel', (m) => { m.channel_id = ids.lobby; }],
  ['substring', (m) => { m.content = 'hello there'; }], ['stale', (m) => { m.timestamp = new Date(epoch - 120001).toISOString(); }],
  ['future', (m) => { m.timestamp = new Date(epoch + 5001).toISOString(); }], ['invalid timestamp', (m) => { m.timestamp = 'invalid'; }],
  ['missing author', (m) => { delete m.author; }], ['oversized content', (m) => { m.content = 'x'.repeat(2001); }]
]) test(`responders ignore ${name} events`, async (t) => { const f = await responderFixture(t); mutate(f.message); await f.service.dispatch('MESSAGE_CREATE', f.message); assert.equal(f.calls.length, 0); assert.equal(f.store.get('hello').lastAt, 0); });
test('responder failed delivery consumes cooldown without logging message content', async (t) => {
  const f = await responderFixture(t); f.discord.createMessage = async () => { throw new Error('private body and token'); };
  await f.service.dispatch('MESSAGE_CREATE', f.message); assert.equal(f.store.get('hello').lastAt, epoch); assert.ok(!JSON.stringify(f.logs).includes('private body'));
});
test('concurrent responder events cannot bypass process-wide rate guard', async (t) => {
  const f = await responderFixture(t);
  await f.store.change('create', { name: 'next', channelId: ids.lobby, trigger: 'hello', reply: 'Next', cooldown: 15 }); await f.store.change('enable', { name: 'next' });
  await Promise.all([f.service.dispatch('MESSAGE_CREATE', f.message), f.service.dispatch('MESSAGE_CREATE', { ...f.message, channel_id: ids.lobby, id: ids.menu })]);
  assert.equal(f.calls.filter(([kind]) => kind === 'message').length, 1);
});
async function timerFixture(t) {
  const root = await directory(t); const store = new TimerStore(path.join(root, 'timers.json'), ids.guild); await store.load();
  const fixture = fakeDiscord(); let time = epoch;
  const service = new TimerService({ config: { guildId: ids.guild }, store, discord: fixture.discord, now: () => time }); t.after(() => service.stop());
  await service.change('create', { name: 'hello', channelId: ids.channel, text: '@everyone Hello', interval: 5 }); await service.change('enable', { name: 'hello' });
  return { ...fixture, service, store, advance: (ms) => { time += ms; } };
}
test('timer due claim advances before send, coalesces tick calls and has no catch-up burst', async (t) => {
  const f = await timerFixture(t); await f.service.tick(); assert.equal(f.calls.length, 0); f.advance(3600000);
  const one = f.service.tick(); const two = f.service.tick(); assert.equal(one, two); await one;
  const sent = f.calls.find(([kind]) => kind === 'message'); assert.deepEqual(sent[2].allowed_mentions, { parse: [] }); assert.equal(f.store.get('hello').lastResult, 'sent');
  await f.service.tick(); assert.equal(f.calls.filter(([kind]) => kind === 'message').length, 1); assert.equal(f.store.get('hello').nextAt, epoch + 3900000);
});
test('timer failure persists failed status, wrong guild blocks send, stop blocks later ticks', async (t) => {
  const f = await timerFixture(t); f.channels.get(ids.channel).guild_id = ids.owner; f.advance(300000); await f.service.tick();
  assert.equal(f.store.get('hello').lastResult, 'failed'); assert.equal(f.calls.filter(([kind]) => kind === 'message').length, 0);
  const restarted = new TimerStore(f.store.filePath, ids.guild); await restarted.load(); assert.equal(restarted.get('hello').lastResult, 'failed');
  await f.service.stop(); f.advance(300000); await f.service.tick(); assert.equal(f.calls.length, 1);
});
test('timer disable waits for an in-flight delivery and shutdown drains it', async (t) => {
  const f = await timerFixture(t); let release; const hold = new Promise((resolve) => { release = resolve; }); let entered;
  const started = new Promise((resolve) => { entered = resolve; }); const original = f.discord.createMessage;
  f.discord.createMessage = async (...args) => { entered(); await hold; return original(...args); };
  f.advance(300000); const tick = f.service.tick(); await started; const disable = f.service.change('disable', { name: 'hello' });
  let stopped = false; const stop = f.service.stop().then(() => { stopped = true; }); await Promise.resolve(); assert.equal(stopped, false);
  release(); await Promise.all([tick, disable, stop]); assert.equal(f.store.get('hello').enabled, false); assert.equal(f.store.get('hello').lastResult, 'sent');
});
