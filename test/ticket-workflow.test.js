'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { TicketStore } = require('../src/ticket-store');
const { TicketService, CHAT } = require('../src/ticket-service');
const { TicketPanelStore } = require('../src/ticket-panel-store');
const { TicketPanelService } = require('../src/ticket-panel-service');
const { createInteractionHandler, publicKeyFromHex } = require('../src/interactions');
const { createServerRuntime } = require('../src/server');
const { loadConfig } = require('../src/config');
const { ids, epoch, directory, fakeDiscord, interaction } = require('./feature-fixtures');
const draft = { id: ids.menu, channelId: ids.channel, title: 'Support desk', description: 'Choose your topic.' };
const topic = { id: 'support', label: 'General support', categoryId: ids.category };
async function fixture(t) {
  const root = await directory(t); const fake = fakeDiscord(); let clock = epoch; let channelNumber = BigInt(ids.message) + 100n; let messageNumber = BigInt(ids.message);
  fake.discord.createMessage = async (channelId, body) => { const message = { id: String(messageNumber++), author: { id: ids.bot }, ...structuredClone(body) }; fake.calls.push(['message', channelId, body]); fake.messages.set(message.id, message); return structuredClone(message); };
  const config = { guildId: ids.guild, applicationId: ids.bot, supportRoleId: ids.actorRole, categoryId: ids.category, storePath: path.join(root, 'tickets.json'), ticketPanelStorePath: path.join(root, 'panels.json'), gatewayEnabled: false };
  fake.discord.createChannel = async (guild, body) => {
    const channel = { id: String(channelNumber++), guild_id: guild, ...structuredClone(body) };
    channel.permission_overwrites = channel.permission_overwrites.map((entry) => ({ allow: '0', deny: '0', ...entry })); fake.calls.push(['create-channel', channel]); fake.channels.set(channel.id, channel); return structuredClone(channel);
  };
  fake.discord.setMemberOverwrite = async (channelId, member, overwrite) => {
    fake.calls.push(['overwrite', channelId, member, overwrite]); const channel = fake.channels.get(channelId);
    channel.permission_overwrites = channel.permission_overwrites.filter((entry) => entry.id !== member || entry.type !== 1); channel.permission_overwrites.push({ id: member, ...overwrite });
  };
  const store = new TicketStore(config.storePath); const tickets = new TicketService({ config, store, discord: fake.discord, botUserId: ids.bot, now: () => new Date(clock) });
  const panelStore = new TicketPanelStore(config.ticketPanelStorePath, ids.guild); const panels = new TicketPanelService({ config, store: panelStore, tickets, discord: fake.discord, botUserId: ids.bot, now: () => clock });
  t.after(() => panels.stop());
  const publish = async () => { await panels.create(draft); await panels.change(ids.menu, 'add', topic); await panels.change(ids.menu, 'publish'); return panels.get(ids.menu); };
  const click = () => ({ type: 3, guild_id: ids.guild, channel_id: ids.channel, token: 'fixture-token', member: { user: { id: ids.user }, roles: [], permissions: '0' }, message: { id: panels.get(ids.menu).messageId, author: { id: ids.bot } }, data: { component_type: 2, custom_id: `ticketpanel:${ids.menu}:support` } });
  const actor = { userId: ids.actor, roles: [ids.actorRole], permissions: '0' };
  return { root, ...fake, config, store, tickets, panelStore, panels, publish, click, actor, advance: (ms) => { clock += ms; } };
}
test('ticket panel full workflow creates privately in the chosen category, closes and reopens after restart', async (t) => {
  const f = await fixture(t); const panel = await f.publish(); assert.equal(panel.pending, false);
  const result = await f.panels.click(f.click()); const channel = f.channels.get(result.channelId);
  assert.equal(channel.parent_id, ids.category); assert.equal(channel.permission_overwrites.find((entry) => entry.id === ids.guild).deny, '1024'); assert.equal(f.store.getByChannel(channel.id).reason, 'Panel topic: General support');
  await f.tickets.manage({ ...f.actor, action: 'claim', channelId: channel.id }); await f.tickets.close({ channelId: channel.id, userId: ids.user });
  const reloaded = new TicketStore(f.config.storePath); await reloaded.load(); const service = new TicketService({ config: f.config, store: reloaded, discord: f.discord, botUserId: ids.bot });
  const reopened = await service.reopen({ ...f.actor, channelId: channel.id }); assert.equal(reopened.ok, true); assert.equal(reloaded.getByChannel(channel.id).status, 'open'); assert.equal(reloaded.getByChannel(channel.id).claimedBy, undefined); assert.equal(reloaded.getByChannel(channel.id).closedAt, undefined);
  const owner = channel.permission_overwrites.find((entry) => entry.id === ids.user); assert.equal(BigInt(owner.allow) & CHAT, CHAT); assert.equal(BigInt(owner.deny) & CHAT, 0n);
  assert.equal((await service.reopen({ ...f.actor, channelId: channel.id })).ok, true);
});
test('concurrent panel clicks create only one active ticket and duplicate clicks return it', async (t) => {
  const f = await fixture(t); await f.publish(); const results = await Promise.all(Array.from({ length: 12 }, () => f.panels.click(f.click())));
  assert.equal(results.filter((entry) => entry.created).length, 1); assert.equal(new Set(results.map((entry) => entry.channelId)).size, 1); assert.equal(f.calls.filter((call) => call[0] === 'create-channel').length, 1);
});
for (const [label, modify] of [
  ['guild', (p) => { p.guild_id = ids.owner; }], ['channel', (p) => { p.channel_id = ids.category; }], ['message', (p) => { p.message.id = ids.channel; }], ['author', (p) => { p.message.author.id = ids.actor; }],
  ['topic', (p) => { p.data.custom_id = `ticketpanel:${ids.menu}:missing`; }], ['component type', (p) => { p.data.component_type = 3; }], ['bot', (p) => { p.member.user.bot = true; }], ['screening', (p) => { p.member.pending = true; }]
]) test(`ticket panel rejects mismatched ${label} before creating a channel`, async (t) => {
  const f = await fixture(t); await f.publish(); const payload = f.click(); modify(payload); await assert.rejects(f.panels.click(payload)); assert.equal(f.store.list().length, 0);
});
test('disabled and updating panels refuse clicks immediately; delete removes saved binding', async (t) => {
  const f = await fixture(t); await f.publish(); const payload = f.click(); await f.panelStore.change(ids.menu, 'disable'); await assert.rejects(f.panels.click(payload));
  await f.panels.change(ids.menu, 'publish'); await f.panelStore.change(ids.menu, 'add', { ...topic, id: 'other' }); await assert.rejects(f.panels.click(payload));
  await f.panels.change(ids.menu, 'delete'); assert.equal(f.panels.get(ids.menu), null); await assert.rejects(f.panels.click(payload));
});
test('panel publishing persists retry state, survives reload and recreates missing messages', async (t) => {
  const f = await fixture(t); await f.panels.create(draft); await f.panels.change(ids.menu, 'add', topic);
  const send = f.discord.createMessage; f.discord.createMessage = async () => { throw new Error('Unavailable'); }; await f.panels.change(ids.menu, 'publish');
  assert.equal(f.panels.get(ids.menu).pending, true); assert.equal(f.panels.get(ids.menu).attempts, 1);
  const loaded = new TicketPanelStore(f.config.ticketPanelStorePath, ids.guild); await loaded.load(); f.panels.store = loaded; f.discord.createMessage = send;
  await f.panels.tick(); assert.equal(f.panels.get(ids.menu).messageId, null); f.advance(15000); await f.panels.tick(); const message = f.panels.get(ids.menu).messageId; assert.ok(message);
  const staleClick = f.click(); f.messages.delete(message); await f.panels.change(ids.menu, 'publish'); assert.equal(f.panels.get(ids.menu).pending, false); assert.notEqual(f.panels.get(ids.menu).messageId, message); await assert.rejects(f.panels.click(staleClick));
});
test('panel publication refuses changed message ownership and wrong category guild', async (t) => {
  const f = await fixture(t); await f.publish(); f.messages.get(f.panels.get(ids.menu).messageId).author.id = ids.actor;
  await f.panels.change(ids.menu, 'disable'); assert.equal(f.panels.get(ids.menu).pending, true); assert.equal(f.calls.filter((call) => call[0] === 'edit').length, 0);
  f.channels.get(ids.category).guild_id = ids.owner; await assert.rejects(f.panels.change(ids.menu, 'add', { ...topic, id: 'other' }));
});
test('panels refuse stale member identity and a deleted category without creating tickets', async (t) => {
  const f = await fixture(t); await f.publish(); const get = f.discord.getGuildMember; f.discord.getGuildMember = async () => ({ user: { id: ids.actor } }); await assert.rejects(f.panels.click(f.click()));
  f.discord.getGuildMember = get; f.channels.delete(ids.category); await assert.rejects(f.panels.click(f.click())); assert.equal(f.store.list().length, 0);
});
test('panel store input and snapshot isolation, topic limits and failed writes', async (t) => {
  const f = await fixture(t); const input = { ...draft }; const write = f.panelStore.create(input); input.title = 'Changed'; await write; assert.equal(f.panels.get(ids.menu).title, draft.title);
  const snapshot = f.panelStore.list(); snapshot[0].title = 'Changed'; assert.equal(f.panels.get(ids.menu).title, draft.title);
  await assert.rejects(f.panels.change(ids.menu, 'publish'), /topic/);
  for (let n = 0; n < 5; n++) await f.panelStore.change(ids.menu, 'add', { ...topic, id: `topic-${n}` });
  await assert.rejects(f.panelStore.change(ids.menu, 'add', { ...topic, id: 'overflow' }), /limit/);
  const blocker = path.join(f.root, 'blocker'); await fs.writeFile(blocker, 'x'); f.panelStore.filePath = path.join(blocker, 'bad.json');
  await assert.rejects(f.panelStore.change(ids.menu, 'remove', { id: 'topic-0' })); assert.equal(f.panels.get(ids.menu).topics.length, 5);
});
for (const [label, change] of [
  ['guild mismatch', (s) => { s.guildId = ids.owner; }], ['duplicate panel', (s) => s.panels.push(s.panels[0])], ['missing topics', (s) => { s.panels[0].topics = null; }],
  ['invalid topic', (s) => { s.panels[0].topics[0].id = 'Invalid'; }], ['unknown field', (s) => { s.extra = true; }], ['unsupported version', (s) => { s.version = 2; }]
]) test(`panel store refuses ${label} without modifying the file`, async (t) => {
  const f = await fixture(t); await f.publish(); const data = JSON.parse(await fs.readFile(f.config.ticketPanelStorePath)); change(data); const original = JSON.stringify(data); await fs.writeFile(f.config.ticketPanelStorePath, original);
  await assert.rejects(new TicketPanelStore(f.config.ticketPanelStorePath, ids.guild).load()); assert.equal(await fs.readFile(f.config.ticketPanelStorePath, 'utf8'), original);
});
test('panel store rejects oversize input and duplicate topics; removing the last topic disables publication', async (t) => {
  const f = await fixture(t); await f.publish(); await assert.rejects(f.panels.change(ids.menu, 'add', topic), /Duplicate/);
  await f.panels.change(ids.menu, 'remove', { id: topic.id }); assert.equal(f.panels.get(ids.menu).state, 'disabled'); assert.deepEqual(f.messages.get(f.panels.get(ids.menu).messageId).components, []);
  await fs.writeFile(f.config.ticketPanelStorePath, Buffer.alloc(1024 * 1024 + 1)); await assert.rejects(new TicketPanelStore(f.config.ticketPanelStorePath, ids.guild).load());
});
test('reopening refuses owners without staff authority and another active ticket', async (t) => {
  const f = await fixture(t); const first = await f.tickets.create({ id: ids.user }); await f.tickets.close({ channelId: first.channelId, userId: ids.user });
  assert.equal((await f.tickets.reopen({ channelId: first.channelId, userId: ids.user })).ok, false);
  const second = await f.tickets.create({ id: ids.user }); assert.equal((await f.tickets.reopen({ ...f.actor, channelId: first.channelId })).ok, false); assert.equal(f.store.getByChannel(first.channelId).status, 'closed'); assert.equal(f.store.getByChannel(second.channelId).status, 'open');
});
test('reopening and creating concurrently cannot produce two active tickets', async (t) => {
  const f = await fixture(t); const ticket = await f.tickets.create({ id: ids.user }); await f.tickets.close({ channelId: ticket.channelId, userId: ids.user });
  await Promise.all([f.tickets.reopen({ ...f.actor, channelId: ticket.channelId }), f.tickets.create({ id: ids.user })]);
  assert.equal(f.store.list().filter((entry) => entry.status !== 'closed').length, 1);
});
test('reopening survives a rename failure and restart, preserving other owner permission bits', async (t) => {
  const f = await fixture(t); const ticket = await f.tickets.create({ id: ids.user }); await f.tickets.close({ channelId: ticket.channelId, userId: ids.user });
  const channel = f.channels.get(ticket.channelId); const owner = channel.permission_overwrites.find((entry) => entry.id === ids.user); owner.allow = String(BigInt(owner.allow) | 4n); owner.deny = String(BigInt(owner.deny) | 8n);
  const edit = f.discord.editChannel; f.discord.editChannel = async () => { throw new Error('Unavailable'); }; await assert.rejects(f.tickets.reopen({ ...f.actor, channelId: ticket.channelId })); assert.equal(f.store.getByChannel(ticket.channelId).status, 'reopening');
  assert.equal((await f.tickets.close({ channelId: ticket.channelId, userId: ids.user })).ok, false); const reloaded = new TicketStore(f.config.storePath); await reloaded.load(); f.tickets.store = reloaded; f.discord.editChannel = edit;
  await f.tickets.reopen({ ...f.actor, channelId: ticket.channelId }); const changed = channel.permission_overwrites.find((entry) => entry.id === ids.user); assert.ok(BigInt(changed.allow) & 4n); assert.ok(BigInt(changed.deny) & 8n); assert.equal(reloaded.getByChannel(ticket.channelId).status, 'open');
});
test('reopening refuses missing privacy, wrong guild and absent/screened owners', async (t) => {
  const f = await fixture(t); const ticket = await f.tickets.create({ id: ids.user }); await f.tickets.close({ channelId: ticket.channelId, userId: ids.user }); const channel = f.channels.get(ticket.channelId);
  const everyone = channel.permission_overwrites.find((entry) => entry.id === ids.guild); everyone.allow = '1024'; assert.equal((await f.tickets.reopen({ ...f.actor, channelId: ticket.channelId })).ok, false); everyone.allow = '0';
  channel.guild_id = ids.owner; await assert.rejects(f.tickets.reopen({ ...f.actor, channelId: ticket.channelId })); channel.guild_id = ids.guild;
  f.members.get(ids.user).pending = true; assert.equal((await f.tickets.reopen({ ...f.actor, channelId: ticket.channelId })).ok, false); assert.equal(f.store.getByChannel(ticket.channelId).status, 'closed');
});
test('failed reopen confirmation and final persistence retain recoverable reopening state', async (t) => {
  const f = await fixture(t); const ticket = await f.tickets.create({ id: ids.user }); await f.tickets.close({ channelId: ticket.channelId, userId: ids.user });
  const overwrite = f.discord.setMemberOverwrite; f.discord.setMemberOverwrite = async () => {};
  await assert.rejects(f.tickets.reopen({ ...f.actor, channelId: ticket.channelId }), /confirmed/); assert.equal(f.store.getByChannel(ticket.channelId).status, 'reopening');
  f.discord.setMemberOverwrite = overwrite; const commit = f.store.markReopened; f.store.markReopened = async () => { throw new Error('Disk unavailable'); };
  await assert.rejects(f.tickets.reopen({ ...f.actor, channelId: ticket.channelId })); assert.equal(f.store.getByChannel(ticket.channelId).status, 'reopening');
  f.store.markReopened = commit; await f.tickets.reopen({ ...f.actor, channelId: ticket.channelId }); assert.equal(f.store.getByChannel(ticket.channelId).status, 'open');
});
test('reopen intent write failure prevents Discord permission changes', async (t) => {
  const f = await fixture(t); const ticket = await f.tickets.create({ id: ids.user }); await f.tickets.close({ channelId: ticket.channelId, userId: ids.user }); const before = f.calls.filter((entry) => entry[0] === 'overwrite').length;
  f.store.markReopening = async () => { throw new Error('Disk unavailable'); }; await assert.rejects(f.tickets.reopen({ ...f.actor, channelId: ticket.channelId }));
  assert.equal(f.calls.filter((entry) => entry[0] === 'overwrite').length, before); assert.equal(f.store.getByChannel(ticket.channelId).status, 'closed');
});
test('ticket panel path must be distinct and cannot overwrite another store', () => {
  const env = { DISCORD_APPLICATION_ID: ids.bot, DISCORD_GUILD_ID: ids.guild, DISCORD_PUBLIC_KEY: 'a'.repeat(64), DISCORD_BOT_TOKEN: 'fixture' };
  assert.throws(() => loadConfig({ ...env, TICKET_PANEL_STORE_PATH: './data/tickets.json' }), /separate/);
  assert.throws(() => loadConfig({ ...env, TICKET_PANEL_STORE_PATH: '.env' }), /configuration/);
  assert.equal(loadConfig(env).ticketPanelStorePath, './data/ticket-panels.json');
});
test('ticket creation rejects everyone as support role before any channel creation', async (t) => {
  const f = await fixture(t); f.config.supportRoleId = ids.guild; await assert.rejects(f.tickets.create({ id: ids.user }), /everyone/); assert.equal(f.calls.length, 0);
  assert.throws(() => loadConfig({ DISCORD_APPLICATION_ID: ids.bot, DISCORD_GUILD_ID: ids.guild, DISCORD_PUBLIC_KEY: 'a'.repeat(64), DISCORD_BOT_TOKEN: 'fixture', DISCORD_SUPPORT_ROLE_ID: ids.guild }), /everyone/);
});
for (const action of ['create', 'add', 'remove', 'list', 'info', 'publish', 'disable', 'delete']) test(`ticket panel ${action} commands reject missing Manage Server`, async (t) => {
  const f = await fixture(t); const handler = createInteractionHandler({ config: f.config, tickets: f.tickets, ticketPanels: f.panels, discord: f.discord }); const result = await handler(interaction('ticketpanel', action, {}, '0')); assert.match(result.immediate.data.content, /Manage Server/); assert.deepEqual(f.panels.list(), []);
});
test('panel command workflow returns private drafts, topics, publication, ticket links and errors', async (t) => {
  const f = await fixture(t); const handler = createInteractionHandler({ config: f.config, tickets: f.tickets, ticketPanels: f.panels, discord: f.discord });
  const run = async (payload) => { const result = await handler(payload); assert.equal(result.immediate.type, 5); assert.equal(result.immediate.data.flags, 64); await result.work(); const body = f.calls.filter((call) => call[0] === 'response').at(-1)[3]; assert.deepEqual(body.allowed_mentions, { parse: [] }); return body.content; };
  assert.match(await run(interaction('ticketpanel', 'create', { title: draft.title, description: draft.description })), /Draft/);
  await run(interaction('ticketpanel', 'add', { id: ids.menu, topic: topic.id, label: topic.label, category: ids.category })); assert.match(await run(interaction('ticketpanel', 'list')), /Support desk/); assert.match(await run(interaction('ticketpanel', 'info', { id: ids.menu })), /General support/);
  await run(interaction('ticketpanel', 'publish', { id: ids.menu })); assert.match(await run(f.click()), /private ticket is ready/); assert.match(await run(f.click()), /already have/);
  await run(interaction('ticketpanel', 'remove', { id: ids.menu, topic: topic.id })); await run(interaction('ticketpanel', 'disable', { id: ids.menu })); await run(interaction('ticketpanel', 'delete', { id: ids.menu })); assert.match(await run(interaction('ticketpanel', 'info', { id: ids.menu })), /failed/);
});
test('signed HTTP runtime persists panel and ticket bindings and drains panel retries on close', async (t) => {
  const f = await fixture(t); const pair = crypto.generateKeyPairSync('ed25519');
  Object.assign(f.config, { host: '127.0.0.1', port: 0, moderationStorePath: path.join(f.root, 'warnings.json'), economyStorePath: path.join(f.root, 'coins.json'), levelStorePath: path.join(f.root, 'levels.json') });
  const server = await createServerRuntime({ config: f.config, publicKey: publicKeyFromHex(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')), discord: f.discord, store: f.store });
  t.after(async () => { await server.drain(); if (server.listening) await new Promise((resolve) => server.close(resolve)); await server.ticketPanels.stop(); }); await once(server, 'listening');
  const send = async (payload) => { const raw = Buffer.from(JSON.stringify(payload)); const timestamp = String(Math.floor(Date.now() / 1000)); const response = await fetch(`http://127.0.0.1:${server.address().port}/interactions`, { method: 'POST', body: raw, headers: { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': crypto.sign(null, Buffer.concat([Buffer.from(timestamp), raw]), pair.privateKey).toString('hex') } }); assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } }); await server.drain(); };
  await send(interaction('ticketpanel', 'create', { title: draft.title })); await send(interaction('ticketpanel', 'add', { id: ids.menu, topic: topic.id, label: topic.label, category: ids.category })); await send(interaction('ticketpanel', 'publish', { id: ids.menu }));
  f.panels = server.ticketPanels; const panel = server.ticketPanels.get(ids.menu); const payload = { type: 3, guild_id: ids.guild, channel_id: ids.channel, token: 'fixture', member: { user: { id: ids.user }, roles: [], permissions: '0' }, message: { id: panel.messageId, author: { id: ids.bot } }, data: { custom_id: `ticketpanel:${ids.menu}:support`, component_type: 2 } };
  await send(payload); const deliver = f.discord.editOriginalResponse; f.discord.editOriginalResponse = async () => { throw new Error('Response lost'); }; await send(payload); f.discord.editOriginalResponse = deliver;
  const loaded = new TicketStore(f.config.storePath); await loaded.load(); assert.equal(loaded.list().length, 1);
  const ticketId = loaded.list()[0].channelId; await send(interaction('ticket', 'close', { channel: ticketId })); assert.equal(f.store.getByChannel(ticketId).status, 'closed');
  await send(interaction('ticket', 'reopen', { channel: ticketId })); assert.equal(f.store.getByChannel(ticketId).status, 'open');
  const loadedPanels = new TicketPanelStore(f.config.ticketPanelStorePath, ids.guild); await loadedPanels.load(); assert.equal(loadedPanels.get(ids.menu).messageId, panel.messageId);
  await new Promise((resolve) => server.close(resolve)); await server.ticketPanels.stop(); assert.equal(server.ticketPanels.timer, null);
});
