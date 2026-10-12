'use strict';
const assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), { once } = require('node:events');
const { loadConfig } = require('../src/config'), { createServerRuntime } = require('../src/server'), { publicKeyFromHex } = require('../src/interactions');
const { TicketStore } = require('../src/ticket-store'), { EconomyStore } = require('../src/economy-store');
const { CommunityStore } = require('../src/community-store');
const { createBackup, verifyBackup } = require('./backup');
const { gunzipSync } = require('node:zlib');
const { unpack } = require('./transcript-unpack');
const { StarboardStore } = require('../src/starboard-store');
const { version } = require('../package.json');
async function runSmoke({ container = false } = {}) {
  if (container) assert.equal(process.getuid?.(), 1000, 'Container must run as the node user.');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-release-smoke-'));
  const ids = { guild: '123456789012345678', bot: '223456789012345678', actor: '323456789012345678', target: '423456789012345678', role: '523456789012345678', channel: '623456789012345678', request: '723456789012345678', owner: '823456789012345678' };
  const starDestination = String(BigInt(ids.channel) + 9n), starMessage = String(BigInt(ids.request) + 5000n); let starPost, starCreates = 0, loseDeletionReply = true;
  let server, giveaway, ticketChannel, historyMode = 'single'; const responses = [], transcriptFiles = [], autoRules = new Map(), pair = crypto.generateKeyPairSync('ed25519');
  try {
    const env = { DISCORD_APPLICATION_ID: ids.bot, DISCORD_GUILD_ID: ids.guild, DISCORD_PUBLIC_KEY: pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex'), DISCORD_BOT_TOKEN: 'isolated-smoke-placeholder', DISCORD_GATEWAY_ENABLED: 'false', HOST: '127.0.0.1', PORT: '3000' };
    const keys = ['STARBOARD_STORE_PATH', 'TICKET_STORE_PATH', 'MODERATION_STORE_PATH', 'ECONOMY_STORE_PATH', 'LEVEL_STORE_PATH', 'COMMUNITY_STORE_PATH', 'VOICE_STORE_PATH', 'ROLE_MENU_STORE_PATH', 'TEMPLATE_STORE_PATH', 'RESPONDER_STORE_PATH', 'TIMER_STORE_PATH', 'TICKET_PANEL_STORE_PATH', 'LEVEL_REWARD_STORE_PATH'];
    keys.forEach((key, index) => { env[key] = path.join(root, `store-${index}.json`); });
    const config = { ...loadConfig(env), starboardEnabled: true, port: 0 }, economy = new EconomyStore(config.economyStorePath);
    // This adapter never contacts Discord. Unexpected calls fail the smoke test.
    const discord = {
      getCurrentUser: async () => ({ id: ids.bot }),
      createAutoModRule: async (guild, body) => { assert.equal(guild, ids.guild); const rule = { ...structuredClone(body), id: String(BigInt(ids.request) + 1000n + BigInt(autoRules.size)), guild_id: guild, creator_id: ids.bot }; autoRules.set(rule.id, rule); return structuredClone(rule); },
      getAutoModRule: async (guild, id) => { assert.equal(guild, ids.guild); assert.ok(autoRules.has(id)); return structuredClone(autoRules.get(id)); },
      editAutoModRule: async (guild, id, patch) => { assert.equal(guild, ids.guild); assert.ok(autoRules.has(id)); Object.assign(autoRules.get(id), structuredClone(patch)); return structuredClone(autoRules.get(id)); },
      getGuild: async () => ({ id: ids.guild, owner_id: ids.owner, name: 'Smoke guild', icon: 'a'.repeat(32) }),
      getGuildMember: async (_guild, userId) => { assert.ok([ids.actor, ids.target, ids.bot].includes(userId)); return { user: { id: userId }, roles: userId === ids.actor ? [ids.role] : [] }; },
      createChannel: async (guild, body) => { assert.equal(guild, ids.guild); ticketChannel = { ...structuredClone(body), id: String(BigInt(ids.channel) + 1n), guild_id: guild }; return structuredClone(ticketChannel); },
      setMemberOverwrite: async (channel, user, body) => { assert.equal(channel, ticketChannel.id); ticketChannel.permission_overwrites = ticketChannel.permission_overwrites.filter(entry => entry.id !== user || entry.type !== 1); ticketChannel.permission_overwrites.push({ id: user, ...structuredClone(body) }); },
      editChannel: async (channel, body) => { assert.equal(channel, ticketChannel.id); Object.assign(ticketChannel, structuredClone(body)); },
      request: async (method, route) => { assert.equal(method, 'GET'); if(route === `/channels/${starDestination}`) return { id: starDestination, guild_id: ids.guild, type: 0, nsfw: false, permission_overwrites: [] }; if(route === `/channels/${ids.channel}/messages/${starMessage}`) return { id: starMessage, channel_id: ids.channel, author: { id: ids.actor }, type: 0 }; if(route.startsWith(`/channels/${ids.channel}/messages/${starMessage}/reactions/`)) return [{ id: ids.actor }, { id: ids.target }, { id: ids.owner }]; if(starPost && route === `/channels/${starDestination}/messages/${starPost.id}`) return structuredClone(starPost); if (route.startsWith(`/channels/${starDestination}/messages/`)) throw Object.assign(new Error('Discord API request failed (404).'), { statusCode: 404, discordCode: 10008 }); if (route === `/channels/${ids.channel}`) return { id: ids.channel, guild_id: ids.guild, type: 0, nsfw: false, permission_overwrites: [] }; if (ticketChannel && route === `/channels/${ticketChannel.id}`) return structuredClone(ticketChannel); assert.equal(route, `/guilds/${ids.guild}/roles`); return [{ id: ids.guild, permissions: '1024' }, { id: ids.role, permissions: '32' }]; },
      editOriginalResponse: async (_application, _token, body, file) => { responses.push(body); if (file) transcriptFiles.push(file); },
      getChannelMessages: async (channel, limit, before) => {
        assert.equal(channel, ticketChannel.id); assert.ok(limit > 0 && limit <= 100);
        const message = index => ({ id: String(BigInt(ids.request) + BigInt(index)), channel_id: channel, author: { id: ids.actor, username: 'Smoke member' }, content: `Private transcript smoke content ${index}`, timestamp: '2026-10-11T12:00:00Z', edited_timestamp: null, attachments: [], embeds: [] });
        const messages = historyMode === 'single' ? [message(0)] : Array.from({ length: 235 }, (_, index) => message(734 - index));
        return messages.filter(item => !before || BigInt(item.id) < BigInt(before)).slice(0, limit);
      },
      createMessage: async (channel, body) => { if(channel === starDestination) { assert.equal(starPost, undefined); starCreates++; starPost = { ...structuredClone(body), id: String(BigInt(starMessage) + 1n), channel_id: channel, author: { id: ids.bot } }; return structuredClone(starPost); } assert.equal(channel, ids.channel); assert.equal(giveaway, undefined); giveaway = { ...structuredClone(body), id: String(BigInt(ids.request) + 99n) }; return structuredClone(giveaway); },
      deleteChannelMessage: async (channel, id) => { assert.equal(channel, starDestination); assert.equal(id, starPost.id); assert.equal(server.starboard.store.snapshot().entries[0].status, 'deleting'); starPost = undefined; if (loseDeletionReply) { loseDeletionReply = false; throw new Error('Simulated lost deletion reply'); } },
      editMessage: async (channel, id, body) => { if(channel === starDestination) { assert.equal(id, starPost.id); Object.assign(starPost, structuredClone(body)); return; } assert.equal(channel, ids.channel); assert.equal(id, giveaway.id); Object.assign(giveaway, structuredClone(body)); }
    };
    server = await createServerRuntime({ config, publicKey: publicKeyFromHex(config.publicKey), discord, store: new TicketStore(config.storePath), economy });
    await once(server, 'listening'); const url = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(5000) }); assert.equal(health.status, 200); assert.equal(await health.text(), 'ok');
    const unsigned = await fetch(`${url}/interactions`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(5000) }); assert.equal(unsigned.status, 401);
    const send = async (payload) => {
      const raw = Buffer.from(JSON.stringify(payload)), timestamp = String(Math.floor(Date.now() / 1000));
      const result = await fetch(`${url}/interactions`, { method: 'POST', body: raw, headers: { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': crypto.sign(null, Buffer.concat([Buffer.from(timestamp), raw]), pair.privateKey).toString('hex') }, signal: AbortSignal.timeout(5000) });
      assert.equal(result.status, 200); const body = await result.json(); await server.drain(); return body;
    };
    assert.deepEqual(await send({ type: 1 }), { type: 1 });
    const command = { id: ids.request, type: 2, guild_id: ids.guild, channel_id: ids.channel, token: 'smoke-interaction-placeholder', member: { user: { id: ids.actor }, roles: [ids.role], permissions: '32' }, data: { name: 'economyadmin', options: [{ name: 'grant', options: [{ name: 'user', value: ids.target }, { name: 'amount', value: 100 }, { name: 'reason', value: 'Isolated release smoke check' }] }] } };
    assert.deepEqual(await send(command), { type: 5, data: { flags: 64 } }); assert.match(responses.at(-1).content, /Adjustment saved/); assert.deepEqual(responses.at(-1).allowed_mentions, { parse: [] });
    await send(command); assert.match(responses.at(-1).content, /Previously saved/); assert.equal(economy.balance(ids.guild, ids.target), 100);
    const utility = (name, options = []) => ({ ...command, id: (BigInt(ids.request) + (name === 'calculate' ? 1n : 2n)).toString(), data: { name: 'utility', options: [{ name, options }] } });
    const calculated = await send(utility('calculate', [{ name: 'expression', value: '2^8 + 4' }]));
    assert.equal(calculated.type, 4); assert.equal(calculated.data.flags, 64); assert.match(calculated.data.content, /260/); assert.deepEqual(calculated.data.allowed_mentions, { parse: [] });
    assert.deepEqual(await send(utility('servericon')), { type: 5, data: { flags: 64 } });
    assert.equal(responses.at(-1).embeds[0].image.url, `https://cdn.discordapp.com/icons/${ids.guild}/${'a'.repeat(32)}.png?size=1024`);
    assert.deepEqual(responses.at(-1).allowed_mentions, { parse: [] });
    const giveawayId = String(BigInt(ids.request) + 3n);
    const giveawayCommand = (offset, name, options, edit) => ({ ...command, id: String(BigInt(ids.request) + BigInt(offset)), member: { ...command.member, permissions: '8192' }, data: { name: 'giveaway', options: [{ name, options: edit ? [{ name: edit, options }] : options }] } });
    await send(giveawayCommand(3, 'create', [{ name: 'prize', value: 'Smoke prize' }, { name: 'minutes', value: 60 }, { name: 'host', value: ids.target }, { name: 'description', value: 'Original details' }, { name: 'image', value: 'https://example.org/prize.png' }]));
    assert.match(responses.at(-1).content, /is open/); assert.equal(giveaway.embeds[0].image.url, 'https://example.org/prize.png');
    assert.deepEqual(giveaway.allowed_mentions, { parse: [] });
    await send(giveawayCommand(4, 'edit', [{ name: 'id', value: giveawayId }, { name: 'description', value: 'Restart-safe details' }], 'description'));
    assert.match(responses.at(-1).content, /updated/); assert.ok(giveaway.embeds[0].description.includes('Restart-safe details'));
    await send(giveawayCommand(5, 'preview', [{ name: 'id', value: giveawayId }]));
    assert.match(responses.at(-1).content, /Private preview/); assert.deepEqual(responses.at(-1).embeds, giveaway.embeds); assert.equal(responses.at(-1).components, undefined);
    assert.deepEqual(responses.at(-1).allowed_mentions, { parse: [] });
    await send(giveawayCommand(6, 'edit', [{ name: 'id', value: giveawayId }, { name: 'field', value: 'image' }], 'clear'));
    assert.match(responses.at(-1).content, /updated/); assert.equal(giveaway.embeds[0].image, undefined);
    const ticketCommand = (offset, name, options = []) => ({ ...command, id: String(BigInt(ids.request) + BigInt(offset)), channel_id: ticketChannel?.id || ids.channel, member: { ...command.member, permissions: '8' }, data: { name: 'ticket', options: [{ name, options }] } });
    assert.deepEqual(await send(ticketCommand(7, 'create')), { type: 5, data: { flags: 64 } }); assert.match(responses.at(-1).content, /ticket is ready/);
    const guestCommand = (offset, action) => ticketCommand(offset, 'guest', [{ name: action, options: action === 'list' ? [] : [{ name: 'user', value: ids.target }] }]);
    await send(guestCommand(8, 'add')); assert.match(responses.at(-1).content, /overwrites verified/);
    await send(guestCommand(9, 'list')); assert.match(responses.at(-1).content, /Saved ticket guests/); assert.ok(responses.at(-1).content.includes(ids.target)); assert.deepEqual(responses.at(-1).allowed_mentions, { parse: [] });
    const guestBackup = path.join(root, 'guest-backup'); await createBackup(config, guestBackup); assert.equal((await verifyBackup(guestBackup, ids.guild)).ok, true);
    const savedGuests = new TicketStore(path.join(guestBackup, 'tickets.json')); await savedGuests.load(); assert.deepEqual(savedGuests.getByChannel(ticketChannel.id).guests, [ids.target]);
    await send(guestCommand(10, 'remove')); assert.match(responses.at(-1).content, /revoked/);
    await send(guestCommand(11, 'add')); assert.match(responses.at(-1).content, /overwrites verified/);
    await send(ticketCommand(12, 'close')); assert.match(responses.at(-1).content, /Ticket closed/);
    const revoked = ticketChannel.permission_overwrites.find(entry => entry.id === ids.target && entry.type === 1); assert.equal(BigInt(revoked.allow) & 68608n, 0n); assert.equal(BigInt(revoked.deny) & 68608n, 68608n);
    await send(ticketCommand(13, 'transcript', [{ name: 'count', value: 10 }])); assert.match(responses.at(-1).content, /Private snapshot: 1/); assert.deepEqual(responses.at(-1).allowed_mentions, { parse: [] }); assert.equal(transcriptFiles.at(-1).filename, `ticket-${ticketChannel.id}.txt`); assert.ok(transcriptFiles.at(-1).data.toString().includes('Private transcript smoke content'));
    await send(ticketCommand(14, 'transcript', [{ name: 'format', value: 'json' }])); const transcript = JSON.parse(transcriptFiles.at(-1).data); assert.equal(transcript.channelId, ticketChannel.id); assert.equal(transcript.state, 'closed'); assert.equal(transcript.messages[0].content, 'Private transcript smoke content 0'); assert.equal(transcriptFiles.at(-1).contentType, 'application/json');
    historyMode = 'paged';
    await send(ticketCommand(15, 'transcript', [{ name: 'count', value: 205 }, { name: 'format', value: 'json' }, { name: 'compression', value: 'gzip' }]));
    const packedFile = transcriptFiles.at(-1), packed = JSON.parse(gunzipSync(packedFile.data)); assert.equal(packed.messages.length, 205); assert.equal(packed.pagination.pages, 3); assert.equal(packed.pagination.historyExhausted, false); assert.match(responses.at(-1).content, /Continue with before:/); assert.ok(responses.at(-1).content.includes(crypto.createHash('sha256').update(packedFile.data).digest('hex')));
    await send(ticketCommand(16, 'transcript', [{ name: 'count', value: 100 }, { name: 'format', value: 'json' }, { name: 'before', value: packed.pagination.nextBefore }]));
    const older = JSON.parse(transcriptFiles.at(-1).data); assert.equal(older.messages.length, 30); assert.equal(older.pagination.historyExhausted, true); assert.equal(new Set([...packed.messages, ...older.messages].map(message => message.id)).size, 235);
    const compressedPath = path.join(root, packedFile.filename), unpackedPath = compressedPath.slice(0, -3); await fs.writeFile(compressedPath, packedFile.data); await unpack(compressedPath, unpackedPath); assert.deepEqual(await fs.readFile(unpackedPath), gunzipSync(packedFile.data));
    await send(ticketCommand(17, 'list', [{ name: 'state', value: 'closed' }, { name: 'owner', value: ids.actor }, { name: 'assignment', value: 'unassigned' }])); assert.match(responses.at(-1).content, /Tickets: 1/); assert.match(responses.at(-1).content, /State: closed/); assert.ok(responses.at(-1).content.includes(ticketChannel.id)); assert.deepEqual(responses.at(-1).allowed_mentions, { parse: [] });
    const autoCommand = (offset, name, values) => ({ ...command, id: String(BigInt(ids.request) + BigInt(offset)), member: { ...command.member, permissions: '1099511627808' }, data: { name: 'automod', options: [{ name, options: Object.entries(values).map(([name, value]) => ({ name, value })) }] } });
    assert.deepEqual(await send(autoCommand(18, 'keywords', { name: 'Smoke filter', keywords: 'spam' })), { type: 5, data: { flags: 64 } });
    const keywordRule = [...autoRules.values()][0]; assert.equal(keywordRule.enabled, false); assert.match(responses.at(-1).content, /Created disabled/);
    await send(autoCommand(19, 'policy', { rule: keywordRule.id, mode: 'block-alert-timeout', channel: ids.channel, seconds: 60 })); assert.match(responses.at(-1).content, /policy saved/); assert.deepEqual(keywordRule.actions, [{ type: 1 }, { type: 2, metadata: { channel_id: ids.channel } }, { type: 3, metadata: { duration_seconds: 60 } }]);
    await send(autoCommand(20, 'keywords-edit', { rule: keywordRule.id, keywords: '*scam*,spam' })); assert.match(responses.at(-1).content, /rule updated/); assert.deepEqual(keywordRule.trigger_metadata.keyword_filter, ['*scam*', 'spam']); assert.equal(keywordRule.actions.length, 3);
    await send(autoCommand(21, 'rename', { rule: keywordRule.id, name: 'Reviewed filter' })); assert.equal(keywordRule.name, 'Latch: Reviewed filter'); assert.equal(keywordRule.enabled, false);
    await send(autoCommand(22, 'mentions', { name: 'Mention safety', limit: 5 })); const mentionRule = [...autoRules.values()][1]; assert.equal(mentionRule.trigger_type, 5);
    await send(autoCommand(23, 'mentions-edit', { rule: mentionRule.id, limit: 3, 'raid-protection': false })); assert.deepEqual(mentionRule.trigger_metadata, { mention_total_limit: 3, mention_raid_protection_enabled: false }); assert.equal(mentionRule.enabled, false);
    await send(autoCommand(24, 'info', { rule: keywordRule.id })); assert.match(responses.at(-1).content, /Timeout seconds: 60/); assert.ok(responses.at(-1).content.includes(ids.channel)); assert.deepEqual(responses.at(-1).allowed_mentions, { parse: [] });
    const starCommand = (offset, name, values) => ({ ...command, id: String(BigInt(ids.request) + BigInt(offset)), data: { name: 'starboard', options: [{ name, options: Object.entries(values).map(([name, value]) => ({ name, value })) }] } });
    assert.deepEqual(await send(starCommand(25, 'configure', { destination: starDestination, source: ids.channel, threshold: 2 })), { type: 5, data: { flags: 64 } }); assert.match(responses.at(-1).content, /Starboard configured/);
    await send(starCommand(26, 'sync', { channel: ids.channel, message: starMessage })); assert.match(responses.at(-1).content, /2 eligible normal stars/); assert.equal(starPost.enforce_nonce, true); assert.deepEqual(starPost.allowed_mentions, { parse: [] }); assert.equal(starPost.flags, 4);
    const originalPost = starPost.id; await send(starCommand(27, 'sync', { channel: ids.channel, message: starMessage })); assert.equal(starPost.id, originalPost);
    await send(starCommand(28, 'status', {})); assert.match(responses.at(-1).content, /Tracked: 1/); assert.deepEqual(responses.at(-1).allowed_mentions, { parse: [] });
    await Promise.all([server.community.stop(), server.voice.stop(), server.roleMenus.stop(), server.timers.stop(), server.ticketPanels.stop(), server.levelRewards.stop(), server.starboard.stop()]);
    const backup = path.join(root, 'backup'), created = await createBackup(config, backup); assert.equal(created.present, 4); assert.equal(created.missing.length, 9); assert.equal((await verifyBackup(backup, ids.guild)).ok, true);
    const recovered = new EconomyStore(path.join(backup, 'economy.json')); await recovered.load(); assert.equal(recovered.balance(ids.guild, ids.target), 100); assert.equal(recovered.adjustmentHistory(ids.guild).length, 1);
    const recoveredCommunity = new CommunityStore(path.join(backup, 'community.json')); await recoveredCommunity.load();
    assert.deepEqual(recoveredCommunity.get(giveawayId).presentation, { hostId: ids.target, description: 'Restart-safe details', image: null, thumbnail: null });
    const recoveredStarboard = new StarboardStore(path.join(backup, 'starboard.json'), ids.guild); await recoveredStarboard.load(); assert.equal(recoveredStarboard.snapshot().entries[0].post, originalPost);
    const recoveredTickets = new TicketStore(path.join(backup, 'tickets.json')); await recoveredTickets.load(); assert.equal(recoveredTickets.getByChannel(ticketChannel.id).status, 'closed'); assert.deepEqual(recoveredTickets.getByChannel(ticketChannel.id).guests, []);
    await server.starboard.store.mutate(state => { state.entries[0].status = 'pending'; state.entries[0].post = null; });
    assert.deepEqual(await send(starCommand(29, 'recover', { message: starMessage, post: originalPost })), { type: 5, data: { flags: 64 } }); assert.match(responses.at(-1).content, /Existing highlight verified/); assert.equal(starCreates, 1); assert.equal(server.starboard.store.snapshot().entries[0].post, originalPost);
    await send(starCommand(30, 'list', { state: 'posted', page: 1 })); assert.match(responses.at(-1).content, /history: 1/); assert.ok(responses.at(-1).content.includes(originalPost)); assert.deepEqual(responses.at(-1).allowed_mentions, { parse: [] });
    await send(starCommand(31, 'retire', { message: starMessage })); assert.match(responses.at(-1).content, /Could not complete/); assert.equal(server.starboard.store.snapshot().entries[0].status, 'deleting');
    const deleting = new StarboardStore(config.starboardStorePath, ids.guild); await deleting.load(); assert.equal(deleting.snapshot().entries[0].status, 'deleting');
    await send(starCommand(32, 'retire', { message: starMessage })); assert.match(responses.at(-1).content, /Highlight retired/); assert.equal(server.starboard.store.snapshot().entries[0].status, 'deleted'); assert.equal(starCreates, 1);
    await send(starCommand(33, 'source-remove', { channel: ids.channel })); assert.match(responses.at(-1).content, /Source removed/); assert.equal(server.starboard.store.snapshot().settings.enabled, false);
    await send(starCommand(34, 'prune', { channel: ids.channel, limit: 1 })); assert.match(responses.at(-1).content, /Forgot 1/); assert.equal(server.starboard.store.snapshot().entries.length, 0); assert.deepEqual(responses.at(-1).allowed_mentions, { parse: [] });
    return { ok: true, version, node: process.versions.node, platform: process.platform, container, checks: ['runtime-startup', 'health', 'unsigned-rejection', 'signed-ping', 'signed-command', 'duplicate-protection', 'private-response', 'scheduler-shutdown', 'thirteen-store-backup', 'backup-verification', 'economy-recovery', 'signed-calculator', 'signed-server-artwork', 'signed-giveaway-create', 'signed-giveaway-edit', 'signed-giveaway-preview', 'signed-giveaway-clear', 'community-recovery', 'signed-ticket-create', 'signed-ticket-guest-add', 'signed-ticket-guest-list', 'signed-ticket-guest-remove', 'signed-ticket-close', 'ticket-guest-recovery', 'ticket-closure-recovery', 'signed-ticket-transcript-text', 'signed-ticket-transcript-json', 'signed-ticket-transcript-paged-gzip', 'signed-ticket-transcript-continuation', 'compressed-transcript-unpack', 'signed-ticket-queue-history', 'signed-automod-keywords-create', 'signed-automod-policy', 'signed-automod-keywords-edit', 'signed-automod-rename', 'signed-automod-mentions-create', 'signed-automod-mentions-edit', 'signed-automod-info', 'signed-starboard-configure', 'signed-starboard-sync', 'starboard-duplicate-protection', 'signed-starboard-status', 'starboard-backup-recovery', 'signed-starboard-recover', 'signed-starboard-history', 'starboard-deletion-recovery', 'signed-starboard-retire', 'signed-starboard-source-remove', 'signed-starboard-prune'] };
  } finally {
    if (server) {
      await Promise.all([server.community.stop(), server.voice.stop(), server.roleMenus.stop(), server.timers.stop(), server.ticketPanels.stop(), server.levelRewards.stop(), server.starboard.stop()]);
      await server.drain(); if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
    const resolved = path.resolve(root), temporaryRoot = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved), temporaryRoot); assert.ok(path.basename(resolved).startsWith('opendesk-release-smoke-')); await fs.rm(resolved, { recursive: true, force: true });
  }
}
async function main(args = process.argv.slice(2)) {
  if (args.some((arg) => arg !== '--container') || args.length > 1) throw new Error('Usage: npm run release:smoke -- [--container]');
  console.log(JSON.stringify(await runSmoke({ container: args.includes('--container') }), null, 2));
}
if (require.main === module) main().catch(() => { console.error('Isolated release smoke failed. No live Discord validation was performed.'); process.exitCode = 1; });
module.exports = { runSmoke, main };
