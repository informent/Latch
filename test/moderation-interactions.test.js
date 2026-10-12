'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInteractionHandler } = require('../src/interactions');

const config = { guildId: '123456789012345678', applicationId: '123456789012345679' };
const userId = '223456789012345678';
const targetId = '323456789012345678';
const base = (subcommand, permissions = '0', options = []) => ({
  type: 2, guild_id: config.guildId, channel_id: '423456789012345678', token: 'interaction-token',
  member: { user: { id: userId }, roles: [], permissions },
  data: { name: 'moderation', options: [{ name: subcommand, options }] }
});
const hierarchyFixture = {
  getCurrentUser: async () => ({ id: '523456789012345678' }),
  getGuild: async () => ({ id: config.guildId, owner_id: '623456789012345678' }),
  request: async () => [{ id: config.guildId, position: 0, permissions: '0' }, { id: '723456789012345678', position: 10, managed: false, permissions: String(4n | 2n | (1n << 40n) | (1n << 28n) | (1n << 27n)) }, { id: '423456789012345679', position: 1, managed: false, permissions: '0' }],
  getGuildMember: async (guildId, id) => ({ user: { id }, roles: id === targetId ? [] : ['723456789012345678'] })
};
const targetOption = { name: 'user', value: targetId };

test('moderation rejects members without the required permission before API calls', async () => {
  let called = false;
  const handler = createInteractionHandler({ config, moderation: {}, discord: { banMember: async () => { called = true; } } });
  const result = await handler(base('ban', '0', [targetOption]));
  assert.equal(result.immediate.type, 4);
  assert.match(result.immediate.data.content, /do not have permission/);
  assert.equal(called, false);
  assert.equal(require('../src/interactions').hasPermission('8', 4n), true);
});

test('ban action passes the actor reason to the Discord adapter and replies privately', async () => {
  const bans = [];
  const edited = [];
  const discord = {
    ...hierarchyFixture,
    banMember: async (...args) => bans.push(args),
    editOriginalResponse: async (...args) => edited.push(args)
  };
  const handler = createInteractionHandler({ config, moderation: {}, discord });
  const result = await handler(base('ban', '4', [targetOption, { name: 'reason', value: 'Repeated spam' }]));
  assert.equal(result.immediate.type, 5);
  await result.work();
  assert.deepEqual(bans, [[config.guildId, targetId, 'Repeated spam']]);
  assert.match(edited[0][2].content, /ban/);
  assert.deepEqual(edited[0][2].allowed_mentions, { parse: [] });
});

test('timeout and untimeout actions, bounded durations, and warnings persist', async () => {
  const timeouts = [];
  const warnings = [];
  const edited = [];
  const fixedNow = new Date('2026-10-09T00:00:00.000Z');
  const moderation = { addWarning: async (record) => warnings.push(record) };
  const discord = {
    ...hierarchyFixture,
    timeoutMember: async (...args) => timeouts.push(args),
    editOriginalResponse: async (...args) => edited.push(args)
  };
  const handler = createInteractionHandler({ config, moderation, discord, now: () => fixedNow });
  const timeout = await handler(base('timeout', String(1n << 40n), [targetOption, { name: 'minutes', value: 60 }, { name: 'reason', value: 'Disruptive behavior' }]));
  await timeout.work();
  assert.equal(timeouts[0][2], '2026-10-09T01:00:00.000Z');
  const warn = await handler(base('warn', String(1n << 40n), [targetOption, { name: 'reason', value: 'Please follow the rules' }]));
  await warn.work();
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].guildId, config.guildId);
  assert.equal(warnings[0].userId, targetId);
  assert.equal(warnings[0].actorId, userId);
  assert.equal(warnings[0].reason, 'Please follow the rules');
  assert.match(warnings[0].id, /^[0-9a-f-]{36}$/i);
  const untimeout = await handler(base('untimeout', String(1n << 40n), [targetOption, { name: 'reason', value: 'Appeal accepted' }]));
  await untimeout.work();
  assert.equal(timeouts[1][2], null);
  assert.equal(timeouts[1][3], 'Appeal accepted');
  assert.match(edited[2][2].content, /Removed the timeout/);
  assert.equal(edited.length, 3);
});

