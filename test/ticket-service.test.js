'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { TicketStore } = require('../src/ticket-store');
const { TicketService, PERMISSIONS, CHAT, BOT } = require('../src/ticket-service');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new TicketStore(path.join(dir, 'tickets.json'));
  await store.load();
  const calls = [];
  let channelNumber = 678;
  const channels = new Map();
  const discord = {
    createChannel: async (guild, payload) => { calls.push(['createChannel', payload]); await new Promise((resolve) => setTimeout(resolve, 10)); const id = `223456789012345${String(channelNumber++).padStart(3, '0')}`; channels.set(id, { id, guild_id: guild, ...structuredClone(payload) }); return { id }; },
    setMemberOverwrite: async (id, user, body) => { calls.push(['overwrite', id, user, body]); const channel = channels.get(id); channel.permission_overwrites = channel.permission_overwrites.filter((entry) => entry.id !== user || entry.type !== 1); channel.permission_overwrites.push({ id: user, ...body }); },
    editChannel: async (id, body) => { calls.push(['editChannel', id, body]); Object.assign(channels.get(id), structuredClone(body)); },
    request: async (method, route) => { calls.push(['request', method, route]); if (method === 'GET') return structuredClone(channels.get(route.split('/').pop())); if (method === 'DELETE') channels.delete(route.split('/').pop()); }
  };
  const config = { guildId: '123456789012345678', supportRoleId: '323456789012345678', categoryId: null };
  const tickets = new TicketService({ config, store, discord, botUserId: '423456789012345678', now: () => new Date('2026-10-04T00:00:00.000Z') });
  return { dir, store, calls, discord, config, tickets };
}

test('creates private channel with minimum permission overwrites and one active ticket per user', async (t) => {
  const { tickets, calls, store, dir } = await fixture(t);
  const user = { id: '523456789012345678', username: 'Helpful Person' };
  const [first, second] = await Promise.all([tickets.create(user), tickets.create(user)]);
  assert.equal(calls.filter(([name]) => name === 'createChannel').length, 1);
  assert.equal(first.channelId, second.channelId);
  assert.equal([first.created, second.created].filter(Boolean).length, 1);
  const channelPayload = calls[0][1];
  assert.equal(channelPayload.name, 'ticket-helpful-person-5678');
  const everyone = channelPayload.permission_overwrites.find((item) => item.id === '123456789012345678');
  assert.equal(everyone.deny, String(PERMISSIONS.VIEW_CHANNEL));
  assert.equal(channelPayload.permission_overwrites.find((item) => item.id === user.id).allow, CHAT.toString());
  assert.equal(channelPayload.permission_overwrites.find((item) => item.id === '423456789012345678').allow, BOT.toString());
  assert.equal((BOT & PERMISSIONS.MANAGE_ROLES) !== 0n, true);
  const file = JSON.parse(await fs.readFile(path.join(dir, 'tickets.json'), 'utf8'));
  assert.deepEqual(Object.keys(file.tickets[0]).sort(), ['channelId', 'createdAt', 'ownerId', 'status']);
});

test('deletes the just-created channel if durable state cannot be recorded', async (t) => {
  const { discord, calls, config } = await fixture(t);
  const store = {
    withUserLock: (_userId, operation) => operation(),
    findActiveByOwner: () => null,
    add: async () => { throw new Error('simulated disk failure'); }
  };
  const tickets = new TicketService({ config, store, discord, botUserId: '423456789012345678' });
  await assert.rejects(tickets.create({ id: '523456789012345678', username: 'Member' }), /simulated disk failure/);
  assert.deepEqual(calls.find(([name]) => name === 'request').slice(1), ['DELETE', '/channels/223456789012345678']);
});

test('reports the orphan channel if both state persistence and Discord cleanup fail', async (t) => {
  const { discord, config } = await fixture(t);
  discord.request = async () => { throw new Error('simulated cleanup outage'); };
  const store = {
    withUserLock: (_userId, operation) => operation(),
    findActiveByOwner: () => null,
    add: async () => { throw new Error('simulated disk failure'); }
  };
  const tickets = new TicketService({ config, store, discord, botUserId: '423456789012345678' });
  await assert.rejects(tickets.create({ id: '523456789012345678', username: 'Member' }), (error) => {
    assert.match(error.message, /state could not be saved and Discord cleanup failed/);
    assert.match(error.message, /223456789012345678/);
    assert.equal(error.cause.message, 'simulated disk failure');
    return true;
  });
});

