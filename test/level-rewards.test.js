'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { LevelRewardStore, MAX_REWARDS, MAX_MEMBERS, MAX_BYTES } = require('../src/level-reward-store');
const { LevelRewardService } = require('../src/level-reward-service');
const { LevelStore } = require('../src/level-store');
const { GuildEventService } = require('../src/guild-events');
const { createInteractionHandler } = require('../src/interactions');
const { ids, epoch, directory, fakeDiscord, interaction } = require('./feature-fixtures');
async function fixture(t) {
  const root = await directory(t), fake = fakeDiscord(); let clock = epoch;
  fake.roles.find((role) => role.id === ids.actorRole).permissions = String((1n << 28n) | 32n);
  const config = { guildId: ids.guild, applicationId: ids.bot, levelingEnabled: true, levelStorePath: path.join(root, 'levels.json'), levelRewardStorePath: path.join(root, 'rewards.json') };
  const levels = new LevelStore(config.levelStorePath, { now: () => clock }); await levels.load();
  const store = new LevelRewardStore(config.levelRewardStorePath, ids.guild); await store.load();
  const service = new LevelRewardService({ config, store, levels, discord: fake.discord, botUserId: ids.bot, now: () => clock }); t.after(() => service.stop());
  const f = { ...fake, root, config, levels, store, service, now: () => clock, advance: (ms = 15000) => { clock += ms; } };
  f.earn = async (userId = ids.user, count = 1) => { await levels.configure(ids.guild, 'tune', { xp: 100, cooldownMs: 15000 }); for (let n = 0; n < count; n++) { await levels.awardMessage(ids.guild, userId); f.advance(); } };
  f.enable = async () => { await service.configure('add', { roleId: ids.role, level: 1 }, ids.actor); await service.configure('enable', {}, ids.actor); };
  f.handler = createInteractionHandler({ ...f, levelRewards: service });
  f.run = async (action, values = {}) => { const result = await f.handler(interaction('levelreward', action, values)); assert.equal(result.immediate.type, 5); assert.equal(result.immediate.data.flags, 64); await result.work(); const data = f.calls.filter((call) => call[0] === 'response').at(-1)[3]; assert.deepEqual(data.allowed_mentions, { parse: [] }); return data.content; };
  return f;
}
test('level rewards start paused, persist configured milestones and isolate inputs/snapshots', async (t) => {
  const f = await fixture(t); assert.equal(f.service.get().enabled, false);
  const input = { roleId: ids.role, level: 1 }; const write = f.store.configure('add', input); input.level = 99; await write;
  const snapshot = f.store.get(); snapshot.rewards[0].level = 999; assert.equal(f.store.get().rewards[0].level, 1);
  await f.enable(); await f.earn(); await f.service.schedule(ids.user);
  const reload = new LevelRewardStore(f.config.levelRewardStorePath, ids.guild); await reload.load(); assert.equal(reload.get().enabled, true); assert.equal(reload.member(ids.user).pending, true); assert.equal(reload.get().rewards[0].level, 1);
});
test('reward ticks backfill existing XP, grant once, confirm membership and skip settled jobs', async (t) => {
  const f = await fixture(t); await f.earn(); await f.enable(); await f.service.tick();
  assert.ok(f.members.get(ids.user).roles.includes(ids.role)); assert.equal(f.store.member(ids.user).pending, false); assert.equal(f.calls.filter((c) => c[0] === 'grant').length, 1);
  await f.service.tick(); await f.service.schedule(ids.user); await f.service.tick(); assert.equal(f.calls.filter((c) => c[0] === 'grant').length, 1);
  f.members.get(ids.user).roles = []; await f.service.tick(); assert.equal(f.members.get(ids.user).roles.length, 0);
  const result = await f.service.reconcile(ids.user, ids.actor); assert.equal(result.granted, 1); assert.equal(result.pending, false);
});
test('rewards accumulate, reconfiguration reschedules, and removed rules preserve earned roles', async (t) => {
  const f = await fixture(t); const role = { id: ids.message, name: 'Second', managed: false, permissions: '0', position: 2 }; f.roles.push(role);
  await f.enable(); await f.service.configure('add', { roleId: role.id, level: 2 }, ids.actor); await f.earn(ids.user, 4); await f.service.tick(); assert.deepEqual(f.members.get(ids.user).roles.sort(), [ids.role, role.id].sort());
  await f.service.configure('remove', { roleId: role.id }, ids.actor); await f.service.tick(); assert.ok(f.members.get(ids.user).roles.includes(role.id));
  await f.service.configure('add', { roleId: ids.role, level: 4 }, ids.actor); assert.equal(f.service.get().rewards.length, 1); assert.equal(f.service.get().rewards[0].level, 4);
});
test('paused rewards do not grant roles or queue new work; re-enable resumes existing XP', async (t) => {
  const f = await fixture(t); await f.enable(); await f.earn(); await f.service.schedule(ids.user); await f.service.configure('disable', {}, ids.actor); await f.service.tick(); assert.equal(f.calls.filter((c) => c[0] === 'grant').length, 0);
  await assert.rejects(f.service.reconcile(ids.user, ids.actor), /Enable/); await f.service.schedule(ids.actor); assert.equal(f.store.member(ids.actor), null);
  await f.service.configure('enable', {}, ids.actor); await f.service.tick(); assert.equal(f.store.member(ids.user).pending, false);
});
test('durable retries back off, survive restart and recover after an ambiguous successful grant', async (t) => {
  const f = await fixture(t); await f.enable(); await f.earn();
  const grant = f.discord.grantRole; f.discord.grantRole = async (...args) => { await grant(...args); throw new Error('reply lost'); };
  await f.service.tick(); let job = f.store.member(ids.user); assert.equal(job.pending, true); assert.equal(job.attempts, 1); assert.equal(Date.parse(job.retryAt), f.now() + 15000);
  const before = f.calls.length; await f.service.tick(); assert.equal(f.calls.length, before);
  const reload = new LevelRewardStore(f.config.levelRewardStorePath, ids.guild); await reload.load(); f.discord.grantRole = grant; f.advance();
  const recovered = new LevelRewardService({ ...f, store: reload, botUserId: ids.bot }); t.after(() => recovered.stop()); await recovered.tick(); assert.equal(reload.member(ids.user).pending, false); assert.equal(f.calls.filter((c) => c[0] === 'grant').length, 1);
});
test('unconfirmed grants retry and higher-level messages preserve an existing retry deadline', async (t) => {
  const f = await fixture(t); await f.enable(); await f.earn(); f.discord.grantRole = async () => {};
  await f.service.tick(); const first = f.store.member(ids.user); assert.equal(first.pending, true);
  await f.earn(ids.user, 3); await f.service.schedule(ids.user); const higher = f.store.member(ids.user); assert.equal(higher.level, 2); assert.equal(higher.retryAt, first.retryAt); assert.equal(higher.attempts, 1);
  await f.service.tick(); assert.equal(f.store.member(ids.user).attempts, 2); assert.equal(Date.parse(f.store.member(ids.user).retryAt), f.now() + 30000);
});
test('failed settlement writes leave a replay-safe pending intent and recover after restart', async (t) => {
  const f = await fixture(t); await f.enable(); await f.earn(); await f.service.schedule(ids.user);
  const rename = fs.rename; fs.rename = async (...args) => { if (args[1] === f.config.levelRewardStorePath) throw new Error('disk full'); return rename(...args); }; t.after(() => { fs.rename = rename; });
  await f.service.tick(); assert.equal(f.store.member(ids.user).pending, true); assert.ok(f.members.get(ids.user).roles.includes(ids.role));
  fs.rename = rename; const reload = new LevelRewardStore(f.config.levelRewardStorePath, ids.guild); await reload.load(); const recovered = new LevelRewardService({ ...f, store: reload, botUserId: ids.bot }); t.after(() => recovered.stop()); await recovered.tick(); assert.equal(reload.member(ids.user).pending, false); assert.equal(f.calls.filter((c) => c[0] === 'grant').length, 1);
});
test('failed durable scheduling cannot grant a role and store queue remains usable', async (t) => {
  const f = await fixture(t); await f.enable(); await f.earn(); const original = await fs.readFile(f.config.levelRewardStorePath, 'utf8');
  const rename = fs.rename; fs.rename = async () => { throw new Error(); }; t.after(() => { fs.rename = rename; });
  await assert.rejects(f.service.schedule(ids.user)); assert.equal(f.store.member(ids.user), null); assert.equal(await fs.readFile(f.config.levelRewardStorePath, 'utf8'), original); assert.equal(f.calls.filter((c) => c[0] === 'grant').length, 0);
  fs.rename = rename; await f.service.schedule(ids.user); assert.equal(f.store.member(ids.user).pending, true); assert.equal((await fs.readdir(f.root)).some((file) => file.endsWith('.tmp')), false);
});
test('readers retain committed settings and job state while atomic replacement is paused', async (t) => {
  const f = await fixture(t), rename = fs.rename; let arrive, release; const entered = new Promise((r) => { arrive = r; }), gate = new Promise((r) => { release = r; });
  fs.rename = async (...args) => { arrive(); await gate; return rename(...args); }; t.after(() => { fs.rename = rename; release(); });
  const write = f.store.configure('enable'); await entered; assert.equal(f.store.get().enabled, false); release(); await write; assert.equal(f.store.get().enabled, true);
});
for (const [label, mutate] of [
  ['permission-bearing role', (f) => { f.roles.find((r) => r.id === ids.role).permissions = '8'; }],
  ['managed role', (f) => { f.roles.find((r) => r.id === ids.role).managed = true; }],
  ['role above bot', (f) => { f.roles.find((r) => r.id === ids.role).position = 20; }],
  ['role above staff', (f) => { f.roles.find((r) => r.id === ids.role).position = 10; }],
  ['missing bot Manage Roles', (f) => { f.roles.find((r) => r.id === ids.botRole).permissions = '0'; }],
  ['missing current staff permissions', (f) => { f.roles.find((r) => r.id === ids.actorRole).permissions = '0'; }],
  ['stale staff identity', (f) => { f.members.get(ids.actor).user.id = ids.owner; }],
  ['timed-out staff', (f) => { f.members.get(ids.actor).communication_disabled_until = new Date(f.now() + 60000).toISOString(); }]
]) test(`reward configuration refuses ${label}`, async (t) => {
  const f = await fixture(t); mutate(f); await assert.rejects(f.service.configure('add', { roleId: ids.role, level: 1 }, ids.actor)); assert.deepEqual(f.service.get().rewards, []);
});
for (const [label, mutate] of [
  ['permission changed after configuration', (f) => { f.roles.find((r) => r.id === ids.role).permissions = '8'; }],
  ['member screening', (f) => { f.members.get(ids.user).pending = true; }],
  ['bot recipient', (f) => { f.members.get(ids.user).user.bot = true; }],
  ['stale member identity', (f) => { f.members.get(ids.user).user.id = ids.actor; }],
  ['unknown member role', (f) => { f.members.get(ids.user).roles = [ids.owner]; }],
  ['member above bot', (f) => { f.members.get(ids.user).roles = [ids.botRole]; }],
  ['deleted reward role', (f) => { f.roles.splice(f.roles.findIndex((r) => r.id === ids.role), 1); }]
]) test(`reward assignment refuses ${label} and keeps a durable retry`, async (t) => {
  const f = await fixture(t); await f.enable(); await f.earn(); mutate(f); await f.service.tick(); assert.equal(f.calls.filter((c) => c[0] === 'grant').length, 0); assert.equal(f.store.member(ids.user).pending, true);
});
test('all reward roles are validated before any assignment and owner is never auto-targeted', async (t) => {
  const f = await fixture(t); f.roles.push({ id: ids.message, name: 'Extra', managed: false, permissions: '0', position: 2 }); await f.enable(); await f.service.configure('add', { roleId: ids.message, level: 1 }, ids.actor); await f.earn(); f.roles.find((r) => r.id === ids.message).permissions = '8'; await f.service.tick(); assert.equal(f.calls.filter((c) => c[0] === 'grant').length, 0);
  await assert.rejects(f.service.reconcile(ids.owner, ids.actor)); await assert.rejects(f.service.reconcile(ids.bot, ids.actor));
});
test('guild and role snapshots reject mismatches, duplicates and malformed fields', async (t) => {
  const f = await fixture(t), original = f.discord.getGuild; f.discord.getGuild = async () => ({ id: ids.owner, owner_id: ids.owner }); await assert.rejects(f.enable()); f.discord.getGuild = original;
  f.roles.push(f.roles[1]); await assert.rejects(f.enable()); f.roles.pop(); const role = f.roles[1]; role.permissions = 'bad'; await assert.rejects(f.enable()); role.permissions = '0';
  f.members.get(ids.bot).roles = [ids.owner]; await assert.rejects(f.enable()); f.members.get(ids.bot).roles = [ids.botRole]; await assert.rejects(f.service.configure('add', { roleId: ids.guild, level: 1 }, ids.actor));
  const malformed = new LevelRewardService({ ...f, botUserId: 'invalid' }); await assert.rejects(malformed.configure('add', { roleId: ids.role, level: 1 }, ids.actor)); await assert.rejects(f.service.configure('add', { roleId: ids.role, level: 1 }, 'bad'));
});
test('rewards enforce staff and target hierarchy while the server owner can configure low bot roles', async (t) => {
  const f = await fixture(t); f.roles.find((r) => r.id === ids.role).position = 11; await f.service.configure('add', { roleId: ids.role, level: 1 }, ids.owner); await f.service.configure('enable', {}, ids.owner); await f.earn();
  f.members.get(ids.user).roles = [ids.actorRole]; await assert.rejects(f.service.reconcile(ids.user, ids.actor)); const result = await f.service.reconcile(ids.user, ids.owner); assert.equal(result.pending, false);
});
test('scheduler coalesces ticks, bounds member scan/API work and drains on stop', async (t) => {
  const f = await fixture(t); await f.enable();
  for (let n = 0; n < 30; n++) { const userId = String(100000000000000000n + BigInt(n)); f.levels.accounts.set(`${ids.guild}:${userId}`, { guildId: ids.guild, userId, xp: 100, lastAward: null }); f.members.set(userId, { user: { id: userId }, roles: [] }); }
  const first = f.service.tick(), second = f.service.tick(); assert.equal(first, second); await first; assert.equal(f.store.get().members.length, 25); assert.equal(f.calls.filter((c) => c[0] === 'grant').length, 1);
  await f.service.tick(); assert.equal(f.store.get().members.length, 30); assert.equal(f.calls.filter((c) => c[0] === 'grant').length, 2);
  f.service.start(); const timer = f.service.timer; f.service.start(); assert.equal(f.service.timer, timer); await f.service.stop(); assert.equal(f.service.timer, null); const calls = f.calls.length; await f.service.tick(); assert.equal(f.calls.length, calls);
});
test('level reward store validates limits, stale completion, clocks and unchanged scheduling', async (t) => {
  const f = await fixture(t); assert.throws(() => new LevelRewardStore('unused', 'bad')); assert.throws(() => f.service.preview('bad'));
  await assert.rejects(f.store.configure('unknown')); await assert.rejects(f.store.configure('add', { roleId: ids.role, level: 0 })); await assert.rejects(f.store.configure('remove', { roleId: 'bad' }));
  for (let n = 0; n < MAX_REWARDS; n++) await f.store.configure('add', { roleId: String(100000n + BigInt(n)), level: 1 });
  await assert.rejects(f.store.configure('add', { roleId: ids.role, level: 1 })); await f.store.configure('enable'); await f.store.schedule(ids.user, 1); const job = f.store.member(ids.user); assert.equal(await f.store.finish({ ...job, level: 2 }, f.now()), null);
  await assert.rejects(f.store.finish(job, NaN)); await assert.rejects(f.store.schedule('bad', 1)); await assert.rejects(f.store.schedule(ids.user, -1));
  await f.store.finish(job, f.now()); const raw = await fs.readFile(f.config.levelRewardStorePath, 'utf8'); await f.store.schedule(ids.user, 1); assert.equal(await fs.readFile(f.config.levelRewardStorePath, 'utf8'), raw);
  f.store.state.members = Array.from({ length: MAX_MEMBERS }, (_, n) => ({ userId: String(100000000000000000n + BigInt(n)), level: 1, revision: f.store.state.revision, pending: false, attempts: 0, retryAt: null }));
  await assert.rejects(f.store.schedule(ids.user, 1), /limit/); assert.equal(f.store.get().members.length, MAX_MEMBERS);
  await fs.writeFile(f.config.levelRewardStorePath, ' '.repeat(MAX_BYTES + 1)); await assert.rejects(new LevelRewardStore(f.config.levelRewardStorePath, ids.guild).load());
});
for (const [label, mutate] of [
  ['wrong guild', (s) => { s.guildId = ids.owner; }], ['unknown root', (s) => { s.extra = true; }], ['unsupported version', (s) => { s.version = 2; }],
  ['duplicate reward', (s) => s.rewards.push(s.rewards[0])], ['numeric role ID', (s) => { s.rewards[0].roleId = 123456; }], ['everyone reward', (s) => { s.rewards[0].roleId = ids.guild; }],
  ['duplicate member', (s) => s.members.push(s.members[0])], ['future member revision', (s) => { s.members[0].revision = s.revision + 1; }], ['unknown member field', (s) => { s.members[0].content = 'bad'; }],
  ['invalid retry timestamp', (s) => { s.members[0].retryAt = 'bad'; }], ['invalid pending state', (s) => { s.members[0].pending = false; s.members[0].attempts = 1; s.members[0].retryAt = new Date(epoch).toISOString(); }]
]) test(`reward store refuses ${label} and preserves the original file`, async (t) => {
  const f = await fixture(t); await f.enable(); await f.earn(); await f.service.schedule(ids.user); const state = f.store.get(); mutate(state); const raw = JSON.stringify(state); await fs.writeFile(f.config.levelRewardStorePath, raw); await assert.rejects(new LevelRewardStore(f.config.levelRewardStorePath, ids.guild).load()); assert.equal(await fs.readFile(f.config.levelRewardStorePath, 'utf8'), raw);
});
for (const action of ['add', 'remove', 'list', 'info', 'enable', 'disable', 'preview', 'reconcile']) test(`levelreward ${action} requires Manage Server`, async (t) => {
  const f = await fixture(t); const result = await f.handler(interaction('levelreward', action, {}, '0')); assert.match(result.immediate.data.content, /Manage Server/); assert.equal(f.calls.length, 0);
});
test('all level reward commands return private confirmations, eligibility, status and errors', async (t) => {
  const f = await fixture(t); await f.earn(); assert.match(await f.run('add', { role: ids.role, level: 1 }), /saved/); assert.match(await f.run('list'), /paused/); assert.match(await f.run('info'), /Rules: 1/); assert.match(await f.run('preview', { user: ids.user }), /Level: 1/); assert.equal(f.members.get(ids.user).roles.length, 0);
  await f.run('enable'); assert.match(await f.run('reconcile', { user: ids.user }), /confirmed/); await f.run('disable'); await f.run('remove', { role: ids.role }); assert.match(await f.run('list'), /No rewards/);
  assert.match(await f.run('add', { role: ids.role, level: 0 }), /failed/); assert.match(await f.run('preview', { user: 'bad' }), /failed/); assert.match((await f.handler(interaction('levelreward', 'unknown'))).immediate.data.content, /Choose/);
  const missing = createInteractionHandler({ config: f.config, discord: f.discord }); assert.match((await missing(interaction('levelreward', 'info'))).immediate.data.content, /unavailable/);
});
test('reward command pending replies preserve durable intent without leaking mentions', async (t) => {
  const f = await fixture(t); await f.enable(); await f.earn(); f.discord.grantRole = async () => { throw new Error(); }; assert.match(await f.run('reconcile', { user: ids.user }), /pending/); assert.equal(f.store.member(ids.user).pending, true);
});
test('Gateway awards queue rewards without storing message text and recover queue failures by scanning', async (t) => {
  const f = await fixture(t); await f.enable(); await f.levels.configure(ids.guild, 'tune', { xp: 100, cooldownMs: 15000 }); const logs = [];
  const events = new GuildEventService({ ...f, levelRewards: f.service, now: f.now, logger: (...args) => logs.push(args) }); const data = { id: ids.message, guild_id: ids.guild, channel_id: ids.channel, timestamp: new Date(f.now()).toISOString(), author: { id: ids.user }, content: 'never save this text' };
  const schedule = f.service.schedule.bind(f.service); f.service.schedule = async () => { throw new Error('queue disk failure'); }; await events.dispatch('MESSAGE_CREATE', data); assert.equal(f.levels.get(ids.guild, ids.user).level, 1); assert.equal(logs[0][0], 'level_reward_schedule_failed'); assert.equal(f.store.member(ids.user), null);
  f.service.schedule = schedule; await f.service.tick(); assert.equal(f.store.member(ids.user).pending, false); assert.equal((await fs.readFile(f.config.levelRewardStorePath, 'utf8')).includes(data.content), false);
  f.advance(); await events.dispatch('MESSAGE_CREATE', { ...data, id: ids.menu, timestamp: new Date(f.now()).toISOString() }); assert.equal(f.store.member(ids.user).pending, false);
});
test('signed HTTP reward workflow controls the wired Gateway and recovers a lost assignment reply', async (t) => {
  const crypto = require('node:crypto'), { once } = require('node:events');
  const { createServerRuntime } = require('../src/server'), { publicKeyFromHex } = require('../src/interactions'), { TicketStore } = require('../src/ticket-store');
  const f = await fixture(t); Object.assign(f.config, { host: '127.0.0.1', port: 0, gatewayEnabled: true, gatewayIntents: 33281, storePath: path.join(f.root, 'tickets.json'), moderationStorePath: path.join(f.root, 'warnings.json'), economyStorePath: path.join(f.root, 'coins.json') });
  const pair = crypto.generateKeyPairSync('ed25519'), gateway = { start() {}, stop() {} };
  const server = await createServerRuntime({ ...f, store: new TicketStore(f.config.storePath), gateway, publicKey: publicKeyFromHex(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')) });
  t.after(async () => { await server.drain(); if (server.listening) await new Promise((r) => server.close(r)); await Promise.all([server.community.stop(), server.voice.stop(), server.roleMenus.stop(), server.timers.stop(), server.ticketPanels.stop(), server.levelRewards.stop()]); }); await once(server, 'listening');
  // Keep background scheduling deterministic while exercising the actual runtime service.
  await server.levelRewards.stop(); server.levelRewards.stopping = false;
  const send = async (action, values = {}) => {
    const raw = Buffer.from(JSON.stringify(interaction('levelreward', action, values))), timestamp = String(Math.floor(Date.now() / 1000));
    const result = await fetch(`http://127.0.0.1:${server.address().port}/interactions`, { method: 'POST', body: raw, headers: { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': crypto.sign(null, Buffer.concat([Buffer.from(timestamp), raw]), pair.privateKey).toString('hex') } });
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { type: 5, data: { flags: 64 } }); await server.drain();
  };
  await send('add', { role: ids.role, level: 1 }); await send('enable'); await f.levels.configure(ids.guild, 'tune', { xp: 100, cooldownMs: 15000 });
  await gateway.onDispatch('MESSAGE_CREATE', { id: ids.message, guild_id: ids.guild, channel_id: ids.channel, author: { id: ids.user }, timestamp: new Date().toISOString(), content: 'not retained' });
  assert.equal(server.levelRewards.store.member(ids.user).pending, true);
  const grant = f.discord.grantRole; f.discord.grantRole = async (...args) => { await grant(...args); throw new Error('lost API reply'); }; await server.levelRewards.tick(); assert.equal(server.levelRewards.store.member(ids.user).pending, true);
  f.discord.grantRole = grant; const deliver = f.discord.editOriginalResponse; f.discord.editOriginalResponse = async () => { throw new Error('lost interaction reply'); }; await send('reconcile', { user: ids.user }); f.discord.editOriginalResponse = deliver;
  const loaded = new LevelRewardStore(f.config.levelRewardStorePath, ids.guild); await loaded.load(); assert.equal(loaded.member(ids.user).pending, false); assert.equal(f.calls.filter((call) => call[0] === 'grant').length, 1);
  await send('info'); await send('preview', { user: ids.user }); await send('disable'); await send('remove', { role: ids.role }); assert.ok(f.members.get(ids.user).roles.includes(ids.role));
});
test('reward configuration paths are distinct, protected and inspected by the offline doctor', async (t) => {
  const { loadConfig } = require('../src/config'), { inspectSetup } = require('../scripts/doctor'); const f = await fixture(t);
  const env = { DISCORD_APPLICATION_ID: ids.bot, DISCORD_GUILD_ID: ids.guild, DISCORD_PUBLIC_KEY: 'a'.repeat(64), DISCORD_BOT_TOKEN: 'fixture-only', LEVEL_REWARD_STORE_PATH: f.config.levelRewardStorePath };
  assert.equal(loadConfig({ ...env, LEVEL_REWARD_STORE_PATH: '' }).levelRewardStorePath, './data/level-rewards.json');
  assert.throws(() => loadConfig({ ...env, LEVEL_STORE_PATH: f.config.levelRewardStorePath }), /separate file/); assert.throws(() => loadConfig({ ...env, LEVEL_REWARD_STORE_PATH: '.env' }), /configuration/);
  assert.throws(() => loadConfig({ ...env, LEVEL_STORE_PATH: path.join(f.config.levelRewardStorePath, 'child.json') }), /contain another/);
  const report = await inspectSetup(env); assert.equal(report.checks.find((check) => check.name === 'Level rewards store').status, 'pass');
  const corrupt = '{"version":99}'; await fs.writeFile(f.config.levelRewardStorePath, corrupt); const invalid = await inspectSetup(env); assert.equal(invalid.checks.find((check) => check.name === 'Level rewards store').status, 'fail'); assert.equal(await fs.readFile(f.config.levelRewardStorePath, 'utf8'), corrupt);
});
