'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createInteractionHandler } = require('../src/interactions');
const { fakeDiscord, ids, epoch, interaction } = require('./feature-fixtures');
function fixture() {
  const f = fakeDiscord(), logs = [], config = { guildId: ids.guild, applicationId: ids.bot };
  const message = { id: ids.message, channel_id: ids.channel, author: { id: ids.bot }, poll: { question: { text: 'Choose @everyone' }, answers: [{ answer_id: 7, poll_media: { text: 'Games' } }, { answer_id: 42, poll_media: { text: 'Movie' } }], expiry: new Date(epoch + 60000).toISOString(), allow_multiselect: false } };
  f.messages.set(ids.message, message); const original = f.discord.request;
  let voters = [], ignoreEnd = false;
  f.discord.request = async (method, route, body) => {
    if (route.includes('/polls/')) { f.calls.push([method, route, body]); if (method === 'POST') { if (!ignoreEnd) message.poll.expiry = new Date(epoch - 1).toISOString(); return structuredClone(message); } return { users: structuredClone(voters) }; }
    return original(method, route, body);
  };
  const handler = createInteractionHandler({ config, discord: f.discord, logger: (...args) => logs.push(args), now: () => new Date(epoch) });
  const invoke = (action, options = { message: ids.message }, permissions = '8192') => handler(interaction('pollmanage', action, options, permissions));
  const run = async (...args) => { const result = await invoke(...args); if (!result.work) return result.immediate.data; assert.equal(result.immediate.type, 5); assert.equal(result.immediate.data.flags, 64); await result.work(); const body = f.calls.filter((call) => call[0] === 'response').at(-1)[3]; assert.deepEqual(body.allowed_mentions, { parse: [] }); return body; };
  return { ...f, config, message, logs, invoke, run, setVoters: (users) => { voters = users; }, ignoreEnd: () => { ignoreEnd = true; } };
}
test('poll info distinguishes missing counts, provisional and finalized results using actual answer IDs', async () => {
  const f = fixture(); let info = await f.run('info'); assert.match(info.content, /Results: Unavailable/); assert.match(info.content, /7\. Games: unknown/); assert.doesNotMatch(info.content, /@everyone/);
  f.message.poll.results = { is_finalized: false, answer_counts: [{ id: 42, count: 8 }] }; info = await f.run('info'); assert.match(info.content, /Provisional/); assert.match(info.content, /7\. Games: 0/); assert.match(info.content, /42\. Movie: 8/);
  f.message.poll.results.is_finalized = true; info = await f.run('info'); assert.match(info.content, /State: Ended/); assert.match(info.content, /Finalized/);
});
for (const [name, change] of [
  ['foreign guild', (f) => { f.channels.get(ids.channel).guild_id = ids.owner; }], ['wrong channel ID', (f) => { f.channels.get(ids.channel).id = ids.owner; }], ['wrong channel type', (f) => { f.channels.get(ids.channel).type = 2; }],
  ['foreign author', (f) => { f.message.author.id = ids.actor; }], ['wrong message ID', (f) => { f.message.id = ids.owner; }], ['foreign message channel', (f) => { f.message.channel_id = ids.lobby; }],
  ['no poll', (f) => { delete f.message.poll; }], ['duplicate answer IDs', (f) => { f.message.poll.answers[1].answer_id = 7; }], ['invalid expiry', (f) => { f.message.poll.expiry = 'bad'; }],
  ['negative vote count', (f) => { f.message.poll.results = { is_finalized: false, answer_counts: [{ id: 7, count: -1 }] }; }], ['foreign result answer', (f) => { f.message.poll.results = { is_finalized: false, answer_counts: [{ id: 99, count: 3 }] }; }],
  ['duplicate count', (f) => { f.message.poll.results = { is_finalized: false, answer_counts: [{ id: 7, count: 3 }, { id: 7, count: 4 }] }; }], ['invalid bot identity', (f) => { f.discord.getCurrentUser = async () => ({ id: 'bad' }); }]
]) test(`poll end refuses ${name} before sending expire`, async () => {
  const f = fixture(); change(f); assert.match((await f.run('end')).content, /Could not/); assert.equal(f.calls.filter((call) => call[0] === 'POST').length, 0); assert.doesNotMatch(JSON.stringify(f.logs), /Choose/);
});
test('poll commands require Manage Messages and reject invalid arguments without REST', async () => {
  const f = fixture(); assert.match((await f.run('info', { message: ids.message }, '0')).content, /Manage Messages/);
  for (const [action, values] of [['other', { message: ids.message }], ['info', { message: '../bad' }], ['voters', { message: ids.message, answer: 0 }], ['voters', { message: ids.message, answer: 1.5 }], ['voters', { message: ids.message, answer: 7, after: 'bad' }]]) assert.equal((await f.invoke(action, values)).work, undefined);
  assert.equal(f.calls.length, 0);
});
test('poll ending reads back and repeated or concurrent endings issue one expire request', async () => {
  const f = fixture(); const commands = await Promise.all(Array.from({ length: 8 }, () => f.invoke('end'))); await Promise.all(commands.map((command) => command.work()));
  assert.equal(f.calls.filter((call) => call[0] === 'POST').length, 1); assert.match((await f.run('end')).content, /Poll ended/); assert.equal(f.calls.filter((call) => call[0] === 'POST').length, 1);
});
test('poll ignored expire refuses success and a later retry can finish', async () => {
  const f = fixture(); f.ignoreEnd(); assert.match((await f.run('end')).content, /Could not/); assert.equal(f.calls.filter((call) => call[0] === 'POST').length, 1);
  f.message.poll.expiry = new Date(epoch - 1).toISOString(); assert.match((await f.run('end')).content, /Poll ended/); assert.equal(f.calls.filter((call) => call[0] === 'POST').length, 1);
});
test('poll lost expire response can be retried without ending twice', async () => {
  const f = fixture(), request = f.discord.request;
  f.discord.request = async (...args) => { const value = await request(...args); if (args[0] === 'POST') throw new Error('secret transport error'); return value; };
  assert.match((await f.run('end')).content, /Could not/); assert.match((await f.run('end')).content, /Poll ended/); assert.equal(f.calls.filter((call) => call[0] === 'POST').length, 1); assert.doesNotMatch(JSON.stringify(f.logs), /secret/);
});
test('poll already ended and finalized polls avoid expire even with nullable expiry', async () => {
  const f = fixture(); f.message.poll.expiry = null; f.message.poll.results = { is_finalized: true, answer_counts: [] }; assert.match((await f.run('end')).content, /Results are finalized/); assert.equal(f.calls.filter((call) => call[0] === 'POST').length, 0);
});
test('poll voters use bounded pages, an explicit cursor and no mention pings', async () => {
  const f = fixture(), users = Array.from({ length: 25 }, (_, i) => ({ id: String(BigInt(ids.user) + BigInt(i)) })); f.setVoters([...users].reverse());
  const result = await f.run('voters', { message: ids.message, answer: 42 }); assert.equal((result.content.match(/<@/g) || []).length, 25); assert.match(result.content, new RegExp(`Next cursor: ${users.at(-1).id}`));
  f.setVoters([]); const next = await f.run('voters', { message: ids.message, answer: 42, after: users.at(-1).id }); assert.match(next.content, /No voters/); assert.ok(f.calls.some((call) => call[1]?.endsWith(`?limit=25&after=${users.at(-1).id}`)));
});
for (const [name, users] of [['duplicates', [{ id: ids.user }, { id: ids.user }]], ['malformed user', [{ id: '../bad' }]], ['oversized page', Array.from({ length: 26 }, (_, i) => ({ id: String(BigInt(ids.user) + BigInt(i)) }))]]) test(`poll voters reject ${name}`, async () => {
  const f = fixture(); f.setVoters(users); assert.match((await f.run('voters', { message: ids.message, answer: 7 })).content, /Could not/);
});
test('poll voters reject a foreign answer or backward cursor result', async () => {
  const f = fixture(); assert.match((await f.run('voters', { message: ids.message, answer: 99 })).content, /Could not/); assert.equal(f.calls.filter((call) => call[1]?.includes('/polls/')).length, 0);
  f.setVoters([{ id: ids.user }]); assert.match((await f.run('voters', { message: ids.message, answer: 7, after: ids.user })).content, /Could not/);
});
test('poll readback with wrong identity refuses an end success and logs only action', async () => {
  const f = fixture(), request = f.discord.request;
  f.discord.request = async (...args) => { const value = await request(...args); if (args[0] === 'POST') f.message.channel_id = ids.owner; return value; };
  assert.match((await f.run('end')).content, /Could not/); assert.deepEqual(f.logs, [['poll_management_failed', { action: 'end' }]]);
});

