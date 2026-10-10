'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { TicketStore } = require('../src/ticket-store');
const { ModerationStore } = require('../src/moderation-store');
const { EconomyStore } = require('../src/economy-store');
const { LevelStore } = require('../src/level-store');
const { CommunityStore } = require('../src/community-store');
const { VoiceStore } = require('../src/voice-store');
const { commands } = require('../src/commands');

async function writableParent(filePath) {
  try { await fs.access(filePath, fs.constants.W_OK); }
  catch (error) { if (error.code !== 'ENOENT') return false; }
  let parent = path.dirname(path.resolve(filePath));
  while (true) {
    try { if (!(await fs.stat(parent)).isDirectory()) return false; await fs.access(parent, fs.constants.W_OK | fs.constants.X_OK); return true; }
    catch (error) { if (error.code !== 'ENOENT') return false; }
    const next = path.dirname(parent);
    if (next === parent) return false;
    parent = next;
  }
}

async function inspectSetup(env = process.env) {
  const checks = [];
  const add = (status, name, detail) => checks.push({ status, name, detail });
  const [major, minor] = process.versions.node.split('.').map(Number);
  add(major > 22 || major === 22 && minor >= 9 ? 'pass' : 'fail', 'Node runtime', 'Node 22.9+ is required; supported CI targets are Node 22 and 24.');
  let config;
  try { config = loadConfig(env); add('pass', 'Configuration', 'Required values, flags, IDs, and distinct store paths are valid.'); }
  catch (error) { add('fail', 'Configuration', error.message); }
  if (config) {
    add(config.host === '127.0.0.1' || config.host === '::1' ? 'pass' : 'warn', 'Listener', 'Use a trusted HTTPS proxy. Wildcard binding needs network isolation.');
    add('pass', 'Commands', `${commands.length} feature suites are available. Re-register after an upgrade.`);
    if (config.welcomeChannelId && !config.memberEventsEnabled) add('warn', 'Welcome events', 'A welcome channel is configured but member events are disabled.');
    if (config.raidJoinThreshold && !config.memberEventsEnabled) add('warn', 'Join alerts', 'A join threshold is configured but member events are disabled.');
    if (config.memberEventsEnabled || config.levelingEnabled) add('warn', 'Privileged intents', 'Enable the matching Server Members / Message Content intents in the Discord Developer Portal.');
    if (config.voiceEnabled) add('warn', 'Voice lifecycle', 'Voice requires Gateway voice states and bot View Channel, Connect, Move Members, Manage Channels and Manage Roles permissions. Live operation is not checked here.');
    const stores = [['Tickets', TicketStore, config.storePath], ['Warnings', ModerationStore, config.moderationStorePath], ['Coins', EconomyStore, config.economyStorePath], ['XP', LevelStore, config.levelStorePath], ['Community jobs', CommunityStore, config.communityStorePath], ['Voice', VoiceStore, config.voiceStorePath]];
    const results = await Promise.all(stores.map(async ([name, Store, file]) => {
      try {
        await (Store === VoiceStore ? new Store(file, config.guildId) : new Store(file)).load();
        return { name, valid: true, writable: await writableParent(file) };
      } catch { return { name, valid: false, writable: false }; }
    }));
    for (const result of results) add(result.valid && result.writable ? 'pass' : 'fail', `${result.name} store`, result.valid ? result.writable ? 'Existing records are readable, or no file exists yet; filesystem access appears writable.' : 'The file or its parent is not writable by this account.' : 'Unreadable or invalid records. Stop the bot and restore a trusted backup; this command never repairs or overwrites data.');
  }
  add('warn', 'Live operation', 'Offline inspection cannot verify bot membership, channel permissions, HTTPS routing, role hierarchy, or live Discord behavior.');
  return { ok: checks.every((check) => check.status !== 'fail'), checks };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--json')) { console.error('Usage: npm run doctor -- [--json]'); process.exitCode = 1; return; }
  const result = await inspectSetup();
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else { console.log('OpenDesk setup inspection (offline, read-only)'); for (const check of result.checks) console.log(`[${check.status.toUpperCase()}] ${check.name}: ${check.detail}`); }
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main().catch(() => { console.error('Setup inspection could not finish. Check local access and configuration.'); process.exitCode = 1; });
module.exports = { inspectSetup };
