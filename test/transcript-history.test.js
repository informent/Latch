'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { gzipSync, gunzipSync } = require('node:zlib');
const { collectTranscript, exportTranscript, COLLECTION_BUDGET_MS, MAX_SOURCE_BYTES } = require('../src/ticket-transcript');
const { unpack, main } = require('../scripts/transcript-unpack');
const { TicketStore } = require('../src/ticket-store');
const { TicketService, CHAT } = require('../src/ticket-service');
const { DiscordApi, MAX_UPLOAD_BYTES } = require('../src/discord-api');
const { ids, epoch, directory, fakeDiscord, interaction } = require('./feature-fixtures');
const { createInteractionHandler } = require('../src/interactions');
const ticket = { channelId: ids.channel, ownerId: ids.user, status: 'open', createdAt: new Date(epoch).toISOString() };
const message = index => ({ id: String(BigInt(ids.message) + BigInt(index)), channel_id: ids.channel, author: { id: ids.user, username: 'Member' }, content: `Private message ${index}`, timestamp: ticket.createdAt, edited_timestamp: null, attachments: [], embeds: [] });
function adapter(total) {
  const messages = Array.from({ length: total }, (_, index) => message(total - index)), calls = [];
  return { calls, discord: { getChannelMessages: async (channel, count, before) => { assert.equal(channel, ids.channel); calls.push({ count, before }); return messages.filter(item => !before || BigInt(item.id) < BigInt(before)).slice(0, count); } } };
}
async function fixture(t, total = 205) {
  const root = await directory(t), fake = fakeDiscord(), store = new TicketStore(path.join(root, 'tickets.json'));
  await store.add(ticket);
  fake.channels.get(ids.channel).permission_overwrites.push({ id: ids.user, type: 1, allow: CHAT.toString(), deny: '0' }, { id: ids.actorRole, type: 0, allow: CHAT.toString(), deny: '0' });
  const history = adapter(total); fake.discord.getChannelMessages = history.discord.getChannelMessages;
  fake.discord.editOriginalResponse = async (...args) => fake.calls.push(['response', ...args]);
  const config = { guildId: ids.guild, applicationId: ids.bot, supportRoleId: ids.actorRole };
  const tickets = new TicketService({ config, store, discord: fake.discord, botUserId: ids.bot, now: () => new Date(epoch) });
  return { root, fake, store, config, tickets, history, actor: { channelId: ids.channel, userId: ids.actor, roles: [ids.actorRole], permissions: '0' } };
}
const exportOptions = messages => ({ ticket, guildId: ids.guild, channelId: ids.channel, messages, exportedAt: ticket.createdAt });

