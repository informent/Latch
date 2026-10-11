'use strict';

const { MAX_CHANNELS } = require('./voice-store');
const ID = /^\d{5,25}$/;
const VIEW = 1n << 10n;
const CONNECT = 1n << 20n;
const BOT_PERMISSIONS = VIEW | CONNECT | (1n << 4n) | (1n << 24n) | (1n << 28n);
const EMPTY_GRACE_MS = 30_000;

class VoiceService {
  constructor({ config, store, discord, botUserId, connection = () => null, logger = () => {}, now = Date.now }) {
    Object.assign(this, { config, store, discord, botUserId, connection, logger, now });
    this.members = new Map();
    this.emptySince = new Map();
    this.cooldowns = new Map();
    this.queue = Promise.resolve();
    this.snapshotConnection = null;
    this.ready = false;
    this.timer = null;
    this.tickTask = null;
    this.cleanupCursor = null;
    this.stopping = false;
  }

  start() {
    if (!this.config.voiceEnabled || this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => { void this.tick().catch(() => this.#log('voice_cleanup_failed')); }, 15_000);
    this.timer.unref?.();
  }

  stop() { this.stopping = true; clearInterval(this.timer); this.timer = null; return this.queue; }

  // Observation happens on receipt, before asynchronous dispatch work. This keeps
  // occupancy current while other commands wait for Discord REST responses.
  observe(type, data) {
    if (!this.config.voiceEnabled) return;
    if (type === 'READY') { this.ready = false; this.members.clear(); this.emptySince.clear(); return; }
    if (type === 'RESUMED') { if (this.ready) this.snapshotConnection = this.connection(); return; }
    if (type === 'GUILD_DELETE' && data?.id === this.config.guildId) { this.ready = false; this.emptySince.clear(); return; }
    if (type === 'GUILD_CREATE' && data?.id === this.config.guildId) {
      this.ready = false;
      this.members.clear(); this.emptySince.clear();
      if (data.unavailable || !Array.isArray(data.voice_states)) return;
      for (const state of data.voice_states) if (ID.test(state.user_id || '') && ID.test(state.channel_id || '')) this.members.set(state.user_id, state.channel_id);
      this.snapshotConnection = this.connection();
      this.ready = true;
    } else if (type === 'VOICE_STATE_UPDATE' && data?.guild_id === this.config.guildId && ID.test(data.user_id || '')) {
      if (data.channel_id === null) this.members.delete(data.user_id);
      else if (ID.test(data.channel_id || '')) this.members.set(data.user_id, data.channel_id);
    }
    for (const { channelId } of this.store.get().channels) {
      if (this.#occupants(channelId).length) this.emptySince.delete(channelId);
      else if (!this.emptySince.has(channelId)) this.emptySince.set(channelId, this.now());
    }
  }

  dispatch(type, data) {
    if (!this.config.voiceEnabled || this.stopping) return Promise.resolve();
    if (type === 'CHANNEL_DELETE' && data?.guild_id === this.config.guildId) return this.#serialize(async () => {
      const state = this.store.get();
      if (state.channels.some((record) => record.channelId === data.id)) await this.store.remove(data.id);
      if (state.lobbyId === data.id || state.categoryId === data.id) await this.store.configure(null, null);
    });
    if (type !== 'VOICE_STATE_UPDATE' || data?.guild_id !== this.config.guildId || data.member?.user?.bot) return Promise.resolve();
    return this.#serialize(async () => {
      if (!this.#live() || this.members.get(data.user_id) !== this.store.get().lobbyId) return;
      try {
        const member = data.member?.user ? data.member : await this.discord.getGuildMember(this.config.guildId, data.user_id);
        if (!member.user || member.user.id !== data.user_id || member.user.bot) return;
        await this.#create(data.user_id, member.user.username || 'Member');
      }
      catch { this.#log('voice_creation_failed'); }
    });
  }

  configure({ lobbyId, categoryId }) {
    return this.#serialize(async () => {
      if (!this.config.voiceEnabled) throw new Error('Enable DISCORD_VOICE_ENABLED and restart first.');
      if (![lobbyId, categoryId].every((id) => typeof id === 'string' && ID.test(id))) throw new Error('Choose a voice lobby and category.');
      const lobby = await this.discord.request('GET', `/channels/${lobbyId}`);
      const category = await this.discord.request('GET', `/channels/${categoryId}`);
      if (lobby.guild_id !== this.config.guildId || lobby.type !== 2 || category.guild_id !== this.config.guildId || category.type !== 4 || this.store.get().channels.some((record) => record.channelId === lobbyId)) throw new Error('Choose existing server voice and category channels, excluding managed rooms.');
      await this.store.configure(lobbyId, categoryId);
      return 'Join-to-create configured. Join the lobby to create your temporary channel.';
    });
  }

