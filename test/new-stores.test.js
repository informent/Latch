'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { directory, ids, epoch } = require('./feature-fixtures');
const { TemplateStore } = require('../src/template-store');
const { ResponderStore } = require('../src/responder-store');
const { TimerStore } = require('../src/timer-store');
const { VoiceStore } = require('../src/voice-store');
const { RoleMenuStore } = require('../src/role-menu-store');
const template = { name: 'hello', title: 'Hello', description: 'Welcome', color: 0x5865f2 };
const responder = { name: 'hello', channelId: ids.channel, trigger: ' HELLO ', reply: 'Welcome', cooldown: 30 };
const timer = { name: 'hello', channelId: ids.channel, text: 'Welcome', interval: 5 };
const suites = [
  [TemplateStore, (s) => s.change('create', template), (s) => s.change('update', { ...template, title: 'Updated' }), (s) => s.list()],
  [ResponderStore, (s) => s.change('create', responder), (s) => s.change('enable', { name: 'hello' }), (s) => s.list()],
  [TimerStore, (s) => s.change('create', timer), (s) => s.change('enable', { name: 'hello' }, epoch), (s) => s.list()],
  [VoiceStore, (s) => s.configure(ids.lobby, ids.category), (s) => s.add(ids.channel, ids.user, new Date(epoch).toISOString()), (s) => s.get()],
  [RoleMenuStore, (s) => s.create({ id: ids.menu, channelId: ids.channel, title: 'Roles' }), (s) => s.change(ids.menu, 'add', { roleId: ids.role, label: 'Member' }), (s) => s.get()]
];
for (const [Store, seed, change, snapshot] of suites) {
  test(`${Store.name}: reload, guild binding, corruption and failed-write recovery`, async (t) => {
    const root = await directory(t); const file = path.join(root, 'store.json'); const store = new Store(file, ids.guild); await store.load(); await seed(store); await change(store);
    const saved = snapshot(store); const reloaded = new Store(file, ids.guild); await reloaded.load(); assert.deepEqual(snapshot(reloaded), saved);
    await assert.rejects(new Store(file, ids.owner).load());
    const before = await fs.readFile(file, 'utf8');
    const blocked = path.join(root, 'blocked.json'); await fs.mkdir(blocked); store.filePath = blocked;
    const alteration = Store === TemplateStore ? () => store.change('delete', { name: 'hello' }) : Store === VoiceStore ? () => store.configure(null, null) : Store === RoleMenuStore ? () => store.change(ids.menu, 'disable') : () => store.change('disable', { name: 'hello' });
    await assert.rejects(alteration()); assert.deepEqual(snapshot(store), saved); assert.equal(await fs.readFile(file, 'utf8'), before); assert.ok(!(await fs.readdir(root)).some((name) => name.endsWith('.tmp')));
    await fs.writeFile(file, '{broken'); await assert.rejects(reloaded.load()); assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  });
  test(`${Store.name}: rejects unsupported format and oversized input`, async (t) => {
    const root = await directory(t); const file = path.join(root, 'store.json'); const store = new Store(file, ids.guild);
    await fs.writeFile(file, JSON.stringify({ version: 999 })); await assert.rejects(store.load());
    await fs.writeFile(file, Buffer.alloc(1024 * 1024 + 1, 32)); await assert.rejects(store.load());
  });
}
test('templates isolate caller input and returned snapshots', async (t) => {
  const root = await directory(t); const store = new TemplateStore(path.join(root, 'templates.json'), ids.guild); const input = { ...template };
  await store.change('create', input); input.title = 'Tampered'; const copy = store.get('hello'); copy.description = 'Tampered';
  assert.equal(store.get('hello').title, 'Hello'); assert.equal(store.get('hello').description, 'Welcome');
  await assert.rejects(store.change('create', template)); await assert.rejects(store.change('update', { ...template, name: 'missing' }));
  await store.change('update', { ...template, title: 'Updated' }); await store.change('delete', { name: 'hello' }); assert.equal(store.get('hello'), null);
});
test('responder uniqueness, stale claim checks and durable cooldown', async (t) => {
  const root = await directory(t); const file = path.join(root, 'responders.json'); const store = new ResponderStore(file, ids.guild);
  await store.change('create', responder); assert.equal(store.get('hello').trigger, 'hello');
  await assert.rejects(store.change('create', { ...responder, name: 'duplicate' }));
  assert.equal(await store.claim('hello', ids.message, epoch, ids.channel, 'hello'), false);
  await store.change('enable', { name: 'hello' }); assert.equal(await store.claim('hello', ids.message, epoch, ids.channel, 'wrong'), false);
  assert.ok(await store.claim('hello', ids.message, epoch, ids.channel, 'hello'));
  const reloaded = new ResponderStore(file, ids.guild); await reloaded.load(); assert.equal(await reloaded.claim('hello', ids.menu, epoch + 1000, ids.channel, 'hello'), false);
  assert.equal(await reloaded.claim('hello', ids.message, epoch + 31000, ids.channel, 'hello'), false);
  await reloaded.change('update', { name: 'hello', trigger: 'next', reply: 'Next', cooldown: 15 }); assert.equal(reloaded.get('hello').enabled, false);
  await reloaded.change('delete', { name: 'hello' }); assert.equal(reloaded.get('hello'), null);
});
test('timers preserve deadlines, reset on update and protect claim result identity', async (t) => {
  const root = await directory(t); const store = new TimerStore(path.join(root, 'timers.json'), ids.guild);
  await store.change('create', timer); await store.change('enable', { name: 'hello' }, epoch); const deadline = epoch + 300000;
  await store.change('enable', { name: 'hello' }, epoch + 1000); assert.equal(store.get('hello').nextAt, deadline);
  assert.equal(await store.claim('hello', deadline - 1), false); const claimed = await store.claim('hello', deadline); assert.equal(claimed.lastResult, 'pending');
  assert.equal(await store.finish('hello', ids.message, true), false); await store.finish('hello', claimed.nonce, true); assert.equal(store.get('hello').lastResult, 'sent');
  await store.change('update', { name: 'hello', text: 'Changed', interval: 10 }); assert.equal(store.get('hello').enabled, false);
  await store.change('delete', { name: 'hello' }); assert.equal(store.get('hello'), null);
});
