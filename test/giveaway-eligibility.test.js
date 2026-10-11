'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CommunityStore } = require('../src/community-store');
const { CommunityService, giveawayMessage } = require('../src/community-service');
const { LevelStore } = require('../src/level-store');
const { createInteractionHandler } = require('../src/interactions');
const { ids, epoch, directory, fakeDiscord, interaction } = require('./feature-fixtures');
async function fixture(t, count = 0) {
  const root = await directory(t), fake = fakeDiscord(); let clock = epoch;
  const config = { guildId: ids.guild, applicationId: ids.bot, communityStorePath: path.join(root, 'community.json'), levelStorePath: path.join(root, 'levels.json') };
  const store = new CommunityStore(config.communityStorePath, { pick: () => 0 }); await store.load(); const levels = new LevelStore(config.levelStorePath); await levels.load();
  const f = { ...fake, root, config, store, levels, now: () => new Date(clock), advance: (ms = 15000) => { clock += ms; } };
  const community = new CommunityService({ ...f }); f.community = community; t.after(() => community.stop()); f.handler = createInteractionHandler(f);
  f.job = await community.createGiveaway({ id: ids.menu, channelId: ids.channel, userId: ids.actor, text: 'Community prize', minutes: 30, winnerCount: 2 });
  f.entry = (userId = ids.user, extra = {}) => ({ id: ids.menu, channelId: ids.channel, messageId: f.job.messageId, userId, ...extra });
  f.user = (n) => String(200000000000000000n + BigInt(n));
  for (let n = 0; n < count; n++) { const userId = f.user(n); f.members.set(userId, { user: { id: userId }, roles: [] }); await community.enter(f.entry(userId)); }
  f.run = async (action, values = {}, subaction) => {
    const payload = interaction('giveaway', action, values, '8192');
    if (subaction) payload.data.options[0].options = [{ name: subaction, options: payload.data.options[0].options }];
    const result = await f.handler(payload); assert.equal(result.immediate.type, 5); assert.equal(result.immediate.data.flags, 64); await result.work(); const body = f.calls.filter((call) => call[0] === 'response').at(-1)[3]; assert.deepEqual(body.allowed_mentions, { parse: [] }); return body.content;
  };
  return f;
}
test('giveaway requirements enforce all roles and inclusive level bounds; leaving bypasses new gates', async (t) => {
  const f = await fixture(t); await f.community.configureRequirements(ids.menu, 'role-add', { roleId: ids.role });
  assert.equal((await f.community.eligibility(ids.menu, ids.user)).eligible, false); await assert.rejects(f.community.enter(f.entry()));
  f.members.get(ids.user).roles.push(ids.role); await f.community.configureRequirements(ids.menu, 'levels', { minLevel: 2, maxLevel: 2 });
  f.levels.accounts.set(`${ids.guild}:${ids.user}`, { guildId: ids.guild, userId: ids.user, xp: 400, lastAward: null }); assert.equal((await f.community.eligibility(ids.menu, ids.user)).eligible, true); await f.community.enter(f.entry());
  f.levels.accounts.get(`${ids.guild}:${ids.user}`).xp = 900; assert.equal((await f.community.eligibility(ids.menu, ids.user)).eligible, false); f.members.get(ids.user).roles = [];
  assert.equal((await f.community.enter(f.entry(ids.user, { leave: true }))).status, 'left');
  await f.community.configureRequirements(ids.menu, 'clear'); assert.deepEqual(f.store.get(ids.menu).requirements, { roles: [], minLevel: 0, maxLevel: null }); assert.equal((await f.community.eligibility(ids.menu, ids.user)).eligible, true);
});
test('requirements persist, respect role limits, and can remove deleted references', async (t) => {
  const f = await fixture(t);
  for (let n = 0; n < 5; n++) { const roleId = String(100000n + BigInt(n)); f.roles.push({ id: roleId }); await f.community.configureRequirements(ids.menu, 'role-add', { roleId }); }
  await f.community.configureRequirements(ids.menu, 'role-add', { roleId: '100000' }); assert.equal(f.store.get(ids.menu).requirements.roles.length, 5);
  await assert.rejects(f.community.configureRequirements(ids.menu, 'role-add', { roleId: ids.role })); await assert.rejects(f.community.configureRequirements(ids.menu, 'role-add', { roleId: ids.guild })); await assert.rejects(f.community.configureRequirements(ids.menu, 'role-add', { roleId: ids.owner }));
  f.roles.splice(f.roles.findIndex((role) => role.id === '100000'), 1); await f.community.configureRequirements(ids.menu, 'role-remove', { roleId: '100000' });
  const reload = new CommunityStore(f.config.communityStorePath); await reload.load(); assert.equal(reload.get(ids.menu).requirements.roles.length, 4); assert.equal(JSON.parse(await fs.readFile(f.config.communityStorePath)).version, 3);
});
for (const [name, value] of [['minimum negative', { minLevel: -1, maxLevel: null }], ['inverted range', { minLevel: 3, maxLevel: 2 }], ['fraction', { minLevel: 1.5, maxLevel: 2 }], ['too high', { minLevel: 0, maxLevel: 1001 }]]) test(`giveaway requirement validation refuses ${name}`, async (t) => {
  const f = await fixture(t); const before = await fs.readFile(f.config.communityStorePath, 'utf8'); await assert.rejects(f.community.configureRequirements(ids.menu, 'levels', value)); assert.equal(await fs.readFile(f.config.communityStorePath, 'utf8'), before);
});
for (const [name, change] of [['bot', (m) => { m.user.bot = true; }], ['pending screening', (m) => { m.pending = true; }]]) test(`giveaways exclude ${name} members`, async (t) => {
  const f = await fixture(t); change(f.members.get(ids.user)); assert.equal((await f.community.eligibility(ids.menu, ids.user)).eligible, false); await assert.rejects(f.community.enter(f.entry()));
});
test('member lookup distinguishes departure from transient failures and refuses stale identity', async (t) => {
  const f = await fixture(t); f.members.delete(ids.user); assert.equal((await f.community.eligibility(ids.menu, ids.user)).eligible, false);
  f.discord.getGuildMember = async () => { throw Object.assign(new Error('temporary'), { statusCode: 503 }); }; await assert.rejects(f.community.eligibility(ids.menu, ids.user));
  f.discord.getGuildMember = async () => ({ user: { id: ids.actor }, roles: [] }); await assert.rejects(f.community.eligibility(ids.menu, ids.user));
  f.discord.getGuildMember = async () => ({ user: { id: ids.user }, roles: [123456] }); await assert.rejects(f.community.eligibility(ids.menu, ids.user)); await assert.rejects(f.community.eligibility(ids.menu, 'bad'));
  f.discord.getGuildMember = async () => ({ user: { id: ids.user }, roles: [] }); await f.community.configureRequirements(ids.menu, 'levels', { minLevel: 1, maxLevel: null }); f.community.levels = undefined; await assert.rejects(f.community.eligibility(ids.menu, ids.user));
});
test('entry validates persisted message/guild/channel before any current member lookup', async (t) => {
  const f = await fixture(t); let reads = 0; const read = f.discord.getGuildMember; f.discord.getGuildMember = async (...args) => { reads++; return read(...args); };
  await assert.rejects(f.community.enter(f.entry(ids.user, { channelId: ids.lobby }))); await assert.rejects(f.community.enter(f.entry(ids.user, { messageId: ids.owner }))); assert.equal(reads, 0);
  await Promise.all([f.community.enter(f.entry()), f.community.enter(f.entry())]); assert.equal(f.store.get(ids.menu).entrants.length, 1);
});
test('selection checks every entrant, excludes departed/ineligible members and saves confirmed winners', async (t) => {
  const f = await fixture(t, 6); await f.community.configureRequirements(ids.menu, 'role-add', { roleId: ids.role });
  for (let n = 0; n < 6; n++) f.members.get(f.user(n)).roles = [ids.role]; f.members.delete(f.user(0)); f.members.get(f.user(1)).pending = true; f.members.get(f.user(2)).user.bot = true; f.members.get(f.user(3)).roles = [];
  const result = await f.community.endGiveaway(ids.menu); assert.equal(result.state, 'finished'); assert.deepEqual(result.winners, [f.user(4), f.user(5)]);
  const winners = [...result.winners]; await f.community.endGiveaway(ids.menu); assert.deepEqual(f.store.get(ids.menu).winners, winners); const reload = new CommunityStore(f.config.communityStorePath); await reload.load(); assert.deepEqual(reload.get(ids.menu).winners, winners);
});
test('large selections check at most 25 members per attempt, resume across restart and close entry', async (t) => {
  const f = await fixture(t, 60); let reads = 0; const read = f.discord.getGuildMember; f.discord.getGuildMember = async (...args) => { reads++; return read(...args); };
  let job = await f.community.endGiveaway(ids.menu); assert.equal(reads, 25); assert.equal(job.state, 'selecting'); assert.equal(job.selection.remaining.length, 35); assert.deepEqual(giveawayMessage(job).components, []);
  await assert.rejects(f.community.enter(f.entry())); await assert.rejects(f.community.editGiveaway(ids.menu, 'prize', 'Changed')); await assert.rejects(f.community.configureRequirements(ids.menu, 'clear'));
  const reload = new CommunityStore(f.config.communityStorePath, { pick: () => 0 }); await reload.load(); const resumed = new CommunityService({ ...f, store: reload }); t.after(() => resumed.stop());
  reads = 0; await resumed.tick(); assert.equal(reads, 25); assert.equal(reload.get(ids.menu).selection.remaining.length, 10);
  reads = 0; await resumed.tick(); assert.equal(reads, 12); job = reload.get(ids.menu); assert.equal(job.state, 'finished'); assert.deepEqual(job.winners, [f.user(0), f.user(1)]);
});
test('selection rechecks proposed winners and replaces members who leave after their earlier scan', async (t) => {
  const f = await fixture(t, 25); let reads = 0; const read = f.discord.getGuildMember; f.discord.getGuildMember = async (...args) => { reads++; return read(...args); };
  await f.community.endGiveaway(ids.menu); assert.equal(reads, 25); assert.equal(f.store.get(ids.menu).state, 'selecting'); f.members.delete(f.user(0));
  reads = 0; await f.community.tick(); assert.equal(reads, 2); assert.equal(f.store.get(ids.menu).state, 'selecting'); assert.equal(f.store.get(ids.menu).selection.eligible.includes(f.user(0)), false);
  await f.community.tick(); assert.deepEqual(f.store.get(ids.menu).winners, [f.user(1), f.user(2)]);
});
test('transient selection errors preserve successful prefix progress and durable retry deadlines', async (t) => {
  const f = await fixture(t, 6); const read = f.discord.getGuildMember; let fail = true; f.discord.getGuildMember = async (guild, user) => { if (fail && user === f.user(3)) throw new Error('network'); return read(guild, user); };
  await f.community.endGiveaway(ids.menu); let job = f.store.get(ids.menu); assert.equal(job.state, 'selecting'); assert.equal(job.selection.remaining.length, 3); assert.equal(job.attempts, 1); assert.equal(Date.parse(job.retryAt), f.now().getTime() + 15000);
  let calls = 0; f.discord.getGuildMember = async (...args) => { calls++; return read(...args); }; await f.community.tick(); assert.equal(calls, 0); f.advance(); fail = false; await f.community.tick(); assert.equal(f.store.get(ids.menu).state, 'finished');
});
test('failed progress replacement exposes no unchecked progress and retries safely', async (t) => {
  const f = await fixture(t, 4); await f.store.beginSelection({ id: ids.menu, guildId: ids.guild, force: true }, f.now()); const rename = fs.rename;
  fs.rename = async (...args) => { if (args[1] === f.config.communityStorePath) throw new Error('disk'); return rename(...args); }; t.after(() => { fs.rename = rename; });
  await f.community.tick(); assert.equal(f.store.get(ids.menu).selection.remaining.length, 4); assert.equal(f.store.get(ids.menu).winners.length, 0);
  fs.rename = rename; await f.community.tick(); assert.equal(f.store.get(ids.menu).state, 'finished');
});
test('failed result delivery retains the same persisted winners without another membership draw', async (t) => {
  const f = await fixture(t, 3); const edit = f.discord.editMessage; f.discord.editMessage = async () => { throw new Error('offline'); }; await f.community.endGiveaway(ids.menu);
  const job = f.store.get(ids.menu); assert.equal(job.state, 'drawn'); assert.deepEqual(job.winners, [f.user(0), f.user(1)]);
  f.discord.editMessage = edit; f.discord.getGuildMember = async () => { throw new Error('No new draw'); }; f.advance(); await f.community.tick(); assert.equal(f.store.get(ids.menu).state, 'finished'); assert.deepEqual(f.store.get(ids.menu).winners, job.winners);
});
test('rerolls exclude previous winners, persist request IDs and do not redraw duplicate requests', async (t) => {
  const f = await fixture(t, 6); await f.community.endGiveaway(ids.menu); const result = await f.community.rerollGiveaway(ids.menu, ids.message); assert.deepEqual(result.winners, [f.user(2), f.user(3)]);
  await f.community.rerollGiveaway(ids.menu, ids.message); assert.deepEqual(f.store.get(ids.menu).winners, result.winners); await assert.rejects(f.community.rerollGiveaway(ids.menu, '100000'));
  const reload = new CommunityStore(f.config.communityStorePath); await reload.load(); assert.equal(reload.get(ids.menu).rerollRequestId, ids.message);
});
test('cancelled selections stop eligibility work and preserve entrant records', async (t) => {
  const f = await fixture(t, 30); await f.community.endGiveaway(ids.menu); await f.community.cancelGiveaway(ids.menu); assert.equal(f.store.get(ids.menu).state, 'cancelled'); assert.equal(f.store.get(ids.menu).selection, undefined);
  f.discord.getGuildMember = async () => { throw new Error('No lookup'); }; await f.community.tick(); assert.equal(f.store.get(ids.menu).entrants.length, 30);
});
test('one scheduler tick services at most one selection and coalesces concurrent ticks', async (t) => {
  const f = await fixture(t, 30); await f.store.beginSelection({ id: ids.menu, guildId: ids.guild, force: true }, f.now());
  const other = await f.community.createGiveaway({ id: ids.owner, channelId: ids.channel, userId: ids.actor, text: 'Other', minutes: 30 }); await f.store.beginSelection({ id: other.id, guildId: ids.guild, force: true }, f.now());
  const first = f.community.tick(); assert.equal(first, f.community.tick()); await first; assert.equal(f.store.get(ids.menu).selection.remaining.length, 5); assert.equal(f.store.get(other.id).state, 'selecting');
});
test('version 1 jobs load untouched and migrate only on a successful atomic write', async (t) => {
  const f = await fixture(t); const job = f.store.get(ids.menu); delete job.requirements; delete job.presentation; const raw = JSON.stringify({ version: 1, jobs: [job] }); await fs.writeFile(f.config.communityStorePath, raw); await f.store.load(); assert.equal(await fs.readFile(f.config.communityStorePath, 'utf8'), raw);
  const rename = fs.rename; fs.rename = async () => { throw new Error(); }; t.after(() => { fs.rename = rename; }); await assert.rejects(f.community.configureRequirements(ids.menu, 'clear')); assert.equal(await fs.readFile(f.config.communityStorePath, 'utf8'), raw);
  fs.rename = rename; await f.community.configureRequirements(ids.menu, 'clear'); assert.equal(JSON.parse(await fs.readFile(f.config.communityStorePath)).version, 3); assert.ok(f.store.get(ids.menu).requirements);
});
test('community readers keep committed entries, requirements and selection during replacement', async (t) => {
  const f = await fixture(t), rename = fs.rename; let arrive, release; const entered = new Promise((r) => { arrive = r; }), gate = new Promise((r) => { release = r; });
  fs.rename = async (...args) => { arrive(); await gate; return rename(...args); }; t.after(() => { fs.rename = rename; release(); });
  const write = f.store.requirements({ id: ids.menu, guildId: ids.guild, action: 'role-add', roleId: ids.role }, f.now()); await entered; assert.deepEqual(f.store.get(ids.menu).requirements.roles, []); release(); await write; assert.deepEqual(f.store.get(ids.menu).requirements.roles, [ids.role]);
});
for (const [name, mutate] of [
  ['duplicate required role', (job) => { job.requirements.roles = [ids.role, ids.role]; }], ['everyone requirement', (job) => { job.requirements.roles = [ids.guild]; }], ['wrong policy fields', (job) => { job.requirements.extra = true; }], ['inverted range', (job) => { job.requirements.minLevel = 2; job.requirements.maxLevel = 1; }],
  ['duplicate selection member', (job) => job.selection.eligible.push(job.selection.remaining[0])], ['unknown selection member', (job) => job.selection.remaining.push(ids.owner)], ['missing selection snapshot', (job) => { delete job.selection; }], ['wrong selection state', (job) => { job.state = 'open'; }], ['invalid selection clock', (job) => { job.selection.startedAt = 'bad'; }]
]) test(`giveaway store refuses ${name} without rewriting original data`, async (t) => {
  const f = await fixture(t, 2); await f.store.beginSelection({ id: ids.menu, guildId: ids.guild, force: true }, f.now()); const job = f.store.get(ids.menu); mutate(job); const raw = JSON.stringify({ version: 3, jobs: [job] }); await fs.writeFile(f.config.communityStorePath, raw); await assert.rejects(new CommunityStore(f.config.communityStorePath).load()); assert.equal(await fs.readFile(f.config.communityStorePath, 'utf8'), raw);
});
test('selection methods reject invalid checkpoints, raw draws and incomplete winner commits', async (t) => {
  const f = await fixture(t, 2); await assert.rejects(f.store.draw(ids.menu, f.now(), true)); await assert.rejects(f.store.reroll({ id: ids.menu, guildId: ids.guild, requestId: ids.message }));
  await assert.rejects(f.store.beginSelection({ id: ids.menu, guildId: ids.guild, force: 'yes' }, f.now()));
  await assert.rejects(f.store.beginSelection({ id: ids.menu, guildId: ids.guild }, f.now())); await f.store.beginSelection({ id: ids.menu, guildId: ids.guild, force: true }, f.now());
  await assert.rejects(f.store.finishSelection(ids.menu, [])); await assert.rejects(f.store.advanceSelection(ids.menu, [{ userId: f.user(1), eligible: true }])); await assert.rejects(f.store.advanceSelection(ids.menu, [{ userId: f.user(0), eligible: 'yes' }]));
  await f.store.advanceSelection(ids.menu, [{ userId: f.user(0), eligible: true }, { userId: f.user(1), eligible: true }]); await assert.rejects(f.store.finishSelection(ids.menu, [f.user(0), f.user(0)])); await assert.rejects(f.store.discardCandidates(ids.menu, [ids.owner]));
  f.store.pick = () => 99; assert.throws(() => f.store.candidates(ids.menu)); f.store.pick = () => 0; await f.store.discardCandidates(ids.menu, [f.user(0)]); await f.store.finishSelection(ids.menu, [f.user(1)]); assert.deepEqual(f.store.get(ids.menu).winners, [f.user(1)]);
});
for (const [action, subaction] of [['requirements','role-add'],['requirements','role-remove'],['requirements','levels'],['requirements','clear'],['eligibility',undefined],['entrants',undefined]]) test(`giveaway ${subaction || action} requires Manage Messages`, async (t) => {
  const f = await fixture(t); const payload = interaction('giveaway', action, {}, '0'); if(subaction) payload.data.options[0].options = [{ name: subaction }]; const result = await f.handler(payload); assert.match(result.immediate.data.content, /Manage Messages/);
});
test('giveaway requirement commands, private previews, entrants pages and pending replies work', async (t) => {
  const f = await fixture(t, 30); assert.match(await f.run('requirements', { id: ids.menu, role: ids.role }, 'role-add'), /saved/); assert.match(await f.run('eligibility', { id: ids.menu, user: f.user(0) }), /Eligible: false/);
  assert.match(await f.run('requirements', { id: ids.menu, role: ids.role }, 'role-remove'), /saved/); await f.run('requirements', { id: ids.menu, min: 0, max: 0 }, 'levels'); await f.run('requirements', { id: ids.menu }, 'clear');
  let content = await f.run('entrants', { id: ids.menu, page: 2 }); assert.equal((content.match(/<@/g) || []).length, 10); assert.match(await f.run('info', { id: ids.menu }), /Selection remaining/);
  assert.match(await f.run('end', { id: ids.menu }), /saved and pending/); assert.match(await f.run('requirements', { id: ids.menu }, 'clear'), /Could not/); assert.match(await f.run('entrants', { id: ids.menu, page: 501 }), /Could not/);
  await f.community.tick(); assert.equal(f.store.get(ids.menu).state, 'finished');
});
test('signed HTTP requirements, eligibility and member selection survive lost result replies', async (t) => {
  const crypto = require('node:crypto'), { once } = require('node:events'); const { createServerRuntime } = require('../src/server'), { publicKeyFromHex } = require('../src/interactions'), { TicketStore } = require('../src/ticket-store');
  const root = await directory(t), fake = fakeDiscord(); const config = { applicationId: ids.bot, guildId: ids.guild, host: '127.0.0.1', port: 0, gatewayEnabled: false, storePath: path.join(root, 'tickets.json'), moderationStorePath: path.join(root, 'warnings.json'), economyStorePath: path.join(root, 'coins.json'), levelStorePath: path.join(root, 'levels.json'), communityStorePath: path.join(root, 'community.json') };
  fake.members.get(ids.user).roles = [ids.role]; const pair = crypto.generateKeyPairSync('ed25519'), store = new CommunityStore(config.communityStorePath, { pick: () => 0 });
  const server = await createServerRuntime({ config, discord: fake.discord, store: new TicketStore(config.storePath), communityStore: store, publicKey: publicKeyFromHex(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')) });
  t.after(async () => { await server.drain(); if(server.listening) await new Promise((r) => server.close(r)); await Promise.all([server.community.stop(), server.voice.stop(), server.roleMenus.stop(), server.timers.stop(), server.ticketPanels.stop(), server.levelRewards.stop()]); }); await once(server, 'listening'); await server.community.stop(); server.community.stopping = false;
  const send = async (payload) => { const raw = Buffer.from(JSON.stringify(payload)), timestamp = String(Math.floor(Date.now()/1000)); const result = await fetch(`http://127.0.0.1:${server.address().port}/interactions`, { method: 'POST', body: raw, headers: { 'x-signature-timestamp':timestamp, 'x-signature-ed25519':crypto.sign(null,Buffer.concat([Buffer.from(timestamp),raw]),pair.privateKey).toString('hex') } }); assert.equal(result.status,200); assert.deepEqual(await result.json(),{ type:5,data:{flags:64} }); await server.drain(); };
  await send(interaction('giveaway','create',{ prize:'Community prize',minutes:30 },'8192'));
  const req = interaction('giveaway','requirements',{},'8192'); req.data.options[0].options = [{ name:'role-add',options:[{ name:'id',value:ids.menu },{ name:'role',value:ids.role }] }]; await send(req);
  await send(interaction('giveaway','eligibility',{ id:ids.menu,user:ids.user },'8192'));
  const button = { type:3,guild_id:ids.guild,channel_id:ids.channel,token:'fixture',member:{user:{id:ids.user},permissions:'0'},message:{id:store.get(ids.menu).messageId},data:{custom_id:`giveaway:enter:${ids.menu}`} };
  await send(button); assert.deepEqual(store.get(ids.menu).entrants,[ids.user]); await send(interaction('giveaway','entrants',{id:ids.menu,page:1},'8192'));
  const edit = fake.discord.editMessage; let failed = false; fake.discord.editMessage = async (...args) => { await edit(...args); if(!failed){failed=true;throw new Error('reply lost');} };
  await send(interaction('giveaway','end',{id:ids.menu},'8192')); assert.equal(store.get(ids.menu).state,'drawn'); assert.deepEqual(store.get(ids.menu).winners,[ids.user]);
  const loaded = new CommunityStore(config.communityStorePath); await loaded.load(); assert.deepEqual(loaded.get(ids.menu).winners,[ids.user]); const resumed = new CommunityService({ config,store:loaded,discord:fake.discord,now:()=>new Date(Date.now()+60000) }); t.after(()=>resumed.stop()); await resumed.tick(); assert.equal(loaded.get(ids.menu).state,'finished'); assert.deepEqual(loaded.get(ids.menu).winners,[ids.user]);
});
test('queued community creation copies caller text and requirement arrays before awaiting service work', async (t) => {
  const f = await fixture(t); let release; const gate = new Promise((resolve) => { release = resolve; }); f.community.queue = gate; t.after(() => release());
  const input = { id: ids.owner, channelId: ids.channel, userId: ids.actor, text: 'Original prize', minutes: 30, requirements: { roles: [ids.role], minLevel: 0, maxLevel: null } };
  const pending = f.community.createGiveaway(input); input.text = 'Changed prize'; input.requirements.roles.length = 0;
  const reminder = { id: ids.user, channelId: ids.channel, userId: ids.actor, text: 'Original reminder', minutes: 1 }; const queued = f.community.createReminder(reminder); reminder.text = 'Changed reminder'; release();
  const result = await pending; assert.equal(result.text, 'Original prize'); assert.deepEqual(result.requirements.roles, [ids.role]); assert.equal((await queued).text, 'Original reminder');
});
