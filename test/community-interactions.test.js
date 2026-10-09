'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInteractionHandler } = require('../src/interactions');
const config = { guildId: '123456789012345678', applicationId: '223456789012345678' };
const base = { type: 2, guild_id: config.guildId, channel_id: '323456789012345678', token: 'fake', member: { user: { id: '423456789012345678' }, permissions: '0' } };
test('embeds require authorization and publish only to the invoking channel without mentions', async () => {
  const sent = [];
  const handler = createInteractionHandler({ config, discord: { createMessage: async (...args) => sent.push(args), editOriginalResponse: async () => {} } });
  const data = { name: 'embed', options: [{ name: 'title', value: 'News' }, { name: 'description', value: '@everyone Update' }, { name: 'color', value: '#123abc' }] };
  assert.match((await handler({ ...base, data })).immediate.data.content, /Manage Messages/);
  assert.equal(sent.length, 0);
  const result = await handler({ ...base, data, member: { ...base.member, permissions: '8192' } });
  assert.equal(result.immediate.data.flags, 64);
  await result.work();
  assert.equal(sent[0][0], base.channel_id);
  assert.deepEqual(sent[0][1], { embeds: [{ title: 'News', description: '@everyone Update', color: 0x123abc }], allowed_mentions: { parse: [] } });
});
test('dice bounds and invalid embed colors are rejected without API work', async () => {
  const handler = createInteractionHandler({ config, discord: {} });
  const invalid = await handler({ ...base, data: { name: 'fun', options: [{ name: 'roll', options: [{ name: 'sides', value: 1001 }] }] } });
  assert.match(invalid.immediate.data.content, /2 to 1000/);
  const roll = await handler({ ...base, data: { name: 'fun', options: [{ name: 'roll' }] } });
  assert.match(roll.immediate.data.content, /D6: \*\*[1-6]\*\*/);
  const badEmbed = await handler({ ...base, member: { ...base.member, permissions: '8192' }, data: { name: 'embed', options: [{ name: 'title', value: 'a' }, { name: 'description', value: 'b' }, { name: 'color', value: 'red' }] } });
  assert.equal(badEmbed.work, undefined);
});
