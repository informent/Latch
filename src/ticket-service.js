'use strict';

const { exportTranscript, channelAccess, LIMIT } = require('./ticket-transcript');
const { MAX_GUESTS } = require('./ticket-store');

const PERMISSIONS = Object.freeze({
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_ROLES: 1n << 28n
});
const CHAT = PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES | PERMISSIONS.READ_MESSAGE_HISTORY;
const BOT = CHAT | PERMISSIONS.MANAGE_CHANNELS | PERMISSIONS.MANAGE_ROLES;
const asString = (bits) => bits.toString(10);

function privateChannel(channel, channelId, guildId) {
  if (channel?.id !== channelId || channel.guild_id !== guildId || channel.type !== 0) throw new Error('Ticket channel is unavailable.');
  const entries = channel.permission_overwrites;
  if (!Array.isArray(entries) || entries.length > 1000 || entries.some((entry) => !entry || typeof entry.id !== 'string' || !/^\d{5,25}$/.test(entry.id) || ![0, 1].includes(entry.type) || ['allow', 'deny'].some((key) => entry[key] !== undefined && typeof entry[key] !== 'string') || !/^\d{1,30}$/.test(entry.allow || '0') || !/^\d{1,30}$/.test(entry.deny || '0'))
    || new Set(entries.map((entry) => `${entry.type}:${entry.id}`)).size !== entries.length) throw new Error('Invalid ticket permissions.');
  const everyone = entries.find((entry) => entry.id === guildId && entry.type === 0);
  if (!everyone || !(BigInt(everyone.deny || '0') & PERMISSIONS.VIEW_CHANNEL) || BigInt(everyone.allow || '0') & PERMISSIONS.VIEW_CHANNEL) throw new Error('Repair ticket everyone visibility protection before changing this ticket.');
  return entries;
}
const permissionSnapshot = (entries) => entries.map((entry) => `${entry.type}:${entry.id}:${BigInt(entry.allow || '0')}:${BigInt(entry.deny || '0')}`).sort().join('|');

function channelName(user) {
  const slug = String(user.username || 'member').normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 30) || 'member';
  return `ticket-${slug}-${user.id.slice(-4)}`.slice(0, 90);
}

class TicketService {
  constructor({ config, store, discord, botUserId, now = () => new Date() }) {
    this.config = config;
    this.store = store;
    this.discord = discord;
    this.botUserId = botUserId;
    this.now = now;
  }

  async create(user, options = {}) {
    const settings = structuredClone(options);
    if (this.config.supportRoleId === this.config.guildId) throw new Error('The everyone role cannot be the ticket support role.');
    if (!user || typeof user.id !== 'string' || !/^\d{5,25}$/.test(user.id) || user.bot) throw new Error('Tickets require a human server member.');
    if (settings.reason !== undefined && (typeof settings.reason !== 'string' || !settings.reason.trim() || settings.reason.length > 400)) throw new Error('Invalid ticket reason.');
    return this.store.withUserLock(user.id, async () => {
      const existing = this.store.findActiveByOwner(user.id);
      if (existing) return { created: false, channelId: existing.channelId };
      if (settings.categoryId !== undefined) {
        if (typeof settings.categoryId !== 'string' || !/^\d{5,25}$/.test(settings.categoryId)) throw new Error('Invalid ticket category.');
        const category = await this.discord.request('GET', `/channels/${settings.categoryId}`);
        if (category?.id !== settings.categoryId || category.guild_id !== this.config.guildId || category.type !== 4) throw new Error('Ticket category is unavailable.');
      }
      const overwrites = [
        { id: this.config.guildId, type: 0, deny: asString(PERMISSIONS.VIEW_CHANNEL) },
        { id: user.id, type: 1, allow: asString(CHAT) },
        { id: this.botUserId, type: 1, allow: asString(BOT) }
      ];
      if (this.config.supportRoleId) overwrites.push({ id: this.config.supportRoleId, type: 0, allow: asString(CHAT) });
      const channel = await this.discord.createChannel(this.config.guildId, {
        name: channelName(user), type: 0,
        ...((settings.categoryId || this.config.categoryId) ? { parent_id: settings.categoryId || this.config.categoryId } : {}),
        permission_overwrites: overwrites
      });
      if (!channel?.id) throw new Error('Discord created a channel without returning its ID.');
      const ticket = { channelId: channel.id, ownerId: user.id, status: 'open', createdAt: this.now().toISOString(), ...(settings.reason ? { reason: settings.reason.trim() } : {}) };
      try { await this.store.add(ticket); }
      catch (error) {
        try { await this.discord.request('DELETE', `/channels/${channel.id}`); }
        catch {
          throw new Error(`Ticket state could not be saved and Discord cleanup failed; remove orphaned channel ${channel.id} manually.`, { cause: error });
        }
        throw error;
      }
      return { created: true, channelId: channel.id };
    });
  }

