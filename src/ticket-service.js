'use strict';

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

  async create(user) {
    return this.store.withUserLock(user.id, async () => {
      const existing = this.store.findActiveByOwner(user.id);
      if (existing) return { created: false, channelId: existing.channelId };
      const overwrites = [
        { id: this.config.guildId, type: 0, deny: asString(PERMISSIONS.VIEW_CHANNEL) },
        { id: user.id, type: 1, allow: asString(CHAT) },
        { id: this.botUserId, type: 1, allow: asString(BOT) }
      ];
      if (this.config.supportRoleId) overwrites.push({ id: this.config.supportRoleId, type: 0, allow: asString(CHAT) });
      const channel = await this.discord.createChannel(this.config.guildId, {
        name: channelName(user), type: 0,
        ...(this.config.categoryId ? { parent_id: this.config.categoryId } : {}),
        permission_overwrites: overwrites
      });
      if (!channel?.id) throw new Error('Discord created a channel without returning its ID.');
      const ticket = { channelId: channel.id, ownerId: user.id, status: 'open', createdAt: this.now().toISOString() };
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
    return this.store.withChannelLock(channelId, async () => {
      const ticket = this.store.getByChannel(channelId);
      if (!ticket) return { ok: false, reason: 'This channel is not an OpenDesk ticket.' };
      const isAdmin = (BigInt(permissions || '0') & 8n) === 8n;
      const isSupport = this.config.supportRoleId && roles.includes(this.config.supportRoleId);
      if (ticket.ownerId !== userId && !isSupport && !isAdmin) return { ok: false, reason: 'Only the ticket owner or server support team can close this ticket.' };
      if (ticket.status === 'closed') return { ok: true, alreadyClosed: true };

      if (ticket.status === 'open') await this.store.markClosing(channelId);
      const canRead = asString(PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.READ_MESSAGE_HISTORY);
      await this.discord.setMemberOverwrite(channelId, ticket.ownerId, { type: 1, allow: canRead, deny: asString(PERMISSIONS.SEND_MESSAGES) });
      await this.discord.editChannel(channelId, { name: `closed-${channelId.slice(-8)}`.slice(0, 90) });
      const closed = await this.store.markClosed(channelId, this.now().toISOString());
      return { ok: true, ticket: closed };
    });
  }

  isStaff({ roles = [], permissions = '0' }) {
    let administrator = false;
    try { administrator = (BigInt(permissions) & 8n) === 8n; } catch {}
    return administrator || Boolean(this.config.supportRoleId && roles.includes(this.config.supportRoleId));
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
      closing: records.filter((ticket) => ticket.status === 'closing').length, closed: records.filter((ticket) => ticket.status === 'closed').length,
      claimed: records.filter((ticket) => ticket.status === 'open' && ticket.claimedBy).length };
  }

  info({ channelId, userId, roles = [], permissions = '0' }) {
    const ticket = this.store.getByChannel(channelId);
    if (!ticket || ticket.ownerId !== userId && !this.isStaff({ roles, permissions })) return { ok: false, reason: 'Ticket information is available only to its owner or the support team.' };
    return { ok: true, ticket: { ...ticket } };
  }

  async manage({ action, channelId, userId, roles = [], permissions = '0', name, categoryId, reason }) {
    if (!this.isStaff({ roles, permissions })) return { ok: false, reason: 'Only the server support team can manage this ticket.' };
    if (typeof channelId !== 'string' || !/^\d{5,25}$/.test(channelId)) return { ok: false, reason: 'Choose a valid ticket channel.' };
    return this.store.withChannelLock(channelId, async () => {
      const ticket = this.store.getByChannel(channelId);
      if (!ticket || ticket.status !== 'open') return { ok: false, reason: 'Choose an open OpenDesk ticket.' };
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
        if (channel?.guild_id !== this.config.guildId || channel.type !== 0) return { ok: false, reason: 'This ticket channel is unavailable in the configured server.' };
        await this.discord.editChannel(channelId, { name });
        return { ok: true, content: 'Ticket renamed.' };
      }
      return { ok: false, reason: 'Choose a ticket management action.' };
    });
  }
}

module.exports = { TicketService, PERMISSIONS, CHAT, BOT, channelName };
