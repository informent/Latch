'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { publicKeyFromHex, verifySignature, createInteractionHandler } = require('../src/interactions');

const pair = crypto.generateKeyPairSync('ed25519');
const rawPublic = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const keyHex = rawPublic.toString('hex');
const now = 1_800_000_000_000;
const timestamp = String(Math.floor(now / 1000));
const body = Buffer.from('{"type":1}');
const signature = crypto.sign(null, Buffer.concat([Buffer.from(timestamp), body]), pair.privateKey).toString('hex');

test('accepts Discord Ed25519 signature with timestamped exact request bytes', () => {
  assert.equal(verifySignature({ publicKey: publicKeyFromHex(keyHex), timestamp, signature, rawBody: body, now }), true);
  assert.equal(verifySignature({ publicKey: publicKeyFromHex(keyHex), timestamp, signature, rawBody: Buffer.from('{}'), now }), false);
  assert.equal(verifySignature({ publicKey: publicKeyFromHex(keyHex), timestamp: String(Number(timestamp) - 301), signature, rawBody: body, now }), false);
  assert.equal(verifySignature({ publicKey: publicKeyFromHex(keyHex), timestamp, signature: 'bad', rawBody: body, now }), false);
});

test('ping is acknowledged and commands outside configured guild are rejected', async () => {
  const config = { guildId: '123456789012345678', applicationId: '123456789012345679' };
  const handler = createInteractionHandler({ config, tickets: {}, discord: {} });
  assert.deepEqual((await handler({ type: 1 })).immediate, { type: 1 });
  const rejected = await handler({ type: 2, guild_id: '123456789012345680' });
  assert.equal(rejected.immediate.type, 4);
  assert.equal(rejected.immediate.data.flags, 64);
});

test('create command is deferred privately and successful work edits the response', async () => {
  const edited = [];
  const tickets = { create: async (user) => ({ created: true, channelId: `channel-${user.id}` }) };
  const discord = { editOriginalResponse: async (...args) => edited.push(args) };
  const config = { guildId: '123456789012345678', applicationId: '123456789012345679' };
  const handler = createInteractionHandler({ config, tickets, discord });
  const result = await handler({ type: 2, guild_id: config.guildId, channel_id: '123456789012345681', token: 'interaction-token', member: { user: { id: '123456789012345682', username: 'Test' } }, data: { name: 'ticket', options: [{ name: 'create' }] } });
  assert.deepEqual(result.immediate, { type: 5, data: { flags: 64 } });
  await result.work();
  assert.match(edited[0][2].content, /<#channel-123456789012345682>/);
  assert.deepEqual(edited[0][2].allowed_mentions, { parse: [] });
});

test('owner can retry closing a selected ticket from another channel', async () => {
  const closeCalls = [];
  const edited = [];
  const tickets = { close: async (request) => { closeCalls.push(request); return { ok: true }; } };
  const discord = { editOriginalResponse: async (...args) => edited.push(args) };
  const config = { guildId: '123456789012345678', applicationId: '123456789012345679' };
  const handler = createInteractionHandler({ config, tickets, discord });
  const result = await handler({
    type: 2,
    guild_id: config.guildId,
    channel_id: '123456789012345680',
    token: 'interaction-token',
    member: { user: { id: '123456789012345681', username: 'Member' }, roles: [], permissions: '0' },
    data: { name: 'ticket', options: [{ name: 'close', options: [{ name: 'channel', value: '123456789012345682' }] }] }
  });
  await result.work();
  assert.equal(closeCalls[0].channelId, '123456789012345682');
  assert.equal(closeCalls[0].userId, '123456789012345681');
  assert.equal(edited[0][2].content, 'Ticket closed.');
});

test('unknown commands stay private and ticket failures get safe follow-up responses', async () => {
  const logs = [];
  const edited = [];
  const config = { guildId: '123456789012345678', applicationId: '123456789012345679' };
  const tickets = {
    create: async () => { throw new Error('simulated create failure'); },
    close: async () => { throw new Error('simulated close failure'); }
  };
  const discord = { editOriginalResponse: async (...args) => edited.push(args) };
  const handler = createInteractionHandler({ config, tickets, discord, logger: (...args) => logs.push(args) });
  const base = {
    type: 2, guild_id: config.guildId, channel_id: '123456789012345680', token: 'interaction-token',
    member: { user: { id: '123456789012345681' }, roles: [], permissions: '0' }
  };
  const unknown = await handler({ ...base, data: { name: 'other' } });
  assert.equal(unknown.immediate.type, 4);
  assert.equal(unknown.immediate.data.flags, 64);
  const malformedSubcommand = await handler({ ...base, data: { name: 'ticket', options: [] } });
  assert.match(malformedSubcommand.immediate.data.content, /Create or Close/);
  const create = await handler({ ...base, data: { name: 'ticket', options: [{ name: 'create' }] } });
  await create.work();
  const close = await handler({ ...base, data: { name: 'ticket', options: [{ name: 'close' }] } });
  await close.work();
  assert.deepEqual(logs.map(([event]) => event), ['ticket_create_failed', 'ticket_close_failed']);
  assert.match(edited[0][2].content, /Could not create/);
  assert.match(edited[1][2].content, /Could not close/);
  assert.equal(edited[0][2].flags, undefined);
});
