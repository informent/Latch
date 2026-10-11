'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TicketStore, MAX_GUESTS } = require('../src/ticket-store');
const { TicketService, CHAT, PERMISSIONS } = require('../src/ticket-service');
const { createInteractionHandler } = require('../src/interactions');
const { ids, epoch, directory, fakeDiscord, interaction } = require('./feature-fixtures');
const record = { channelId: ids.channel, ownerId: ids.user, status: 'open', createdAt: new Date(epoch).toISOString() };
async function fixture(t) {
  const root = await directory(t), fake = fakeDiscord(), store = new TicketStore(path.join(root, 'tickets.json'));
  await store.add(record);
  const config = { guildId: ids.guild, applicationId: ids.bot, supportRoleId: ids.actorRole };
  fake.channels.get(ids.channel).permission_overwrites.push({ id: ids.user, type: 1, allow: CHAT.toString(), deny: '0' }, { id: ids.bot, type: 1, allow: CHAT.toString(), deny: '0' });
  fake.discord.setMemberOverwrite = async (channel, user, body) => {
    fake.calls.push(['overwrite', channel, user, structuredClone(body)]);
    const saved = fake.channels.get(channel); saved.permission_overwrites = saved.permission_overwrites.filter(entry => entry.id !== user || entry.type !== 1); saved.permission_overwrites.push({ id: user, ...structuredClone(body) });
  };
  const tickets = new TicketService({ config, store, discord: fake.discord, botUserId: ids.bot, now: () => new Date(epoch) });
  const actor = { userId: ids.actor, roles: [ids.actorRole], permissions: '0', channelId: ids.channel, targetId: ids.owner };
  return { root, fake, store, config, tickets, actor, guest: action => tickets.guests({ ...actor, action }) };
}
const targetOverwrite = f => f.fake.channels.get(ids.channel).permission_overwrites.find(entry => entry.id === ids.owner && entry.type === 1);

