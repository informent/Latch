'use strict';

const { loadConfig } = require('../src/config');
const { DiscordApi } = require('../src/discord-api');
const { commands } = require('../src/commands');
const { features } = require('./invite');

const id = (value) => typeof value === 'string' && /^\d{5,25}$/.test(value);
const fields = ['type', 'name', 'description', 'min_value', 'max_value', 'min_length', 'max_length', 'channel_types', 'choices'];
function commandShape(command, root = true) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error('Invalid command');
  const result = {};
  for (const field of fields) if (Object.hasOwn(command, field)) result[field] = command[field];
  if (result.choices) result.choices = result.choices.map((choice) => ({ name: choice.name, value: choice.value }));
  result.type ??= 1;
  if (root) result.default_member_permissions = command.default_member_permissions ?? null;
  else { result.required = command.required ?? false; result.autocomplete = command.autocomplete ?? false; }
  result.options = (command.options ?? []).map((entry) => commandShape(entry, false));
  return result;
}

async function inspectLive(env = process.env, client) {
  const checks = [];
  const add = (status, name, detail) => checks.push({ status, name, detail });
  let config;
  try { config = loadConfig(env); }
  catch { return { ok: false, liveBehaviorValidated: false, checks: [{ status: 'fail', name: 'Configuration', detail: 'Run the offline doctor and configure required local values before connecting.' }] }; }
  const api = client ?? new DiscordApi(config.botToken);
  async function read(name, route, validate) {
    try {
      const value = await api.request('GET', route);
      if (!validate(value)) throw new Error('Unexpected response');
      add('pass', name, 'Discord returned the expected object for this configuration.');
      return value;
    } catch { add('fail', name, 'Read failed or returned an unexpected object. Check local credentials, IDs and bot access.'); return null; }
  }
  const user = await read('Bot identity', '/users/@me', (value) => id(value?.id) && value.bot === true);
  if (user) {
    const [guild, member, roles, registered] = await Promise.all([
      read('Guild access', `/guilds/${config.guildId}`, (value) => value?.id === config.guildId),
      read('Bot membership', `/guilds/${config.guildId}/members/${user.id}`, (value) => value?.user?.id === user.id && value.user.bot === true && Array.isArray(value.roles) && value.roles.every(id) && value.pending !== true),
      read('Guild roles', `/guilds/${config.guildId}/roles`, (value) => Array.isArray(value) && value.length > 0 && value.length <= 250 && new Set(value.map((role) => role.id)).size === value.length && value.every((role) => id(role.id) && typeof role.permissions === 'string' && /^\d{1,30}$/.test(role.permissions)) && value.some((role) => role.id === config.guildId)),
      read('Command access', `/applications/${config.applicationId}/guilds/${config.guildId}/commands`, (value) => Array.isArray(value) && value.length <= 100)
    ]);
    if (guild && member && roles) {
      if (member.roles.some((roleId) => !roles.some((role) => role.id === roleId))) add('fail', 'Role snapshot', 'Membership references a role absent from the guild response. Retry the inspection.');
      else {
        const permissions = roles.filter((role) => role.id === config.guildId || member.roles.includes(role.id)).reduce((bits, role) => bits | BigInt(role.permissions), 0n);
        const administrator = (permissions & 8n) !== 0n;
        for (const [feature, required] of Object.entries(features)) add(administrator || (permissions & required) === required ? 'pass' : 'warn', `${feature} guild permissions`, 'Guild-level permission inspection only; channel overwrites, role hierarchy and target permissions still require live checks.');
      }
      if (config.supportRoleId) add(roles.some((role) => role.id === config.supportRoleId && role.id !== config.guildId) ? 'pass' : 'fail', 'Support role', 'The configured support role must exist and must not be the everyone role.');
    }
    if (registered) {
      try {
        const expected = commands.map((command) => JSON.stringify(commandShape(command))).sort();
        const actual = registered.map((command) => JSON.stringify(commandShape(command))).sort();
        add(JSON.stringify(expected) === JSON.stringify(actual) ? 'pass' : 'fail', 'Command definitions', 'Registered names, options and default member permissions must match this version. Re-register explicitly if they differ.');
      } catch { add('fail', 'Command definitions', 'Discord returned malformed command definitions.'); }
    }
    await Promise.all([
      ['Ticket category', config.categoryId, 4], ['Welcome channel', config.welcomeChannelId, 0]
    ].filter(([, channelId]) => channelId).map(([name, channelId, type]) => read(name, `/channels/${channelId}`, (value) => value?.id === channelId && value.guild_id === config.guildId && value.type === type)));
  }
  add('warn', 'Remaining live checks', 'This GET-only inspection does not test HTTPS routing, signatures, Gateway events, command execution, channel overwrites, role hierarchy or production storage. Follow docs/RELEASE.md before stable promotion.');
  return { ok: checks.every((check) => check.status !== 'fail'), liveBehaviorValidated: false, checks };
}

async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || args.some((arg) => arg !== '--json')) throw new Error('Usage: npm run doctor:live -- [--json]');
  const result = await inspectLive();
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else { console.log('OpenDesk Discord preflight (online, GET-only)'); for (const check of result.checks) console.log(`[${check.status.toUpperCase()}] ${check.name}: ${check.detail}`); }
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main().catch(() => { console.error('Discord preflight could not finish. Usage: npm run doctor:live -- [--json]'); process.exitCode = 1; });
module.exports = { inspectLive, commandShape, main };
