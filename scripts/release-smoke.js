'use strict';
const assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), { once } = require('node:events');
const { loadConfig } = require('../src/config'), { createServerRuntime } = require('../src/server'), { publicKeyFromHex } = require('../src/interactions');
const { TicketStore } = require('../src/ticket-store'), { EconomyStore } = require('../src/economy-store');
const { CommunityStore } = require('../src/community-store');
const { createBackup, verifyBackup } = require('./backup');
const { version } = require('../package.json');
async function runSmoke({ container = false } = {}) {
  if (container) assert.equal(process.getuid?.(), 1000, 'Container must run as the node user.');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-release-smoke-'));
  const ids = { guild: '123456789012345678', bot: '223456789012345678', actor: '323456789012345678', target: '423456789012345678', role: '523456789012345678', channel: '623456789012345678', request: '723456789012345678', owner: '823456789012345678' };
  let server, giveaway; const responses = [], pair = crypto.generateKeyPairSync('ed25519');
  try {
    const env = { DISCORD_APPLICATION_ID: ids.bot, DISCORD_GUILD_ID: ids.guild, DISCORD_PUBLIC_KEY: pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex'), DISCORD_BOT_TOKEN: 'isolated-smoke-placeholder', DISCORD_GATEWAY_ENABLED: 'false', HOST: '127.0.0.1', PORT: '3000' };
    const keys = ['TICKET_STORE_PATH', 'MODERATION_STORE_PATH', 'ECONOMY_STORE_PATH', 'LEVEL_STORE_PATH', 'COMMUNITY_STORE_PATH', 'VOICE_STORE_PATH', 'ROLE_MENU_STORE_PATH', 'TEMPLATE_STORE_PATH', 'RESPONDER_STORE_PATH', 'TIMER_STORE_PATH', 'TICKET_PANEL_STORE_PATH', 'LEVEL_REWARD_STORE_PATH'];
    keys.forEach((key, index) => { env[key] = path.join(root, `store-${index}.json`); });
    const config = { ...loadConfig(env), port: 0 }, economy = new EconomyStore(config.economyStorePath);
    // This adapter never contacts Discord. Unexpected calls fail the smoke test.
    const discord = {
      getCurrentUser: async () => ({ id: ids.bot }),
      getGuild: async () => ({ id: ids.guild, owner_id: ids.owner, name: 'Smoke guild', icon: 'a'.repeat(32) }),
      getGuildMember: async (_guild, userId) => { assert.ok([ids.actor, ids.target].includes(userId)); return { user: { id: userId }, roles: userId === ids.actor ? [ids.role] : [] }; },
      request: async (method, route) => { assert.equal(method, 'GET'); assert.equal(route, `/guilds/${ids.guild}/roles`); return [{ id: ids.guild, permissions: '0' }, { id: ids.role, permissions: '32' }]; },
      editOriginalResponse: async (_application, _token, body) => { responses.push(body); },
      createMessage: async (channel, body) => { assert.equal(channel, ids.channel); assert.equal(giveaway, undefined); giveaway = { ...structuredClone(body), id: String(BigInt(ids.request) + 99n) }; return structuredClone(giveaway); },
      editMessage: async (channel, id, body) => { assert.equal(channel, ids.channel); assert.equal(id, giveaway.id); Object.assign(giveaway, structuredClone(body)); }
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
    await Promise.all([server.community.stop(), server.voice.stop(), server.roleMenus.stop(), server.timers.stop(), server.ticketPanels.stop(), server.levelRewards.stop()]);
    const backup = path.join(root, 'backup'), created = await createBackup(config, backup); assert.equal(created.present, 2); assert.equal(created.missing.length, 10); assert.equal((await verifyBackup(backup, ids.guild)).ok, true);
    const recovered = new EconomyStore(path.join(backup, 'economy.json')); await recovered.load(); assert.equal(recovered.balance(ids.guild, ids.target), 100); assert.equal(recovered.adjustmentHistory(ids.guild).length, 1);
    const recoveredCommunity = new CommunityStore(path.join(backup, 'community.json')); await recoveredCommunity.load();
    assert.deepEqual(recoveredCommunity.get(giveawayId).presentation, { hostId: ids.target, description: 'Restart-safe details', image: null, thumbnail: null });
    return { ok: true, version, node: process.versions.node, platform: process.platform, container, checks: ['runtime-startup', 'health', 'unsigned-rejection', 'signed-ping', 'signed-command', 'duplicate-protection', 'private-response', 'scheduler-shutdown', 'twelve-store-backup', 'backup-verification', 'economy-recovery', 'signed-calculator', 'signed-server-artwork', 'signed-giveaway-create', 'signed-giveaway-edit', 'signed-giveaway-preview', 'signed-giveaway-clear', 'community-recovery'] };
  } finally {
    if (server) {
      await Promise.all([server.community.stop(), server.voice.stop(), server.roleMenus.stop(), server.timers.stop(), server.ticketPanels.stop(), server.levelRewards.stop()]);
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