test('ticket guest grants persist before Discord and preserve unrelated permissions', async t => {
  const f = await fixture(t); const extra = 1n << 17n;
  f.fake.channels.get(ids.channel).permission_overwrites.push({ id: ids.owner, type: 1, allow: extra.toString(), deny: (CHAT | (1n << 18n)).toString() });
  const write = f.fake.discord.setMemberOverwrite;
  f.fake.discord.setMemberOverwrite = async (...args) => { assert.deepEqual(f.store.getByChannel(ids.channel).guests, [ids.owner]); await write(...args); };
  assert.equal((await f.guest('add')).ok, true);
  assert.equal(BigInt(targetOverwrite(f).allow), CHAT | extra); assert.equal(BigInt(targetOverwrite(f).deny), 1n << 18n);
  const reopened = new TicketStore(f.store.filePath); await reopened.load(); assert.deepEqual(reopened.getByChannel(ids.channel).guests, [ids.owner]);
  assert.equal(JSON.parse(await fs.readFile(f.store.filePath)).version, 2);
});
test('guest removal denies only chat bits and persists after verified readback', async t => {
  const f = await fixture(t); await f.guest('add'); targetOverwrite(f).allow = (CHAT | (1n << 17n)).toString();
  const write = f.fake.discord.setMemberOverwrite;
  f.fake.discord.setMemberOverwrite = async (...args) => { assert.deepEqual(f.store.getByChannel(ids.channel).guests, [ids.owner]); await write(...args); };
  assert.equal((await f.guest('remove')).ok, true); assert.equal(BigInt(targetOverwrite(f).allow), 1n << 17n); assert.equal(BigInt(targetOverwrite(f).deny) & CHAT, CHAT); assert.deepEqual(f.store.getByChannel(ids.channel).guests, []);
});
test('guest grants retry after an ambiguous API failure and restart without duplicate slots', async t => {
  const f = await fixture(t), write = f.fake.discord.setMemberOverwrite;
  f.fake.discord.setMemberOverwrite = async (...args) => { await write(...args); throw new Error('private remote error'); };
  await assert.rejects(f.guest('add')); assert.deepEqual(f.store.getByChannel(ids.channel).guests, [ids.owner]);
  const recovered = new TicketStore(f.store.filePath); await recovered.load(); f.tickets.store = recovered; f.fake.discord.setMemberOverwrite = write;
  assert.equal((await f.guest('add')).ok, true); assert.deepEqual(recovered.getByChannel(ids.channel).guests, [ids.owner]);
});
test('failed removal remains saved so closing still revokes it', async t => {
  const f = await fixture(t); await f.guest('add'); const write = f.fake.discord.setMemberOverwrite;
  f.fake.discord.setMemberOverwrite = async () => { throw new Error('offline'); }; await assert.rejects(f.guest('remove')); assert.deepEqual(f.store.getByChannel(ids.channel).guests, [ids.owner]);
  f.fake.discord.setMemberOverwrite = write; await f.tickets.close(f.actor); assert.equal(f.store.getByChannel(ids.channel).status, 'closed'); assert.deepEqual(f.store.getByChannel(ids.channel).guests, []); assert.equal(BigInt(targetOverwrite(f).deny) & CHAT, CHAT);
});
test('closing revokes all saved guests, preserves staff and does not reinvite on reopen', async t => {
  const f = await fixture(t); await f.guest('add'); const staff = { id: ids.actorRole, type: 0, allow: CHAT.toString(), deny: '0' }; f.fake.channels.get(ids.channel).permission_overwrites.push(staff);
  assert.equal((await f.tickets.close(f.actor)).ok, true); assert.equal(BigInt(targetOverwrite(f).allow) & CHAT, 0n); assert.equal(BigInt(targetOverwrite(f).deny) & CHAT, CHAT);
  assert.equal((await f.tickets.reopen(f.actor)).ok, true); assert.equal(BigInt(targetOverwrite(f).deny) & CHAT, CHAT); assert.deepEqual(f.store.getByChannel(ids.channel).guests, []); assert.deepEqual(f.fake.channels.get(ids.channel).permission_overwrites.find(entry => entry.id === ids.actorRole), staff);
  assert.equal((await f.guest('add')).ok, true); assert.equal(BigInt(targetOverwrite(f).allow) & CHAT, CHAT);
});
test('a guest close failure remains closing and completes after restart/retry', async t => {
  const f = await fixture(t); await f.guest('add'); const write = f.fake.discord.setMemberOverwrite;
  f.fake.discord.setMemberOverwrite = async (...args) => { if (args[1] === ids.owner) throw new Error('offline'); await write(...args); };
  await assert.rejects(f.tickets.close(f.actor)); assert.equal(f.store.getByChannel(ids.channel).status, 'closing'); assert.deepEqual(f.store.getByChannel(ids.channel).guests, [ids.owner]);
  const recovered = new TicketStore(f.store.filePath); await recovered.load(); f.tickets.store = recovered; f.fake.discord.setMemberOverwrite = write;
  await f.tickets.close(f.actor); assert.equal(recovered.getByChannel(ids.channel).status, 'closed'); assert.deepEqual(recovered.getByChannel(ids.channel).guests, []);
});
test('permission mismatch never confirms a grant or forgets a removal', async t => {
  const f = await fixture(t), write = f.fake.discord.setMemberOverwrite; f.fake.discord.setMemberOverwrite = async () => {};
  await assert.rejects(f.guest('add'), /confirmed/); assert.deepEqual(f.store.getByChannel(ids.channel).guests, [ids.owner]);
  f.fake.discord.setMemberOverwrite = write; await f.guest('add'); f.fake.discord.setMemberOverwrite = async () => {};
  await assert.rejects(f.guest('remove'), /confirmed/); assert.deepEqual(f.store.getByChannel(ids.channel).guests, [ids.owner]);
});
test('unrelated overwrite changes cannot be silently confirmed', async t => {
  const f = await fixture(t), write = f.fake.discord.setMemberOverwrite;
  f.fake.discord.setMemberOverwrite = async (...args) => { await write(...args); f.fake.channels.get(ids.channel).permission_overwrites.find(entry => entry.id === ids.user).allow = '0'; };
  await assert.rejects(f.guest('add'), /confirmed/);
});
test('grant persistence failure leaves Discord untouched and memory unchanged', async t => {
  const f = await fixture(t); f.store.filePath = path.join(f.root, 'blocked'); await fs.mkdir(f.store.filePath);
  await assert.rejects(f.guest('add')); assert.equal(f.fake.calls.filter(call => call[0] === 'overwrite').length, 0); assert.equal(f.store.getByChannel(ids.channel).guests, undefined);
});
test('removal persistence failure retains a retryable record after denial', async t => {
  const f = await fixture(t); await f.guest('add'); f.store.filePath = path.join(f.root, 'blocked'); await fs.mkdir(f.store.filePath);
  await assert.rejects(f.guest('remove')); assert.deepEqual(f.store.getByChannel(ids.channel).guests, [ids.owner]); assert.equal(BigInt(targetOverwrite(f).deny) & CHAT, CHAT);
});
for (const action of ['add', 'remove', 'list']) test(`ordinary members and ticket owners cannot ${action} guests`, async t => {
  const f = await fixture(t); for (const userId of [ids.user, ids.owner]) assert.equal((await f.tickets.guests({ ...f.actor, action, userId, roles: [], permissions: '0' })).ok, false); assert.equal(f.fake.calls.length, 0);
});
for (const targetId of [ids.user, ids.bot, ids.guild, 'invalid']) test(`rejects protected or invalid guest ${targetId}`, async t => {
  const f = await fixture(t); assert.equal((await f.tickets.guests({ ...f.actor, action: 'add', targetId })).ok, false); assert.equal(f.fake.calls.length, 0);
});
for (const kind of ['bot', 'pending', 'wrong-id', 'support', 'missing']) test(`rejects ${kind} guest membership before permission writes`, async t => {
  const f = await fixture(t); const member = f.fake.members.get(ids.owner);
  if (kind === 'bot') member.user.bot = true; if (kind === 'pending') member.pending = true; if (kind === 'wrong-id') member.user.id = ids.user; if (kind === 'support') member.roles = [ids.actorRole]; if (kind === 'missing') f.fake.members.delete(ids.owner);
  try { assert.equal((await f.guest('add')).ok, false); } catch (error) { assert.equal(kind, 'missing'); }
  assert.equal(f.fake.calls.filter(call => call[0] === 'overwrite').length, 0);
});
test('removal works for departed guests without fetching membership', async t => {
  const f = await fixture(t); await f.guest('add'); f.fake.members.delete(ids.owner); assert.equal((await f.guest('remove')).ok, true);
});
test('manual member overwrites are preserved when removing an unsaved guest', async t => {
  const f = await fixture(t); f.fake.channels.get(ids.channel).permission_overwrites.push({ id: ids.owner, type: 1, allow: CHAT.toString(), deny: '0' }); assert.equal((await f.guest('remove')).ok, false); assert.equal(BigInt(targetOverwrite(f).allow), CHAT);
});
for (const kind of ['public', 'wrong-guild', 'wrong-type', 'duplicate', 'invalid-bits']) test(`refuses ${kind} ticket permissions before granting`, async t => {
  const f = await fixture(t), channel = f.fake.channels.get(ids.channel);
  if (kind === 'public') channel.permission_overwrites[0].deny = '0'; if (kind === 'wrong-guild') channel.guild_id = ids.bot; if (kind === 'wrong-type') channel.type = 2; if (kind === 'duplicate') channel.permission_overwrites.push({ ...channel.permission_overwrites[0] }); if (kind === 'invalid-bits') channel.permission_overwrites[0].deny = '-1';
  await assert.rejects(f.guest('add')); assert.equal(f.store.getByChannel(ids.channel).guests, undefined); assert.equal(f.fake.calls.filter(call => call[0] === 'overwrite').length, 0);
});
test('guest lists are immutable copies and include saved unconfirmed intents', async t => {
  const f = await fixture(t); await f.store.setGuest(ids.channel, ids.owner, true); const result = await f.guest('list'); result.guests.length = 0; const records = f.store.list(); records[0].guests.length = 0; assert.deepEqual(f.store.getByChannel(ids.channel).guests, [ids.owner]); assert.throws(() => f.store.getByChannel(ids.channel).guests.push(ids.bot));
});
test('twenty guest slots are bounded and existing guests can retry at capacity', async t => {
  const f = await fixture(t); for (let i = 0; i < MAX_GUESTS - 1; i++) await f.store.setGuest(ids.channel, String(BigInt(ids.owner) + BigInt(i) + 1n), true); await f.guest('add');
  assert.equal((await f.guest('add')).ok, true); const target = String(BigInt(ids.owner) + 999n); assert.equal((await f.tickets.guests({ ...f.actor, action: 'add', targetId: target })).ok, false); await assert.rejects(f.store.setGuest(ids.channel, target, true)); assert.equal(f.store.getByChannel(ids.channel).guests.length, MAX_GUESTS);
});
test('concurrent guest operations and closure share the channel lock', async t => {
  const f = await fixture(t); const results = await Promise.all([f.guest('add'), f.guest('remove'), f.guest('add'), f.tickets.close(f.actor), f.guest('add')]); assert.ok(results.slice(0,4).every(result => result.ok)); assert.equal(results[4].ok, false); assert.equal(f.store.getByChannel(ids.channel).status, 'closed'); assert.deepEqual(f.store.getByChannel(ids.channel).guests, []); assert.equal(BigInt(targetOverwrite(f).deny) & CHAT, CHAT);
});
test('version one stores load unchanged and migrate only after a successful write', async t => {
  const root = await directory(t), file = path.join(root, 'tickets.json'), original = JSON.stringify({ version: 1, tickets: [record] }); await fs.writeFile(file, original); const store = new TicketStore(file); await store.load(); assert.equal(await fs.readFile(file,'utf8'), original); await store.setReason(ids.channel,'Updated'); assert.equal(JSON.parse(await fs.readFile(file)).version,2);
});
for (const guests of [[ids.user], [ids.owner,ids.owner], ['invalid'], Array.from({length:21},(_,i)=>String(10000+i)), null]) test(`corrupt guest lists are rejected without overwriting: ${JSON.stringify(guests)}`, async t => {
  const root = await directory(t), file = path.join(root,'tickets.json'), original = JSON.stringify({version:2,tickets:[{...record,guests}]}); await fs.writeFile(file,original); await assert.rejects(new TicketStore(file).load()); assert.equal(await fs.readFile(file,'utf8'),original);
});
test('version one cannot smuggle new guest fields and closed records cannot retain guests', async t => {
  const root = await directory(t), file = path.join(root,'tickets.json'); for (const data of [{version:1,tickets:[{...record,guests:[]}]},{version:2,tickets:[{...record,status:'closed',closedAt:record.createdAt,guests:[ids.owner]}]}]) { await fs.writeFile(file,JSON.stringify(data)); await assert.rejects(new TicketStore(file).load()); }
});
test('ticket guest interactions defer privately, suppress mentions and expose no remote errors', async t => {
  const f=await fixture(t), handle=createInteractionHandler({config:f.config,tickets:f.tickets,discord:f.fake.discord});
  const command=action=>{const value=interaction('ticket','guest'); value.data.options[0].options=[{name:action,options:[{name:'user',value:ids.owner}]}]; return value;};
  for(const action of ['add','list','remove']) { const result=await handle(command(action)); assert.deepEqual(result.immediate,{type:5,data:{flags:64}}); await result.work(); const body=f.fake.calls.filter(call=>call[0]==='response').at(-1)[3]; assert.deepEqual(body.allowed_mentions,{parse:[]}); assert.ok(body.content.length<1900); }
  f.fake.discord.setMemberOverwrite=async()=>{throw new Error('private-token');}; const result=await handle(command('add')); await result.work(); const body=f.fake.calls.filter(call=>call[0]==='response').at(-1)[3]; assert.doesNotMatch(body.content,/private-token/); assert.match(body.content,/retry/);
});
