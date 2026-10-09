'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GuildEventService } = require('../src/guild-events');

test('welcome and raid detection only act on configured human joins for the configured guild', async () => {
  let now = 1000;
  const sent = [];
  const logs = [];
  const service = new GuildEventService({
    config: { guildId: 'guild', welcomeChannelId: 'channel', welcomeMessage: 'Hello {user}, welcome to {server}', raidJoinThreshold: 2, raidJoinWindowMs: 5000 },
    discord: { createMessage: async (...args) => sent.push(args) },
    logger: (...args) => logs.push(args),
    now: () => now
  });
  await service.dispatch('MESSAGE_CREATE', { guild_id: 'guild', user: { id: 'ignored' } });
  await service.dispatch('GUILD_MEMBER_ADD', { guild_id: 'other', user: { id: 'ignored' } });
  await service.dispatch('GUILD_MEMBER_ADD', { guild_id: 'guild', user: { id: 'bot', bot: true } });
  await service.dispatch('GUILD_MEMBER_ADD', { guild_id: 'guild', user: { id: 'member-1' }, guild_name: 'Example' });
  now += 100;
  await service.dispatch('GUILD_MEMBER_ADD', { guild_id: 'guild', user: { id: 'member-2' }, guild_name: 'Example' });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], ['channel', { content: 'Hello <@member-2>, welcome to Example', allowed_mentions: { parse: [], users: ['member-2'] } }]);
  assert.deepEqual(logs, [['raid_join_burst_detected', { guildId: 'guild', joinCount: 2, windowMs: 5000 }]]);
});

test('welcome failures log identifiers without message content', async () => {
  const logs = [];
  const service = new GuildEventService({
    config: { guildId: 'guild', welcomeChannelId: 'channel', welcomeMessage: 'welcome', raidJoinThreshold: 0, raidJoinWindowMs: 5000 },
    discord: { createMessage: async () => { throw new Error('failed'); } },
    logger: (...args) => logs.push(args)
  });
  await service.dispatch('GUILD_MEMBER_ADD', { guild_id: 'guild', user: { id: 'member' } });
  assert.deepEqual(logs, [['welcome_message_failed', { guildId: 'guild', channelId: 'channel', message: 'failed' }]]);
});

test('leveling awards human guild messages without reading or storing their content', async () => {
  const awards = [];
  const config = { guildId: 'guild', levelingEnabled: true, welcomeChannelId: null };
  const service = new GuildEventService({ config, discord: {}, levels: { awardMessage: async (...args) => awards.push(args) } });
  await service.dispatch('MESSAGE_CREATE', { guild_id: 'guild', channel_id: 'channel', author: { id: 'member' }, content: 'never persist this text' });
  await service.dispatch('MESSAGE_CREATE', { guild_id: 'guild', channel_id: 'channel', author: { id: 'bot', bot: true }, content: 'ignored' });
  await service.dispatch('MESSAGE_CREATE', { guild_id: 'other', channel_id: 'channel', author: { id: 'member' } });
  await service.dispatch('MESSAGE_CREATE', { guild_id: 'guild', channel_id: 'channel', author: { id: 'member' }, webhook_id: 'hook' });
  assert.deepEqual(awards, [['guild', 'member']]);
});
