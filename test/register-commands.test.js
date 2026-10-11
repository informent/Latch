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
  assert.equal(calls.shift()[2].name, 'poll');
  assert.equal(calls[0][2].name, 'ticket');
  assert.equal(Array.isArray(calls[0][2]), false);
  const close = calls[0][2].options.find((option) => option.name === 'close');
  assert.equal(close.options[0].name, 'channel');
  assert.equal(close.options[0].required, false);
  assert.deepEqual(close.options[0].channel_types, [0]);
  assert.deepEqual(calls.map((call) => call[2].name), ['ticket', 'moderation', 'utility', 'economy', 'roles', 'level', 'leaderboard', 'automod', 'embed', 'fun', 'reminder', 'giveaway', 'shop', 'voice', 'rolemenu', 'autorole', 'template', 'responder', 'timer', 'levelreward', 'levelconfig', 'ticketpanel', 'pollmanage', 'economyadmin']);
  const moderation = calls[1][2].options;
  assert.deepEqual(moderation.map((option) => option.name), ['ban', 'unban', 'kick', 'timeout', 'untimeout', 'purge', 'slowmode', 'warn', 'warnings', 'clear-warnings']);
  assert.equal(moderation.find((option) => option.name === 'timeout').options.find((option) => option.name === 'minutes').max_value, 40320);
  assert.deepEqual(calls[4][2].options.map((option) => option.name), ['grant', 'revoke', 'nickname', 'clear-nickname']);
  assert.equal(calls[5][2].options[0].name, 'user');
  assert.deepEqual(calls[6][2].options.map((option) => option.name), ['levels', 'coins']);
});

test('all slash-command payloads conform to documented name, description, and nesting limits', () => {
  const namePattern = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;
  for (const command of commands) {
    assert.match(command.name, namePattern);
    assert.ok(command.description.length >= 1 && command.description.length <= 100);
    assert.ok(command.options.length <= 25);
    const hasSubcommands = command.options.some((item) => item.type === 1 || item.type === 2);
    assert.ok(!hasSubcommands || command.options.every((item) => item.type === 1 || item.type === 2), `${command.name} mixes subcommands and parameters`);
    for (const item of command.options) {
      assert.match(item.name, namePattern);
      assert.ok(item.description.length >= 1 && item.description.length <= 100);
      assert.ok((item.options || []).length <= 25);
      for (const parameter of item.options || []) {
        assert.match(parameter.name, namePattern);
        assert.ok(parameter.description.length >= 1 && parameter.description.length <= 100);
      }
    }
  }
});