  status() {
    const state = this.store.get();
    return `Voice suite: ${this.config.voiceEnabled ? 'enabled' : 'disabled'}\nGateway occupancy: ${this.#live() ? 'ready' : 'waiting for a current server snapshot'}\nLobby: ${state.lobbyId ? `<#${state.lobbyId}>` : 'not configured'}\nManaged rooms: ${state.channels.length}/${MAX_CHANNELS}`;
  }

  disable() { return this.#serialize(async () => { await this.store.configure(null, null); return 'New room creation disabled. Existing managed rooms still expire when empty.'; }); }

  manage({ action, userId, targetId, value }) {
    return this.#serialize(async () => {
      if (!this.#live()) throw new Error('Voice occupancy is not ready.');
      const channelId = this.members.get(userId);
      const record = this.store.get().channels.find((room) => room.channelId === channelId);
      if (!record) throw new Error('Join an Latch temporary voice channel first.');
      if (action === 'claim') {
        if (this.members.get(record.ownerId) === channelId && record.ownerId !== userId) throw new Error('The current owner is still present.');
        if (this.store.get().channels.some((room) => room.channelId !== channelId && room.ownerId === userId)) throw new Error('You already own another room.');
        const socket = this.connection();
        const channel = await this.#channel(channelId);
        if (!this.#live() || this.connection() !== socket || this.members.get(userId) !== channelId || record.ownerId !== userId && this.members.get(record.ownerId) === channelId) throw new Error('Voice state changed; retry.');
        await this.#overwrite(channel, userId, 1, VIEW | CONNECT, false);
        if (!this.#live() || this.connection() !== socket || this.members.get(userId) !== channelId || record.ownerId !== userId && this.members.get(record.ownerId) === channelId) throw new Error('Voice state changed; retry.');
        await this.store.transfer(channelId, userId);
        return 'You own this temporary channel.';
      }
      if (record.ownerId !== userId) throw new Error('Only the channel owner can use this command.');
      const socket = this.connection();
      const channel = await this.#channel(channelId);
      if (!this.#live() || this.connection() !== socket || this.members.get(userId) !== channelId) throw new Error('Voice state changed; retry.');
      if (action === 'transfer') {
        if (typeof targetId !== 'string' || !ID.test(targetId) || this.members.get(targetId) !== channelId || targetId === this.botUserId) throw new Error('Choose a member currently in your room.');
        if (this.store.get().channels.some((room) => room.channelId !== channelId && room.ownerId === targetId)) throw new Error('This member already owns another room.');
        const member = await this.discord.getGuildMember(this.config.guildId, targetId);
        if (!member.user || member.user.id !== targetId || member.user.bot || !this.#live() || this.connection() !== socket || this.members.get(targetId) !== channelId) throw new Error('Choose a human member currently in your room.');
        await this.#overwrite(channel, targetId, 1, VIEW | CONNECT, false);
        if (!this.#live() || this.connection() !== socket || this.members.get(userId) !== channelId || this.members.get(targetId) !== channelId) throw new Error('Voice state changed; retry.');
        await this.store.transfer(channelId, targetId);
        return 'Channel ownership transferred.';
      }
      if (action === 'rename') {
        if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\r\n\x00-\x1f]/.test(value)) throw new Error('Use a channel name of 1 to 100 characters.');
        await this.discord.editChannel(channelId, { name: value.trim() });
      } else if (action === 'limit') {
        if (!Number.isInteger(value) || value < 0 || value > 99) throw new Error('Use a member limit from 0 to 99.');
        await this.discord.editChannel(channelId, { user_limit: value });
      } else if (['lock', 'unlock', 'ghost', 'unghost'].includes(action)) {
        const bit = ['lock', 'unlock'].includes(action) ? CONNECT : VIEW;
        const deny = ['lock', 'ghost'].includes(action);
        await this.#overwrite(channel, this.config.guildId, 0, bit, deny);
        // Keep the owner and bot able to see and join the room.
        await this.#overwrite(await this.#channel(channelId), userId, 1, VIEW | CONNECT, false);
      } else if (['permit', 'reject'].includes(action)) {
        if (typeof targetId !== 'string' || !ID.test(targetId) || [userId, this.botUserId].includes(targetId)) throw new Error('Choose another server member.');
        const member = await this.discord.getGuildMember(this.config.guildId, targetId);
        if (member.user?.id !== targetId) throw new Error('Choose an available server member.');
        if (!this.#live() || this.connection() !== socket) throw new Error('Voice state changed; retry.');
        await this.#overwrite(channel, targetId, 1, VIEW | CONNECT, action === 'reject');
      } else if (action === 'info') {
        return `Channel: <#${channelId}>\nOwner: <@${record.ownerId}>\nConnected members: ${this.#occupants(channelId).length}\nLimit: ${channel.user_limit || 'unlimited'}`;
      } else throw new Error('Choose a voice action.');
      return `Voice channel ${action} completed.`;
    });
  }

  tick() {
    if (this.tickTask || this.stopping) return this.tickTask || Promise.resolve();
    const task = this.#serialize(async () => {
      if (!this.#live()) return;
      let attempted = false;
      const rooms = this.store.get().channels;
      const cursor = rooms.findIndex((room) => room.channelId === this.cleanupCursor);
      const ordered = cursor < 0 ? rooms : [...rooms.slice(cursor + 1), ...rooms.slice(0, cursor + 1)];
      for (const room of ordered) {
        if (this.stopping || !this.#live()) break;
        if (this.#occupants(room.channelId).length) { this.emptySince.delete(room.channelId); continue; }
        if (!this.emptySince.has(room.channelId)) { this.emptySince.set(room.channelId, this.now()); continue; }
        if (this.now() - this.emptySince.get(room.channelId) < EMPTY_GRACE_MS) continue;
        if (attempted) break;
        attempted = true;
        this.cleanupCursor = room.channelId;
        // Rotate failures so a broken room cannot starve cleanup of other rooms.
        this.emptySince.set(room.channelId, this.now());
        const socket = this.connection();
        try {
          await this.#channel(room.channelId);
          if (!this.#live() || this.connection() !== socket || this.#occupants(room.channelId).length) continue;
          await this.discord.request('DELETE', `/channels/${room.channelId}`, undefined, { auditReason: 'Latch empty temporary voice room' });
          await this.store.remove(room.channelId);
          this.emptySince.delete(room.channelId);
        } catch (error) {
          if (error.statusCode === 404) { await this.store.remove(room.channelId); this.emptySince.delete(room.channelId); }
          else this.#log('voice_cleanup_failed');
        }
      }
      for (const [id, at] of this.cooldowns) if (this.now() - at > 60_000) this.cooldowns.delete(id);
    });
    this.tickTask = task;
    void task.finally(() => { if (this.tickTask === task) this.tickTask = null; }).catch(() => {});
    return task;
  }

  async #create(userId, username) {
    const state = this.store.get();
    if (!state.lobbyId || !this.#live() || this.members.get(userId) !== state.lobbyId) return;
    const existing = state.channels.find((room) => room.ownerId === userId);
    if (existing) {
      await this.#channel(existing.channelId);
      if (!this.#live() || this.members.get(userId) !== state.lobbyId) return;
      await this.#move(userId, existing.channelId);
      return;
    }
    if (state.channels.length >= MAX_CHANNELS || this.now() - (this.cooldowns.get(userId) || 0) < 30_000) return;
    this.cooldowns.set(userId, this.now());
    const socket = this.connection();
    const category = await this.discord.request('GET', `/channels/${state.categoryId}`);
    if (category.guild_id !== this.config.guildId || category.type !== 4 || !this.#live() || this.connection() !== socket || this.members.get(userId) !== state.lobbyId) return;
    const overwrites = (category.permission_overwrites || []).filter((overwrite) => ![userId, this.botUserId].includes(overwrite.id));
    overwrites.push({ id: userId, type: 1, allow: String(VIEW | CONNECT), deny: '0' }, { id: this.botUserId, type: 1, allow: String(BOT_PERMISSIONS), deny: '0' });
    const name = `${String(username).replace(/[\r\n\x00-\x1f]/g, '').slice(0, 75)}'s room`;
    const channel = await this.discord.createChannel(this.config.guildId, { name, type: 2, parent_id: state.categoryId, permission_overwrites: overwrites, user_limit: 0 });
    if (!channel?.id || !ID.test(channel.id)) throw new Error('Discord did not return a channel ID.');
    try { await this.store.add(channel.id, userId, new Date(this.now()).toISOString()); }
    catch (error) {
      // This is the just-created channel only; no unrelated server channel is touched.
      await this.discord.request('DELETE', `/channels/${channel.id}`).catch(() => this.#log('voice_orphan_cleanup_failed', { channelId: channel.id }));
      throw error;
    }
    if (!this.#live() || this.connection() !== socket || this.members.get(userId) !== state.lobbyId) return;
    await this.#move(userId, channel.id);
  }

  async #move(userId, channelId) {
    await this.discord.request('PATCH', `/guilds/${this.config.guildId}/members/${userId}`, { channel_id: channelId });
    // Gateway observation can already contain a newer state; never overwrite it.
    if (this.members.get(userId) === this.store.get().lobbyId) this.members.set(userId, channelId);
    this.emptySince.delete(channelId);
  }

  async #channel(channelId) {
    const channel = await this.discord.request('GET', `/channels/${channelId}`);
    if (channel.guild_id !== this.config.guildId || channel.type !== 2) throw new Error('Managed voice channel is unavailable.');
    return channel;
  }

  async #overwrite(channel, id, type, bits, deny) {
    const old = (channel.permission_overwrites || []).find((overwrite) => overwrite.id === id && overwrite.type === type);
    const allowBits = BigInt(old?.allow || '0');
    const denyBits = BigInt(old?.deny || '0');
    await this.discord.request('PUT', `/channels/${channel.id}/permissions/${id}`, { type, allow: String(deny ? allowBits & ~bits : allowBits | bits), deny: String(deny ? denyBits | bits : denyBits & ~bits) });
  }

  #occupants(channelId) { return [...this.members].filter(([, channel]) => channel === channelId).map(([userId]) => userId); }
  #live() { return this.config.voiceEnabled && !this.stopping && this.ready && this.snapshotConnection && this.snapshotConnection === this.connection(); }
  #serialize(work) { const task = this.queue.then(work); this.queue = task.catch(() => {}); return task; }
  #log(event, details = {}) { try { this.logger(event, details); } catch {} }
}

module.exports = { VoiceService, EMPTY_GRACE_MS };
