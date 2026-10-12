'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AutoModService } = require('../src/automod-service');
const { createInteractionHandler } = require('../src/interactions');
const { ids, fakeDiscord, interaction } = require('./feature-fixtures');
function fixture() {
  const fake = fakeDiscord(); const rules = new Map(); const edits = [];
  const rule = { id: ids.menu, guild_id: ids.guild, creator_id: ids.bot, name: 'Latch: Review', event_type: 1, trigger_type: 1, trigger_metadata: { keyword_filter: ['blocked'], regex_patterns: ['test'], allow_list: [] }, enabled: false, actions: [{ type: 1 }, { type: 2, metadata: { channel_id: ids.channel } }], exempt_roles: [], exempt_channels: [] }; rules.set(rule.id, rule);
  fake.discord.getAutoModRule = async (guild, id) => { assert.equal(guild, ids.guild); return structuredClone(rules.get(id)); };
  fake.discord.editAutoModRule = async (guild, id, patch) => { edits.push(structuredClone(patch)); Object.assign(rules.get(id), structuredClone(patch)); };
  fake.discord.createAutoModRule = async (guild, body) => { const created = { ...structuredClone(body), id: ids.message, guild_id: guild, creator_id: ids.bot }; rules.set(created.id, created); return structuredClone(created); };
  const service = new AutoModService({ discord: fake.discord, guildId: ids.guild, botUserId: ids.bot });
  return { ...fake, service, rule, rules, edits, configure: (action, extra = {}) => service.configure({ action, ruleId: ids.menu, actorId: ids.actor, ...extra }) };
}
for (const [preset, values] of [['profanity', [1]], ['sexual', [2]], ['slurs', [3]], ['all', [1, 2, 3]]]) test(`AutoMod preset ${preset} creates a disabled native wordset rule`, async () => {
  const f = fixture(); const rule = await f.service.create({ kind: 'presets', name: 'Safety', preset, actorId: ids.actor });
  assert.equal(rule.trigger_type, 4); assert.equal(rule.enabled, false); assert.deepEqual(rule.trigger_metadata, { presets: values, allow_list: [] }); assert.deepEqual(rule.actions, [{ type: 1 }]);
});
test('AutoMod presets reject unknown names and inherited keys', async () => {
  const f = fixture(); for (const preset of ['unknown', 'constructor', '__proto__']) await assert.rejects(f.service.create({ kind: 'presets', name: 'Safety', preset }), /preset/);
});
test('AutoMod role/channel exemptions validate targets and preserve every unrelated setting', async () => {
  const f = fixture(); const original = structuredClone(f.rule);
  await f.configure('exempt-role', { targetId: ids.role }); await f.configure('exempt-channel', { targetId: ids.channel });
  assert.deepEqual(f.rule.exempt_roles, [ids.role]); assert.deepEqual(f.rule.exempt_channels, [ids.channel]); assert.equal(f.rule.enabled, false);
  for (const key of ['actions', 'trigger_metadata', 'trigger_type', 'name']) assert.deepEqual(f.rule[key], original[key]);
  assert.deepEqual(await f.configure('exempt-role', { targetId: ids.role }), { changed: false });
  f.roles.splice(1, 1); f.channels.delete(ids.channel);
  await f.configure('unexempt-role', { targetId: ids.role }); await f.configure('unexempt-channel', { targetId: ids.channel });
  assert.deepEqual(f.rule.exempt_roles, []); assert.deepEqual(f.rule.exempt_channels, []);
});
test('AutoMod exemption edits serialize to retain concurrent additions', async () => {
  const f = fixture(); await Promise.all([f.configure('exempt-role', { targetId: ids.role }), f.configure('exempt-role', { targetId: ids.actorRole })]); assert.deepEqual(f.rule.exempt_roles, [ids.role, ids.actorRole]);
});
test('AutoMod rejects everyone, absent roles, foreign channels and invalid IDs before writes', async () => {
  const f = fixture(); await assert.rejects(f.configure('exempt-role', { targetId: ids.guild }), /everyone/);
  await assert.rejects(f.configure('exempt-role', { targetId: ids.menu }), /role/);
  f.channels.get(ids.channel).guild_id = ids.owner; await assert.rejects(f.configure('exempt-channel', { targetId: ids.channel }), /server/);
  await assert.rejects(f.configure('unexempt-channel', { targetId: 123456 }), /valid/); assert.equal(f.edits.length, 0);
});
for (const [kind, maximum, field, target] of [['role', 20, 'exempt_roles', ids.role], ['channel', 50, 'exempt_channels', ids.channel]]) test(`AutoMod ${kind} exemption cap refuses overflow and accepts an existing entry`, async () => {
  const f = fixture(); f.rule[field] = Array.from({ length: maximum }, (_, n) => String(BigInt(ids.message) + BigInt(n)));
  await assert.rejects(f.configure(`exempt-${kind}`, { targetId: target }), /limit/); f.rule[field][0] = target;
  assert.deepEqual(await f.configure(`exempt-${kind}`, { targetId: target }), { changed: false }); assert.equal(f.edits.length, 0);
});
test('AutoMod allow words replace/clear exceptions while preserving trigger filters', async () => {
  const f = fixture(); await f.configure('allow-words', { words: 'allowed, allowed, phrase' });
  assert.deepEqual(f.rule.trigger_metadata, { keyword_filter: ['blocked'], regex_patterns: ['test'], allow_list: ['allowed', 'phrase'] });
  await f.configure('allow-words', { words: '' }); assert.deepEqual(f.rule.trigger_metadata.allow_list, []);
  await assert.rejects(f.configure('allow-words', { words: 'x'.repeat(61) }), /allowed words/);
  await assert.rejects(f.configure('allow-words', { words: Array.from({ length: 101 }, (_, n) => `word-${n}`).join(',') }), /allowed words/);
  f.rule.trigger_type = 3; await assert.rejects(f.configure('allow-words', { words: 'allowed' }), /keyword/);
});
test('AutoMod block explanation preserves alert actions and rejects missing/oversized messages', async () => {
  const f = fixture(); await f.configure('block-message', { message: ' Please follow the rules. ' }); assert.equal(f.rule.actions[0].metadata.custom_message, 'Please follow the rules.'); assert.deepEqual(f.rule.actions[1], { type: 2, metadata: { channel_id: ids.channel } });
  await assert.rejects(f.configure('block-message', { message: 'x'.repeat(151) }), /150/); f.rule.actions = [{ type: 2 }]; await assert.rejects(f.configure('block-message', { message: 'Rules' }), /blocking/);
});
for (const [label, edit] of [['foreign creator', (r) => { r.creator_id = ids.actor; }], ['foreign guild', (r) => { r.guild_id = ids.actor; }], ['mismatched ID', (r) => { r.id = ids.channel; }], ['foreign prefix', (r) => { r.name = 'Other bot'; }]]) test(`AutoMod refuses ${label} for inspection and configuration`, async () => {
  const f = fixture(); edit(f.rule); await assert.rejects(f.service.inspect(ids.menu), /own/); await assert.rejects(f.configure('exempt-role', { targetId: ids.role }), /own/); assert.equal(f.edits.length, 0);
});
test('AutoMod invalid exemption snapshots and failed edits remain recoverable', async () => {
  const f = fixture(); f.rule.exempt_roles = [ids.role, ids.role]; await assert.rejects(f.configure('exempt-role', { targetId: ids.actorRole }), /invalid/); f.rule.exempt_roles = [];
  const original = f.discord.editAutoModRule; f.discord.editAutoModRule = async () => { throw new Error('Unavailable'); }; await assert.rejects(f.configure('exempt-role', { targetId: ids.role })); assert.deepEqual(f.rule.exempt_roles, []);
  f.discord.editAutoModRule = original; await f.configure('exempt-role', { targetId: ids.role }); const snapshot = await f.service.inspect(ids.menu); snapshot.exempt_roles.push(ids.actor); assert.deepEqual(f.rule.exempt_roles, [ids.role]);
});
for (const action of ['info', 'presets', 'exempt-role', 'unexempt-role', 'exempt-channel', 'unexempt-channel', 'allow-words', 'block-message']) test(`AutoMod ${action} command denies missing staff permissions`, async () => {
  const f = fixture(); const handler = createInteractionHandler({ config: { guildId: ids.guild, applicationId: ids.bot }, automod: f.service, discord: f.discord }); const result = await handler(interaction('automod', action, { rule: ids.menu }, '0')); assert.match(result.immediate.data.content, /Manage Server/); assert.equal(f.edits.length, 0);
});
test('AutoMod new command paths send private confirmations and safe failure replies', async () => {
  const f = fixture(); const handler = createInteractionHandler({ config: { guildId: ids.guild, applicationId: ids.bot }, automod: f.service, discord: f.discord });
  const run = async (action, values) => { const result = await handler(interaction('automod', action, values)); assert.equal(result.immediate.type, 5); assert.equal(result.immediate.data.flags, 64); await result.work(); const body = f.calls.filter((call) => call[0] === 'response').at(-1)[3]; assert.deepEqual(body.allowed_mentions, { parse: [] }); return body.content; };
  assert.match(await run('presets', { name: 'Safety', preset: 'all' }), /disabled/);
  for (const [action, values] of [['exempt-role', { target: ids.role }], ['exempt-channel', { target: ids.channel }], ['allow-words', { words: 'safe' }], ['block-message', { message: 'Rules' }], ['unexempt-role', { target: ids.role }], ['unexempt-channel', { target: ids.channel }]]) assert.match(await run(action, { rule: ids.menu, ...values }), /saved/);
  assert.match(await run('info', { rule: ids.menu }), /Block explanation: Rules/);
  f.discord.getAutoModRule = async () => { throw new Error('PRIVATE_TOKEN'); }; const error = await run('info', { rule: ids.menu }); assert.match(error, /Could not complete/); assert.ok(!error.includes('PRIVATE_TOKEN'));
});

