'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GuildEventService } = require('../src/guild-events');

test('welcome and raid detection only act on configured human joins for the configured guild', async () => {
  let now = 1000;
  const sent = [];
  const logs = [];
  const service = new GuildEventService({
    config: { guildId: 'guild', memberEventsEnabled: true, welcomeChannelId: 'channel', welcomeMessage: 'Hello {user}, welcome to {server}', raidJoinThreshold: 2, raidJoinWindowMs: 5000 },
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
    config: { guildId: 'guild', memberEventsEnabled: true, welcomeChannelId: 'channel', welcomeMessage: 'welcome', raidJoinThreshold: 0, raidJoinWindowMs: 5000 },
    discord: { createMessage: async () => { throw new Error('failed'); } },
    logger: (...args) => logs.push(args)
  });
  await service.dispatch('GUILD_MEMBER_ADD', { guild_id: 'guild', user: { id: 'member' } });
  assert.deepEqual(logs, [['welcome_message_failed', { guildId: 'guild', channelId: 'channel', message: 'failed' }]]);
});

test('member events are ignored unless configured', async () => {
  let sent = 0;
  const service = new GuildEventService({
    config: { guildId: 'guild', memberEventsEnabled: false, welcomeChannelId: 'channel', welcomeMessage: 'welcome', raidJoinThreshold: 1, raidJoinWindowMs: 5000 },
    discord: { createMessage: async () => { sent++; } }
  });
  await service.dispatch('GUILD_MEMBER_ADD', { guild_id: 'guild', user: { id: 'member' } });
  assert.equal(sent, 0);
});

test('leveling awards human guild messages without storing their content', async () => {
  const awards = [];
  const guild = '123456789012345678', channel = '223456789012345678', user = '323456789012345678', message = '423456789012345678';
  const config = { guildId: guild, levelingEnabled: true, memberEventsEnabled: false };
  const service = new GuildEventService({ config, discord: {}, levels: { awardMessage: async (...args) => awards.push(args) } });
  const event = { id: message, guild_id: guild, channel_id: channel, author: { id: user }, timestamp: new Date().toISOString(), content: 'never persist this text' };
  await service.dispatch('MESSAGE_CREATE', event);
  for (const change of [{ content: '   ' }, { author: { id: user, bot: true } }, { guild_id: message }, { webhook_id: message }]) await service.dispatch('MESSAGE_CREATE', { ...event, ...change });
  assert.deepEqual(awards, [[guild, user, { channelId: channel, messageId: message }]]);
});