  async close({ channelId, userId, roles = [], permissions = '0' }) {
    if (typeof channelId !== 'string' || !/^\d{5,25}$/.test(channelId)) return { ok: false, reason: 'Choose a valid ticket channel.' };
    return this.store.withChannelLock(channelId, async () => {
      const ticket = this.store.getByChannel(channelId);
      if (!ticket) return { ok: false, reason: 'This channel is not an Latch ticket.' };
      if (ticket.ownerId !== userId && !this.isStaff({ roles, permissions })) return { ok: false, reason: 'Only the ticket owner or server support team can close this ticket.' };
      if (ticket.status === 'closed') return { ok: true, alreadyClosed: true };
      if (ticket.status === 'reopening') return { ok: false, reason: 'Support staff must finish reopening this ticket before closing it.' };

      const channel = await this.discord.request('GET', `/channels/${channelId}`);
      const entries = privateChannel(channel, channelId, this.config.guildId);
      const owner = entries.find((entry) => entry.id === ticket.ownerId && entry.type === 1);
      const read = PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.READ_MESSAGE_HISTORY;
      const overwrite = { type: 1, allow: asString((BigInt(owner?.allow || '0') | read) & ~PERMISSIONS.SEND_MESSAGES), deny: asString((BigInt(owner?.deny || '0') | PERMISSIONS.SEND_MESSAGES) & ~read) };
      const expected = entries.filter((entry) => entry.id !== ticket.ownerId || entry.type !== 1).map((entry) => ({ ...entry }));
      expected.push({ id: ticket.ownerId, ...overwrite });
      if (ticket.status === 'open') await this.store.markClosing(channelId);
      await this.discord.setMemberOverwrite(channelId, ticket.ownerId, overwrite);
      for (const guestId of ticket.guests || []) {
        const guest = entries.find(entry => entry.id === guestId && entry.type === 1);
        const revoked = { type: 1, allow: asString(BigInt(guest?.allow || '0') & ~CHAT), deny: asString(BigInt(guest?.deny || '0') | CHAT) };
        const index = expected.findIndex(entry => entry.id === guestId && entry.type === 1);
        if (index >= 0) expected.splice(index, 1);
        expected.push({ id: guestId, ...revoked });
        await this.discord.setMemberOverwrite(channelId, guestId, revoked);
      }
      const name = `closed-${channelId.slice(-8)}`;
      await this.discord.editChannel(channelId, { name });
      const confirmed = await this.discord.request('GET', `/channels/${channelId}`);
      const confirmedEntries = privateChannel(confirmed, channelId, this.config.guildId);
      if (confirmed.name !== name || permissionSnapshot(confirmedEntries) !== permissionSnapshot(expected)) throw new Error('Closed ticket permissions and name could not be confirmed. Retry close after inspecting the channel.');
      const closed = await this.store.markClosed(channelId, this.now().toISOString());
      return { ok: true, ticket: closed };
    });
  }