test('history collection paginates 205 messages and detects a short final page', async () => {
  const f = adapter(205), result = await collectTranscript({ discord: f.discord, channelId: ids.channel, limit: 500 });
  assert.equal(result.messages.length, 205); assert.equal(result.pages, 3); assert.equal(result.historyExhausted, true);
  assert.deepEqual(f.calls.map(call => call.count), [100, 100, 100]);
  assert.equal(f.calls[1].before, message(106).id); assert.equal(f.calls[2].before, message(6).id);
});
test('count boundaries request the exact remainder and never exceed ten pages', async () => {
  const f = adapter(1500), result = await collectTranscript({ discord: f.discord, channelId: ids.channel, limit: 1000 });
  assert.equal(result.messages.length, 1000); assert.equal(result.pages, 10); assert.equal(result.historyExhausted, false);
  const remainder = adapter(500); await collectTranscript({ discord: remainder.discord, channelId: ids.channel, limit: 205 }); assert.deepEqual(remainder.calls.map(call => call.count), [100, 100, 5]);
});
test('continuation cursors retrieve older windows without duplicating boundary messages', async () => {
  const f = adapter(205), first = await collectTranscript({ discord: f.discord, channelId: ids.channel, limit: 100 });
  const file = exportTranscript({ ...exportOptions(first.messages), ...first, limit: 100, format: 'json' });
  assert.equal(file.pagination.nextBefore, message(106).id);
  const second = await collectTranscript({ discord: f.discord, channelId: ids.channel, limit: 100, before: file.pagination.nextBefore });
  assert.equal(second.messages[0].id, message(105).id); assert.equal(second.before, message(106).id);
  const secondFile = exportTranscript({ ...exportOptions(second.messages), ...second, limit: 100 }); assert.ok(secondFile.filename.includes(`-before-${message(106).id}`));
  assert.equal(new Set([...first.messages, ...second.messages].map(item => item.id)).size, 200);
});
test('empty history is explicitly exhausted without a continuation cursor', async () => {
  const f = adapter(0), history = await collectTranscript({ discord: f.discord, channelId: ids.channel });
  const file = exportTranscript({ ...exportOptions(history.messages), ...history }); assert.equal(file.count, 0); assert.equal(file.pagination.nextBefore, null); assert.equal(file.pagination.historyExhausted, true);
});
for (const kind of ['duplicate', 'cross-channel', 'stalled-cursor', 'oversized-page', 'non-array']) test(`rejects ${kind} history responses`, async () => {
  const f = adapter(200), read = f.discord.getChannelMessages;
  f.discord.getChannelMessages = async (...args) => {
    const result = await read(...args);
    if (kind === 'duplicate') result[1] = result[0];
    if (kind === 'cross-channel') result[0].channel_id = ids.lobby;
    if (kind === 'stalled-cursor' && args[2]) result[0] = message(200);
    if (kind === 'oversized-page') result.push(message(999));
    return kind === 'non-array' ? {} : result;
  };
  await assert.rejects(collectTranscript({ discord: f.discord, channelId: ids.channel, limit: 200 }));
});
test('invalid collection cursors and count bounds fail before API access', async () => {
  const f = adapter(200); for (const change of [{ limit: 0 }, { limit: 1001 }, { limit: 1.5 }, { before: '../file' }, { before: null }, { channelId: 'invalid' }]) await assert.rejects(collectTranscript({ discord: f.discord, channelId: ids.channel, ...change })); assert.equal(f.calls.length, 0);
});
test('collection enforces elapsed time before accepting a slow response', async () => {
  let clock = 0, calls = 0;
  await assert.rejects(collectTranscript({ channelId: ids.channel, limit: 100, now: () => clock, discord: { getChannelMessages: async () => { calls++; clock = COLLECTION_BUDGET_MS; return [message(1)]; } } }), /time budget/); assert.equal(calls, 1);
});
test('history collection bounds normalized UTF8 memory before rendering', async () => {
  const f = adapter(1000), read = f.discord.getChannelMessages;
  f.discord.getChannelMessages = async (...args) => (await read(...args)).map(item => ({ ...item, content: String.fromCodePoint(0x1f600).repeat(2000), embeds: [{ description: String.fromCodePoint(0x1f600).repeat(2000) }] }));
  await assert.rejects(collectTranscript({ discord: f.discord, channelId: ids.channel, limit: 1000 }), /memory budget/); assert.ok(f.calls.length < 10);
});
test('gzip JSON and text preserve exact uncompressed bytes and continuation metadata', async () => {
  const f = adapter(150), history = await collectTranscript({ discord: f.discord, channelId: ids.channel, limit: 100 });
  for (const format of ['text', 'json']) {
    const options = { ...exportOptions(history.messages), ...history, limit: 100, format }, plain = exportTranscript(options), compressed = exportTranscript({ ...options, compression: 'gzip' });
    assert.deepEqual(gunzipSync(compressed.data), plain.data); assert.equal(compressed.contentType, 'application/gzip'); assert.equal(compressed.filename, plain.filename + '.gz'); assert.deepEqual(compressed.pagination, plain.pagination); assert.equal(compressed.sourceBytes, plain.data.length);
  }
});
test('gzip allows larger compressible snapshots while plain upload limits remain enforced', () => {
  const messages = Array.from({ length: 400 }, (_, index) => ({ ...message(index), content: String.fromCodePoint(0x1f600).repeat(1500) }));
  const options = { ...exportOptions(messages), limit: 400, format: 'json' }; assert.throws(() => exportTranscript(options), /too large/);
  const file = exportTranscript({ ...options, compression: 'gzip' }); assert.ok(file.sourceBytes > MAX_UPLOAD_BYTES); assert.ok(file.data.length < MAX_UPLOAD_BYTES); assert.equal(JSON.parse(gunzipSync(file.data)).messages.length, 400);
});
test('unsupported compression or excessive uncompressed output cannot be uploaded', () => {
  assert.throws(() => exportTranscript({ ...exportOptions([message(1)]), compression: 'zip' }));
  const messages = Array.from({ length: 1000 }, (_, index) => ({ ...message(index), content: String.fromCodePoint(0x1f600).repeat(2000), embeds: [{ description: String.fromCodePoint(0x1f600).repeat(2000) }] }));
  assert.throws(() => exportTranscript({ ...exportOptions(messages), limit: 1000, compression: 'gzip' }), /uncompressed/);
});
test('bot read permissions are checked before history access', async t => {
  const f = await fixture(t); f.fake.roles.find(role => role.id === ids.botRole).permissions = '0'; const result = await f.tickets.transcript({ ...f.actor, limit: 205 }); assert.equal(result.ok, false); assert.match(result.reason, /Latch needs/); assert.equal(f.history.calls.length, 0);
});
for (const kind of ['support-revoked', 'member-left', 'history-denied', 'bot-denied']) test(`post-collection ${kind} prevents returning a file`, async t => {
  const f = await fixture(t, 1), read = f.fake.discord.getChannelMessages;
  f.fake.discord.getChannelMessages = async (...args) => {
    const messages = await read(...args);
    if (kind === 'support-revoked') f.fake.members.get(ids.actor).roles = [];
    if (kind === 'member-left') f.fake.members.delete(ids.actor);
    if (kind === 'history-denied') f.fake.roles.find(role => role.id === ids.actorRole).permissions = '0', f.fake.channels.get(ids.channel).permission_overwrites = f.fake.channels.get(ids.channel).permission_overwrites.filter(entry => entry.id !== ids.actorRole);
    if (kind === 'bot-denied') f.fake.roles.find(role => role.id === ids.botRole).permissions = '0';
    return messages;
  };
  if (kind === 'member-left') await assert.rejects(f.tickets.transcript(f.actor));
  else { const result = await f.tickets.transcript(f.actor); assert.equal(result.ok, false); assert.equal(result.file, undefined); }
});
test('private interaction accepts large counts, gzip and before with safe continuation guidance', async t => {
  const f = await fixture(t), handle = createInteractionHandler({ config: f.config, tickets: f.tickets, discord: f.fake.discord });
  const command = interaction('ticket', 'transcript', { count: 150, format: 'json', compression: 'gzip', before: message(201).id });
  const result = await handle(command); assert.deepEqual(result.immediate, { type: 5, data: { flags: 64 } }); await result.work();
  const response = f.fake.calls.filter(call => call[0] === 'response').at(-1); assert.match(response[3].content, /Continue with before:/); assert.deepEqual(response[3].allowed_mentions, { parse: [] }); const data = JSON.parse(gunzipSync(response[4].data)); assert.equal(data.messages.length, 150); assert.equal(data.pagination.pages, 2); assert.equal(data.pagination.before, message(201).id);
});
test('REST history cursors are validated and encoded without changing existing routes', async () => {
  const routes = [], api = new DiscordApi('token', async route => { routes.push(route); return { ok: true, status: 200, json: async () => [] }; });
  await api.getChannelMessages(ids.channel, 100, ids.message); assert.ok(routes[0].endsWith(`?limit=100&before=${ids.message}`));
  for (const args of [[ids.channel, 101], [ids.channel, 0], [ids.channel, 10, '12345&secret=true'], ['bad', 10]]) assert.throws(() => api.getChannelMessages(...args)); assert.equal(routes.length, 1);
});
test('multipart gzip metadata and bytes are exact and MIME mismatches fail before fetch', async () => {
  const calls = [], api = new DiscordApi('token', async (_url, request) => { calls.push(request); return { ok: true, status: 200, json: async () => ({}) }; }), file = exportTranscript({ ...exportOptions([message(1)]), compression: 'gzip' });
  await api.editOriginalResponse(ids.bot, 'token', { content: 'Private' }, file); assert.deepEqual(Buffer.from(await calls[0].body.get('files[0]').arrayBuffer()), file.data); assert.equal(calls[0].body.get('files[0]').type, 'application/gzip');
  for (const change of [{ contentType: 'text/plain; charset=utf-8' }, { filename: 'ticket.txt' }, { filename: 'ticket.html.gz' }]) await assert.rejects(api.editOriginalResponse(ids.bot, 'token', {}, { ...file, ...change })); assert.equal(calls.length, 1);
});
test('unpack restores text and JSON exactly without replacing existing files', async t => {
  const root = await directory(t);
  for (const format of ['text', 'json']) {
    const file = exportTranscript({ ...exportOptions([message(1)]), format, compression: 'gzip' }), input = path.join(root, file.filename), output = input.slice(0, -3); await fs.writeFile(input, file.data); const result = await unpack(input, output); assert.equal(result.bytes, file.sourceBytes); assert.deepEqual(await fs.readFile(output), gunzipSync(file.data)); await assert.rejects(unpack(input, output)); assert.deepEqual(await fs.readFile(output), gunzipSync(file.data));
  }
});
for (const kind of ['corrupt', 'bomb', 'empty', 'wrong-content', 'oversized']) test(`unpack rejects ${kind} without creating output`, async t => {
  const root = await directory(t), input = path.join(root, 'ticket.txt.gz'), output = path.join(root, 'ticket.txt');
  const data = kind === 'corrupt' ? Buffer.from('not gzip') : kind === 'bomb' ? gzipSync(Buffer.alloc(MAX_SOURCE_BYTES + 1)) : kind === 'empty' ? gzipSync(Buffer.alloc(0)) : kind === 'oversized' ? Buffer.alloc(MAX_UPLOAD_BYTES + 1) : gzipSync(Buffer.from('not a transcript'));
  await fs.writeFile(input, data); await assert.rejects(unpack(input, output)); assert.deepEqual(await fs.readdir(root), ['ticket.txt.gz']);
});
test('unpack checks output extensions and JSON schema before writing', async t => {
  const root = await directory(t), input = path.join(root, 'ticket.json.gz'); await fs.writeFile(input, gzipSync(Buffer.from('{"version":1,"messages":[]}'))); await assert.rejects(unpack(input, path.join(root, 'new.json'))); await assert.rejects(unpack(input, path.join(root, 'new.exe'))); assert.deepEqual(await fs.readdir(root), ['ticket.json.gz']);
});
test('unpack CLI reports byte counts without printing transcript content', async t => {
  const root = await directory(t), file = exportTranscript({ ...exportOptions([message(1)]), compression: 'gzip' }), input = path.join(root, file.filename), output = input.slice(0, -3), logs = []; await fs.writeFile(input, file.data); t.mock.method(console, 'log', value => logs.push(value)); await main([input, output]); assert.match(logs[0], /Unpacked transcript/); assert.doesNotMatch(logs[0], /Private message/); for (const args of [[], [input], [input, output, 'extra'], ['--help', output]]) await assert.rejects(main(args));
});
