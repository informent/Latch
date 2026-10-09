'use strict';

function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function snowflake(value, key) {
  if (!/^\d{5,25}$/.test(value)) throw new Error(`${key} must be a Discord ID containing 5-25 digits.`);
  return value;
}

function boolean(env, key, fallback = false) {
  const value = env[key]?.trim().toLowerCase();
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${key} must be true or false.`);
}

function loadConfig(env = process.env) {
  const publicKey = required(env, 'DISCORD_PUBLIC_KEY');
  if (!/^[0-9a-fA-F]{64}$/.test(publicKey)) throw new Error('DISCORD_PUBLIC_KEY must be 32-byte hex from the Developer Portal.');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const host = env.HOST?.trim() || '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1' && host !== '0.0.0.0' && host !== '::') {
    throw new Error('HOST must be a loopback address or a wildcard bind address.');
  }
  const levelingEnabled = boolean(env, 'DISCORD_LEVELING_ENABLED');
  const memberEventsEnabled = boolean(env, 'DISCORD_ENABLE_MEMBER_EVENTS');
  const gatewayEnabled = boolean(env, 'DISCORD_GATEWAY_ENABLED', levelingEnabled || memberEventsEnabled);
  const gatewayIntents = 1 | 512
    | (memberEventsEnabled ? 2 : 0)
    | (boolean(env, 'DISCORD_ENABLE_MESSAGE_CONTENT') || levelingEnabled ? 1 << 15 : 0);
  const raidJoinThreshold = Number(env.DISCORD_RAID_JOIN_THRESHOLD || 0);
  const raidJoinWindowMs = Number(env.DISCORD_RAID_JOIN_WINDOW_MS || 10_000);
  if (!Number.isInteger(raidJoinThreshold) || raidJoinThreshold < 0 || raidJoinThreshold > 10_000) throw new Error('DISCORD_RAID_JOIN_THRESHOLD must be an integer from 0 to 10000.');
  if (!Number.isInteger(raidJoinWindowMs) || raidJoinWindowMs < 1000 || raidJoinWindowMs > 300_000) throw new Error('DISCORD_RAID_JOIN_WINDOW_MS must be an integer from 1000 to 300000.');
  return Object.freeze({
    applicationId: snowflake(required(env, 'DISCORD_APPLICATION_ID'), 'DISCORD_APPLICATION_ID'),
    publicKey,
    botToken: required(env, 'DISCORD_BOT_TOKEN'),
    guildId: snowflake(required(env, 'DISCORD_GUILD_ID'), 'DISCORD_GUILD_ID'),
    supportRoleId: env.DISCORD_SUPPORT_ROLE_ID?.trim() ? snowflake(env.DISCORD_SUPPORT_ROLE_ID.trim(), 'DISCORD_SUPPORT_ROLE_ID') : null,
    categoryId: env.DISCORD_CATEGORY_ID?.trim() ? snowflake(env.DISCORD_CATEGORY_ID.trim(), 'DISCORD_CATEGORY_ID') : null,
    moderationStorePath: env.MODERATION_STORE_PATH?.trim() || './data/moderation.json',
    economyStorePath: env.ECONOMY_STORE_PATH?.trim() || './data/economy.json',
    gatewayEnabled,
    memberEventsEnabled,
    gatewayIntents,
    levelingEnabled,
    levelStorePath: env.LEVEL_STORE_PATH?.trim() || './data/levels.json',
    welcomeChannelId: env.DISCORD_WELCOME_CHANNEL_ID?.trim() ? snowflake(env.DISCORD_WELCOME_CHANNEL_ID.trim(), 'DISCORD_WELCOME_CHANNEL_ID') : null,
    welcomeMessage: env.DISCORD_WELCOME_MESSAGE?.trim() || 'Welcome {user} to {server}!',
    raidJoinThreshold,
    raidJoinWindowMs,
    port,
    host,
    storePath: env.TICKET_STORE_PATH?.trim() || './data/tickets.json'
  });
}

module.exports = { loadConfig };
