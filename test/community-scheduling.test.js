'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CommunityStore, RETENTION_MS } = require('../src/community-store');
const { CommunityService } = require('../src/community-service');
const { createInteractionHandler } = require('../src/interactions');
const guildId = '123456789012345678';
const channelId = '223456789012345678';
const userId = '323456789012345678';
const messageId = '423456789012345678';
const otherUserId = '523456789012345678';
const id = '623456789012345678';
const config = { guildId, applicationId: '723456789012345678' };
const start = new Date('2026-10-09T12:00:00Z');
const next = new Date(start.getTime() + 60_000);
const data = { id, guildId, channelId, userId, text: 'Community event', minutes: 1 };

async function setup(t, options) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-community-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new CommunityStore(path.join(dir, 'community.json'), options);
  await store.load();
  return { store, dir };
}

test('reminders serialize concurrent writes, deduplicate IDs and enforce owner cancellation', async (t) => {
  const { store } = await setup(t);
  const jobs = await Promise.all(Array.from({ length: 10 }, (_, index) => store.create({ ...data, id: String(BigInt(id) + BigInt(index)), kind: 'reminder' }, start)));
  assert.equal(store.list(guildId, { kind: 'reminder', userId }).length, 10);
  await assert.rejects(store.create({ ...data, id: '823456789012345678', kind: 'reminder' }, start), /limit/);
  assert.equal((await store.create({ ...data, kind: 'reminder' }, start)).id, jobs[0].id);
  await assert.rejects(store.cancel({ id, guildId, userId: otherUserId, kind: 'reminder' }, start), /another member/);
  await store.cancel({ id, guildId, userId, kind: 'reminder' }, start);
  assert.equal(store.get(id).state, 'cancelled');
  const reload = new CommunityStore(store.filePath);
  await reload.load();
  assert.deepEqual(reload.get(id), store.get(id));
  assert.equal(reload.list('923456789012345678').length, 0);
});

test('failed durable job creation and entry writes roll back memory without mutating snapshots', async (t) => {
  const { store, dir } = await setup(t);
  await store.create({ ...data, kind: 'giveaway' }, start);
  await store.activate(id, messageId);
  const snapshot = store.get(id);
  snapshot.entrants.push(otherUserId);
  assert.equal(store.get(id).entrants.length, 0);
  const blocker = path.join(dir, 'blocker');
  await fs.writeFile(blocker, 'not a directory');
  const originalPath = store.filePath;
  store.filePath = path.join(blocker, 'community.json');
  await assert.rejects(store.enter({ id, guildId, channelId, messageId, userId }, start));
  assert.equal(store.get(id).entrants.length, 0);
  await assert.rejects(store.create({ ...data, id: otherUserId, kind: 'reminder' }, start));
  assert.equal(store.get(otherUserId), null);
  store.filePath = originalPath;
  assert.equal((await store.enter({ id, guildId, channelId, messageId, userId }, start)).status, 'entered');
});

test('corrupt and duplicate community records are preserved and rejected', async (t) => {
  const { store } = await setup(t);
  await store.create({ ...data, kind: 'reminder' }, start);
  const good = store.get(id);
  for (const records of [[{ ...good, secret: 'unexpected' }], [good, good], [{ ...good, state: 'finished' }]]) {
    const content = JSON.stringify({ version: 1, jobs: records });
    await fs.writeFile(store.filePath, content);
    await assert.rejects(new CommunityStore(store.filePath).load(), /invalid|duplicate/);
    assert.equal(await fs.readFile(store.filePath, 'utf8'), content);
  }
  await fs.writeFile(store.filePath, 'secret-fragment invalid JSON');
  await assert.rejects(new CommunityStore(store.filePath).load(), (error) => {
    assert.doesNotMatch(error.message, /secret-fragment/);
    return true;
  });
});

test('giveaway entries are unique, removable, message bound and closed at the deadline', async (t) => {
  const { store } = await setup(t);
  await store.create({ ...data, kind: 'giveaway' }, start);
  await store.activate(id, messageId);
  const entry = { id, guildId, channelId, messageId, userId };
  assert.equal((await store.enter(entry, start)).status, 'entered');
  assert.equal((await store.enter(entry, start)).status, 'already');
  assert.equal((await store.enter({ ...entry, leave: true }, start)).status, 'left');
  assert.equal((await store.enter({ ...entry, leave: true }, start)).status, 'not-entered');
  await assert.rejects(store.enter({ ...entry, messageId: otherUserId }, start), /closed|unavailable/);
  await assert.rejects(store.enter({ ...entry, guildId: otherUserId }, start), /closed|unavailable/);
  await assert.rejects(store.enter(entry, next), /closed/);
});