  isStaff({ roles = [], permissions = '0' }) {
    let administrator = false;
    try { administrator = (BigInt(permissions) & 8n) === 8n; } catch {}
    return administrator || Boolean(this.config.supportRoleId && roles.includes(this.config.supportRoleId));
  }

  async reopen({ channelId, userId, roles = [], permissions = '0' }) {
    if (!this.isStaff({ roles, permissions })) return { ok: false, reason: 'Only the server support team can reopen tickets.' };
    const original = this.store.getByChannel(channelId);
    if (!original) return { ok: false, reason: 'Choose a closed Latch ticket.' };
    return this.store.withUserLock(original.ownerId, () => this.store.withChannelLock(channelId, async () => {
      const ticket = this.store.getByChannel(channelId);
      if (ticket.status === 'open') return { ok: true, content: 'This ticket is already open.' };
      if (!['closed', 'reopening'].includes(ticket.status)) return { ok: false, reason: 'Finish closing this ticket first.' };
      const active = this.store.findActiveByOwner(ticket.ownerId);
      if (active && active.channelId !== channelId) return { ok: false, reason: 'The owner already has another active ticket.' };
      const channel = await this.discord.request('GET', `/channels/${channelId}`);
      if (channel?.id !== channelId || channel.guild_id !== this.config.guildId || channel.type !== 0) throw new Error('Ticket channel is unavailable.');
      const everyone = channel.permission_overwrites?.find((entry) => entry.id === this.config.guildId && entry.type === 0);
      if (!everyone || !/^\d{1,30}$/.test(everyone.allow || '0') || !/^\d{1,30}$/.test(everyone.deny || '') || !(BigInt(everyone.deny) & PERMISSIONS.VIEW_CHANNEL) || BigInt(everyone.allow || '0') & PERMISSIONS.VIEW_CHANNEL) return { ok: false, reason: 'Repair ticket everyone visibility protection before reopening.' };
      const member = await this.discord.getGuildMember(this.config.guildId, ticket.ownerId);
      if (member?.user?.id !== ticket.ownerId || member.user.bot || member.pending) return { ok: false, reason: 'The owner must be a current human member who completed screening.' };
      const owner = channel.permission_overwrites.find((entry) => entry.id === ticket.ownerId && entry.type === 1);
      if (owner && (!/^\d{1,30}$/.test(owner.allow || '0') || !/^\d{1,30}$/.test(owner.deny || '0'))) throw new Error('Invalid owner permissions.');
      await this.store.markReopening(channelId);
      await this.discord.setMemberOverwrite(channelId, ticket.ownerId, { type: 1, allow: asString(BigInt(owner?.allow || '0') | CHAT), deny: asString(BigInt(owner?.deny || '0') & ~CHAT) });
      await this.discord.editChannel(channelId, { name: `ticket-${channelId.slice(-8)}` });
      const restored = await this.discord.request('GET', `/channels/${channelId}`);
      const restoredOwner = restored.permission_overwrites?.find((entry) => entry.id === ticket.ownerId && entry.type === 1);
      const restoredEveryone = restored.permission_overwrites?.find((entry) => entry.id === this.config.guildId && entry.type === 0);
      if (restored.id !== channelId || restored.guild_id !== this.config.guildId || restored.type !== 0 || restored.name !== `ticket-${channelId.slice(-8)}`
        || !restoredOwner || (BigInt(restoredOwner.allow || '0') & CHAT) !== CHAT || BigInt(restoredOwner.deny || '0') & CHAT
        || !restoredEveryone || !(BigInt(restoredEveryone.deny || '0') & PERMISSIONS.VIEW_CHANNEL) || BigInt(restoredEveryone.allow || '0') & PERMISSIONS.VIEW_CHANNEL) throw new Error('Reopened ticket permissions could not be confirmed.');
      await this.store.markReopened(channelId);
      return { ok: true, content: 'Ticket reopened. Owner access restored and previous assignment cleared.' };
    }));
  }

