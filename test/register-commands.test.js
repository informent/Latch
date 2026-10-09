'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { commands, registerCommands } = require('../scripts/register-commands');

test('registers each feature command without bulk-replacing other app commands', async () => {
  const calls = [];
  const api = { request: async (...args) => { calls.push(args); return { id: 'command-id' }; } };
  const config = { applicationId: '123456789012345678', guildId: '223456789012345678' };
  const result = await registerCommands(config, api);
  assert.equal(result.length, commands.length);
  assert.equal(calls.length, commands.length);
  assert.equal(calls[0][0], 'POST');
  assert.equal(calls[0][1], `/applications/${config.applicationId}/guilds/${config.guildId}/commands`);
  assert.equal(calls[0][2].name, 'ticket');
  assert.equal(Array.isArray(calls[0][2]), false);
  const close = calls[0][2].options.find((option) => option.name === 'close');
  assert.equal(close.options[0].name, 'channel');
  assert.equal(close.options[0].required, false);
  assert.deepEqual(close.options[0].channel_types, [0]);
  assert.deepEqual(calls.map((call) => call[2].name), ['ticket', 'moderation', 'utility', 'economy', 'roles', 'level', 'leaderboard']);
  const moderation = calls[1][2].options;
  assert.deepEqual(moderation.map((option) => option.name), ['ban', 'kick', 'timeout', 'purge', 'slowmode', 'warn', 'warnings', 'clear-warnings']);
  assert.equal(moderation.find((option) => option.name === 'timeout').options.find((option) => option.name === 'minutes').max_value, 40320);
  assert.deepEqual(calls[4][2].options.map((option) => option.name), ['grant', 'revoke', 'nickname', 'clear-nickname']);
  assert.equal(calls[5][2].options[0].name, 'user');
  assert.deepEqual(calls[6][2].options.map((option) => option.name), ['levels', 'coins']);
});
