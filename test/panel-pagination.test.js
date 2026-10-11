'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { directory, ids, fakeDiscord, interaction } = require('./feature-fixtures');
const { RoleMenuStore } = require('../src/role-menu-store');
const { TicketPanelStore } = require('../src/ticket-panel-store');
const { createInteractionHandler } = require('../src/interactions');
const { commands } = require('../src/commands');

async function fixture(t, suite, count) {
  const root = await directory(t); const f = fakeDiscord();
  const store = suite === 'rolemenu' ? new RoleMenuStore(path.join(root, 'menus.json'), ids.guild) : new TicketPanelStore(path.join(root, 'panels.json'), ids.guild);
  for (let i = count - 1; i >= 0; i--) await store.create({ id: String(9999999999999999999999980n + BigInt(i)), channelId: ids.channel, title: 'x'.repeat(200), ...(suite === 'ticketpanel' ? { description: '' } : {}) });
  const list = () => suite === 'rolemenu' ? store.get().menus : store.list();
  const service = { list };
  const handler = createInteractionHandler({ config: { guildId: ids.guild, applicationId: ids.bot }, ...f, [suite === 'rolemenu' ? 'roleMenus' : 'ticketPanels']: service });
  async function run(options = {}, permission = suite === 'rolemenu' ? '268435456' : '32', guild = ids.guild) {
    const payload = interaction(suite, 'list', options, permission); payload.guild_id = guild;
    const result = await handler(payload); assert.equal(result.immediate.data.flags, 64);
    if (!result.work) return result.immediate.data;
    await result.work(); const reply = f.calls.filter(([kind]) => kind === 'response').at(-1)[3];
    assert.deepEqual(reply.allowed_mentions, { parse: [] }); assert.ok(reply.content.length < 1900); return reply;
  }
  return { store, service, list, run, calls: f.calls };
}
for (const suite of ['rolemenu', 'ticketpanel']) {
  test(`${suite} lists all twenty full-length titles and precise IDs across four pages`, async (t) => {
    const f = await fixture(t, suite, 20); const before = f.list(); const seen = [];
    for (let page = 1; page <= 4; page++) {
      const reply = await f.run({ page }); assert.match(reply.content, new RegExp(`20 \\| Page ${page}/4`));
      const rows = reply.content.split('\n').slice(1); assert.equal(rows.length, 5);
      for (const row of rows) { assert.ok(row.includes('x'.repeat(200))); seen.push(row.split(':')[0]); }
    }
    assert.deepEqual(seen, before.map(item => item.id).reverse()); assert.deepEqual(f.list(), before);
    assert.ok(f.calls.every(([kind]) => kind === 'response'));
  });
  test(`${suite} defaults to page one and supports a partial final page`, async (t) => {
    const f = await fixture(t, suite, 6); assert.match((await f.run()).content, /Page 1\/2/);
    assert.equal((await f.run({ page: 2 })).content.split('\n').length, 2);
  });
  test(`${suite} has an explicit empty state`, async (t) => {
    const f = await fixture(t, suite, 0); const reply = await f.run(); assert.match(reply.content, /0 \| Page 1\/1/); assert.match(reply.content, /No /);
  });
  for (const page of [0, -1, 1.5, '1', 2, Infinity]) test(`${suite} rejects invalid page ${page}`, async (t) => {
    const f = await fixture(t, suite, 1); assert.equal((await f.run({ page })).content, 'Choose a page from 1 to 1.');
  });
  test(`${suite} enforces permissions and configured guild before reading`, async (t) => {
    const f = await fixture(t, suite, 1); f.service.list = () => { throw new Error('Must not read'); };
    assert.match((await f.run({}, '0')).content, /You need Manage/);
    assert.match((await f.run({}, '8', ids.owner)).content, /not available/); assert.equal(f.calls.length, 0);
  });
  test(`${suite} normalizes multiline titles and preserves pending status`, async (t) => {
    const f = await fixture(t, suite, 1); const entries = f.list(); entries[0].title = 'Hello\r\n@everyone <test> `code`'; entries[0].pending = true;
    f.service.list = () => entries;
    const reply = await f.run(); assert.equal(reply.content.split('\n').length, 2); assert.match(reply.content, /pending/);
    assert.ok(!reply.content.includes('@everyone')); assert.ok(!reply.content.includes('<test>')); assert.ok(!reply.content.includes('`code`'));
  });
  test(`${suite} declares optional bounded pagination`, () => {
    const command = commands.find(item => item.name === suite).options.find(item => item.name === 'list');
    const option = command.options[0]; assert.equal(option.name, 'page'); assert.equal(option.type, 4);
    assert.equal(option.min_value, 1); assert.equal(option.max_value, 4); assert.ok(!option.required);
  });
}