test('only owner, support, or administrator can close; owner becomes read-only', async (t) => {
  const { tickets, calls, store } = await fixture(t);
  const user = { id: '523456789012345678', username: 'Member' };
  await tickets.create(user);
  const denied = await tickets.close({ channelId: '223456789012345678', userId: '623456789012345678' });
  assert.equal(denied.ok, false);
  const closed = await tickets.close({ channelId: '223456789012345678', userId: user.id });
  assert.equal(closed.ok, true);
  assert.equal(store.getByChannel('223456789012345678').status, 'closed');
  const outsiderAfterClose = await tickets.close({ channelId: '223456789012345678', userId: '623456789012345678' });
  assert.equal(outsiderAfterClose.ok, false);
  const overwrite = calls.find(([name]) => name === 'overwrite');
  assert.equal(overwrite[3].allow, String(PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.READ_MESSAGE_HISTORY));
  assert.equal(overwrite[3].deny, String(PERMISSIONS.SEND_MESSAGES));
});

test('support role and Administrator permission can close a ticket', async (t) => {
  const { tickets } = await fixture(t);
  await tickets.create({ id: '523456789012345678', username: 'Member' });
  assert.equal((await tickets.close({ channelId: '223456789012345678', userId: '623456789012345678', roles: ['323456789012345678'] })).ok, true);
  await tickets.create({ id: '523456789012345679', username: 'Another' });
  assert.equal((await tickets.close({ channelId: '223456789012345679', userId: '623456789012345678', permissions: '8' })).ok, true);
});

test('a transient permission API failure persists closing state and allows retry after restart', async (t) => {
  const { tickets, discord, store, config, dir } = await fixture(t);
  await tickets.create({ id: '523456789012345678', username: 'Member' });
  const setOverwrite = discord.setMemberOverwrite;
  let failOnce = true;
  discord.setMemberOverwrite = async (...args) => {
    if (failOnce) { failOnce = false; throw new Error('simulated Discord outage'); }
    return setOverwrite(...args);
  };
  await assert.rejects(tickets.close({ channelId: '223456789012345678', userId: '523456789012345678' }), /simulated Discord outage/);
  assert.equal(store.getByChannel('223456789012345678').status, 'closing');
  const restartedStore = new TicketStore(path.join(dir, 'tickets.json'));
  await restartedStore.load();
  const restartedService = new TicketService({ config, store: restartedStore, discord, botUserId: '423456789012345678' });
  assert.equal((await restartedService.close({ channelId: '223456789012345678', userId: '523456789012345678' })).ok, true);
  assert.equal(restartedStore.getByChannel('223456789012345678').status, 'closed');
});

test('a channel rename failure keeps local state retryable after permission update', async (t) => {
  const { tickets, discord, store } = await fixture(t);
  await tickets.create({ id: '523456789012345678', username: 'Member' });
  const editChannel = discord.editChannel;
  let failOnce = true;
  discord.editChannel = async (...args) => {
    if (failOnce) { failOnce = false; throw new Error('simulated rename failure'); }
    return editChannel(...args);
  };
  await assert.rejects(tickets.close({ channelId: '223456789012345678', userId: '523456789012345678' }), /simulated rename failure/);
  assert.equal(store.getByChannel('223456789012345678').status, 'closing');
  const duplicate = await tickets.create({ id: '523456789012345678', username: 'Member' });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.channelId, '223456789012345678');
  assert.equal((await tickets.close({ channelId: '223456789012345678', userId: '523456789012345678' })).ok, true);
  assert.equal(store.getByChannel('223456789012345678').status, 'closed');
});

test('a persisted open ticket blocks duplicate creation after restart', async (t) => {
  const first = await fixture(t);
  await first.tickets.create({ id: '523456789012345678', username: 'Member' });
  const store = new TicketStore(path.join(first.dir, 'tickets.json'));
  await store.load();
  let created = 0;
  const restarted = new TicketService({ config: first.config, store, discord: { createChannel: async () => { created++; } }, botUserId: '423456789012345678' });
  const result = await restarted.create({ id: '523456789012345678', username: 'Member' });
  assert.equal(result.created, false);
  assert.equal(created, 0);
});
