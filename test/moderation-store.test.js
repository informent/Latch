'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ModerationStore } = require('../src/moderation-store');

const baseWarning = (overrides = {}) => ({
  id: randomUUID(), guildId: '123456789012345678', userId: '223456789012345678',
  actorId: '323456789012345678', reason: 'Test warning', createdAt: '2026-10-09T00:00:00.000Z', ...overrides
});
const baseStrike = (overrides = {}) => ({
  id: randomUUID(), guildId: '123456789012345678', userId: '223456789012345678',
  actorId: '323456789012345678', reason: 'Repeated rule violation', createdAt: '2026-10-09T00:00:00.000Z',
  expiresAt: null, removedAt: null, removedBy: null, removalReason: null, ...overrides
});

test('serializes concurrent warning writes and reloads persisted records', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-moderation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'moderation.json');
  const store = new ModerationStore(file);
  await store.load();
  const warnings = Array.from({ length: 12 }, (_, index) => baseWarning({ reason: `Warning ${index}` }));
  await Promise.all(warnings.map((warning) => store.addWarning(warning)));
  assert.equal(store.listWarnings(warnings[0].guildId, warnings[0].userId).length, warnings.length);
  const reloaded = new ModerationStore(file);
  await reloaded.load();
  assert.deepEqual(reloaded.listWarnings(warnings[0].guildId, warnings[0].userId).map((warning) => warning.reason), warnings.map((warning) => warning.reason));
  assert.equal(await reloaded.clearWarnings(warnings[0].guildId, warnings[0].userId), warnings.length);
  assert.equal(reloaded.listWarnings(warnings[0].guildId, warnings[0].userId).length, 0);
});

test('refuses malformed moderation state without replacing it', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-moderation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'moderation.json');
  const original = '{"version":1,"warnings":[{"reason":"tampered"}]}\n';
  await fs.writeFile(file, original);
  const store = new ModerationStore(file);
  await assert.rejects(store.load(), /invalid records/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('refuses duplicate strike case IDs in version 2 stores without replacing the file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'latch-moderation-duplicate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'moderation.json');
  const strike = baseStrike();
  const original = `${JSON.stringify({ version: 2, warnings: [], strikes: [strike, strike] }, null, 2)}\n`;
  await fs.writeFile(file, original);
  const store = new ModerationStore(file);
  await assert.rejects(store.load(), /invalid records/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('migrates warning-only stores on write and preserves existing warnings', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'latch-moderation-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'moderation.json');
  const warning = baseWarning();
  await fs.writeFile(file, `${JSON.stringify({ version: 1, warnings: [warning] })}\n`);
  const store = new ModerationStore(file);
  await store.load();
  const strike = baseStrike();
  await store.addStrike(strike);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.warnings, [warning]);
  assert.deepEqual(saved.strikes, [strike]);
  const reloaded = new ModerationStore(file);
  await reloaded.load();
  assert.deepEqual(reloaded.listWarnings(warning.guildId, warning.userId), [warning]);
  assert.deepEqual(reloaded.listStrikes(strike.guildId, strike.userId), [strike]);
});

test('tracks expiry and removals without discarding the strike audit history', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'latch-moderation-strikes-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ModerationStore(path.join(root, 'moderation.json'));
  await store.load();
  const currentTime = new Date('2026-10-12T12:00:00.000Z');
  const active = baseStrike();
  const expiring = baseStrike({ expiresAt: '2026-10-12T11:00:00.000Z' });
  await Promise.all([store.addStrike(active), store.addStrike(expiring)]);
  assert.deepEqual(store.listStrikes(active.guildId, active.userId, { now: currentTime }), [active]);
  const removed = await store.removeStrike(active.guildId, active.userId, active.id, {
    actorId: '423456789012345678', removedAt: currentTime.toISOString(), reason: 'Appeal accepted'
  });
  assert.equal(removed.removalReason, 'Appeal accepted');
  assert.deepEqual(store.listStrikes(active.guildId, active.userId, { now: currentTime }), []);
  assert.equal(store.listStrikes(active.guildId, active.userId, { includeInactive: true, now: currentTime }).length, 2);
  const restored = new ModerationStore(store.filePath);
  await restored.load();
  const history = restored.listStrikes(active.guildId, active.userId, { includeInactive: true, now: currentTime });
  assert.equal(history.find((strike) => strike.id === active.id).removedBy, '423456789012345678');
  assert.equal(history.find((strike) => strike.id === expiring.id).expiresAt, expiring.expiresAt);
});

test('clears only active strikes and validates staff removal records', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'latch-moderation-clear-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ModerationStore(path.join(root, 'moderation.json'));
  await store.load();
  const active = baseStrike();
  const expired = baseStrike({ expiresAt: '2026-10-12T11:00:00.000Z' });
  await Promise.all([store.addStrike(active), store.addStrike(expired)]);
  const removed = await store.clearStrikes(active.guildId, active.userId, {
    actorId: '423456789012345678', removedAt: '2026-10-12T12:00:00.000Z', reason: 'Case review'
  });
  assert.equal(removed, 1);
  assert.deepEqual(store.listStrikes(active.guildId, active.userId, { now: new Date('2026-10-12T12:00:00.000Z') }), []);
  const history = store.listStrikes(active.guildId, active.userId, { includeInactive: true });
  assert.equal(history.filter((strike) => strike.removedAt).length, 1);
  assert.equal(history.find((strike) => strike.id === active.id).removalReason, 'Case review');
  assert.equal(await store.removeStrike(active.guildId, active.userId, randomUUID(), {
    actorId: '423456789012345678', removedAt: '2026-10-12T12:00:00.000Z', reason: 'Not found'
  }), null);
  await assert.rejects(store.removeStrike(active.guildId, active.userId, 'bad-id', {
    actorId: 'invalid', removedAt: 'bad-date', reason: ''
  }), /Invalid strike removal details/);
});
