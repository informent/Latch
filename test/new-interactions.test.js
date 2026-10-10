'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { directory, ids, epoch, fakeDiscord, interaction } = require('./feature-fixtures');
const { createInteractionHandler } = require('../src/interactions');
const { TemplateStore } = require('../src/template-store');
const { ResponderStore } = require('../src/responder-store');
const { TimerStore } = require('../src/timer-store');
const { TimerService } = require('../src/timer-service');
const { EconomyStore } = require('../src/economy-store');
async function fixture(t) {
  const root = await directory(t); const f = fakeDiscord(); const config = { guildId: ids.guild, applicationId: ids.bot, respondersEnabled: true };
  const templates = new TemplateStore(path.join(root, 'templates.json'), ids.guild); const responders = new ResponderStore(path.join(root, 'responders.json'), ids.guild);
  const store = new TimerStore(path.join(root, 'timers.json'), ids.guild); const timers = new TimerService({ config, store, discord: f.discord, now: () => epoch });
  const economy = new EconomyStore(path.join(root, 'coins.json'), { rollBeg: () => 25 }); t.after(() => timers.stop());
  const handler = createInteractionHandler({ config, ...f, templates, responders, timers, economy, now: () => new Date(epoch) });
  async function run(payload) { const result = await handler(payload); assert.equal(result.immediate.type, 5); await result.work(); const response = f.calls.filter(([kind]) => kind === 'response').at(-1); assert.deepEqual(response[3].allowed_mentions, { parse: [] }); return response[3]; }
  return { ...f, config, handler, run, templates, responders, timers, economy };
}
for (const command of ['template', 'responder', 'timer', 'roles', 'moderation']) test(`${command} interactions reject missing staff permission before API work`, async (t) => {
  const f = await fixture(t); const action = command === 'roles' ? 'grant' : command === 'moderation' ? 'ban' : 'create';
  const result = await f.handler(interaction(command, action, {}, '0')); assert.equal(result.immediate.type, 4); assert.equal(result.immediate.data.flags, 64); assert.equal(f.calls.length, 0);
});
test('templates interaction create/update/preview/send/info/list/delete use private confirmations', async (t) => {
  const f = await fixture(t); const values = { name: 'hello', title: 'Title', description: '@everyone Body', color: '#abcdef' };
  for (const action of ['create', 'update']) assert.match((await f.run(interaction('template', action, values))).content, /saved/);
  assert.equal((await f.run(interaction('template', 'preview', { name: 'hello' }))).embeds[0].description, values.description);
  for (const action of ['info', 'list', 'send', 'delete']) assert.ok(!(await f.run(interaction('template', action, { name: 'hello' }))).content.includes('failed'));
  assert.deepEqual(f.calls.find(([kind]) => kind === 'message')[2].allowed_mentions, { parse: [] }); assert.equal(f.templates.get('hello'), null);
  assert.match((await f.run(interaction('template', 'send', { name: 'missing' }))).content, /failed/);
});
for (const command of ['responder', 'timer']) test(`${command} interaction review, enable, disable and deletion flows`, async (t) => {
  const f = await fixture(t); const values = command === 'responder' ? { name: 'hello', trigger: 'hello', reply: '@everyone Hello', cooldown: 15 } : { name: 'hello', minutes: 5, text: '@everyone Hello' };
  for (const action of ['create', 'info', 'preview', 'list', 'enable', 'disable', 'update', 'delete']) {
    const result = await f.run(interaction(command, action, ['create', 'update'].includes(action) ? values : { name: 'hello' })); assert.ok(!result.content.includes('action failed'), `${command} ${action}: ${result.content}`);
  }
});
test('economy interaction beg/profile and nested profession flows publish stored state privately', async (t) => {
  const f = await fixture(t);
  const profession = (action, values = {}) => { const payload = interaction('economy', 'profession'); payload.data.options[0].options = [{ name: action, options: Object.entries(values).map(([name, value]) => ({ name, value })) }]; return payload; };
  assert.match((await f.run(profession('choose', { name: 'artist' }))).content, /set to artist/);
  assert.match((await f.run(profession('status'))).content, /artist/);
  const listed = await f.handler(profession('list')); assert.equal(listed.immediate.type, 4);
  assert.match((await f.run(interaction('economy', 'beg'))).content, /25/); assert.match((await f.run(interaction('economy', 'profile'))).content, /artist/);
  assert.match((await f.run(interaction('economy', 'beg'))).content, /again/);
  const role = await f.run(interaction('utility', 'role', { role: ids.role })); assert.match(role.content, /permission bits/);
});
