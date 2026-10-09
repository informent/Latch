'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { once } = require('node:events');
const { startServer, createServerRuntime, installShutdownHandlers } = require('../src/server');
const { publicKeyFromHex } = require('../src/interactions');
const { TicketStore } = require('../src/ticket-store');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('HTTP endpoint validates signatures and responds to signed pings without logging payloads', async (t) => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicRaw = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const logs = [];
  const server = startServer({ config: { port: 0, host: '127.0.0.1' }, publicKey: publicKeyFromHex(publicRaw.toString('hex')), handle: async () => ({ immediate: { type: 1 } }), logger: (...args) => logs.push(args) });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/interactions`;
  const health = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  const raw = Buffer.from('{"type":1}');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sign = (data) => crypto.sign(null, Buffer.concat([Buffer.from(timestamp), data]), pair.privateKey).toString('hex');
  const valid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature-timestamp': timestamp, 'x-signature-ed25519': sign(raw) }, body: raw });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { type: 1 });
  const invalid = await fetch(url, { method: 'POST', headers: { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': '0'.repeat(128) }, body: raw });
  assert.equal(invalid.status, 401);
  assert.equal(logs.length, 0);
  const oversized = Buffer.alloc(65 * 1024, 65);
  const tooLarge = await fetch(url, { method: 'POST', headers: { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': sign(oversized) }, body: oversized });
  assert.equal(tooLarge.status, 413);
  const wrongRoute = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST' });
  assert.equal(wrongRoute.status, 404);
});

test('drains acknowledged background work and logs unexpected task failures', async (t) => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicRaw = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const logs = [];
  let releaseFirst;
  const firstWork = new Promise((resolve) => { releaseFirst = resolve; });
  let interactionCount = 0;
  const server = startServer({
    config: { port: 0, host: '127.0.0.1' },
    publicKey: publicKeyFromHex(publicRaw.toString('hex')),
    handle: async () => ({
      immediate: { type: 1 },
      work: () => interactionCount++ === 0 ? firstWork : Promise.reject(new Error('simulated background failure'))
    }),
    logger: (...args) => logs.push(args)
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/interactions`;
  const raw = Buffer.from('{"type":1}');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.sign(null, Buffer.concat([Buffer.from(timestamp), raw]), pair.privateKey).toString('hex');
  const sendPing = () => fetch(url, { method: 'POST', headers: { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': signature }, body: raw });

  assert.equal((await sendPing()).status, 200);
  assert.equal(server.pendingWorkCount(), 1);
  let drained = false;
  const drain = server.drain().then(() => { drained = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  releaseFirst();
  await drain;
  assert.equal(server.pendingWorkCount(), 0);

  assert.equal((await sendPing()).status, 200);
  await server.drain();
  assert.equal(server.pendingWorkCount(), 0);
  assert.deepEqual(logs.map(([event]) => event), ['interaction_work_failed']);
  assert.equal(logs[0][1].message, 'simulated background failure');
});

test('shutdown signals stop listening and wait for active ticket work', async () => {
  const processRef = new EventEmitter();
  const server = new EventEmitter();
  let releaseDrain;
  let drainCount = 0;
  let closeCount = 0;
  server.listening = false;
  server.close = () => { closeCount++; };
  server.pendingWorkCount = () => 1;
  server.drain = () => { drainCount++; return new Promise((resolve) => { releaseDrain = resolve; }); };
  installShutdownHandlers(server, { processRef, log: () => {}, timeoutMs: 1000 });

  processRef.emit('SIGTERM');
  processRef.emit('SIGINT');
  assert.equal(drainCount, 1);
  assert.equal(closeCount, 0);
  server.listening = true;
  server.emit('listening');
  assert.equal(closeCount, 1);
  releaseDrain();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(processRef.exitCode, undefined);
});

test('shutdown timeout marks a non-zero exit and records remaining work', async () => {
  const processRef = new EventEmitter();
  const logs = [];
  const server = new EventEmitter();
  let releaseDrain;
  server.listening = true;
  server.close = () => {};
  server.pendingWorkCount = () => 2;
  server.drain = () => new Promise((resolve) => { releaseDrain = resolve; });
  installShutdownHandlers(server, { processRef, log: (...args) => logs.push(args), timeoutMs: 5 });

  processRef.emit('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(processRef.exitCode, 1);
  assert.deepEqual(logs, [['shutdown_drain_timed_out', { pending: 2 }]]);
  releaseDrain();
  await new Promise((resolve) => setImmediate(resolve));
});

test('signed HTTP create and close flow reaches Discord adapter and persists private ticket state', async (t) => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicRaw = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-e2e-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = {
    applicationId: '123456789012345678', guildId: '223456789012345678',
    port: 0, host: '127.0.0.1', storePath: path.join(dir, 'tickets.json'), supportRoleId: '323456789012345678', categoryId: null
  };
  const botUserId = '423456789012345678';
  const ownerId = '523456789012345678';
  const channelId = '623456789012345678';
  const calls = [];
  let resolveEdit;
  let editDone = new Promise((resolve) => { resolveEdit = resolve; });
  const waitForEdit = async () => {
    let timeout;
    try {
      return await Promise.race([
        editDone,
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Timed out waiting for Discord interaction response edit.')), 3000); })
      ]);
    } finally { clearTimeout(timeout); }
  };
  const discord = {
    getCurrentUser: async () => ({ id: botUserId }),
    createChannel: async (guildId, payload) => { calls.push(['createChannel', guildId, payload]); return { id: channelId }; },
    setMemberOverwrite: async (...args) => calls.push(['overwrite', ...args]),
    editChannel: async (...args) => calls.push(['editChannel', ...args]),
    editOriginalResponse: async (_appId, token, payload) => { calls.push(['editResponse', token, payload]); resolveEdit({ token, payload }); }
  };
  const store = new TicketStore(config.storePath);
  const server = await createServerRuntime({ config, publicKey: publicKeyFromHex(publicRaw.toString('hex')), discord, store });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');

  const deliver = async (interaction) => {
    const raw = Buffer.from(JSON.stringify(interaction));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.sign(null, Buffer.concat([Buffer.from(timestamp), raw]), pair.privateKey).toString('hex');
    return fetch(`http://127.0.0.1:${server.address().port}/interactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature-timestamp': timestamp, 'x-signature-ed25519': signature },
      body: raw
    });
  };
  const base = {
    type: 2, guild_id: config.guildId, channel_id: '723456789012345678',
    member: { user: { id: ownerId, username: 'Member' }, roles: [], permissions: '0' }
  };

  const createResponse = await deliver({ ...base, token: 'create-interaction-token', data: { name: 'ticket', options: [{ name: 'create' }] } });
  assert.deepEqual(await createResponse.json(), { type: 5, data: { flags: 64 } });
  const created = await waitForEdit();
  assert.match(created.payload.content, new RegExp(channelId));
  const creation = calls.find(([name]) => name === 'createChannel');
  assert.equal(creation[1], config.guildId);
  assert.equal(creation[2].permission_overwrites.find((overwrite) => overwrite.id === config.guildId).deny, '1024');
  assert.equal(creation[2].permission_overwrites.find((overwrite) => overwrite.id === ownerId).allow, String((1n << 10n) | (1n << 11n) | (1n << 16n)));
  assert.equal(creation[2].permission_overwrites.find((overwrite) => overwrite.id === botUserId).type, 1);

  editDone = new Promise((resolve) => { resolveEdit = resolve; });
  const closeResponse = await deliver({
    ...base, channel_id: '723456789012345679', token: 'close-interaction-token',
    data: { name: 'ticket', options: [{ name: 'close', options: [{ name: 'channel', value: channelId }] }] }
  });
  assert.deepEqual(await closeResponse.json(), { type: 5, data: { flags: 64 } });
  const closed = await waitForEdit();
  assert.equal(closed.payload.content, 'Ticket closed.');
  assert.equal(store.getByChannel(channelId).status, 'closed');
  assert.equal(calls.find(([name]) => name === 'overwrite')[3].deny, '2048');
  assert.match(calls.find(([name]) => name === 'editChannel')[2].name, /^closed-/);
});
