'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { directory, ids, epoch, fakeDiscord } = require('./feature-fixtures');
const { RoleMenuStore } = require('../src/role-menu-store');
const { RoleMenuService, menuMessage } = require('../src/role-menu-service');
async function fixture(t) {
  const root = await directory(t); const store = new RoleMenuStore(path.join(root, 'roles.json'), ids.guild); await store.load(); const f = fakeDiscord(); let now = epoch;
  const service = new RoleMenuService({ config: { guildId: ids.guild, memberEventsEnabled: true }, store, discord: f.discord, botUserId: ids.bot, now: () => now }); t.after(() => service.stop());
  await service.create({ id: ids.menu, channelId: ids.channel, title: 'Roles' }); await service.change(ids.menu, 'add', { roleId: ids.role, label: 'Member', actorId: ids.actor });
  return { ...f, store, service, advance: (ms) => { now += ms; } };
}
test('role menus publish bound buttons, idempotently grant/remove and reject stale controls', async (t) => {
  const f = await fixture(t); await f.service.change(ids.menu, 'publish', { actorId: ids.actor }); const menu = f.service.get(ids.menu);
  assert.equal(menu.pending, false); assert.equal(menu.messageId, ids.message); assert.deepEqual(menuMessage(menu).allowed_mentions, { parse: [] });
  const input = { id: ids.menu, roleId: ids.role, guildId: ids.guild, channelId: ids.channel, messageId: menu.messageId, userId: ids.user, action: 'grant' };
  await f.service.button(input); await f.service.button(input); assert.equal(f.calls.filter(([kind]) => kind === 'grant').length, 1);
  for (const wrong of [{ guildId: ids.owner }, { channelId: ids.lobby }, { messageId: ids.menu }]) await assert.rejects(f.service.button({ ...input, ...wrong }));
  await f.service.button({ ...input, action: 'revoke' }); await f.service.button({ ...input, action: 'revoke' }); assert.equal(f.calls.filter(([kind]) => kind === 'revoke').length, 1);
  f.members.get(ids.user).pending = true; await assert.rejects(f.service.button(input), /screening/); f.members.get(ids.user).pending = false;
  f.roles.find((r) => r.id === ids.role).permissions = '8'; await assert.rejects(f.service.button(input), /permission-free/);
  f.roles.find((r) => r.id === ids.role).permissions = '0'; await f.service.change(ids.menu, 'disable'); await assert.rejects(f.service.button(input));
  await f.service.change(ids.menu, 'delete'); assert.equal(f.service.get(ids.menu), null);
});
test('role menu failed publication persists retries and reload recovers without redrawing state', async (t) => {
  const f = await fixture(t); const original = f.discord.createMessage; f.discord.createMessage = async () => { throw new Error('outage'); };
  await f.service.change(ids.menu, 'publish', { actorId: ids.actor }); assert.equal(f.service.get(ids.menu).attempts, 1); assert.equal(f.service.get(ids.menu).pending, true);
  const reload = new RoleMenuStore(f.store.filePath, ids.guild); await reload.load(); assert.equal(reload.menu(ids.menu).pending, true);
  f.discord.createMessage = original; f.advance(15000); await f.service.tick(); assert.equal(f.service.get(ids.menu).pending, false); assert.equal(f.service.get(ids.menu).attempts, 0);
  f.messages.delete(ids.message); await f.service.change(ids.menu, 'publish', { actorId: ids.actor }); assert.ok(f.service.get(ids.menu).messageId);
});
test('autoroles skip screened/bot joins, require eligibility and reconcile explicitly', async (t) => {
  const f = await fixture(t); await f.service.configureAutorole(ids.role, false, ids.actor); assert.equal(await f.service.applyAutoroles(ids.user, ids.actor), 1); assert.equal(await f.service.applyAutoroles(ids.user, ids.actor), 0);
  f.members.get(ids.user).roles = []; await f.service.dispatch('GUILD_MEMBER_ADD', { guild_id: ids.guild, user: { id: ids.user }, pending: true }); assert.equal(f.members.get(ids.user).roles.length, 0);
  await f.service.dispatch('GUILD_MEMBER_ADD', { guild_id: ids.guild, user: { id: ids.user } }); assert.deepEqual(f.members.get(ids.user).roles, [ids.role]);
  await f.service.configureAutorole(ids.role, true, ids.actor); assert.equal(await f.service.applyAutoroles(ids.user, ids.actor), 0);
});
