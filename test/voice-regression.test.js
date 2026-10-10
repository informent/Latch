'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { VoiceStore } = require('../src/voice-store');
const { VoiceService } = require('../src/voice-service');
const { directory, fakeDiscord, ids, epoch } = require('./feature-fixtures');
async function fixture(t) {
  const store = new VoiceStore(path.join(await directory(t), 'voice.json'), ids.guild);
  const fake = fakeDiscord(); let clock = epoch; let socket = {};
  const original = fake.discord.request;
  fake.discord.request = async (method, route, body) => {
    if (method === 'PUT' || method === 'PATCH') { fake.calls.push([method, route, body]); return; }
    return original(method, route, body);
  };
  fake.discord.createChannel = async (guild, data) => { assert.equal(guild, ids.guild); const channel = { id: ids.menu, guild_id: guild, ...data }; fake.channels.set(channel.id, channel); fake.calls.push(['create', channel]); return channel; };
  const service = new VoiceService({ config: { guildId: ids.guild, voiceEnabled: true }, store, discord: fake.discord, botUserId: ids.bot, connection: () => socket, now: () => clock });
  const snapshot = (states = []) => service.observe('GUILD_CREATE', { id: ids.guild, voice_states: states.map(([user_id, channel_id]) => ({ user_id, channel_id })) });
  return { ...fake, store, service, snapshot, advance: (ms) => { clock += ms; }, reconnect: () => { socket = {}; }, join: async (user = ids.user, channel = ids.lobby) => { const data = { guild_id: ids.guild, user_id: user, channel_id: channel }; service.observe('VOICE_STATE_UPDATE', data); await service.dispatch('VOICE_STATE_UPDATE', data); } };
}
test('voice creates, persists before moving, reuses rooms and ignores stale connections', async (t) => {
  const f = await fixture(t); await f.service.configure({ lobbyId: ids.lobby, categoryId: ids.category });
  await f.join(); assert.equal(f.store.get().channels.length, 0);
  f.snapshot(); await f.join(); assert.equal(f.store.get().channels[0].ownerId, ids.user);
  assert.equal(f.calls.filter((call) => call[0] === 'create').length, 1);
  await f.join(); assert.equal(f.calls.filter((call) => call[0] === 'create').length, 1);
  f.reconnect(); await assert.rejects(f.service.manage({ action: 'info', userId: ids.user }), /not ready/);
  f.service.observe('RESUMED', {}); assert.match(await f.service.manage({ action: 'info', userId: ids.user }), /Connected members: 1/);
  f.service.observe('READY', {}); assert.match(f.service.status(), /waiting/);
});
test('voice owner controls, transfer and claim respect live occupancy and membership', async (t) => {
  const f = await fixture(t); await f.store.add(ids.menu, ids.user, new Date(epoch).toISOString());
  f.channels.set(ids.menu, { id: ids.menu, guild_id: ids.guild, type: 2, permission_overwrites: [] }); f.snapshot([[ids.user, ids.menu], [ids.actor, ids.menu]]);
  await assert.rejects(f.service.manage({ action: 'rename', userId: ids.actor, value: 'Room' }), /owner/);
  await assert.rejects(f.service.manage({ action: 'claim', userId: ids.actor }), /still present/);
  for (const action of ['lock', 'unlock', 'ghost', 'unghost', 'permit', 'reject']) await f.service.manage({ action, userId: ids.user, targetId: ids.actor });
  await f.service.manage({ action: 'rename', userId: ids.user, value: 'Room' }); await f.service.manage({ action: 'limit', userId: ids.user, value: 3 });
  await assert.rejects(f.service.manage({ action: 'limit', userId: ids.user, value: 100 }));
  await assert.rejects(f.service.manage({ action: 'rename', userId: ids.user, value: '\n' }));
  await f.service.manage({ action: 'transfer', userId: ids.user, targetId: ids.actor }); assert.equal(f.store.get().channels[0].ownerId, ids.actor);
  f.service.observe('VOICE_STATE_UPDATE', { guild_id: ids.guild, user_id: ids.actor, channel_id: null });
  await f.service.manage({ action: 'claim', userId: ids.user }); assert.equal(f.store.get().channels[0].ownerId, ids.user);
});
test('voice cleanup waits for grace, preserves occupied rooms and removes missing rooms', async (t) => {
  const f = await fixture(t); await f.store.add(ids.menu, ids.user, new Date(epoch).toISOString());
  f.channels.set(ids.menu, { id: ids.menu, guild_id: ids.guild, type: 2 }); f.snapshot();
  await f.service.tick(); assert.equal(f.store.get().channels.length, 1); f.advance(30000);
  await f.join(ids.user, ids.menu); await f.service.tick(); assert.equal(f.store.get().channels.length, 1);
  f.service.observe('VOICE_STATE_UPDATE', { guild_id: ids.guild, user_id: ids.user, channel_id: null }); f.advance(30000);
  await f.service.tick(); assert.equal(f.store.get().channels.length, 0);
  await f.store.add(ids.menu, ids.user, new Date(epoch).toISOString()); f.snapshot(); f.advance(30000); await f.service.tick(); assert.equal(f.store.get().channels.length, 0);
});
test('voice creation persistence failure deletes only the newly created room', async (t) => {
  const f = await fixture(t); await f.service.configure({ lobbyId: ids.lobby, categoryId: ids.category }); f.snapshot();
  f.store.add = async () => { throw new Error('Disk unavailable'); }; await f.join();
  assert.equal(f.store.get().channels.length, 0); assert.equal(f.channels.has(ids.menu), false); assert.equal(f.channels.has(ids.lobby), true);
  assert.equal(f.calls.some((call) => call[0] === 'PATCH'), false);
});
test('voice deletion disables missing configuration and stop refuses new work', async (t) => {
  const f = await fixture(t); await f.service.configure({ lobbyId: ids.lobby, categoryId: ids.category }); f.snapshot();
  await f.service.dispatch('CHANNEL_DELETE', { guild_id: ids.guild, id: ids.category }); assert.equal(f.store.get().lobbyId, null);
  await f.service.stop(); await f.join(); await f.service.tick(); assert.equal(f.calls.some((call) => call[0] === 'create'), false);
});
test('voice transfer refuses a member response with missing or mismatched identity', async (t) => {
  const f = await fixture(t); await f.store.add(ids.menu, ids.user, new Date(epoch).toISOString());
  f.channels.set(ids.menu, { id: ids.menu, guild_id: ids.guild, type: 2 }); f.snapshot([[ids.user, ids.menu], [ids.actor, ids.menu]]);
  for (const member of [{ roles: [] }, { user: { id: ids.owner }, roles: [] }]) {
    f.discord.getGuildMember = async () => member;
    await assert.rejects(f.service.manage({ action: 'transfer', userId: ids.user, targetId: ids.actor }), /human member/);
    assert.equal(f.store.get().channels[0].ownerId, ids.user);
  }
});
