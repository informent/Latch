'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { LevelStore, MAX_LEVEL_BYTES, MAX_LEVEL_GUILDS } = require('../src/level-store');
const { GuildEventService } = require('../src/guild-events');
const { createInteractionHandler } = require('../src/interactions');
const { ids, epoch, directory, fakeDiscord, interaction } = require('./feature-fixtures');
async function fixture(t) {
  const root = await directory(t), file = path.join(root, 'levels.json'); let clock = epoch;
  const levels = new LevelStore(file, { now: () => clock }); await levels.load();
  const f = { ...fakeDiscord(), root, file, levels, config: { guildId: ids.guild, applicationId: ids.bot, levelingEnabled: true }, advance: (ms) => { clock += ms; }, now: () => clock };
  f.handler = createInteractionHandler(f);
  f.run = async (action, values = {}) => {
    const result = await f.handler(interaction('levelconfig', action, values)); assert.equal(result.immediate.type, 5); assert.equal(result.immediate.data.flags, 64);
    await result.work(); const body = f.calls.filter((c) => c[0] === 'response').at(-1)[3]; assert.deepEqual(body.allowed_mentions, { parse: [] }); return body.content;
  };
  f.message = (extra = {}) => ({ id: ids.message, guild_id: ids.guild, channel_id: ids.channel, type: 0, timestamp: new Date(clock).toISOString(), author: { id: ids.user }, content: 'Not stored', ...extra });
  f.events = new GuildEventService({ ...f, now: f.now }); return f;
}
test('level settings migrate legacy XP only after successful write and survive restart', async (t) => {
  const f = await fixture(t), legacy = { version: 1, accounts: [{ guildId: ids.guild, userId: ids.user, xp: 120, lastAward: new Date(epoch).toISOString() }] };
  await fs.writeFile(f.file, JSON.stringify(legacy)); await f.levels.load(); assert.equal(JSON.parse(await fs.readFile(f.file)).version, 1);
  await f.levels.configure(ids.guild, 'tune', { xp: 100, cooldownMs: 15000 }); await f.levels.configure(ids.guild, 'ignore', { channelId: ids.channel }); await f.levels.configure(ids.guild, 'disable');
  const reload = new LevelStore(f.file); await reload.load(); assert.equal(reload.get(ids.guild, ids.user).xp, 120); assert.equal(reload.getSettings(ids.guild).xp, 100); assert.equal(reload.getSettings(ids.guild).enabled, false); assert.deepEqual(reload.getSettings(ids.guild).ignoredChannels, [ids.channel]); assert.equal(JSON.parse(await fs.readFile(f.file)).version, 2);
});
test('tuned cooldown boundary, duplicate messages and restart keep awards bounded', async (t) => {
  const f = await fixture(t); await f.levels.configure(ids.guild, 'tune', { xp: 100, cooldownMs: 15000 });
  const opts = { channelId: ids.channel, messageId: ids.message }; const first = await f.levels.awardMessage(ids.guild, ids.user, opts); assert.equal(first.leveledUp, true);
  f.advance(14999); assert.equal((await f.levels.awardMessage(ids.guild, ids.user)).awarded, false); f.advance(1);
  assert.equal((await f.levels.awardMessage(ids.guild, ids.user, opts)).awarded, false);
  const reload = new LevelStore(f.file, { now: f.now }); await reload.load(); assert.equal((await reload.awardMessage(ids.guild, ids.user, opts)).awarded, false);
  assert.equal((await reload.awardMessage(ids.guild, ids.user, { messageId: ids.menu })).xp, 200);
});
test('ignored and paused messages perform no writes; reset preserves accounts and cooldowns', async (t) => {
  const f = await fixture(t); await f.levels.awardMessage(ids.guild, ids.user); await f.levels.configure(ids.guild, 'ignore', { channelId: ids.channel }); f.advance(60000);
  let raw = await fs.readFile(f.file, 'utf8'); assert.equal((await f.levels.awardMessage(ids.guild, ids.user, { channelId: ids.channel })).awarded, false); assert.equal(await fs.readFile(f.file, 'utf8'), raw);
  await f.levels.configure(ids.guild, 'disable'); raw = await fs.readFile(f.file, 'utf8'); assert.equal((await f.levels.awardMessage(ids.guild, ids.user)).awarded, false); assert.equal(await fs.readFile(f.file, 'utf8'), raw);
  await f.levels.configure(ids.guild, 'reset'); assert.equal(f.levels.get(ids.guild, ids.user).xp, 15); assert.equal(f.levels.getSettings(ids.guild).enabled, true); assert.deepEqual(f.levels.getSettings(ids.guild).ignoredChannels, []);
  assert.equal((await f.levels.awardMessage(ids.guild, ids.user)).xp, 30); await f.levels.configure(ids.guild, 'reset'); assert.equal((await f.levels.awardMessage(ids.guild, ids.user)).awarded, false);
});
test('queued settings and concurrent awards use the latest committed configuration', async (t) => {
  const f = await fixture(t), input = { xp: 80, cooldownMs: 15000 }; const change = f.levels.configure(ids.guild, 'tune', input); input.xp = 1;
  const awards = [f.levels.awardMessage(ids.guild, ids.user), f.levels.awardMessage(ids.guild, ids.user)]; await change;
  assert.equal((await awards[0]).gained, 80); assert.equal((await awards[1]).awarded, false);
  const pause = f.levels.configure(ids.guild, 'disable'); f.advance(15000); const award = f.levels.awardMessage(ids.guild, ids.user); await pause; assert.equal((await award).awarded, false);
  assert.equal(f.levels.getSettings(ids.owner).enabled, true); assert.equal(f.levels.leaderboard(ids.owner).length, 0);
});
test('readers see only committed XP and settings while replacement is pending', async (t) => {
  const f = await fixture(t), rename = fs.rename; let release, reached;
  const arrived = new Promise((r) => { reached = r; }); const gate = new Promise((r) => { release = r; });
  fs.rename = async (...args) => { if (args[1] === f.file) { reached(); await gate; } return rename(...args); };
  t.after(() => { fs.rename = rename; release(); });
  const write = f.levels.configure(ids.guild, 'disable'); await arrived; assert.equal(f.levels.getSettings(ids.guild).enabled, true); release(); await write; assert.equal(f.levels.getSettings(ids.guild).enabled, false);
  fs.rename = rename; await f.levels.configure(ids.guild, 'enable');
  let ready; const entered = new Promise((r) => { ready = r; }); let finish; const wait = new Promise((r) => { finish = r; });
  fs.rename = async (...args) => { ready(); await wait; return rename(...args); }; t.after(() => finish());
  const award = f.levels.awardMessage(ids.guild, ids.user); await entered; assert.equal(f.levels.get(ids.guild, ids.user).xp, 0); assert.deepEqual(f.levels.leaderboard(ids.guild), []); finish(); await award; assert.equal(f.levels.get(ids.guild, ids.user).xp, 15);
});
test('failed migration and settings writes preserve file and recover the transaction queue', async (t) => {
  const f = await fixture(t); const legacy = '{"version":1,"accounts":[]}'; await fs.writeFile(f.file, legacy); await f.levels.load();
  const rename = fs.rename; fs.rename = async () => { throw new Error('replacement failed'); }; t.after(() => { fs.rename = rename; });
  await assert.rejects(f.levels.configure(ids.guild, 'disable')); await assert.rejects(f.levels.awardMessage(ids.guild, ids.user));
  assert.equal(await fs.readFile(f.file, 'utf8'), legacy); assert.equal(f.levels.getSettings(ids.guild).enabled, true); assert.equal(f.levels.accounts.size, 0); assert.deepEqual(await fs.readdir(f.root), ['levels.json']);
  fs.rename = rename; await f.levels.configure(ids.guild, 'disable'); assert.equal(f.levels.getSettings(ids.guild).enabled, false);
});
test('settings and snapshots enforce ignored-channel caps and isolate caller mutation', async (t) => {
  const f = await fixture(t);
  for (let n = 0; n < 100; n++) await f.levels.configure(ids.guild, 'ignore', { channelId: String(100000n + BigInt(n)) });
  await f.levels.configure(ids.guild, 'ignore', { channelId: '100000' }); assert.equal(f.levels.getSettings(ids.guild).ignoredChannels.length, 100);
  await assert.rejects(f.levels.configure(ids.guild, 'ignore', { channelId: ids.channel })); assert.throws(() => f.levels.getSettings(ids.guild).ignoredChannels.push(ids.channel));
  await f.levels.configure(ids.guild, 'unignore', { channelId: '100000' }); assert.equal(f.levels.getSettings(ids.guild).ignoredChannels.length, 99);
});
for (const [label, modify] of [
  ['numeric ID', (p) => { p.accounts[0].userId = 123456; }], ['noncanonical timestamp', (p) => { p.accounts[0].lastAward = '2026-01-01'; }],
  ['unknown account key', (p) => { p.accounts[0].content = 'no'; }], ['negative XP', (p) => { p.accounts[0].xp = -1; }], ['duplicate account', (p) => p.accounts.push(p.accounts[0])],
  ['duplicate settings', (p) => p.settings.push(p.settings[0])], ['unknown root field', (p) => { p.other = true; }], ['unknown version', (p) => { p.version = 3; }],
  ['duplicate channel', (p) => { p.settings[0].ignoredChannels = [ids.channel, ids.channel]; }], ['invalid enabled flag', (p) => { p.settings[0].enabled = 1; }], ['invalid XP setting', (p) => { p.settings[0].xp = 101; }],
  ['invalid cooldown', (p) => { p.settings[0].cooldownMs = 14999; }], ['invalid message ID', (p) => { p.accounts[0].lastMessageId = 'bad'; }]
]) test(`level store refuses ${label} and preserves original data`, async (t) => {
  const f = await fixture(t); await f.levels.awardMessage(ids.guild, ids.user); await f.levels.configure(ids.guild, 'enable'); const p = JSON.parse(await fs.readFile(f.file)); modify(p); const raw = JSON.stringify(p); await fs.writeFile(f.file, raw);
  await assert.rejects(new LevelStore(f.file).load()); assert.equal(await fs.readFile(f.file, 'utf8'), raw);
});
test('level validation bounds IDs, settings, clocks, XP, store size and guild count', async (t) => {
  const f = await fixture(t); await assert.rejects(f.levels.awardMessage(ids.guild, 123456)); await assert.rejects(f.levels.awardMessage(ids.guild, ids.user, { channelId: 'bad' })); await assert.rejects(f.levels.awardMessage(ids.guild, ids.user, { messageId: 'bad' }));
  assert.throws(() => f.levels.leaderboard(ids.guild, 0)); assert.throws(() => f.levels.get(123456, ids.user));
  await assert.rejects(f.levels.configure(ids.guild, 'unknown')); await assert.rejects(f.levels.configure(ids.guild, 'tune', { xp: 1.5, cooldownMs: 15000 }));
  f.levels.now = () => NaN; await assert.rejects(f.levels.awardMessage(ids.guild, ids.user)); f.levels.now = f.now;
  f.levels.accounts.set(`${ids.guild}:${ids.user}`, { guildId: ids.guild, userId: ids.user, xp: Number.MAX_SAFE_INTEGER, lastAward: null }); await assert.rejects(f.levels.awardMessage(ids.guild, ids.user), /XP limit/); f.levels.accounts.clear();
  for (let n = 0; n < MAX_LEVEL_GUILDS; n++) { const guildId = String(100000n + BigInt(n)); f.levels.settings.set(guildId, f.levels.getSettings(guildId)); }
  await assert.rejects(f.levels.configure(ids.guild, 'enable'), /guild limit/);
  await fs.writeFile(f.file, ' '.repeat(MAX_LEVEL_BYTES + 1)); await assert.rejects(new LevelStore(f.file).load(), /size limit/);
});
for (const action of ['show', 'tune', 'reset', 'ignore', 'unignore', 'ignored', 'enable', 'disable']) test(`levelconfig ${action} requires Manage Server`, async (t) => {
  const f = await fixture(t); const result = await f.handler(interaction('levelconfig', action, {}, '0')); assert.match(result.immediate.data.content, /Manage Server/); assert.equal(f.calls.length, 0);
});
test('level commands cover tune, pause, ignore, deleted cleanup, reset and private listing', async (t) => {
  const f = await fixture(t); assert.match(await f.run('show'), /XP per message: 15/); assert.match(await f.run('tune', { xp: 70, cooldown: 30 }), /70/);
  await f.run('ignore', { channel: ids.channel }); assert.match(await f.run('ignored'), new RegExp(ids.channel)); assert.match(await f.run('disable'), /paused/);
  f.channels.delete(ids.channel); assert.match(await f.run('unignore', { channel: ids.channel }), /saved/); await f.run('enable'); assert.match(await f.run('reset'), /Defaults restored/);
  f.config.levelingEnabled = false; assert.match(await f.run('show'), /disabled in environment/);
  const missing = createInteractionHandler({ config: f.config, discord: f.discord }); assert.match((await missing(interaction('levelconfig', 'show'))).immediate.data.content, /unavailable/);
  assert.match((await f.handler(interaction('levelconfig', 'invalid'))).immediate.data.content, /Choose/);
});
test('level ignore validates live channel identity, guild, type and failure replies', async (t) => {
  const f = await fixture(t); for (const change of [{ guild_id: ids.owner }, { id: ids.owner }, { type: 4 }]) {
    const old = { ...f.channels.get(ids.channel) }; Object.assign(f.channels.get(ids.channel), change); assert.match(await f.run('ignore', { channel: ids.channel }), /failed/); f.channels.set(ids.channel, old);
  }
  assert.match(await f.run('ignore', { channel: 'bad' }), /failed/); assert.match(await f.run('ignore', { channel: ids.owner }), /failed/); assert.match(await f.run('tune', { xp: 0, cooldown: 20 }), /failed/); assert.deepEqual(f.levels.getSettings(ids.guild).ignoredChannels, []);
});
test('ignored-channel listing exposes every page with a bounded private response', async (t) => {
  const f = await fixture(t); for (let n = 0; n < 100; n++) await f.levels.configure(ids.guild, 'ignore', { channelId: String(100000000000000000n + BigInt(n)) });
  for (let page = 1; page <= 5; page++) { const content = await f.run('ignored', { page }); assert.ok(content.length < 1900); assert.equal((content.match(/<#/g) || []).length, 20); }
  assert.match(await f.run('ignored', { page: 6 }), /failed/);
});
test('Gateway XP honors live settings, durable duplicate suppression and fresh human messages', async (t) => {
  const f = await fixture(t); await f.events.dispatch('MESSAGE_CREATE', f.message()); assert.equal(f.levels.get(ids.guild, ids.user).xp, 15); f.advance(60000); await f.events.dispatch('MESSAGE_CREATE', f.message()); assert.equal(f.levels.get(ids.guild, ids.user).xp, 15);
  const next = { id: ids.menu }; await f.run('ignore', { channel: ids.channel }); await f.events.dispatch('MESSAGE_CREATE', f.message(next)); assert.equal(f.levels.get(ids.guild, ids.user).xp, 15);
  await f.run('unignore', { channel: ids.channel }); await f.run('disable'); await f.events.dispatch('MESSAGE_CREATE', f.message(next)); await f.run('enable'); await f.run('tune', { xp: 25, cooldown: 15 }); await f.events.dispatch('MESSAGE_CREATE', f.message(next)); assert.equal(f.levels.get(ids.guild, ids.user).xp, 40);
  f.advance(60000);
  for (const extra of [{ id: undefined }, { timestamp: undefined }, { author: { id: 123456 } }, { type: 7 }, { timestamp: 'bad' }, { timestamp: new Date(f.now() - 300001).toISOString() }, { timestamp: new Date(f.now() + 5001).toISOString() }, { author: { id: ids.user, bot: true } }, { webhook_id: ids.owner }, { guild_id: ids.owner }, { content: ' ' }]) await f.events.dispatch('MESSAGE_CREATE', f.message({ id: ids.owner, ...extra }));
  assert.equal(f.levels.get(ids.guild, ids.user).xp, 40); f.config.levelingEnabled = false; await f.events.dispatch('MESSAGE_CREATE', f.message({ id: ids.owner })); assert.equal(f.levels.get(ids.guild, ids.user).xp, 40);
  assert.equal((await fs.readFile(f.file, 'utf8')).includes('Not stored'), false);
});
test('Gateway award errors and throwing loggers do not interrupt dispatch', async (t) => {
  const f = await fixture(t); f.levels.awardMessage = async () => { throw new Error('disk'); }; const logs = []; f.events.logger = (...args) => logs.push(args); await f.events.dispatch('MESSAGE_CREATE', f.message()); assert.equal(logs[0][0], 'level_award_failed'); f.events.logger = () => { throw new Error(); }; await f.events.dispatch('MESSAGE_CREATE', f.message());
});
test('signed HTTP settings control the wired Gateway and persist despite lost replies', async (t) => {
  const crypto = require('node:crypto'), { once } = require('node:events');
  const { createServerRuntime } = require('../src/server'), { publicKeyFromHex } = require('../src/interactions'), { TicketStore } = require('../src/ticket-store');
  const f = await fixture(t); Object.assign(f.config, { host: '127.0.0.1', port: 0, gatewayEnabled: true, gatewayIntents: 33281, storePath: path.join(f.root, 'tickets.json'), moderationStorePath: path.join(f.root, 'warnings.json'), economyStorePath: path.join(f.root, 'coins.json'), levelStorePath: f.file });
  const pair = crypto.generateKeyPairSync('ed25519'), gateway = { start() {}, stop() {} };
  const server = await createServerRuntime({ ...f, store: new TicketStore(f.config.storePath), gateway, publicKey: publicKeyFromHex(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')) });
  t.after(async () => { await server.drain(); if (server.listening) await new Promise((r) => server.close(r)); await Promise.all([server.community.stop(), server.voice.stop(), server.roleMenus.stop(), server.timers.stop(), server.ticketPanels.stop()]); }); await once(server, 'listening');
  const send = async (action, values = {}) => {
    const raw = Buffer.from(JSON.stringify(interaction('levelconfig', action, values))), timestamp = String(Math.floor(Date.now() / 1000));
    const result = await fetch(`http://127.0.0.1:${server.address().port}/interactions`, { method: 'POST', body: raw, headers: { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': crypto.sign(null, Buffer.concat([Buffer.from(timestamp), raw]), pair.privateKey).toString('hex') } });
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { type: 5, data: { flags: 64 } }); await server.drain();
  };
  const message = () => f.message({ timestamp: new Date().toISOString() });
  await send('tune', { xp: 90, cooldown: 15 }); await send('disable'); await gateway.onDispatch('MESSAGE_CREATE', message()); assert.equal(f.levels.get(ids.guild, ids.user).xp, 0);
  const reply = f.discord.editOriginalResponse; f.discord.editOriginalResponse = async () => { throw new Error('lost reply'); }; await send('enable'); f.discord.editOriginalResponse = reply;
  await gateway.onDispatch('MESSAGE_CREATE', message()); assert.equal(f.levels.get(ids.guild, ids.user).xp, 90); f.advance(15000); await gateway.onDispatch('MESSAGE_CREATE', message()); assert.equal(f.levels.get(ids.guild, ids.user).xp, 90);
  const reload = new LevelStore(f.file); await reload.load(); assert.equal(reload.getSettings(ids.guild).enabled, true); assert.equal(reload.getSettings(ids.guild).cooldownMs, 15000); assert.equal(reload.get(ids.guild, ids.user).xp, 90);
});