test('warning case lookup and removal are scoped to the current server', async () => {
  const record = { id: '123e4567-e89b-42d3-a456-426614174000', guildId: config.guildId, userId: targetId, actorId: userId, reason: 'Repeated links', createdAt: '2026-10-09T00:00:00.000Z' };
  const calls = [], edited = [];
  const moderation = {
    getWarning: (guildId, id) => guildId === record.guildId && id === record.id ? record : null,
    removeWarning: async (guildId, id) => { calls.push([guildId, id]); return guildId === record.guildId && id === record.id ? record : null; }
  };
  const discord = { editOriginalResponse: async (...args) => edited.push(args) };
  const handler = createInteractionHandler({ config, moderation, discord });
  const lookup = await handler(base('case', String(1n << 40n), [{ name: 'id', value: record.id }]));
  await lookup.work();
  assert.match(edited[0][2].content, /Repeated links/);
  assert.match(edited[0][2].content, new RegExp(targetId));
  const remove = await handler(base('unwarn', String(1n << 40n), [{ name: 'id', value: record.id }]));
  await remove.work();
  assert.deepEqual(calls, [[config.guildId, record.id]]);
  assert.match(edited[1][2].content, /Removed warning case/);
  const invalid = await handler(base('case', String(1n << 40n), [{ name: 'id', value: 'bad' }]));
  assert.equal(invalid.immediate.type, 5);
  await invalid.work();
  assert.match(edited[2][2].content, /Could not complete case/);
});

test('purge skips messages older than Discord bulk-delete retention and slowmode is bounded', async () => {
  const calls = [];
  const edited = [];
  const fixedNow = new Date('2026-10-09T00:00:00.000Z');
  const discord = {
    getChannelMessages: async (...args) => { calls.push(['get', ...args]); return [
      { id: '523456789012345678', timestamp: '2026-10-08T23:00:00.000Z' },
      { id: '623456789012345678', timestamp: '2026-09-20T23:00:00.000Z' }
    ]; },
    deleteChannelMessage: async (...args) => calls.push(['delete-one', ...args]),
    bulkDeleteChannelMessages: async (...args) => calls.push(['delete-many', ...args]),
    editChannel: async (...args) => calls.push(['edit-channel', ...args]),
    editOriginalResponse: async (...args) => edited.push(args)
  };
  const handler = createInteractionHandler({ config, moderation: {}, discord, now: () => fixedNow });
  const purge = await handler(base('purge', String(1n << 13n), [{ name: 'count', value: 2 }]));
  await purge.work();
  assert.deepEqual(calls[0], ['get', '423456789012345678', 2]);
  assert.equal(calls[1][0], 'delete-one');
  assert.equal(calls[1][2], '523456789012345678');
  assert.match(edited[0][2].content, /Deleted 1 recent message/);
  const slowmode = await handler(base('slowmode', String(1n << 4n), [{ name: 'seconds', value: 15 }]));
  await slowmode.work();
  assert.deepEqual(calls.at(-1), ['edit-channel', '423456789012345678', { rate_limit_per_user: 15 }]);
  assert.match(edited[1][2].content, /15 seconds/);
});

test('role grant requires Manage Roles and nickname update requires Manage Nicknames', async () => {
  const calls = [];
  const edited = [];
  const discord = {
    ...hierarchyFixture,
    grantRole: async (...args) => calls.push(['grant', ...args]),
    setNickname: async (...args) => calls.push(['nickname', ...args]),
    editOriginalResponse: async (...args) => edited.push(args)
  };
  const handler = createInteractionHandler({ config, discord });
  const unauthorized = await handler({
    type: 2, guild_id: config.guildId, channel_id: '423456789012345678', token: 'interaction-token',
    member: { user: { id: userId }, permissions: '0' },
    data: { name: 'roles', options: [{ name: 'grant', options: [{ name: 'user', value: targetId }, { name: 'role', value: '423456789012345679' }] }] }
  });
  assert.match(unauthorized.immediate.data.content, /do not have permission/);
  const grant = await handler({
    type: 2, guild_id: config.guildId, channel_id: '423456789012345678', token: 'interaction-token',
    member: { user: { id: userId }, permissions: String(1n << 28n) },
    data: { name: 'roles', options: [{ name: 'grant', options: [{ name: 'user', value: targetId }, { name: 'role', value: '423456789012345679' }] }] }
  });
  await grant.work();
  assert.equal(calls[0][0], 'grant');
  assert.equal(calls[0][3], '423456789012345679');
  const clear = await handler({
    type: 2, guild_id: config.guildId, channel_id: '423456789012345678', token: 'interaction-token',
    member: { user: { id: userId }, permissions: String(1n << 27n) },
    data: { name: 'roles', options: [{ name: 'clear-nickname', options: [{ name: 'user', value: targetId }] }] }
  });
  await clear.work();
  assert.equal(calls[1][0], 'nickname');
  assert.equal(calls[1][3], null);
  assert.equal(edited.length, 2);
});
