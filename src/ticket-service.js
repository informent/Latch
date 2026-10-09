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
}

module.exports = { TicketService, PERMISSIONS, CHAT, BOT, channelName };
