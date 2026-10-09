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
