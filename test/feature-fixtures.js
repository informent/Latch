'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const ids = { guild: '123456789012345678', bot: '223456789012345678', actor: '323456789012345678', user: '423456789012345678', role: '523456789012345678', channel: '623456789012345678', lobby: '723456789012345678', category: '823456789012345678', menu: '923456789012345678', message: '102345678901234567', botRole: '112345678901234567', actorRole: '122345678901234567', owner: '132345678901234567' };
const epoch = Date.parse('2026-10-10T12:00:00Z');
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-regression-'));
  t.after(async () => { assert.ok(path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()), 'opendesk-regression-'))); await fs.rm(root, { recursive: true, force: true }); });
  return root;
}
function fakeDiscord() {
  const calls = [];
  const roles = [{ id: ids.guild, position: 0, managed: false, permissions: '0' }, { id: ids.role, name: 'Member', position: 1, managed: false, permissions: '0' }, { id: ids.actorRole, position: 10, managed: false, permissions: String(4n | 2n | (1n << 40n) | (1n << 28n) | (1n << 27n)) }, { id: ids.botRole, position: 20, managed: false, permissions: '8' }];
  const members = new Map([[ids.bot, { user: { id: ids.bot, bot: true }, roles: [ids.botRole] }], [ids.actor, { user: { id: ids.actor }, roles: [ids.actorRole] }], [ids.user, { user: { id: ids.user, username: 'Member' }, roles: [] }], [ids.owner, { user: { id: ids.owner }, roles: [] }]]);
  const channels = new Map([[ids.channel, { id: ids.channel, guild_id: ids.guild, type: 0, permission_overwrites: [{ id: ids.guild, type: 0, allow: '0', deny: '1024' }] }], [ids.lobby, { id: ids.lobby, guild_id: ids.guild, type: 2, permission_overwrites: [] }], [ids.category, { id: ids.category, guild_id: ids.guild, type: 4, permission_overwrites: [] }]]);
  const messages = new Map();
  const unavailable = () => { throw Object.assign(new Error('Unavailable'), { statusCode: 404 }); };
  const discord = {
    getCurrentUser: async () => ({ id: ids.bot }),
    getGuild: async () => ({ id: ids.guild, owner_id: ids.owner }),
    getGuildMember: async (guild, user) => { assert.equal(guild, ids.guild); return structuredClone(members.get(user) || unavailable()); },
    request: async (method, route, body) => {
      calls.push([method, route, body]);
      if (route === `/guilds/${ids.guild}/roles`) return structuredClone(roles);
      const match = /^\/channels\/(\d+)(?:\/messages\/(\d+))?$/.exec(route);
      if (!match) throw new Error(`Unexpected route ${route}`);
      if (method === 'DELETE') { channels.delete(match[1]); return; }
      return structuredClone((match[2] ? messages.get(match[2]) : channels.get(match[1])) || unavailable());
    },
    createMessage: async (channel, data) => { calls.push(['message', channel, structuredClone(data)]); const message = { id: String(BigInt(ids.message) + BigInt(messages.size)), author: { id: ids.bot }, ...data }; messages.set(message.id, message); return structuredClone(message); },
    editMessage: async (channel, message, data) => { calls.push(['edit', channel, message, data]); if (!messages.has(message)) unavailable(); Object.assign(messages.get(message), data); },
    deleteChannelMessage: async (channel, message) => { calls.push(['delete-message', channel, message]); if (!messages.delete(message)) unavailable(); },
    editOriginalResponse: async (...args) => calls.push(['response', ...args]),
    editChannel: async (channel, data) => { calls.push(['channel-edit', channel, data]); Object.assign(channels.get(channel) || unavailable(), structuredClone(data)); },
    grantRole: async (guild, user, role) => { calls.push(['grant', user, role]); members.get(user).roles.push(role); },
    revokeRole: async (guild, user, role) => { calls.push(['revoke', user, role]); members.get(user).roles = members.get(user).roles.filter((id) => id !== role); },
    setMemberOverwrite: async (...args) => calls.push(['overwrite', ...args])
  };
  return { discord, calls, roles, members, channels, messages };
}
function interaction(command, action, values = {}, permissions = '8') {
  return { id: ids.menu, type: 2, guild_id: ids.guild, channel_id: ids.channel, token: 'fixture-token', member: { user: { id: ids.actor }, roles: [ids.actorRole], permissions }, data: { name: command, options: [{ name: action, options: Object.entries(values).map(([name, value]) => ({ name, value })) }] } };
}
module.exports = { ids, epoch, directory, fakeDiscord, interaction };
