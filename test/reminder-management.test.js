'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CommunityStore } = require('../src/community-store');
const { CommunityService } = require('../src/community-service');
const { createInteractionHandler } = require('../src/interactions');
const { ids, epoch, directory, fakeDiscord, interaction } = require('./feature-fixtures');
async function fixture(t) {
  const root = await directory(t), fake = fakeDiscord(); let clock = epoch;
  const config = { guildId: ids.guild, applicationId: ids.bot };
  const store = new CommunityStore(path.join(root, 'community.json'));
  const community = new CommunityService({ config, store, discord: fake.discord, now: () => new Date(clock) });
  t.after(() => community.stop());
  await community.createReminder({ id: ids.menu, channelId: ids.channel, userId: ids.actor, text: 'Original text', minutes: 10 });
  const handler = createInteractionHandler({ config, community, discord: fake.discord });
  const run = async (action, values = { id: ids.menu }, owner = ids.actor) => {
    const payload = interaction('reminder', action, values, '0'); payload.member.user.id = owner;
    const result = await handler(payload); if (!result.work) return result.immediate.data;
    assert.equal(result.immediate.type, 5); assert.equal(result.immediate.data.flags, 64); await result.work();
    const response = fake.calls.filter((call) => call[0] === 'response').at(-1)[3]; assert.deepEqual(response.allowed_mentions, { parse: [] }); return response;
  };
  return { root, ...fake, store, community, config, run, advance: (ms) => { clock += ms; } };
}
test('reminder edits and rescheduling preserve identity, ownership, creation and channel across restart', async (t) => {
  const f = await fixture(t); const original = f.store.get(ids.menu); f.advance(60000);
  const text = await f.community.editReminder({ id: ids.menu, userId: ids.actor, field: 'text', value: '  Updated text  ' }); assert.equal(text.text, 'Updated text'); assert.equal(text.dueAt, original.dueAt);
  const moved = await f.community.editReminder({ id: ids.menu, userId: ids.actor, field: 'minutes', value: 30 }); assert.equal(Date.parse(moved.dueAt), epoch + 31 * 60000);
  for (const key of ['id', 'guildId', 'userId', 'channelId', 'createdAt', 'state', 'attempts', 'retryAt']) assert.equal(moved[key], original[key]);
  const reloaded = new CommunityStore(f.store.filePath); await reloaded.load(); assert.deepEqual(reloaded.get(ids.menu), moved); assert.equal(f.calls.filter((call) => call[0] === 'message').length, 0);
});
for (const [field, value] of [['text', ''], ['text', '  '], ['text', 'x'.repeat(501)], ['text', 42], ['minutes', 0], ['minutes', 43201], ['minutes', 1.5], ['minutes', '5'], ['channel', ids.lobby]]) test(`reminder edits reject invalid ${field} ${String(value).slice(0, 12)}`, async (t) => {
  const f = await fixture(t); const before = f.store.get(ids.menu); await assert.rejects(f.community.editReminder({ id: ids.menu, userId: ids.actor, field, value })); assert.deepEqual(f.store.get(ids.menu), before);
});
for (const label of ['owner', 'guild', 'kind', 'missing', 'due', 'retry', 'sent', 'cancelled']) test(`reminder edit rejects ${label} mismatch without modifying state`, async (t) => {
  const f = await fixture(t); const input = { id: ids.menu, userId: ids.actor, guildId: ids.guild, field: 'text', value: 'Replacement' };
  if (label === 'owner') input.userId = ids.user;
  if (label === 'guild') input.guildId = ids.owner;
  if (label === 'missing') input.id = ids.owner;
  if (label === 'kind') { input.id = ids.owner; await f.store.create({ id: ids.owner, guildId: ids.guild, channelId: ids.channel, userId: ids.actor, kind: 'giveaway', text: 'Prize', minutes: 10 }, new Date(epoch)); }
  if (label === 'due') f.advance(600000);
  if (label === 'retry') await f.store.retry(ids.menu, new Date(epoch));
  if (label === 'sent') await f.store.complete(ids.menu, new Date(epoch));
  if (label === 'cancelled') await f.community.cancelReminder(ids.menu, ids.actor);
  const before = f.store.get(input.id); await assert.rejects(f.store.editReminder(input, new Date(label === 'due' ? epoch + 600000 : epoch))); assert.deepEqual(f.store.get(input.id), before);
});
test('reminder failed save preserves file and committed reads; later retry succeeds', async (t) => {
  const f = await fixture(t); const file = f.store.filePath, original = await fs.readFile(file, 'utf8'), before = f.store.get(ids.menu);
  const blocker = path.join(f.root, 'blocker'); await fs.writeFile(blocker, 'x'); f.store.filePath = path.join(blocker, 'community.json');
  await assert.rejects(f.community.editReminder({ id: ids.menu, userId: ids.actor, field: 'minutes', value: 20 })); assert.deepEqual(f.store.get(ids.menu), before); assert.equal(await fs.readFile(file, 'utf8'), original);
  f.store.filePath = file; await f.community.editReminder({ id: ids.menu, userId: ids.actor, field: 'minutes', value: 20 }); assert.equal(Date.parse(f.store.get(ids.menu).dueAt), epoch + 1200000);
});
test('reminder queued edits copy caller data and serialize without losing other changes', async (t) => {
  const f = await fixture(t); let release; f.community.queue = new Promise((resolve) => { release = resolve; }); t.after(() => release());
  const input = { id: ids.menu, userId: ids.actor, field: 'text', value: 'Captured' }; const write = f.community.editReminder(input); input.value = 'Mutated';
  const move = f.community.editReminder({ id: ids.menu, userId: ids.actor, field: 'minutes', value: 43200 }); release(); await Promise.all([write, move]);
  assert.equal(f.store.get(ids.menu).text, 'Captured'); assert.equal(Date.parse(f.store.get(ids.menu).dueAt), epoch + 43200 * 60000);
});
test('reminder scheduler observes rescheduled time and publishes only updated text', async (t) => {
  const f = await fixture(t); await f.community.editReminder({ id: ids.menu, userId: ids.actor, field: 'minutes', value: 20 });
  await f.community.editReminder({ id: ids.menu, userId: ids.actor, field: 'text', value: '@everyone new text' }); f.advance(600000); await f.community.tick(); assert.equal(f.calls.filter((call) => call[0] === 'message').length, 0);
  f.advance(600000); await f.community.tick(); const messages = f.calls.filter((call) => call[0] === 'message'); assert.equal(messages.length, 1); assert.match(messages[0][2].content, /@everyone new text/); assert.deepEqual(messages[0][2].allowed_mentions, { parse: [], users: [ids.actor] }); assert.equal(f.store.get(ids.menu).state, 'sent');
});
test('reminder edit waits for in-flight delivery and refuses altering its saved result', async (t) => {
  const f = await fixture(t); f.advance(600000); let release, started; const begun = new Promise((r) => { started = r; });
  f.discord.createMessage = async () => { started(); await new Promise((r) => { release = r; }); return { id: ids.message }; }; t.after(() => release?.());
  const tick = f.community.tick(); await begun; const edit = f.community.editReminder({ id: ids.menu, userId: ids.actor, field: 'text', value: 'Late edit' }); const rejection = assert.rejects(edit, /future reminders/); release(); await Promise.all([tick, rejection]); assert.equal(f.store.get(ids.menu).text, 'Original text');
});
test('reminder info is owner-only, cloned, guild-bound and available for retained cancelled records', async (t) => {
  const f = await fixture(t); const detail = f.community.getReminder(ids.menu, ids.actor); detail.text = 'Mutated'; assert.equal(f.community.getReminder(ids.menu, ids.actor).text, 'Original text');
  assert.throws(() => f.community.getReminder(ids.menu, ids.user), /unavailable/); assert.throws(() => f.community.getReminder(ids.user, ids.actor), /unavailable/);
  f.config.guildId = ids.owner; assert.throws(() => f.community.getReminder(ids.menu, ids.actor), /unavailable/); f.config.guildId = ids.guild;
  await f.community.cancelReminder(ids.menu, ids.actor); assert.equal(f.community.getReminder(ids.menu, ids.actor).state, 'cancelled');
});
test('reminder command workflow edits, reschedules, shows details and hides another owner', async (t) => {
  const f = await fixture(t); assert.match((await f.run('edit', { id: ids.menu, text: '**hello** @everyone' })).content, /text saved/);
  assert.match((await f.run('reschedule', { id: ids.menu, minutes: 30 })).content, /rescheduled/);
  const info = await f.run('info'); assert.match(info.content, /State: scheduled/); assert.match(info.content, /Delivery attempts: 0/); assert.match(info.content, /Text:/);
  assert.match((await f.run('info', { id: ids.menu }, ids.user)).content, /Could not/); assert.match((await f.run('edit', { id: ids.menu, text: 'Stolen' }, ids.user)).content, /Could not/);
  assert.equal(f.store.get(ids.menu).text, '**hello** @everyone'); assert.match((await f.run('info', { id: '../invalid' })).content, /valid reminder/);
});
test('reminder details show delivery retries without allowing an edit', async (t) => {
  const f = await fixture(t); f.advance(600000); f.discord.createMessage = async () => { throw new Error('secret transport error'); }; await f.community.tick();
  const info = await f.run('info'); assert.match(info.content, /Delivery attempts: 1/); assert.match(info.content, /Retry:/); assert.doesNotMatch(info.content, /secret/);
  assert.match((await f.run('reschedule', { id: ids.menu, minutes: 1 })).content, /without delivery attempts/);
});
test('reminder edits reject invalid operation time without changing committed state', async (t) => {
  const f = await fixture(t); assert.throws(() => f.store.editReminder({ id: ids.menu, guildId: ids.guild, userId: ids.actor, field: 'text', value: 'Edit' }, new Date(NaN)), /edit time/); assert.equal(f.store.get(ids.menu).text, 'Original text');
});

