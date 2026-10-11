'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { directory, ids, fakeDiscord, interaction } = require('./feature-fixtures');
const { TemplateStore } = require('../src/template-store');
const { createInteractionHandler } = require('../src/interactions');
const { commands } = require('../src/commands');

const original = { name: 'welcome', title: 'Welcome', description: '@everyone Read the rules', color: 0xabcdef };
async function fixture(t) {
  const root = await directory(t); const store = new TemplateStore(path.join(root, 'templates.json'), ids.guild);
  await store.change('create', original); const f = fakeDiscord(); const logs = [];
  const handler = createInteractionHandler({ config: { guildId: ids.guild, applicationId: ids.bot }, ...f, templates: store, logger: (...args) => logs.push(args) });
  async function run(action, values = {}, permissions = '8192', guild = ids.guild) {
    const payload = interaction('template', action, { name: 'welcome', destination: 'onboarding', ...values }, permissions); payload.guild_id = guild;
    const result = await handler(payload); assert.equal(result.immediate.data.flags, 64);
    if (!result.work) return result.immediate.data;
    await result.work(); const reply = f.calls.filter(([kind]) => kind === 'response').at(-1)[3];
    assert.deepEqual(reply.allowed_mentions, { parse: [] }); return reply;
  }
  return { root, store, run, logs, ...f };
}
for (const action of ['clone', 'rename']) {
  test(`template ${action} preserves the embed, persists and never publishes`, async (t) => {
    const f = await fixture(t); assert.match((await f.run(action)).content, action === 'clone' ? /copied/ : /renamed/);
    assert.deepEqual(f.store.get('onboarding'), { ...original, name: 'onboarding' });
    assert.deepEqual(f.store.get('welcome'), action === 'clone' ? original : null);
    const reopened = new TemplateStore(f.store.filePath, ids.guild); await reopened.load(); assert.deepEqual(reopened.list(), f.store.list());
    assert.ok(f.calls.every(([kind]) => kind === 'response'));
  });
  for (const destination of ['', 'UPPER', '-bad', 'has space', '../path', 'x'.repeat(33), null, 123, '@everyone']) {
    test(`template ${action} rejects invalid destination ${String(destination)} atomically`, async (t) => {
      const f = await fixture(t); const before = await fs.readFile(f.store.filePath, 'utf8');
      await assert.rejects(f.store.change(action, { name: original.name, destination }));
      assert.equal(await fs.readFile(f.store.filePath, 'utf8'), before); assert.deepEqual(f.store.list(), [original]);
    });
  }
  test(`template ${action} rejects missing sources, same name and existing destinations`, async (t) => {
    const f = await fixture(t); await f.store.change('create', { ...original, name: 'existing' }); const before = f.store.list();
    for (const input of [{ name: 'missing', destination: 'new' }, { name: 'welcome', destination: 'welcome' }, { name: 'welcome', destination: 'existing' }]) {
      await assert.rejects(f.store.change(action, input)); assert.deepEqual(f.store.list(), before);
    }
  });
  test(`template ${action} rejects nonstaff and foreign guild requests before store access`, async (t) => {
    const f = await fixture(t); assert.match((await f.run(action, {}, '0')).content, /Manage Messages/);
    await f.run(action, {}, '8192', ids.owner); assert.deepEqual(f.store.list(), [original]); assert.equal(f.calls.length, 0);
  });
  test(`template ${action} keeps state intact on failed persistence and recovers afterward`, async (t) => {
    const f = await fixture(t); const file = f.store.filePath; const saved = await fs.readFile(file, 'utf8');
    const blocked = path.join(f.root, 'blocked'); await fs.mkdir(blocked); f.store.filePath = blocked;
    assert.match((await f.run(action)).content, /failed/); assert.deepEqual(f.store.list(), [original]);
    assert.equal(await fs.readFile(file, 'utf8'), saved); assert.ok(!(await fs.readdir(f.root)).some(name => name.endsWith('.tmp')));
    f.store.filePath = file; await f.store.change(action, { name: 'welcome', destination: 'recovered' });
    assert.deepEqual(f.store.get('recovered'), { ...original, name: 'recovered' });
  });
  test(`template ${action} command requires both bounded names`, () => {
    const command = commands.find(item => item.name === 'template').options.find(item => item.name === action);
    assert.deepEqual(command.options.map(option => option.name), ['name', 'destination']);
    for (const option of command.options) { assert.equal(option.type, 3); assert.equal(option.required, true); assert.equal(option.max_length, 32); }
  });
}
test('cloned templates are independent when either copy is updated or deleted', async (t) => {
  const f = await fixture(t); await f.store.change('clone', { name: 'welcome', destination: 'copy' });
  await f.store.change('update', { ...original, name: 'copy', title: 'Changed' }); assert.deepEqual(f.store.get('welcome'), original);
  await f.store.change('delete', { name: 'welcome' }); assert.equal(f.store.get('copy').title, 'Changed');
});
test('capacity rejects cloning but allows renaming without data loss', async (t) => {
  const f = await fixture(t);
  for (let i = 1; i < 50; i++) await f.store.change('create', { ...original, name: `template${i}` });
  const before = f.store.list(); await assert.rejects(f.store.change('clone', { name: 'welcome', destination: 'extra' })); assert.deepEqual(f.store.list(), before);
  await f.store.change('rename', { name: 'welcome', destination: 'x'.repeat(32) }); assert.equal(f.store.list().length, 50); assert.equal(f.store.get('x'.repeat(32)).title, original.title);
});
test('concurrent destination collisions have exactly one winner and never overwrite', async (t) => {
  const f = await fixture(t); await f.store.change('create', { ...original, name: 'second', title: 'Second' });
  const outcomes = await Promise.allSettled([
    f.store.change('clone', { name: 'welcome', destination: 'shared' }),
    f.store.change('rename', { name: 'second', destination: 'shared' })
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.store.get('shared').title, original.title); assert.equal(f.store.get('second').title, 'Second');
});
test('queued template operations isolate destination input from caller mutation', async (t) => {
  const f = await fixture(t); const input = { name: 'welcome', destination: 'copy' };
  const pending = f.store.change('clone', input); input.destination = 'changed'; await pending;
  assert.ok(f.store.get('copy')); assert.equal(f.store.get('changed'), null);
});
