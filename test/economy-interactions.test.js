'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInteractionHandler } = require('../src/interactions');

const config = { guildId: '123456789012345678', applicationId: '123456789012345679' };
const userId = '223456789012345678';
const targetId = '323456789012345678';
const interaction = (action, options = []) => ({
  type: 2, guild_id: config.guildId, channel_id: '423456789012345678', token: 'interaction-token',
  member: { user: { id: userId }, roles: [], permissions: '0' },
  data: { name: 'economy', options: [{ name: action, options }] }
});

test('economy reward command persists a daily claim and updates the response', async () => {
  const claims = [];
  const edited = [];
  const economy = { claim: async (...args) => { claims.push(args); return { claimed: true, reward: 100, balance: 100 }; } };
  const discord = { editOriginalResponse: async (...args) => edited.push(args) };
  const handler = createInteractionHandler({ config, economy, discord });
  const result = await handler(interaction('daily'));
  assert.equal(result.immediate.type, 5);
  await result.work();
  assert.deepEqual(claims[0].slice(0, 3), [config.guildId, userId, 'daily']);
  assert.match(edited[0][2].content, /earned \*\*100\*\* coins/);
});

test('economy pay rejects invalid transfers and leaves balances unchanged', async () => {
  let called = false;
  const discord = {};
  const economy = { transfer: async () => { called = true; } };
  const handler = createInteractionHandler({ config, economy, discord });
  const result = await handler(interaction('pay', [{ name: 'user', value: userId }, { name: 'amount', value: 10 }]));
  assert.match(result.immediate.data.content, /cannot transfer coins to yourself/);
  assert.equal(called, false);
});

test('level and unified leaderboard commands show guild scoped XP and coin rankings', async () => {
  const handler = createInteractionHandler({
    config, discord: {},
    levels: { get: () => ({ level: 3, xp: 950, xpToNextLevel: 50 }), leaderboard: () => [{ userId, level: 3, xp: 950 }] },
    economy: { leaderboard: () => [{ userId, balance: 100 }] }
  });
  const level = await handler({ ...interaction(''), data: { name: 'level', options: [] } });
  assert.match(level.immediate.data.content, /level \*\*3\*\* with \*\*950 XP\*\*/);
  const xpBoard = await handler({ ...interaction('levels'), data: { name: 'leaderboard', options: [{ name: 'levels', type: 1 }] } });
  assert.match(xpBoard.immediate.data.content, /Server XP leaderboard/);
  const coinBoard = await handler({ ...interaction('coins'), data: { name: 'leaderboard', options: [{ name: 'coins', type: 1 }] } });
  assert.match(coinBoard.immediate.data.content, /Server coin leaderboard/);
});
