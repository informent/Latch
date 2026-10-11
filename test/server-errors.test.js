'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once, EventEmitter } = require('node:events');
const { startServer, installShutdownHandlers } = require('../src/server');
const { publicKeyFromHex } = require('../src/interactions');

async function fixture(t, handle, logger) {
  const pair = crypto.generateKeyPairSync('ed25519');
  const key = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const server = startServer({ config: { port: 0, host: '127.0.0.1' }, publicKey: publicKeyFromHex(key), handle, logger });
  t.after(async () => { await server.drain(); if (server.listening) await new Promise(resolve => server.close(resolve)); });
  await once(server, 'listening');
  const send = async () => {
    const raw = Buffer.from('{"type":1,"token":"private-interaction-value"}');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.sign(null, Buffer.concat([Buffer.from(timestamp), raw]), pair.privateKey).toString('hex');
    return fetch(`http://127.0.0.1:${server.address().port}/interactions`, { method: 'POST', body: raw, headers: { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': signature }, signal: AbortSignal.timeout(5000) });
  };
  return { server, send };
}

test('unexpected request errors log a fixed diagnostic and keep HTTP status valid', async (t) => {
  const logs = []; const f = await fixture(t, async () => { throw Object.assign(new Error('private-interaction-value token-file'), { statusCode: 99999 }); }, (...args) => logs.push(args));
  const response = await f.send(); assert.equal(response.status, 500); assert.equal(await response.text(), '');
  assert.deepEqual(logs, [['http_request_failed', { message: 'Interaction request could not be completed.' }]]);
});
test('request handling survives null rejections and broken loggers', async (t) => {
  const f = await fixture(t, async () => { throw null; }, () => { throw new Error('logger failure'); });
  assert.equal((await f.send()).status, 500); assert.equal((await f.send()).status, 500);
});
test('background failures drain safely without exposing errors or depending on logger success', async (t) => {
  const logs = []; let calls = 0;
  const f = await fixture(t, async () => ({ immediate: { type: 1 }, work: async () => { throw calls++ === 0 ? new Error('private-interaction-value') : null; } }), (...args) => { logs.push(args); throw new Error('logger failed'); });
  for (let i = 0; i < 2; i++) { assert.equal((await f.send()).status, 200); await f.server.drain(); assert.equal(f.server.pendingWorkCount(), 0); }
  assert.deepEqual(logs, Array.from({ length: 2 }, () => ['interaction_work_failed', { message: 'Unexpected interaction work failure.' }]));
});
test('shutdown failure diagnostics remain private and a broken logger cannot hide failure status', async () => {
  const processRef = new EventEmitter(), server = new EventEmitter();
  server.listening = true; server.close = () => {}; server.drain = async () => { throw new Error('private-interaction-value'); }; server.pendingWorkCount = () => 0;
  const logs = []; installShutdownHandlers(server, { processRef, timeoutMs: 1000, log: (...args) => { logs.push(args); throw new Error('logger failure'); } });
  processRef.emit('SIGTERM'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(processRef.exitCode, 1); assert.deepEqual(logs, [['shutdown_drain_failed', { message: 'Shutdown work could not be drained.' }]]);
});