  list({ userId, roles = [], permissions = '0', page = 1 }) {
    if (!Number.isInteger(page) || page < 1 || page > 10000) return { ok: false, reason: 'Choose a valid page.' };
    const staff = this.isStaff({ roles, permissions });
    const records = this.store.list().filter((ticket) => ticket.status !== 'closed' && (staff || ticket.ownerId === userId))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return { ok: true, tickets: records.slice((page - 1) * 10, page * 10), total: records.length, page, pages: Math.max(1, Math.ceil(records.length / 10)) };
  }

  stats(actor) {
    if (!this.isStaff(actor)) return { ok: false, reason: 'Only the server support team can view ticket statistics.' };
    const records = this.store.list();
    return { ok: true, total: records.length, open: records.filter((ticket) => ticket.status === 'open').length,
      closing: records.filter((ticket) => ticket.status === 'closing').length, reopening: records.filter((ticket) => ticket.status === 'reopening').length, closed: records.filter((ticket) => ticket.status === 'closed').length,
      claimed: records.filter((ticket) => ticket.status === 'open' && ticket.claimedBy).length };
  }

  info({ channelId, userId, roles = [], permissions = '0' }) {
    const ticket = this.store.getByChannel(channelId);
    if (!ticket || ticket.ownerId !== userId && !this.isStaff({ roles, permissions })) return { ok: false, reason: 'Ticket information is available only to its owner or the support team.' };
    return { ok: true, ticket: { ...ticket } };
  }

  async transcript({ channelId, userId, roles = [], permissions = '0', limit = 50, format = 'text' }) {
    if (typeof channelId !== 'string' || !/^\d{5,25}$/.test(channelId) || !Number.isInteger(limit) || limit < 1 || limit > LIMIT || !['text', 'json'].includes(format)) return { ok: false, reason: 'Choose a ticket, text or JSON, and 1 to 100 recent messages.' };
    return this.store.withChannelLock(channelId, async () => {
      const ticket = this.store.getByChannel(channelId);
      if (!ticket || ticket.ownerId !== userId && !this.isStaff({ roles, permissions })) return { ok: false, reason: 'Only the ticket owner or support team can export its conversation.' };
      const member = await this.discord.getGuildMember(this.config.guildId, userId);
      if (member?.user?.id !== userId || member.user.bot || member.pending) return { ok: false, reason: 'Conversation exports require current human membership and completed screening.' };
      const [guild, currentRoles, channel] = await Promise.all([this.discord.getGuild(this.config.guildId), this.discord.request('GET', `/guilds/${this.config.guildId}/roles`), this.discord.request('GET', `/channels/${channelId}`)]);
      if (guild?.id !== this.config.guildId) throw new Error('Transcript guild unavailable.');
      const entries = privateChannel(channel, channelId, this.config.guildId);
      const access = channelAccess({ guild, roles: currentRoles, member, entries });
      if (ticket.ownerId !== userId && !this.isStaff({ roles: member.roles, permissions: access.base.toString() })) return { ok: false, reason: 'Your support access is no longer active.' };
      if (!access.readable) return { ok: false, reason: 'Your current roles and ticket permissions must allow viewing the channel and reading message history.' };
      const before = permissionSnapshot(entries);
      const messages = await this.discord.getChannelMessages(channelId, limit);
      const file = exportTranscript({ ticket, channelId, guildId: this.config.guildId, messages, limit, format, exportedAt: this.now().toISOString() });
      const confirmed = await this.discord.request('GET', `/channels/${channelId}`);
      if (permissionSnapshot(privateChannel(confirmed, channelId, this.config.guildId)) !== before) throw new Error('Ticket permissions changed during export. Retry after inspection.');
      return { ok: true, file };
    });
  }

