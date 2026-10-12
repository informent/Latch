'use strict';

const fs = require('node:fs');
const path = require('node:path');

function botToken(env) {
  const direct = env.DISCORD_BOT_TOKEN?.trim();
  const file = env.DISCORD_BOT_TOKEN_FILE?.trim();
  if (direct && file) throw new Error('Set only one of DISCORD_BOT_TOKEN or DISCORD_BOT_TOKEN_FILE.');
  if (!file) return required(env, 'DISCORD_BOT_TOKEN');
  try {
    if (fs.statSync(file).size > 16 * 1024) throw new Error();
    const value = fs.readFileSync(file, 'utf8').trim();
    if (!value || /\s/.test(value)) throw new Error();
    return value;
  } catch { throw new Error('DISCORD_BOT_TOKEN_FILE must point to a readable, non-empty token file.'); }
}

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
  const voiceEnabled = boolean(env, 'DISCORD_VOICE_ENABLED');
  const starboardEnabled = boolean(env, 'DISCORD_STARBOARD_ENABLED');
  const respondersEnabled = boolean(env, 'DISCORD_RESPONDERS_ENABLED');
  const gatewayEnabled = boolean(env, 'DISCORD_GATEWAY_ENABLED', levelingEnabled || memberEventsEnabled || voiceEnabled || respondersEnabled || starboardEnabled);
  if (!gatewayEnabled && (levelingEnabled || memberEventsEnabled || voiceEnabled || respondersEnabled || starboardEnabled)) throw new Error('DISCORD_GATEWAY_ENABLED cannot be false when leveling, member events, voice, responders or starboard are enabled.');
  const storePaths = {
    storePath: env.TICKET_STORE_PATH?.trim() || './data/tickets.json',
    moderationStorePath: env.MODERATION_STORE_PATH?.trim() || './data/moderation.json',
    economyStorePath: env.ECONOMY_STORE_PATH?.trim() || './data/economy.json',
    communityStorePath: env.COMMUNITY_STORE_PATH?.trim() || './data/community.json',
    levelStorePath: env.LEVEL_STORE_PATH?.trim() || './data/levels.json',
    voiceStorePath: env.VOICE_STORE_PATH?.trim() || './data/voice.json',
    roleMenuStorePath: env.ROLE_MENU_STORE_PATH?.trim() || './data/role-menus.json',
    templateStorePath: env.TEMPLATE_STORE_PATH?.trim() || './data/templates.json',
    responderStorePath: env.RESPONDER_STORE_PATH?.trim() || './data/responders.json',
    timerStorePath: env.TIMER_STORE_PATH?.trim() || './data/timers.json',
    ticketPanelStorePath: env.TICKET_PANEL_STORE_PATH?.trim() || './data/ticket-panels.json',
    starboardStorePath: env.STARBOARD_STORE_PATH?.trim() || './data/starboard.json',
    levelRewardStorePath: env.LEVEL_REWARD_STORE_PATH?.trim() || './data/level-rewards.json'
  };
  const normalized = Object.values(storePaths).map((value) => {
    const absolute = path.resolve(value);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  });
  if (new Set(normalized).size !== normalized.length) throw new Error('Each data store must use a separate file path.');
  if (normalized.some((file, index) => normalized.some((other, otherIndex) => index !== otherIndex && file.startsWith(`${other}${path.sep}`)))) throw new Error('Data store file paths cannot contain another store file path.');
  const protectedFiles = ['.env', '.env.example', env.DISCORD_BOT_TOKEN_FILE?.trim()].filter(Boolean).map((file) => {
    const absolute = path.resolve(file);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  });
  if (normalized.some((file) => protectedFiles.includes(file))) throw new Error('Data stores cannot overwrite configuration or token files.');
  const gatewayIntents = 1 | 512
    | (starboardEnabled ? 1 << 10 : 0)
    | (voiceEnabled ? 1 << 7 : 0)
    | (memberEventsEnabled ? 2 : 0)
    | (boolean(env, 'DISCORD_ENABLE_MESSAGE_CONTENT') || levelingEnabled || respondersEnabled ? 1 << 15 : 0);
  const raidJoinThreshold = Number(env.DISCORD_RAID_JOIN_THRESHOLD || 0);
  const raidJoinWindowMs = Number(env.DISCORD_RAID_JOIN_WINDOW_MS || 10_000);
  if (!Number.isInteger(raidJoinThreshold) || raidJoinThreshold < 0 || raidJoinThreshold > 10_000) throw new Error('DISCORD_RAID_JOIN_THRESHOLD must be an integer from 0 to 10000.');
  if (!Number.isInteger(raidJoinWindowMs) || raidJoinWindowMs < 1000 || raidJoinWindowMs > 300_000) throw new Error('DISCORD_RAID_JOIN_WINDOW_MS must be an integer from 1000 to 300000.');
  if (env.DISCORD_SUPPORT_ROLE_ID?.trim() && env.DISCORD_SUPPORT_ROLE_ID.trim() === env.DISCORD_GUILD_ID?.trim()) throw new Error('The everyone role cannot be the ticket support role.');
  return Object.freeze({
    applicationId: snowflake(required(env, 'DISCORD_APPLICATION_ID'), 'DISCORD_APPLICATION_ID'),
    publicKey,
    botToken: botToken(env),
    guildId: snowflake(required(env, 'DISCORD_GUILD_ID'), 'DISCORD_GUILD_ID'),
    supportRoleId: env.DISCORD_SUPPORT_ROLE_ID?.trim() ? snowflake(env.DISCORD_SUPPORT_ROLE_ID.trim(), 'DISCORD_SUPPORT_ROLE_ID') : null,
    categoryId: env.DISCORD_CATEGORY_ID?.trim() ? snowflake(env.DISCORD_CATEGORY_ID.trim(), 'DISCORD_CATEGORY_ID') : null,
    ...storePaths,
    gatewayEnabled,
    voiceEnabled,
    respondersEnabled,
    starboardEnabled,
    memberEventsEnabled,
    gatewayIntents,
    levelingEnabled,
    welcomeChannelId: env.DISCORD_WELCOME_CHANNEL_ID?.trim() ? snowflake(env.DISCORD_WELCOME_CHANNEL_ID.trim(), 'DISCORD_WELCOME_CHANNEL_ID') : null,
    welcomeMessage: env.DISCORD_WELCOME_MESSAGE?.trim() || 'Welcome {user} to {server}!',
    raidJoinThreshold,
    raidJoinWindowMs,
    port,
    host,
  });
}

module.exports = { loadConfig };
