'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AutoModService } = require('../src/automod-service');
const { createInteractionHandler } = require('../src/interactions');
const guildId = '123456789012345678';
const botUserId = '223456789012345678';
const ruleId = '323456789012345678';

test('AutoMod creates disabled native filters with block actions and bounded metadata', async () => {
  const created = [];
  const service = new AutoModService({ guildId, botUserId, discord: { createAutoModRule: async (...args) => { created.push(args); return { id: ruleId }; } } });
  await service.create({ kind: 'keywords', name: 'Terms', keywords: 'spam, *scam*, spam', actorId: botUserId });
  assert.deepEqual(created[0][1], { name: 'Latch: Terms', event_type: 1, trigger_type: 1, trigger_metadata: { keyword_filter: ['spam', '*scam*'] }, actions: [{ type: 1 }], enabled: false, exempt_roles: [], exempt_channels: [] });
  await service.create({ kind: 'mentions', name: 'Mention raids', limit: 5, actorId: botUserId });
  assert.deepEqual(created[1][1].trigger_metadata, { mention_total_limit: 5, mention_raid_protection_enabled: true });
  await service.create({ kind: 'spam', name: 'Spam', actorId: botUserId });
  assert.equal(created[2][1].trigger_type, 3);
  await assert.rejects(service.create({ kind: 'keywords', name: 'Invalid', keywords: 'x'.repeat(61) }), /keywords/);
  await assert.rejects(service.create({ kind: 'mentions', name: 'Invalid', limit: 51 }), /limit/);
  assert.equal(created.length, 3);
});

test('AutoMod refuses foreign rules even if their names match and allows owned rules', async () => {
  const edited = [];
  const removed = [];
  let creator = '423456789012345678';
  const service = new AutoModService({ guildId, botUserId, discord: {
    getAutoModRule: async () => ({ id: ruleId, guild_id: guildId, creator_id: creator, name: 'Latch: Filter' }),
    editAutoModRule: async (...args) => edited.push(args),
    deleteAutoModRule: async (...args) => removed.push(args)
  } });
  await assert.rejects(service.change({ ruleId, action: 'remove', actorId: botUserId }), /own AutoMod rules/);
  assert.equal(removed.length, 0);
  creator = botUserId;
  await service.change({ ruleId, action: 'enable', actorId: botUserId });
  assert.deepEqual(edited[0].slice(0, 3), [guildId, ruleId, { enabled: true }]);
  await service.change({ ruleId, action: 'remove', actorId: botUserId });
  assert.equal(removed.length, 1);
});

test('AutoMod interactions require Manage Server and respond privately', async () => {
  let calls = 0;
  const edited = [];
  const config = { guildId, applicationId: botUserId };
  const handler = createInteractionHandler({ config, automod: { list: async () => { calls++; return [{ name: '@everyone Filter', id: ruleId, enabled: false }]; } }, discord: { editOriginalResponse: async (...args) => edited.push(args) } });
  const interaction = { type: 2, guild_id: guildId, channel_id: ruleId, token: 'fake', member: { user: { id: botUserId }, permissions: '0' }, data: { name: 'automod', options: [{ name: 'list' }] } };
  const denied = await handler(interaction);
  assert.match(denied.immediate.data.content, /Manage Server/);
  assert.equal(calls, 0);
  const accepted = await handler({ ...interaction, member: { ...interaction.member, permissions: '32' } });
  assert.equal(accepted.immediate.data.flags, 64);
  await accepted.work();
  assert.equal(calls, 1);
  assert.deepEqual(edited[0][2].allowed_mentions, { parse: [] });
});

test('Latch retains legacy AutoMod ownership checks after renaming', async () => {
  const edited = [];
  const rule = { id: ruleId, guild_id: guildId, creator_id: botUserId, name: 'OpenDesk: Existing filter' };
  const service = new AutoModService({ guildId, botUserId, discord: { getAutoModRule: async () => rule, editAutoModRule: async (...args) => edited.push(args) } });
  await service.change({ ruleId, action: 'disable', actorId: botUserId });
  assert.deepEqual(edited[0].slice(0, 3), [guildId, ruleId, { enabled: false }]);
  rule.creator_id = '423456789012345678';
  await assert.rejects(service.change({ ruleId, action: 'enable', actorId: botUserId }), /own AutoMod rules/);
  assert.equal(edited.length, 1);
});
