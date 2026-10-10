'use strict';

const { normalize } = require('./responder-store');
const ID = /^\d{5,25}$/;
class ResponderService {
  constructor({ config, store, discord, logger = () => {}, now = Date.now }) {
    this.config = config; this.store = store; this.discord = discord; this.logger = logger; this.now = now;
    this.channelCooldowns = new Map();
    this.lastAttempt = 0;
    this.queue = Promise.resolve();
  }
  dispatch(type, message) {
    const payload = structuredClone(message);
    const task = this.queue.then(() => this.#dispatch(type, payload));
    this.queue = task.catch(() => {});
    return task;
  }
  async #dispatch(type, message) {
    if (!this.config.respondersEnabled || type !== 'MESSAGE_CREATE' || message?.guild_id !== this.config.guildId
      || !ID.test(message.id) || !ID.test(message.channel_id) || !ID.test(message.author?.id)
      || message.author.bot || message.webhook_id || message.type !== 0
      || typeof message.content !== 'string' || message.content.length > 2000) return;
    const now = this.now();
    const timestamp = Date.parse(message.timestamp);
    if (!Number.isFinite(timestamp) || now - timestamp > 120000 || timestamp > now + 5000) return;
    const rule = this.store.list().find((item) => item.enabled && item.channelId === message.channel_id && item.trigger === normalize(message.content));
    if (!rule || now - this.lastAttempt < 2000 || now - (this.channelCooldowns.get(message.channel_id) || 0) < 5000) return;
    try {
      const claimed = await this.store.claim(rule.name, message.id, now, message.channel_id, normalize(message.content));
      if (!claimed) return;
      this.channelCooldowns.set(message.channel_id, now);
      this.lastAttempt = now;
      if (this.channelCooldowns.size > 50) this.channelCooldowns.delete(this.channelCooldowns.keys().next().value);
      await this.discord.createMessage(message.channel_id, { content: claimed.reply, allowed_mentions: { parse: [] }, nonce: message.id, enforce_nonce: true });
    } catch { try { this.logger('responder_delivery_failed', { name: rule.name }); } catch {} }
  }
}
module.exports = { ResponderService };
