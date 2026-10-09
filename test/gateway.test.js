'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GatewayClient, gatewayUrl } = require('../src/gateway');

class FakeTimers {
  constructor() { this.now = 0; this.nextId = 1; this.jobs = new Map(); }
  setTimeout(callback, delay) {
    const id = this.nextId++;
    this.jobs.set(id, { callback, at: this.now + delay });
    return id;
  }
  clearTimeout(id) { this.jobs.delete(id); }
  async advance(milliseconds) {
    this.now += milliseconds;
    while (true) {
      const ready = [...this.jobs.entries()].filter(([, job]) => job.at <= this.now).sort((a, b) => a[1].at - b[1].at)[0];
      if (!ready) break;
      this.jobs.delete(ready[0]);
      ready[1].callback();
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 1; this.sent = []; this.listeners = new Map(); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  send(data) { this.sent.push(JSON.parse(data)); }
  emit(name, event) { this.listeners.get(name)?.(event); }
  packet(packet) { this.emit('message', { data: JSON.stringify(packet) }); }
  close(code, reason) { this.readyState = 3; this.emit('close', { code, reason }); }
}

const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); };

test('builds a versioned JSON Gateway URL without duplicating query keys', () => {
  assert.equal(gatewayUrl('wss://gateway.discord.gg/?v=9&encoding=etf'), 'wss://gateway.discord.gg/?v=10&encoding=json');
});

test('identifies, tracks sequence, heartbeats, resumes, and dispatches events', async () => {
  const timers = new FakeTimers();
  const sockets = [];
  const events = [];
  let gatewayLookups = 0;
  const client = new GatewayClient({
    token: 'fake-token', intents: 513, timers, random: () => 0.5, reconnectBaseMs: 100,
    getGateway: async () => { gatewayLookups++; return { url: 'wss://gateway.discord.gg/' }; },
    webSocketFactory: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    onDispatch: async (name, data) => events.push([name, data])
  });
  client.start();
  await flush();
  assert.equal(gatewayLookups, 1);
  assert.match(sockets[0].url, /v=10&encoding=json/);
  sockets[0].packet({ op: 10, d: { heartbeat_interval: 1000 } });
  await flush();
  assert.equal(sockets[0].sent[0].op, 2);
  assert.equal(sockets[0].sent[0].d.intents, 513);
  sockets[0].packet({ op: 0, s: 17, t: 'READY', d: { session_id: 'session-1', resume_gateway_url: 'wss://resume.discord.gg/' } });
  await flush();
  assert.equal(events[0][0], 'READY');
  await timers.advance(500);
  assert.deepEqual(sockets[0].sent.at(-1), { op: 1, d: 17 });
  sockets[0].packet({ op: 11, d: null });
  sockets[0].emit('close', { code: 4000 });
  await timers.advance(100);
  assert.equal(sockets.length, 2);
  assert.match(sockets[1].url, /^wss:\/\/resume\.discord\.gg/);
  sockets[1].packet({ op: 10, d: { heartbeat_interval: 1000 } });
  await flush();
  assert.deepEqual(sockets[1].sent[0], { op: 6, d: { token: 'fake-token', session_id: 'session-1', seq: 17 } });
  sockets[1].packet({ op: 0, s: 18, t: 'MESSAGE_CREATE', d: { id: 'message-1' } });
  await flush();
  assert.deepEqual(events[1], ['MESSAGE_CREATE', { id: 'message-1' }]);
  client.stop();
  assert.equal(client.running, false);
});

test('fatal authentication close stops instead of reconnecting', async () => {
  const timers = new FakeTimers();
  const sockets = [];
  const logs = [];
  const client = new GatewayClient({
    token: 'bad-token', intents: 1, timers, getGateway: async () => ({ url: 'wss://gateway.discord.gg/' }),
    webSocketFactory: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    logger: (...args) => logs.push(args)
  });
  client.start();
  await flush();
  sockets[0].emit('close', { code: 4004 });
  assert.equal(client.running, false);
  assert.deepEqual(logs.at(-1), ['gateway_stopped_fatal_close', { code: 4004 }]);
  await timers.advance(60_000);
  assert.equal(sockets.length, 1);
});

test('slow dispatch handlers do not block heartbeat acknowledgements', async () => {
  const timers = new FakeTimers();
  const sockets = [];
  let releaseDispatch;
  const dispatchWait = new Promise((resolve) => { releaseDispatch = resolve; });
  const client = new GatewayClient({
    token: 'fake-token', intents: 513, timers, random: () => 0.5,
    getGateway: async () => ({ url: 'wss://gateway.discord.gg/' }),
    webSocketFactory: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    onDispatch: async () => dispatchWait
  });
  client.start();
  await flush();
  sockets[0].packet({ op: 10, d: { heartbeat_interval: 1000 } });
  sockets[0].packet({ op: 0, s: 1, t: 'READY', d: { session_id: 'session', resume_gateway_url: 'wss://resume.discord.gg/' } });
  await flush();
  sockets[0].packet({ op: 0, s: 2, t: 'MESSAGE_CREATE', d: { id: 'message' } });
  await flush();
  assert.equal(client.lastHeartbeatAck, true);
  await timers.advance(500);
  assert.equal(client.lastHeartbeatAck, false);
  sockets[0].packet({ op: 11, d: null });
  await flush();
  assert.equal(client.lastHeartbeatAck, true);
  releaseDispatch();
  client.stop();
});