test('winners are selected without replacement and persist before failed result delivery', async (t) => {
  const { store } = await setup(t, { pick: () => 0 });
  let clock = start;
  let fail = true;
  const edits = [];
  const logs = [];
  const discord = { getGuildMember: async (guild, user) => ({ user: { id: user }, roles: [] }), createMessage: async () => ({ id: messageId }), editMessage: async (...args) => { edits.push(args); if (fail) throw new Error('secret should not be logged'); } };
  const service = new CommunityService({ config, store, discord, now: () => clock, logger: (...args) => logs.push(args) });
  await service.createGiveaway({ ...data, winnerCount: 2 });
  for (const entrant of [userId, otherUserId, '923456789012345678']) await service.enter({ id, channelId, messageId, userId: entrant });
  clock = next;
  await service.tick();
  assert.equal(store.get(id).state, 'drawn');
  assert.deepEqual(store.get(id).winners, [userId, otherUserId]);
  assert.equal(store.get(id).attempts, 1);
  assert.doesNotMatch(JSON.stringify(logs), /secret should/);
  const reload = new CommunityStore(store.filePath, { pick: () => { throw new Error('must not redraw'); } });
  await reload.load();
  const restarted = new CommunityService({ config, store: reload, discord, now: () => clock });
  fail = false;
  clock = new Date(next.getTime() + 15_000);
  await restarted.tick();
  assert.equal(reload.get(id).state, 'finished');
  assert.deepEqual(reload.get(id).winners, [userId, otherUserId]);
  assert.deepEqual(edits[1][2].components, []);
  assert.deepEqual(edits[1][2].allowed_mentions, { parse: [] });
});

test('reminders survive restart, retry failures with backoff and only mention their owner', async (t) => {
  const { store } = await setup(t);
  await store.create({ ...data, kind: 'reminder', text: '@everyone event' }, start);
  const reload = new CommunityStore(store.filePath);
  await reload.load();
  let clock = next;
  let fail = true;
  const calls = [];
  const service = new CommunityService({ config, store: reload, now: () => clock, discord: { createMessage: async (...args) => { calls.push(args); if (fail) throw new Error('offline'); } } });
  await service.tick();
  assert.equal(reload.get(id).state, 'scheduled');
  await service.tick();
  assert.equal(calls.length, 1);
  fail = false;
  clock = new Date(next.getTime() + 15_000);
  await service.tick();
  assert.equal(reload.get(id).state, 'sent');
  assert.equal(calls[1][0], channelId);
  assert.deepEqual(calls[1][1].allowed_mentions, { parse: [], users: [userId] });
  assert.equal(calls[1][1].nonce, id);
  assert.equal(calls[1][1].enforce_nonce, true);
  await service.tick();
  assert.equal(calls.length, 2);
});

test('failed giveaway publication remains recoverable and cancellation closes entry immediately', async (t) => {
  const { store } = await setup(t);
  let clock = start;
  let fail = true;
  const service = new CommunityService({ config, store, now: () => clock, discord: { createMessage: async () => { if (fail) throw new Error('offline'); return { id: messageId }; }, editMessage: async () => { throw new Error('offline'); } } });
  assert.equal((await service.createGiveaway(data)).state, 'draft');
  fail = false;
  clock = new Date(start.getTime() + 15_000);
  await service.tick();
  assert.equal(store.get(id).state, 'open');
  await service.cancelGiveaway(id);
  assert.equal(store.get(id).state, 'cancelled');
  assert.equal(store.get(id).deliveredAt, null);
  await assert.rejects(service.enter({ id, channelId, messageId, userId }), /closed/);
});