test('signed HTTP reminder create, edit, reschedule and info persist across store reload', async (t) => {
  const crypto = require('node:crypto'), { once } = require('node:events');
  const { createServerRuntime } = require('../src/server'), { publicKeyFromHex } = require('../src/interactions'), { TicketStore } = require('../src/ticket-store');
  const root = await directory(t), fake = fakeDiscord();
  const config = { applicationId: ids.bot, guildId: ids.guild, host: '127.0.0.1', port: 0, gatewayEnabled: false, storePath: path.join(root, 'tickets.json'), moderationStorePath: path.join(root, 'warnings.json'), economyStorePath: path.join(root, 'coins.json'), levelStorePath: path.join(root, 'levels.json'), communityStorePath: path.join(root, 'community.json') };
  const pair = crypto.generateKeyPairSync('ed25519'), store = new CommunityStore(config.communityStorePath);
  const server = await createServerRuntime({ config, discord: fake.discord, store: new TicketStore(config.storePath), communityStore: store, publicKey: publicKeyFromHex(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')) });
  t.after(async () => { await server.drain(); if (server.listening) await new Promise((r) => server.close(r)); await Promise.all([server.community.stop(), server.voice.stop(), server.roleMenus.stop(), server.timers.stop(), server.ticketPanels.stop(), server.levelRewards.stop()]); });
  await once(server, 'listening'); await server.community.stop(); server.community.stopping = false;
  const send = async (action, values, permission = '0') => {
    const payload = interaction('reminder', action, values, permission); payload.id = ids.menu;
    const raw = Buffer.from(JSON.stringify(payload)), timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/interactions`, { method: 'POST', body: raw, headers: { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': crypto.sign(null, Buffer.concat([Buffer.from(timestamp), raw]), pair.privateKey).toString('hex') } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } }); await server.drain();
    return fake.calls.filter((call) => call[0] === 'response').at(-1)[3];
  };
  assert.match((await send('create', { text: 'Original', minutes: 20 }, '2048')).content, /Reminder saved/);
  assert.match((await send('edit', { id: ids.menu, text: 'Updated from signed HTTP' })).content, /text saved/);
  assert.match((await send('reschedule', { id: ids.menu, minutes: 30 })).content, /rescheduled/);
  assert.match((await send('info', { id: ids.menu })).content, /Updated from signed HTTP/);
  const loaded = new CommunityStore(config.communityStorePath); await loaded.load(); assert.deepEqual(loaded.get(ids.menu), store.get(ids.menu)); assert.equal(loaded.get(ids.menu).text, 'Updated from signed HTTP');
});
