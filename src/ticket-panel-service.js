'use strict';
function panelMessage(panel) {
  const enabled = panel.state === 'enabled';
  return { embeds: [{ title: panel.title, description: enabled ? panel.description || 'Choose a topic to open a private support ticket.' : 'This ticket panel is disabled.', color: enabled ? 0x5865f2 : 0x747f8d, footer: { text: `Ticket panel: ${panel.id}` } }], components: enabled ? [{ type: 1, components: panel.topics.map((topic) => ({ type: 2, style: 1, label: topic.label, custom_id: `ticketpanel:${panel.id}:${topic.id}` })) }] : [], allowed_mentions: { parse: [] } };
}
class TicketPanelService {
  constructor({ config, store, tickets, discord, botUserId, logger = () => {}, now = Date.now }) { Object.assign(this, { config, store, tickets, discord, botUserId, logger, now }); this.queue = Promise.resolve(); this.timer = null; this.tickTask = null; this.stopping = false; }
  start() { if (this.timer) return; this.stopping = false; this.timer = setInterval(() => { void this.tick().catch(() => this.#log('ticket_panel_tick_failed')); }, 15000); this.timer.unref?.(); void this.tick().catch(() => this.#log('ticket_panel_tick_failed')); }
  stop() { this.stopping = true; clearInterval(this.timer); this.timer = null; return this.queue; }
  list() { return this.store.list(); }
  get(id) { return this.store.get(id); }
  create(input) {
    const data = structuredClone(input);
    return this.#serialize(async () => { await this.#channel(data.channelId, 0); return this.store.create(data); });
  }
  change(id, action, input = {}) {
    const data = structuredClone(input);
    return this.#serialize(async () => {
      if (action === 'add') await this.#channel(data.categoryId, 4);
      if (action === 'publish') {
        const panel = this.store.get(id); if (!panel) throw new Error('Panel unavailable.');
        await this.#channel(panel.channelId, 0); for (const topic of panel.topics) await this.#channel(topic.categoryId, 4);
      }
      const panel = await this.store.change(id, action, data); if (panel?.pending) await this.#attempt(panel); return this.store.get(id);
    });
  }
  click(interaction) {
    const payload = structuredClone(interaction);
    return this.#serialize(async () => {
      const match = /^ticketpanel:(\d{5,25}):([a-z0-9][a-z0-9-]{0,19})$/.exec(payload.data?.custom_id || '');
      const panel = match && this.store.get(match[1]); const topic = panel?.topics.find((entry) => entry.id === match[2]); const user = payload.member?.user;
      if (payload.type !== 3 || payload.data?.component_type !== 2 || payload.guild_id !== this.config.guildId || !panel || panel.state !== 'enabled' || panel.pending || panel.channelId !== payload.channel_id || panel.messageId !== payload.message?.id || payload.message?.author?.id !== this.botUserId || !topic || !user || user.bot || payload.member.pending) throw new Error('This ticket button is unavailable.');
      const member = await this.discord.getGuildMember(this.config.guildId, user.id);
      if (member?.user?.id !== user.id || member.user.bot || member.pending) throw new Error('A current screened human member is required.');
      await this.#channel(topic.categoryId, 4);
      return this.tickets.create(member.user, { categoryId: topic.categoryId, reason: `Panel topic: ${topic.label}` });
    });
  }
  tick() {
    if (this.tickTask || this.stopping) return this.tickTask || Promise.resolve();
    const task = this.#serialize(async () => {
      const pending = this.store.list().filter((panel) => panel.pending && (!panel.retryAt || Date.parse(panel.retryAt) <= this.now())).sort((a, b) => Date.parse(a.retryAt || '1970-01-01') - Date.parse(b.retryAt || '1970-01-01'))[0]; if (pending) await this.#attempt(pending);
    }); this.tickTask = task; void task.finally(() => { if (this.tickTask === task) this.tickTask = null; }).catch(() => {}); return task;
  }
  async #attempt(original) {
    let panel = original;
    try {
      try { await this.#channel(panel.channelId, 0); }
      catch (error) { if (error.statusCode === 404 && panel.state !== 'enabled') { await this.store.delivered(panel.id, null); return; } throw error; }
      if (panel.messageId) {
        try { const message = await this.discord.request('GET', `/channels/${panel.channelId}/messages/${panel.messageId}`); if (message.id !== panel.messageId || message.author?.id !== this.botUserId) throw new Error('Panel message ownership changed.'); }
        catch (error) { if (error.statusCode !== 404) throw error; panel = { ...panel, messageId: null }; }
      }
      if (panel.state === 'deleting') {
        if (panel.messageId) try { await this.discord.deleteChannelMessage(panel.channelId, panel.messageId); } catch (error) { if (error.statusCode !== 404) throw error; }
        await this.store.delivered(panel.id, panel.messageId); return;
      }
      if (panel.state === 'enabled') for (const topic of panel.topics) await this.#channel(topic.categoryId, 4);
      const body = panelMessage(panel); let messageId = panel.messageId;
      if (messageId) try { await this.discord.editMessage(panel.channelId, messageId, body); } catch (error) { if (error.statusCode !== 404) throw error; messageId = null; }
      if (!messageId && panel.state === 'enabled') { const message = await this.discord.createMessage(panel.channelId, { ...body, nonce: panel.id, enforce_nonce: true }); if (!/^\d{5,25}$/.test(message?.id || '')) throw new Error('Panel publication failed.'); messageId = message.id; }
      await this.store.delivered(panel.id, messageId);
    } catch { this.#log('ticket_panel_publication_failed', { panelId: panel.id }); await this.store.retry(panel.id, this.now()).catch(() => this.#log('ticket_panel_retry_save_failed')); }
  }
  async #channel(id, type) { if (typeof id !== 'string' || !/^\d{5,25}$/.test(id)) throw new Error('Choose a valid channel.'); const channel = await this.discord.request('GET', `/channels/${id}`); if (channel?.id !== id || channel.guild_id !== this.config.guildId || channel.type !== type) throw new Error('Choose the correct channel type in this server.'); return channel; }
  #serialize(work) { if (this.stopping) return Promise.reject(new Error('Ticket panels are stopping.')); const task = this.queue.then(work); this.queue = task.catch(() => {}); return task; }
  #log(event, details = {}) { try { this.logger(event, details); } catch {} }
}
module.exports = { TicketPanelService, panelMessage };