for (const mode of ['block', 'alert', 'block-alert', 'block-timeout', 'block-alert-timeout']) test(`AutoMod policy ${mode} replaces actions and preserves rule settings`, async () => {
  const f = fixture(); const before = structuredClone(f.rule);
  const input = { ruleId: ids.menu, mode, actorId: ids.actor };
  if (mode.includes('alert')) input.channelId = ids.channel;
  if (mode.includes('timeout')) input.seconds = 120;
  await f.service.policy(input);
  assert.deepEqual(f.rule.actions.map((entry) => entry.type), [ ...(mode !== 'alert' ? [1] : []), ...(mode.includes('alert') ? [2] : []), ...(mode.includes('timeout') ? [3] : []) ]);
  for (const key of Object.keys(before).filter((key) => key !== 'actions')) assert.deepEqual(f.rule[key], before[key]);
  assert.deepEqual(await f.service.policy(input), { changed: false });
});
for (const seconds of [0, -1, 1.5, 2419201, '60', null]) test(`AutoMod policy rejects invalid timeout ${seconds}`, async () => {
  const f = fixture(); await assert.rejects(f.service.policy({ ruleId: ids.menu, mode: 'block-timeout', seconds }), /Timeouts/); assert.equal(f.edits.length, 0);
});
for (const trigger of [3, 4, 6]) test(`AutoMod policy rejects timeout trigger ${trigger}`, async () => {
  const f = fixture(); f.rule.trigger_type = trigger; await assert.rejects(f.service.policy({ ruleId: ids.menu, mode: 'block-timeout', seconds: 60 })); assert.equal(f.edits.length, 0);
});
test('AutoMod policy validates channels, options and action snapshots before writes', async () => {
  const f = fixture(); const input = { ruleId: ids.menu, mode: 'block-alert', channelId: ids.channel };
  for (const extra of [{ mode: 'unknown' }, { channelId: undefined }, { seconds: 60 }, { channelId: 'bad' }]) await assert.rejects(f.service.policy({ ...input, ...extra }));
  const channel = f.channels.get(ids.channel); const original = structuredClone(channel);
  for (const extra of [{ guild_id: ids.owner }, { type: 2 }, { id: ids.owner }]) { Object.assign(channel, original, extra); await assert.rejects(f.service.policy(input), /channel/); }
  Object.assign(channel, original); f.rule.actions = [{ type: 4 }]; await assert.rejects(f.service.policy(input), /unsupported/); assert.equal(f.edits.length, 0);
});
test('AutoMod policy preserves block explanation and serializes concurrent changes', async () => {
  const f = fixture(); await Promise.all([f.configure('block-message', { message: 'Follow server rules.' }), f.service.policy({ ruleId: ids.menu, mode: 'block-timeout', seconds: 2419200 })]);
  assert.deepEqual(f.rule.actions, [{ type: 1, metadata: { custom_message: 'Follow server rules.' } }, { type: 3, metadata: { duration_seconds: 2419200 } }]);
});
test('AutoMod timeout command requires Moderate Members in addition to Manage Server', async () => {
  const f = fixture(); const handler = createInteractionHandler({ config: { guildId: ids.guild, applicationId: ids.bot }, automod: f.service, discord: f.discord });
  const result = await handler(interaction('automod', 'policy', { rule: ids.menu, mode: 'block-timeout', seconds: 60 }, '32')); await result.work();
  assert.equal(f.edits.length, 0); assert.match(f.calls.at(-1)[3].content, /Moderate Members/);
});

test('AutoMod policy command applies authorized timeout privately and reports policy metadata', async () => {
  const f = fixture(); const handler = createInteractionHandler({ config: { guildId: ids.guild, applicationId: ids.bot }, automod: f.service, discord: f.discord });
  const result = await handler(interaction('automod', 'policy', { rule: ids.menu, mode: 'block-alert-timeout', channel: ids.channel, seconds: 60 }, '1099511627808'));
  assert.equal(result.immediate.data.flags, 64); await result.work(); assert.equal(f.rule.actions[2].metadata.duration_seconds, 60);
  assert.deepEqual(f.calls.at(-1)[3].allowed_mentions, { parse: [] });
});
test('AutoMod policy queue recovers after Discord refuses an edit', async () => {
  const f = fixture(); const original = f.discord.editAutoModRule; f.discord.editAutoModRule = async () => { throw new Error('Denied'); };
  await assert.rejects(f.service.policy({ ruleId: ids.menu, mode: 'block' })); assert.equal(f.rule.actions.length, 2);
  f.discord.editAutoModRule = original; await f.service.policy({ ruleId: ids.menu, mode: 'block' }); assert.deepEqual(f.rule.actions, [{ type: 1 }]);
});