  async guests({ action, channelId, targetId, userId, roles = [], permissions = '0' }) {
    if (!this.isStaff({ roles, permissions })) return { ok: false, reason: 'Only the server support team can manage ticket guests.' };
    if (!['add', 'remove', 'list'].includes(action) || typeof channelId !== 'string' || !/^\d{5,25}$/.test(channelId)) return { ok: false, reason: 'Choose a valid ticket and guest action.' };
    return this.store.withChannelLock(channelId, async () => {
      const ticket = this.store.getByChannel(channelId);
      if (!ticket) return { ok: false, reason: 'Choose an Latch ticket.' };
      if (action === 'list') return { ok: true, guests: [...(ticket.guests || [])], status: ticket.status };
      if (ticket.status !== 'open') return { ok: false, reason: 'Finish closing or reopening before managing guests on an open ticket.' };
      if (typeof targetId !== 'string' || !/^\d{5,25}$/.test(targetId) || [ticket.ownerId, this.botUserId, this.config.guildId].includes(targetId)) return { ok: false, reason: 'Choose a guest other than the ticket owner or bot.' };
      const saved = (ticket.guests || []).includes(targetId);
      if (action === 'remove' && !saved) return { ok: false, reason: 'That member is not a saved ticket guest. Existing manual permissions were preserved.' };
      if (action === 'add') {
        if (!saved && (ticket.guests || []).length >= MAX_GUESTS) return { ok: false, reason: `Each ticket supports at most ${MAX_GUESTS} guests.` };
        const member = await this.discord.getGuildMember(this.config.guildId, targetId);
        if (member?.user?.id !== targetId || member.user.bot || member.pending) return { ok: false, reason: 'Guests must be current human members who completed screening.' };
        if (this.config.supportRoleId && member.roles?.includes(this.config.supportRoleId)) return { ok: false, reason: 'Support team members already have staff access; choose another member.' };
      }
      const channel = await this.discord.request('GET', `/channels/${channelId}`);
      const entries = privateChannel(channel, channelId, this.config.guildId);
      const current = entries.find(entry => entry.id === targetId && entry.type === 1);
      const overwrite = { type: 1, allow: asString(action === 'add' ? BigInt(current?.allow || '0') | CHAT : BigInt(current?.allow || '0') & ~CHAT), deny: asString(action === 'add' ? BigInt(current?.deny || '0') & ~CHAT : BigInt(current?.deny || '0') | CHAT) };
      const expected = entries.filter(entry => entry.id !== targetId || entry.type !== 1).map(entry => ({ ...entry }));
      expected.push({ id: targetId, ...overwrite });
      // Save access intent before granting; a failed or ambiguous API call remains retryable after restart.
      if (action === 'add' && !saved) await this.store.setGuest(channelId, targetId, true);
      await this.discord.setMemberOverwrite(channelId, targetId, overwrite);
      const confirmed = await this.discord.request('GET', `/channels/${channelId}`);
      if (permissionSnapshot(privateChannel(confirmed, channelId, this.config.guildId)) !== permissionSnapshot(expected)) throw new Error('Guest permissions could not be confirmed. Retry the same action after inspecting the channel.');
      // Forget guests only after denial is confirmed, so close can still revoke failed removals.
      if (action === 'remove') await this.store.setGuest(channelId, targetId, false);
      return { ok: true, content: action === 'add' ? 'Guest access saved and channel overwrites verified.' : 'Guest access revoked and channel overwrites verified. Administrator access cannot be revoked by channel overwrites.' };
    });
  }

