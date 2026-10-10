'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const id = (value) => typeof value === 'string' && /^\d{5,25}$/.test(value);
const slug = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,19}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',');
class TicketPanelStore {
  constructor(filePath, guildId) { Object.assign(this, { filePath, guildId }); this.state = { version: 1, guildId, panels: [] }; this.queue = Promise.resolve(); }
  async load() {
    try {
      if ((await fs.stat(this.filePath)).size > 1024 * 1024) throw new Error();
      const state = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!this.#valid(state)) throw new Error(); this.state = state;
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('Ticket panel store is unreadable or invalid; refusing to modify it.'); }
  }
  list() { return structuredClone(this.state.panels); }
  get(id) { return this.list().find((panel) => panel.id === id) || null; }
  create(input) {
    const data = structuredClone(input);
    return this.#mutate((state) => {
      const existing = state.panels.find((panel) => panel.id === data.id);
      if (existing) {
        if (existing.channelId !== data.channelId || existing.title !== data.title || existing.description !== data.description) throw new Error('Panel ID conflict.');
        return;
      }
      if (state.panels.length >= 20) throw new Error('Ticket panel limit reached.');
      state.panels.push({ ...data, topics: [], messageId: null, state: 'draft', pending: false, attempts: 0, retryAt: null });
    }).then(() => this.get(data.id));
  }
  change(panelId, action, input = {}) {
    const data = structuredClone(input);
    return this.#mutate((state) => {
      const panel = state.panels.find((entry) => entry.id === panelId);
      if (!panel || panel.state === 'deleting') throw new Error('Panel unavailable.');
      if (action === 'add') {
        if (panel.topics.length >= 5 || panel.topics.some((entry) => entry.id === data.id)) throw new Error('Duplicate topic or five-topic limit reached.');
        panel.topics.push(data);
      } else if (action === 'remove') {
        if (!panel.topics.some((entry) => entry.id === data.id)) throw new Error('Topic not found.');
        panel.topics = panel.topics.filter((entry) => entry.id !== data.id);
        if (!panel.topics.length && panel.state === 'enabled') panel.state = 'disabled';
      } else if (action === 'publish') {
        if (!panel.topics.length) throw new Error('Add at least one topic first.'); panel.state = 'enabled';
      } else if (action === 'disable') panel.state = 'disabled';
      else if (action === 'delete') panel.state = 'deleting';
      else throw new Error('Unknown panel action.');
      panel.pending = Boolean(panel.messageId || panel.state === 'enabled' || panel.state === 'deleting'); panel.attempts = 0; panel.retryAt = null;
    }).then(() => this.get(panelId));
  }
  delivered(panelId, messageId) {
    return this.#mutate((state) => {
      const panel = state.panels.find((entry) => entry.id === panelId); if (!panel) throw new Error('Panel unavailable.');
      if (panel.state === 'deleting') state.panels = state.panels.filter((entry) => entry.id !== panelId);
      else { panel.messageId = messageId; panel.pending = false; panel.attempts = 0; panel.retryAt = null; }
    });
  }
  retry(panelId, now) {
    return this.#mutate((state) => {
      const panel = state.panels.find((entry) => entry.id === panelId); if (!panel?.pending) return;
      panel.attempts = Math.min(1000000, panel.attempts + 1); panel.retryAt = new Date(now + Math.min(900000, 15000 * 2 ** Math.min(6, panel.attempts - 1))).toISOString();
    });
  }
  #valid(state) {
    if (!exact(state, 'version,guildId,panels') || state.version !== 1 || !id(state.guildId) || state.guildId !== this.guildId || !Array.isArray(state.panels) || state.panels.length > 20 || new Set(state.panels.map((entry) => entry?.id)).size !== state.panels.length) return false;
    return state.panels.every((panel) => exact(panel, 'id,channelId,title,description,topics,messageId,state,pending,attempts,retryAt')
      && id(panel.id) && id(panel.channelId) && (panel.messageId === null || id(panel.messageId))
      && typeof panel.title === 'string' && panel.title.trim().length > 0 && panel.title.length <= 200 && typeof panel.description === 'string' && panel.description.length <= 1000
      && ['draft', 'enabled', 'disabled', 'deleting'].includes(panel.state) && typeof panel.pending === 'boolean'
      && Number.isInteger(panel.attempts) && panel.attempts >= 0 && panel.attempts <= 1000000
      && (panel.retryAt === null || typeof panel.retryAt === 'string' && Number.isFinite(Date.parse(panel.retryAt)))
      && (panel.pending || panel.attempts === 0 && panel.retryAt === null)
      && Array.isArray(panel.topics)
      && (panel.state !== 'deleting' || panel.pending) && (panel.state !== 'enabled' || panel.topics.length > 0 && (panel.messageId !== null || panel.pending))
      && Array.isArray(panel.topics) && panel.topics.length <= 5 && new Set(panel.topics.map((entry) => entry?.id)).size === panel.topics.length
      && panel.topics.every((entry) => exact(entry, 'id,label,categoryId') && slug(entry.id) && id(entry.categoryId) && typeof entry.label === 'string' && entry.label.trim().length > 0 && entry.label.length <= 60));
  }
  #mutate(update) {
    const task = this.queue.then(async () => {
      const state = structuredClone(this.state); update(state); if (!this.#valid(state)) throw new Error('Invalid ticket panel update.');
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try { await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true }); await fs.writeFile(temporary, `${JSON.stringify(state)}\n`, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, this.filePath); this.state = state; }
      catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
    }); this.queue = task.catch(() => {}); return task;
  }
}
module.exports = { TicketPanelStore };
