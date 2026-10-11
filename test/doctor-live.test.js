'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectLive, commandShape, main } = require('../scripts/doctor-live');
const { commands } = require('../src/commands');
const env = { DISCORD_APPLICATION_ID: '100001', DISCORD_GUILD_ID: '100002', DISCORD_PUBLIC_KEY: 'a'.repeat(64), DISCORD_BOT_TOKEN: 'private-fixture-token', DISCORD_SUPPORT_ROLE_ID: '100004', DISCORD_CATEGORY_ID: '100005', DISCORD_WELCOME_CHANNEL_ID: '100006' };
function fixture(overrides = {}) {
  const calls = [];
  const responses = {
    '/users/@me': { id: '100001', bot: true },
    '/guilds/100002': { id: '100002' },
    '/guilds/100002/members/100001': { user: { id: '100001', bot: true }, roles: ['100004'] },
    '/guilds/100002/roles': [{ id: '100002', permissions: '0' }, { id: '100004', permissions: '8' }],
    '/applications/100001/guilds/100002/commands': commands.map((command) => ({ ...command, id: '100008', application_id: '100001' })),
    '/channels/100005': { id: '100005', guild_id: '100002', type: 4 },
    '/channels/100006': { id: '100006', guild_id: '100002', type: 0 },
    ...overrides
  };
  return { calls, async request(method, route, body) { calls.push({ method, route, body }); assert.equal(method, 'GET'); assert.equal(body, undefined); const value = responses[route]; if (value instanceof Error) throw value; return value; } };
}
test('live doctor is GET-only and matches registered commands without returning private data', async () => {
  const api = fixture(), result = await inspectLive(env, api);
  assert.equal(result.ok, true); assert.equal(result.liveBehaviorValidated, false);
  assert.equal(api.calls.length, 7);
  assert.equal(result.checks.find((check) => check.name === 'Command definitions').status, 'pass');
  assert.ok(!JSON.stringify(result).includes(env.DISCORD_BOT_TOKEN));
});
test('invalid local configuration does not contact Discord', async () => {
  const api = fixture(); assert.equal((await inspectLive({}, api)).ok, false); assert.equal(api.calls.length, 0);
});
test('identity errors are sanitized and stop dependent requests', async () => {
  const api = fixture({ '/users/@me': new Error(env.DISCORD_BOT_TOKEN) });
  const result = await inspectLive(env, api); assert.equal(result.ok, false); assert.equal(api.calls.length, 1); assert.ok(!JSON.stringify(result).includes(env.DISCORD_BOT_TOKEN));
});
test('guild, membership and role snapshots are checked', async () => {
  for (const overrides of [
    { '/guilds/100002': { id: '999999' } },
    { '/guilds/100002/members/100001': { user: { id: '100001', bot: true }, roles: [], pending: true } },
    { '/guilds/100002/roles': [{ id: '100002', permissions: 'invalid' }] },
    { '/guilds/100002/members/100001': { user: { id: '100001', bot: true }, roles: ['100009'] } }
  ]) assert.equal((await inspectLive(env, fixture(overrides))).ok, false);
});
test('missing guild permissions warn without claiming channel access', async () => {
  const result = await inspectLive(env, fixture({ '/guilds/100002/roles': [{ id: '100002', permissions: '0' }, { id: '100004', permissions: '0' }] }));
  assert.equal(result.ok, true); assert.equal(result.checks.filter((check) => check.name.endsWith('guild permissions') && check.status === 'warn').length, 6);
});
test('command drift and malformed definitions fail preflight', async () => {
  for (const registered of [[], [null], commands.map((command) => ({ ...command, default_member_permissions: '8' }))]) assert.equal((await inspectLive(env, fixture({ '/applications/100001/guilds/100002/commands': registered }))).ok, false);
});
test('configured channels must have correct guild and type', async () => {
  assert.equal((await inspectLive(env, fixture({ '/channels/100005': { id: '100005', guild_id: '999999', type: 4 } }))).ok, false);
});
test('command projection normalizes defaults, choices and Discord metadata', () => {
  assert.deepEqual(commandShape({ name: 'x', description: 'x', options: [{ type: 3, name: 'a', description: 'a', choices: [{ value: 'a', name: 'A', name_localizations: {} }] }] }), commandShape({ type: 1, name: 'x', description: 'x', default_member_permissions: null, id: '12345', options: [{ type: 3, name: 'a', description: 'a', required: false, autocomplete: false, choices: [{ name: 'A', value: 'a' }], options: [] }] }));
});
test('live doctor rejects unsupported or duplicate CLI arguments', async () => {
  await assert.rejects(main(['--json', '--json']), /Usage/); await assert.rejects(main(['--write']), /Usage/);
});
