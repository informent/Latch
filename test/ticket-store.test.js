'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { TicketStore } = require('../src/ticket-store');

test('serializes concurrent ticket writes without losing records', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-store-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'data', 'tickets.json');
  const store = new TicketStore(file);
  await Promise.all([
    store.add({ channelId: '123456789012345678', ownerId: '223456789012345678', status: 'open', createdAt: '2026-10-04T00:00:00.000Z' }),
    store.add({ channelId: '323456789012345678', ownerId: '423456789012345678', status: 'open', createdAt: '2026-10-04T00:00:01.000Z' })
  ]);
  const reloaded = new TicketStore(file);
  await reloaded.load();
  assert.equal(reloaded.getByChannel('123456789012345678').ownerId, '223456789012345678');
  assert.equal(reloaded.getByChannel('323456789012345678').ownerId, '423456789012345678');
});

test('refuses corrupt ticket state without overwriting it', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-corrupt-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'tickets.json');
  const original = '{ not valid json';
  await fs.writeFile(file, original, 'utf8');
  const store = new TicketStore(file);
  await assert.rejects(store.load(), SyntaxError);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('refuses unexpected ticket fields instead of carrying them into future writes', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-extra-field-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'tickets.json');
  const original = JSON.stringify({ version: 1, tickets: [{
    channelId: '123456789012345678', ownerId: '223456789012345678', status: 'open', createdAt: '2026-10-04T00:00:00.000Z'
  }, {
    channelId: '323456789012345678', ownerId: '423456789012345678', status: 'open',
    createdAt: '2026-10-04T00:00:00.000Z', transcript: 'must not be imported'
  }] });
  await fs.writeFile(file, original, 'utf8');
  const store = new TicketStore(file);
  await assert.rejects(store.load(), /invalid records/);
  assert.equal(store.byChannel.size, 0);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('rejects duplicate active tickets for the same member', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-duplicate-owner-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'tickets.json');
  await fs.writeFile(file, JSON.stringify({ version: 1, tickets: [
    { channelId: '123456789012345678', ownerId: '223456789012345678', status: 'open', createdAt: '2026-10-04T00:00:00.000Z' },
    { channelId: '323456789012345678', ownerId: '223456789012345678', status: 'open', createdAt: '2026-10-04T00:01:00.000Z' }
  ] }), 'utf8');
  const store = new TicketStore(file);
  await assert.rejects(store.load(), /invalid records/);
  assert.equal(store.byChannel.size, 0);
});

test('rejects an open ticket alongside a closing ticket for the same member', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-closing-owner-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'tickets.json');
  await fs.writeFile(file, JSON.stringify({ version: 1, tickets: [
    { channelId: '123456789012345678', ownerId: '223456789012345678', status: 'closing', createdAt: '2026-10-04T00:00:00.000Z' },
    { channelId: '323456789012345678', ownerId: '223456789012345678', status: 'open', createdAt: '2026-10-04T00:01:00.000Z' }
  ] }), 'utf8');
  const store = new TicketStore(file);
  await assert.rejects(store.load(), /invalid records/);
  assert.equal(store.byChannel.size, 0);
});

test('rolls in-memory ticket states back when atomic persistence fails', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-write-failure-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'tickets.json');
  const ticket = { channelId: '123456789012345678', ownerId: '223456789012345678', status: 'open', createdAt: '2026-10-04T00:00:00.000Z' };
  const store = new TicketStore(file);
  await store.load();
  await store.add(ticket);

  await fs.unlink(file);
  await fs.mkdir(file);
  await assert.rejects(store.markClosing(ticket.channelId));
  assert.equal(store.getByChannel(ticket.channelId).status, 'open');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['tickets.json']);

  store.filePath = path.join(dir, 'retry.json');
  await store.markClosing(ticket.channelId);
  assert.equal(store.getByChannel(ticket.channelId).status, 'closing');
  await fs.unlink(store.filePath);
  await fs.mkdir(store.filePath);
  await assert.rejects(store.markClosed(ticket.channelId, '2026-10-04T00:05:00.000Z'));
  assert.equal(store.getByChannel(ticket.channelId).status, 'closing');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['retry.json', 'tickets.json']);
});

test('rolls back a new ticket record when its first durable write fails', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-add-failure-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'tickets.json');
  const store = new TicketStore(file);
  await store.load();
  await fs.mkdir(file);
  await assert.rejects(store.add({ channelId: '123456789012345678', ownerId: '223456789012345678', status: 'open', createdAt: '2026-10-04T00:00:00.000Z' }));
  assert.equal(store.byChannel.size, 0);
  assert.deepEqual(await fs.readdir(dir), ['tickets.json']);
});