test('overlapping ticks coalesce and stop waits for a current delivery', async (t) => {
  const { store } = await setup(t);
  await store.create({ ...data, kind: 'reminder' }, start);
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const service = new CommunityService({ config, store, now: () => next, discord: { createMessage: async () => { calls++; await waiting; } } });
  const first = service.tick();
  assert.equal(service.tick(), first);
  await new Promise((resolve) => setImmediate(resolve));
  let drained = false;
  const stopped = service.stop().then(() => { drained = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  release();
  await stopped;
  assert.equal(calls, 1);
  await service.tick();
  assert.equal(calls, 1);
});

test('completed job retention is bounded and pending jobs are preserved', async (t) => {
  const { store } = await setup(t);
  await store.create({ ...data, kind: 'reminder' }, start);
  await store.cancel({ id, guildId, userId, kind: 'reminder' }, start);
  const future = new Date(start.getTime() + RETENTION_MS + 1);
  await store.create({ ...data, id: otherUserId, kind: 'reminder' }, future);
  assert.equal(store.get(id), null);
  assert.equal(store.get(otherUserId).state, 'scheduled');
  assert.equal(await store.prune(future), 0);
  await store.cancel({ id: otherUserId, guildId, userId, kind: 'reminder' }, future);
  assert.equal(await store.prune(new Date(future.getTime() + RETENTION_MS + 1)), 1);
});

test('reminder commands create publicly disclosed schedules and keep lists and cancellations private', async (t) => {
  const { store } = await setup(t);
  const edits = [];
  const discord = { editOriginalResponse: async (...args) => edits.push(args) };
  const community = new CommunityService({ config, store, discord, now: () => start });
  const handler = createInteractionHandler({ config, community, discord });
  const base = { type: 2, id, guild_id: guildId, channel_id: channelId, token: 'temporary-token', member: { user: { id: userId }, permissions: '0' } };
  const denied = await handler({ ...base, data: { name: 'reminder', options: [{ name: 'create' }] } });
  assert.match(denied.immediate.data.content, /Send Messages/);
  assert.equal(denied.work, undefined);
  const invoke = async (action, options = [], member = base.member) => {
    if (action === 'create') member = { ...member, permissions: '2048' };
    const result = await handler({ ...base, member, data: { name: 'reminder', options: [{ name: action, options }] } });
    assert.equal(result.immediate.data.flags, 64);
    await result.work();
    return edits.at(-1)[2].content;
  };
  assert.match(await invoke('create', [{ name: 'minutes', value: 10 }, { name: 'text', value: '@everyone event' }]), /posted publicly/);
  assert.match(await invoke('list'), /pending reminders/);
  assert.match(await invoke('cancel', [{ name: 'id', value: id }], { user: { id: otherUserId }, permissions: '0' }), /Could not/);
  assert.equal(store.get(id).state, 'scheduled');
  assert.match(await invoke('cancel', [{ name: 'id', value: id }]), /cancelled/);
  assert.match(await invoke('list'), /no pending/);
});

test('staff can inspect and end giveaways early without redrawing on a repeated end', async (t) => {
  const { store } = await setup(t, { pick: () => 0 });
  const edits = [];
  const discord = { getGuildMember: async (guild, user) => ({ user: { id: user }, roles: [] }), createMessage: async () => ({ id: messageId }), editMessage: async () => {}, editOriginalResponse: async (...args) => edits.push(args) };
  const community = new CommunityService({ config, store, discord, now: () => start });
  await community.createGiveaway(data);
  await community.enter({ id, channelId, messageId, userId });
  const handler = createInteractionHandler({ config, community, discord });
  const invoke = async (action) => {
    const result = await handler({ type: 2, id, guild_id: guildId, channel_id: channelId, token: 'temporary', member: { user: { id: userId }, permissions: '8192' }, data: { name: 'giveaway', options: [{ name: action, options: [{ name: 'id', value: id }] }] } });
    await result.work();
    return edits.at(-1)[2].content;
  };
  assert.match(await invoke('info'), /Entries: 1/);
  assert.match(await invoke('list'), /Active giveaways/);
  assert.match(await invoke('end'), /result is published/);
  assert.match(await invoke('end'), /result is published/);
  assert.deepEqual(store.get(id).winners, [userId]);
  assert.match(await invoke('info'), /finished/);
});

test('giveaway interactions enforce staff access, human entry and persisted message binding', async (t) => {
  const { store } = await setup(t);
  const edits = [];
  const discord = { getGuildMember: async (guild, user) => ({ user: { id: user }, roles: [] }), createMessage: async () => ({ id: messageId }), editOriginalResponse: async (...args) => edits.push(args), editMessage: async () => {} };
  const community = new CommunityService({ config, store, discord, now: () => start });
  const handler = createInteractionHandler({ config, community, discord });
  const base = { type: 2, id, guild_id: guildId, channel_id: channelId, token: 'transient-secret', member: { user: { id: userId }, permissions: '0' } };
  const command = { ...base, data: { name: 'giveaway', options: [{ name: 'create', options: [{ name: 'prize', value: 'A game' }, { name: 'minutes', value: 1 }] }] } };
  assert.match((await handler(command)).immediate.data.content, /Manage Messages/);
  const created = await handler({ ...command, member: { ...base.member, permissions: '8192' } });
  assert.equal(created.immediate.data.flags, 64);
  await created.work();
  const button = { ...base, type: 3, message: { id: messageId }, data: { custom_id: `giveaway:enter:${id}` } };
  await (await handler(button)).work();
  assert.equal(store.get(id).entrants.length, 1);
  assert.match((await handler({ ...button, member: { user: { id: otherUserId, bot: true } } })).immediate.data.content, /human/);
  await (await handler({ ...button, message: { id: otherUserId } })).work();
  assert.match(edits.at(-1)[2].content, /Could not/);
  assert.doesNotMatch(await fs.readFile(store.filePath, 'utf8'), /transient-secret/);
});
