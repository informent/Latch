'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TicketStore } = require('../src/ticket-store');
const { TicketService } = require('../src/ticket-service');
const { createInteractionHandler } = require('../src/interactions');
const { ids, epoch, directory, fakeDiscord, interaction } = require('./feature-fixtures');
async function fixture(t) {
  const root = await directory(t), store = new TicketStore(path.join(root, 'tickets.json')), fake = fakeDiscord();
  const records = Array.from({ length: 24 }, (_, index) => {
    const status = ['open', 'closing', 'closed', 'reopening'][index % 4];
    return { channelId: String(BigInt(ids.channel) + BigInt(index)), ownerId: String(BigInt(ids.user) + BigInt(index)), status, createdAt: new Date(epoch + index).toISOString(), ...(['closed', 'reopening'].includes(status) ? { closedAt: new Date(epoch + 1000).toISOString() } : {}), ...(index % 3 === 0 ? { claimedBy: ids.actor } : {}) };
  });
  for (const record of records) await store.add(record);
  const config = { guildId: ids.guild, applicationId: ids.bot, supportRoleId: ids.actorRole }, tickets = new TicketService({ config, store, discord: fake.discord, botUserId: ids.bot });
  return { root, store, fake, config, tickets, records, staff: { userId: ids.actor, roles: [ids.actorRole], permissions: '0' }, member: { userId: ids.user, roles: [], permissions: '0' } };
}
for (const state of ['active', 'open', 'closing', 'closed', 'reopening', 'all']) test(`queue filters ${state} records without mutating them`, async t => {
  const f = await fixture(t), before = await fs.readFile(f.store.filePath, 'utf8'), result = f.tickets.list({ ...f.staff, state }), expected = f.records.filter(record => state === 'all' || state === 'active' && record.status !== 'closed' || record.status === state);
  assert.equal(result.ok, true); assert.equal(result.total, expected.length); assert.deepEqual(result.tickets, expected.slice(0, 10)); assert.equal(await fs.readFile(f.store.filePath, 'utf8'), before); assert.equal(f.fake.calls.length, 0);
});
for (const assignment of ['all', 'assigned', 'unassigned']) test(`queue filters ${assignment} assignments`, async t => {
  const f = await fixture(t), result = f.tickets.list({ ...f.staff, state: 'all', assignment }), expected = f.records.filter(record => assignment === 'all' || (assignment === 'assigned' ? Boolean(record.claimedBy) : !record.claimedBy));
  assert.equal(result.total, expected.length); assert.deepEqual(result.tickets, expected.slice(0, 10));
});
test('owner and handler filters intersect state and assignment filters', async t => {
  const f = await fixture(t), first = f.records[0];
  const result = f.tickets.list({ ...f.staff, state: 'open', ownerId: first.ownerId, handlerId: ids.actor, assignment: 'assigned' }); assert.deepEqual(result.tickets, [first]); assert.equal(result.total, 1);
  assert.equal(f.tickets.list({ ...f.staff, state: 'closed', ownerId: first.ownerId, handlerId: ids.actor }).total, 0);
});
test('members can browse only their own current and closed history', async t => {
  const f = await fixture(t), closed = { ...f.records[2], channelId: String(BigInt(ids.channel) + 999n), ownerId: ids.user }; await f.store.add(closed);
  assert.equal(f.tickets.list(f.member).total, 1); assert.deepEqual(f.tickets.list({ ...f.member, state: 'closed' }).tickets, [closed]); assert.equal(f.tickets.list({ ...f.member, state: 'all' }).total, 2);
  assert.equal(f.tickets.list({ ...f.member, ownerId: ids.user }).ok, true);
  for (const filters of [{ ownerId: ids.actor }, { handlerId: ids.actor }, { assignment: 'assigned' }, { assignment: 'unassigned' }]) assert.equal(f.tickets.list({ ...f.member, ...filters }).ok, false);
});
test('filtered pagination uses ten full records, rejects excess pages and accepts one empty page', async t => {
  const f = await fixture(t); assert.equal(f.tickets.list({ ...f.staff, state: 'all' }).pages, 3); assert.deepEqual(f.tickets.list({ ...f.staff, state: 'all', page: 3 }).tickets, f.records.slice(20)); assert.equal(f.tickets.list({ ...f.staff, state: 'all', page: 4 }).ok, false);
  const empty = f.tickets.list({ ...f.staff, ownerId: ids.bot }); assert.equal(empty.total, 0); assert.equal(empty.pages, 1); assert.equal(f.tickets.list({ ...f.staff, ownerId: ids.bot, page: 2 }).ok, false);
});
test('invalid state, assignment, ID and page inputs fail without exposing records', async t => {
  const f = await fixture(t); for (const filters of [{ state: 'deleted' }, { assignment: 'maybe' }, { ownerId: 'invalid' }, { handlerId: null }, { page: 0 }, { page: 1.5 }, { page: 10001 }]) { const result = f.tickets.list({ ...f.staff, ...filters }); assert.equal(result.ok, false); assert.equal(result.tickets, undefined); }
});
test('equal creation times order channel IDs numerically beyond safe integer precision', async t => {
  const f = await fixture(t), createdAt = new Date(epoch - 1000).toISOString();
  for (const [channelId, ownerId] of [['1000000000000000000', '2000000000000000000'], ['999999999999999999', '2999999999999999999']]) await f.store.add({ channelId, ownerId, status: 'open', createdAt });
  assert.deepEqual(f.tickets.list(f.staff).tickets.slice(0, 2).map(record => record.channelId), ['999999999999999999', '1000000000000000000']);
});
test('queue interaction forwards all filters privately and suppresses notifications', async t => {
  const f = await fixture(t), handle = createInteractionHandler({ config: f.config, tickets: f.tickets, discord: f.fake.discord }), result = await handle(interaction('ticket', 'list', { state: 'closed', owner: f.records[2].ownerId, handler: ids.actor, assignment: 'unassigned' }));
  assert.deepEqual(result.immediate, { type: 5, data: { flags: 64 } }); await result.work(); const body = f.fake.calls.filter(call => call[0] === 'response').at(-1)[3]; assert.deepEqual(body.allowed_mentions, { parse: [] }); assert.match(body.content, /State: closed/); assert.match(body.content, /assignment: unassigned/); assert.match(body.content, /Tickets: 0/);
});
test('maximum-size IDs remain complete within private response limits', async t => {
  const f = await fixture(t); for (let index = 0; index < 10; index++) await f.store.add({ channelId: String(1000000000000000000000000n + BigInt(index)), ownerId: String(2000000000000000000000000n + BigInt(index)), claimedBy: String(3000000000000000000000000n + BigInt(index)), status: 'open', createdAt: new Date(epoch - 1000).toISOString() });
  const handle = createInteractionHandler({ config: f.config, tickets: f.tickets, discord: f.fake.discord }), result = await handle(interaction('ticket', 'list', { state: 'open' })); await result.work(); const body = f.fake.calls.filter(call => call[0] === 'response').at(-1)[3]; assert.ok(body.content.length < 1900); for (let index = 0; index < 10; index++) assert.ok(body.content.includes(String(1000000000000000000000000n + BigInt(index))));
});