test('signed HTTP poll management inspects and confirms ending through the runtime adapter', async (t) => {
  const crypto = require('node:crypto'), { once } = require('node:events'), path = require('node:path');
  const { directory } = require('./feature-fixtures'), { createServerRuntime } = require('../src/server'), { publicKeyFromHex } = require('../src/interactions'), { TicketStore } = require('../src/ticket-store');
  const root = await directory(t), f = fixture(); f.message.poll.expiry = new Date(Date.now() + 60000).toISOString();
  const request = f.discord.request; f.discord.request = async (...args) => { const value = await request(...args); if (args[0] === 'POST') f.message.poll.expiry = new Date(Date.now() - 1000).toISOString(); return value; };
  const config = { ...f.config, host: '127.0.0.1', port: 0, gatewayEnabled: false, storePath: path.join(root, 'tickets.json'), moderationStorePath: path.join(root, 'warnings.json'), economyStorePath: path.join(root, 'coins.json'), levelStorePath: path.join(root, 'levels.json'), communityStorePath: path.join(root, 'community.json') };
  const pair = crypto.generateKeyPairSync('ed25519');
  const server = await createServerRuntime({ config, discord: f.discord, store: new TicketStore(config.storePath), publicKey: publicKeyFromHex(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')) });
  t.after(async () => { await server.drain(); if (server.listening) await new Promise((r) => server.close(r)); await Promise.all([server.community.stop(), server.voice.stop(), server.roleMenus.stop(), server.timers.stop(), server.ticketPanels.stop(), server.levelRewards.stop()]); }); await once(server, 'listening');
  const send = async (action) => {
    const raw = Buffer.from(JSON.stringify(interaction('pollmanage', action, { message: ids.message }, '8192'))), timestamp = String(Math.floor(Date.now() / 1000));
    const result = await fetch(`http://127.0.0.1:${server.address().port}/interactions`, { method: 'POST', body: raw, headers: { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': crypto.sign(null, Buffer.concat([Buffer.from(timestamp), raw]), pair.privateKey).toString('hex') } });
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { type: 5, data: { flags: 64 } }); await server.drain(); return f.calls.filter((call) => call[0] === 'response').at(-1)[3];
  };
  assert.match((await send('info')).content, /State: Open/); assert.match((await send('end')).content, /Poll ended/); assert.match((await send('info')).content, /State: Ended/);
  assert.equal(f.calls.filter((call) => call[0] === 'POST').length, 1);
});
