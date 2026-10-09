'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DiscordApi } = require('../src/discord-api');

test('REST errors never contain webhook URL tokens or server response bodies', async () => {
  const secret = 'fake-interaction-secret';
  const api = new DiscordApi('fake-bot-secret', async () => ({ ok: false, status: 401, json: async () => ({ message: secret }) }));
  await assert.rejects(api.editOriginalResponse('123456789012345678', secret, { content: 'ok' }), (error) => {
    assert.match(error.message, /401/);
    assert.doesNotMatch(error.message, /fake-interaction-secret|api\/webhooks|fake-bot-secret/);
    return true;
  });
});

test('network errors are replaced with a credential-safe message', async () => {
  const secret = 'fake-interaction-secret';
  const api = new DiscordApi('fake-bot-secret', async () => { throw new Error(`failed ${secret}`); });
  await assert.rejects(api.editOriginalResponse('123456789012345678', secret, {}), (error) => {
    assert.equal(error.message, 'Discord API request failed before receiving a response.');
    return true;
  });
});

test('interaction webhook calls use their interaction token without sending the bot token', async () => {
  const calls = [];
  const api = new DiscordApi('fake-bot-secret', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
  await api.request('GET', '/users/@me');
  await api.editOriginalResponse('123456789012345678', 'fake-interaction-secret', { content: 'done' });
  assert.equal(calls[0].options.headers.Authorization, 'Bot fake-bot-secret');
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.match(calls[1].url, /fake-interaction-secret/);
});

test('204 permission updates are accepted without trying to parse an empty body', async () => {
  const api = new DiscordApi('fake-bot-secret', async () => ({ ok: true, status: 204, json: async () => { throw new Error('empty response must not be parsed'); } }));
  assert.equal(await api.setMemberOverwrite('123456789012345678', '223456789012345678', { type: 1, allow: '1024', deny: '2048' }), null);
});

test('moderation requests encode audit reasons and preserve the bot authorization header', async () => {
  const calls = [];
  const api = new DiscordApi('fake-bot-secret', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 204, json: async () => null };
  });
  await api.banMember('123456789012345678', '223456789012345678', 'spam & scams');
  assert.match(calls[0].url, /\/guilds\/123456789012345678\/bans\/223456789012345678$/);
  assert.equal(calls[0].options.headers.Authorization, 'Bot fake-bot-secret');
  assert.equal(calls[0].options.headers['X-Audit-Log-Reason'], 'spam%20%26%20scams');
});

test('message moderation endpoints use the expected channel routes', async () => {
  const calls = [];
  const api = new DiscordApi('fake-bot-secret', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: options.method === 'GET' ? 200 : 204, json: async () => [] };
  });
  await api.getChannelMessages('123456789012345678', 20);
  await api.deleteChannelMessage('123456789012345678', '223456789012345678', 'cleanup');
  await api.bulkDeleteChannelMessages('123456789012345678', ['223456789012345678', '323456789012345678'], 'cleanup');
  assert.match(calls[0].url, /\/channels\/123456789012345678\/messages\?limit=20$/);
  assert.match(calls[1].url, /\/channels\/123456789012345678\/messages\/223456789012345678$/);
  assert.equal(calls[2].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[2].options.body), { messages: ['223456789012345678', '323456789012345678'] });
});

test('role and nickname endpoints retain audit reasons', async () => {
  const calls = [];
  const api = new DiscordApi('fake-bot-secret', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 204, json: async () => null };
  });
  await api.grantRole('123456789012345678', '223456789012345678', '323456789012345678', 'staff grant');
  await api.revokeRole('123456789012345678', '223456789012345678', '323456789012345678', 'staff revoke');
  await api.setNickname('123456789012345678', '223456789012345678', null, 'staff reset');
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[1].options.method, 'DELETE');
  assert.equal(calls[2].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[2].options.body), { nick: null });
  assert.equal(calls[2].options.headers['X-Audit-Log-Reason'], 'staff%20reset');
});
