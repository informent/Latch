'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

const valid = {
  DISCORD_APPLICATION_ID: '123456789012345678',
  DISCORD_PUBLIC_KEY: 'a'.repeat(64),
  DISCORD_BOT_TOKEN: 'not-a-real-token',
  DISCORD_GUILD_ID: '123456789012345679'
};

test('loads required config and safe loopback defaults', () => {
  const config = loadConfig(valid);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  assert.equal(config.supportRoleId, null);
  assert.equal(config.moderationStorePath, './data/moderation.json');
  assert.equal(config.economyStorePath, './data/economy.json');
  assert.equal(config.gatewayEnabled, true);
  assert.equal(config.gatewayIntents, 513);
  assert.equal(config.levelingEnabled, false);
  assert.equal(config.levelStorePath, './data/levels.json');
  assert.equal(config.welcomeChannelId, null);
  assert.equal(config.raidJoinThreshold, 0);
});

test('privileged Gateway intents require explicit opt-in and event settings are bounded', () => {
  const config = loadConfig({ ...valid, DISCORD_ENABLE_MEMBER_EVENTS: 'true', DISCORD_ENABLE_MESSAGE_CONTENT: 'true', DISCORD_WELCOME_CHANNEL_ID: '323456789012345678', DISCORD_RAID_JOIN_THRESHOLD: '5' });
  assert.equal(config.gatewayIntents, 33283);
  assert.equal(config.welcomeChannelId, '323456789012345678');
  assert.equal(config.raidJoinThreshold, 5);
  assert.throws(() => loadConfig({ ...valid, DISCORD_ENABLE_MEMBER_EVENTS: 'yes' }), /true or false/);
  assert.throws(() => loadConfig({ ...valid, DISCORD_RAID_JOIN_THRESHOLD: '-1' }), /THRESHOLD/);
});

test('leveling enables the message and message-content intents explicitly', () => {
  const config = loadConfig({ ...valid, DISCORD_LEVELING_ENABLED: 'true' });
  assert.equal(config.levelingEnabled, true);
  assert.equal(config.gatewayIntents, 33281);
});

test('rejects missing secrets, malformed IDs, public-key lengths, and invalid ports', () => {
  assert.throws(() => loadConfig({}), /DISCORD_PUBLIC_KEY/);
  assert.throws(() => loadConfig({ ...valid, DISCORD_GUILD_ID: 'abc' }), /Discord ID/);
  assert.throws(() => loadConfig({ ...valid, DISCORD_PUBLIC_KEY: 'aa' }), /32-byte hex/);
  assert.throws(() => loadConfig({ ...valid, PORT: '0' }), /PORT/);
  assert.throws(() => loadConfig({ ...valid, HOST: 'example.com' }), /HOST/);
});