  async manage({ action, channelId, userId, roles = [], permissions = '0', name, categoryId, reason }) {
    if (!this.isStaff({ roles, permissions })) return { ok: false, reason: 'Only the server support team can manage this ticket.' };
    if (typeof channelId !== 'string' || !/^\d{5,25}$/.test(channelId)) return { ok: false, reason: 'Choose a valid ticket channel.' };
    return this.store.withChannelLock(channelId, async () => {
      const ticket = this.store.getByChannel(channelId);
      if (!ticket || ticket.status !== 'open') return { ok: false, reason: 'Choose an open Latch ticket.' };
      if (action === 'reason') {
        await this.store.setReason(channelId, reason);
        return { ok: true, content: 'Ticket reason saved. It is visible to the owner and support staff through ticket info.' };
      }
      if (action === 'move') {
        if (typeof categoryId !== 'string' || !/^\d{5,25}$/.test(categoryId)) return { ok: false, reason: 'Choose a server category.' };
        const [channel, category] = await Promise.all([this.discord.request('GET', `/channels/${channelId}`), this.discord.request('GET', `/channels/${categoryId}`)]);
        if (channel?.id !== channelId || category?.id !== categoryId || channel?.guild_id !== this.config.guildId || channel.type !== 0 || category?.guild_id !== this.config.guildId || category.type !== 4) return { ok: false, reason: 'Choose an existing ticket and category in the configured server.' };
        const overwrites = channel.permission_overwrites;
        if (!Array.isArray(overwrites) || overwrites.length > 1000 || overwrites.some((item) => !item || typeof item.id !== 'string' || !/^\d{5,25}$/.test(item.id) || ![0, 1].includes(item.type) || typeof item.allow !== 'string' || typeof item.deny !== 'string' || !/^\d{1,30}$/.test(item.allow) || !/^\d{1,30}$/.test(item.deny))) throw new Error('Invalid ticket permissions.');
        const everyone = overwrites.find((item) => item.id === this.config.guildId && item.type === 0);
        if (!everyone || !(BigInt(everyone.deny) & PERMISSIONS.VIEW_CHANNEL) || BigInt(everyone.allow) & PERMISSIONS.VIEW_CHANNEL) return { ok: false, reason: 'Ticket everyone visibility protection is missing. Repair permissions before moving.' };
        if (channel.parent_id === categoryId) return { ok: true, content: 'Ticket is already in that category.' };
        await this.discord.editChannel(channelId, { parent_id: categoryId, permission_overwrites: overwrites.map(({ id, type, allow, deny }) => ({ id, type, allow, deny })) });
        const moved = await this.discord.request('GET', `/channels/${channelId}`);
        const canonical = (items) => JSON.stringify(items.map(({ id, type, allow, deny }) => [id, type, BigInt(allow).toString(), BigInt(deny).toString()]).sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]));
        if (moved.guild_id !== this.config.guildId || moved.type !== 0 || moved.parent_id !== categoryId || !Array.isArray(moved.permission_overwrites) || canonical(moved.permission_overwrites) !== canonical(overwrites)) throw new Error('Ticket move could not be confirmed.');
        return { ok: true, content: 'Ticket moved and channel overwrites verified. Category permissions were not copied.' };
      }
      if (action === 'claim') {
        if (ticket.ownerId === userId) return { ok: false, reason: 'You cannot claim your own ticket.' };
        if (ticket.claimedBy && ticket.claimedBy !== userId) return { ok: false, reason: 'This ticket is already claimed. Unclaim it before assigning a new handler.' };
        await this.store.setClaim(channelId, userId);
        return { ok: true, content: 'Ticket claimed by you.' };
      }
      if (action === 'unclaim') {
        await this.store.setClaim(channelId, null);
        return { ok: true, content: 'Ticket assignment cleared.' };
      }
      if (action === 'rename') {
        if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,89}$/.test(name)) return { ok: false, reason: 'Use 1 to 90 lowercase letters, digits or hyphens, starting with a letter or digit.' };
        // The durable store restricts changes to channels created by this service.
        const channel = await this.discord.request('GET', `/channels/${channelId}`);
        const expectedPermissions = permissionSnapshot(privateChannel(channel, channelId, this.config.guildId));
        await this.discord.editChannel(channelId, { name });
        const renamed = await this.discord.request('GET', `/channels/${channelId}`);
        if (renamed.name !== name || permissionSnapshot(privateChannel(renamed, channelId, this.config.guildId)) !== expectedPermissions) throw new Error('Ticket rename could not be confirmed. Inspect the channel before retrying.');
        return { ok: true, content: 'Ticket renamed and channel overwrites verified.' };
      }
      return { ok: false, reason: 'Choose a ticket management action.' };
    });
  }
}

module.exports = { TicketService, PERMISSIONS, CHAT, BOT, channelName };
