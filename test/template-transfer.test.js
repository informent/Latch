'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { importTemplate, exportTemplate } = require('../src/template-transfer');
const { TemplateStore } = require('../src/template-store');
const { createInteractionHandler } = require('../src/interactions');
const { directory, ids, fakeDiscord, interaction } = require('./feature-fixtures');
const item = { name: 'game-night', title: 'Game night', description: '@everyone Bring a friend', color: 0x73df9f };
test('portable templates round trip without guild IDs or mutable references', () => {
  const doc = exportTemplate(item); doc.template.title = 'changed'; assert.equal(item.title, 'Game night');
  const parsed = importTemplate(JSON.stringify(exportTemplate(item)), 'new-name'); assert.deepEqual(parsed, { ...item, name: 'new-name' });
  assert.deepEqual(Object.keys(exportTemplate(item)).sort(), ['kind', 'template', 'version']);
});
test('imports reject invalid versions, fields, names, colors, malformed JSON and oversized input', () => {
  for (const input of [null, '', '{', 'x'.repeat(6001), JSON.stringify({ ...exportTemplate(item), version: 2 }), JSON.stringify({ ...exportTemplate(item), guildId: ids.guild }), JSON.stringify({ ...exportTemplate(item), template: { ...item, color: -1 } }), JSON.stringify({ ...exportTemplate(item), template: { ...item, token: 'private' } })]) assert.throws(() => importTemplate(input, 'copy'));
  assert.throws(() => importTemplate(JSON.stringify(exportTemplate(item)), '../bad'));
  assert.throws(() => exportTemplate({ ...item, name: '../bad' }));
});
test('private import/export persists, never overwrites and requires staff permission', async t => {
  const root = await directory(t), templates = new TemplateStore(path.join(root, 'templates.json'), ids.guild), f = fakeDiscord();
  const handler = createInteractionHandler({ config: { guildId: ids.guild, applicationId: ids.bot }, templates, ...f });
  async function run(action, values, permissions = '8192') {
    const result = await handler(interaction('template', action, values, permissions)); assert.equal(result.immediate.data.flags, 64);
    if (result.work) await result.work(); return result;
  }
  await run('import', { name: 'welcome', json: JSON.stringify(exportTemplate(item)) }); assert.equal(templates.get('welcome').title, item.title);
  await run('export', { name: 'welcome' }); const reply = f.calls.filter(call => call[0] === 'response').at(-1);
  assert.deepEqual(reply[3].allowed_mentions, { parse: [] }); assert.equal(reply[4].filename, 'welcome.json'); assert.equal(JSON.parse(reply[4].data).template.name, 'welcome');
  await run('import', { name: 'welcome', json: JSON.stringify(exportTemplate({ ...item, title: 'overwrite' })) }); assert.equal(templates.get('welcome').title, item.title);
  const denied = await run('import', { name: 'other', json: JSON.stringify(exportTemplate(item)) }, '0'); assert.equal(denied.work, undefined); assert.equal(templates.get('other'), null);
  const reopened = new TemplateStore(templates.filePath, ids.guild); await reopened.load(); assert.deepEqual(reopened.list(), templates.list());
  assert.ok(!f.calls.some(call => call[0] === 'message'));
});
