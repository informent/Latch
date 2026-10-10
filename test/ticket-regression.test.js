'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { directory, ids, epoch, fakeDiscord } = require('./feature-fixtures');
const { TicketStore } = require('../src/ticket-store');
const { TicketService } = require('../src/ticket-service');
async function fixture(t) {
  const root = await directory(t); const store = new TicketStore(path.join(root, 'tickets.json')); await store.load();
  await store.add({ channelId: ids.channel, ownerId: ids.user, status: 'open', createdAt: new Date(epoch).toISOString() });
  const f = fakeDiscord(); const service = new TicketService({ config: { guildId: ids.guild, supportRoleId: ids.actorRole }, store, discord: f.discord, botUserId: ids.bot });
  const actor = { channelId: ids.channel, userId: ids.actor, roles: [ids.actorRole] };
  return { ...f, store, service, actor };
}
test('ticket reads remain committed while a reason write is queued', async (t) => {
  const f = await fixture(t); let release; const gate = new Promise((resolve) => { release = resolve; }); f.store.saveQueue = gate;
  const change = f.store.setReason(ids.channel, 'New reason'); await Promise.resolve();
  const observed = f.store.getByChannel(ids.channel).reason; release(); await change;
  assert.equal(observed, undefined); assert.equal(f.store.getByChannel(ids.channel).reason, 'New reason');
});
test('ticket info privacy, persisted reasons, staff assignment and category moves', async (t) => {
  const f = await fixture(t);
  assert.equal(f.service.info({ channelId: ids.channel, userId: ids.user }).ok, true); assert.equal(f.service.info({ channelId: ids.channel, userId: ids.owner }).ok, false);
  assert.equal((await f.service.manage({ ...f.actor, action: 'reason', reason: 'Staff reason' })).ok, true);
  const reload = new TicketStore(f.store.filePath); await reload.load(); assert.equal(reload.getByChannel(ids.channel).reason, 'Staff reason');
  await f.service.manage({ ...f.actor, action: 'claim' }); assert.equal(f.store.getByChannel(ids.channel).claimedBy, ids.actor); await f.service.manage({ ...f.actor, action: 'unclaim' }); assert.equal(f.store.getByChannel(ids.channel).claimedBy, undefined);
  const before = structuredClone(f.channels.get(ids.channel).permission_overwrites);
  const moved = await f.service.manage({ ...f.actor, action: 'move', categoryId: ids.category }); assert.equal(moved.ok, true); assert.deepEqual(f.channels.get(ids.channel).permission_overwrites, before);
  assert.equal((await f.service.manage({ ...f.actor, action: 'move', categoryId: ids.category })).ok, true);
});
test('ticket moves reject missing protection, wrong categories and mismatched read-back', async (t) => {
  const f = await fixture(t); f.channels.get(ids.category).guild_id = ids.owner;
  assert.equal((await f.service.manage({ ...f.actor, action: 'move', categoryId: ids.category })).ok, false);
  f.channels.get(ids.category).guild_id = ids.guild; f.channels.get(ids.channel).permission_overwrites = [];
  assert.equal((await f.service.manage({ ...f.actor, action: 'move', categoryId: ids.category })).ok, false);
  f.channels.get(ids.channel).permission_overwrites = [{ id: ids.guild, type: 0, allow: '0', deny: '1024' }];
  f.discord.editChannel = async () => {}; await assert.rejects(f.service.manage({ ...f.actor, action: 'move', categoryId: ids.category }), /confirmed/);
  assert.equal((await f.service.manage({ ...f.actor, userId: ids.user, roles: [], action: 'reason', reason: 'No' })).ok, false);
});
test('ticket invalid reasons and corrupt records preserve state', async (t) => {
  const f = await fixture(t); for (const reason of ['', ' ', 'x'.repeat(401)]) await assert.rejects(f.store.setReason(ids.channel, reason));
  assert.equal(f.store.getByChannel(ids.channel).reason, undefined); const payload = JSON.parse(await fs.readFile(f.store.filePath, 'utf8')); payload.tickets[0].reason = ' ';
  await fs.writeFile(f.store.filePath, JSON.stringify(payload)); await assert.rejects(new TicketStore(f.store.filePath).load());
});
