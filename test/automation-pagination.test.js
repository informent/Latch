'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { directory, ids, fakeDiscord, interaction } = require('./feature-fixtures');
const { ResponderStore } = require('../src/responder-store');
const { TimerStore } = require('../src/timer-store');
const { createInteractionHandler } = require('../src/interactions');
const { commands } = require('../src/commands');

async function fixture(t, suite, count) {
  const root = await directory(t); const f = fakeDiscord();
  const store = suite === 'responder' ? new ResponderStore(path.join(root, 'rules.json'), ids.guild) : new TimerStore(path.join(root, 'timers.json'), ids.guild);
  for (let i = count - 1; i >= 0; i--) {
    const name = `rule${String(i).padStart(2, '0')}${'x'.repeat(26)}`;
    await store.change('create', suite === 'responder'
      ? { name, channelId: '9'.repeat(25), trigger: `trigger${i}`, reply: 'Reply', cooldown: 3600 }
      : { name, channelId: '9'.repeat(25), text: 'Message', interval: 43200 });
  }
  const config = { guildId: ids.guild, applicationId: ids.bot, respondersEnabled: false };
  const handler = createInteractionHandler({ config, ...f, [suite === 'responder' ? 'responders' : 'timers']: store });
  async function run(options = {}, permissions = '32', guild = ids.guild) {
    const payload = interaction(suite, 'list', options, permissions); payload.guild_id = guild;
    const result = await handler(payload); assert.equal(result.immediate.data.flags, 64);
    if (!result.work) return result.immediate.data;
    await result.work(); const reply = f.calls.filter(([k]) => k === 'response').at(-1)[3];
    assert.deepEqual(reply.allowed_mentions, { parse: [] }); assert.ok(reply.content.length < 1900);
    return reply;
  }
  return { store, run, calls: f.calls };
}

for (const [suite, maximum] of [['responder', 50], ['timer', 25]]) {
  test(`${suite}: every maximum-length entry appears once across bounded pages`, async (t) => {
    const f = await fixture(t, suite, maximum); const before = f.store.list(); const seen = [];
    for (let page = 1; page <= Math.ceil(maximum / 10); page++) {
      const reply = await f.run({ page }); assert.match(reply.content, new RegExp(`Page ${page}/${Math.ceil(maximum / 10)}`));
      const rows = reply.content.split('\n').filter(line => line.startsWith('rule'));
      assert.equal(rows.length, Math.min(10, maximum - (page - 1) * 10)); seen.push(...rows.map(row => row.split(':')[0]));
    }
    assert.deepEqual(seen, before.map(item => item.name).sort()); assert.equal(new Set(seen).size, maximum);
    assert.deepEqual(f.store.list(), before); assert.ok(f.calls.every(([kind]) => kind === 'response'));
  });
  test(`${suite}: omitted page defaults to first and environment state remains visible`, async (t) => {
    const f = await fixture(t, suite, 11); const reply = await f.run();
    assert.match(reply.content, /Page 1\/2/); assert.equal(reply.content.split('\n').filter(line => line.startsWith('rule')).length, 10);
    if (suite === 'responder') assert.match(reply.content, /disabled in environment/);
  });
  test(`${suite}: empty lists show page one and clear empty state`, async (t) => {
    const f = await fixture(t, suite, 0); assert.match((await f.run()).content, /Page 1\/1/);
    assert.match((await f.run()).content, /No .* configured/);
    assert.equal((await f.run({ page: 2 })).content, 'Choose a page from 1 to 1.');
  });
  for (const page of [0, -1, 1.5, '1', 2, Infinity]) {
    test(`${suite}: rejects invalid or unavailable page ${String(page)}`, async (t) => {
      const f = await fixture(t, suite, 1); const before = f.store.list();
      assert.equal((await f.run({ page })).content, 'Choose a page from 1 to 1.'); assert.deepEqual(f.store.list(), before);
    });
  }
  test(`${suite}: list remains staff-only and guild-scoped`, async (t) => {
    const f = await fixture(t, suite, 1);
    assert.match((await f.run({}, '0')).content, /Manage Server/);
    await f.run({}, '32', ids.owner); assert.equal(f.calls.length, 0);
  });
  test(`${suite}: registration exposes an optional bounded integer page`, () => {
    const option = commands.find(c => c.name === suite).options.find(c => c.name === 'list').options[0];
    assert.equal(option.name, 'page'); assert.equal(option.type, 4); assert.ok(!option.required);
    assert.equal(option.min_value, 1); assert.equal(option.max_value, Math.ceil(maximum / 10));
  });
}
