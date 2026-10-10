'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ID = /^\d{5,25}$/;
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const normalize = (text) => text.trim().toLowerCase();

class ResponderStore {
  constructor(filePath, guildId) {
    this.filePath = filePath; this.guildId = guildId;
    this.state = { version: 1, guildId, rules: [] }; this.queue = Promise.resolve();
  }
  valid(state) {
    return state && Object.keys(state).sort().join(',') === 'guildId,rules,version'
      && state.version === 1 && state.guildId === this.guildId && ID.test(state.guildId)
      && Array.isArray(state.rules) && state.rules.length <= 50
      && state.rules.every((rule) => rule && Object.keys(rule).sort().join(',') === 'channelId,cooldown,enabled,lastAt,lastMessageId,name,reply,trigger'
        && typeof rule.name === 'string' && NAME.test(rule.name)
        && typeof rule.channelId === 'string' && ID.test(rule.channelId)
        && typeof rule.trigger === 'string' && rule.trigger === normalize(rule.trigger) && rule.trigger.length > 0 && rule.trigger.length <= 200
        && typeof rule.reply === 'string' && rule.reply.trim().length > 0 && rule.reply.length <= 1800
        && typeof rule.enabled === 'boolean' && Number.isInteger(rule.cooldown) && rule.cooldown >= 15 && rule.cooldown <= 3600
        && Number.isSafeInteger(rule.lastAt) && rule.lastAt >= 0
        && (rule.lastMessageId === null || typeof rule.lastMessageId === 'string' && ID.test(rule.lastMessageId)))
      && new Set(state.rules.map((rule) => rule.name)).size === state.rules.length
      && new Set(state.rules.map((rule) => `${rule.channelId}:${rule.trigger}`)).size === state.rules.length;
  }
  async load() {
    try {
      if ((await fs.stat(this.filePath)).size > 1024 * 1024) throw new Error();
      const state = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!this.valid(state)) throw new Error();
      this.state = state;
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('Responder store is invalid or unreadable; refusing to modify it.'); }
  }
  list() { return structuredClone(this.state.rules); }
  get(name) { return this.list().find((rule) => rule.name === name) || null; }
  mutate(change) {
    const operation = this.queue.then(async () => {
      const state = structuredClone(this.state);
      const result = change(state);
      if (result === false) return false;
      if (!this.valid(state)) throw new Error('Invalid responder configuration or duplicate name/channel trigger.');
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, this.filePath); this.state = state;
      } finally { await fs.unlink(temporary).catch(() => {}); }
      return result;
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  change(action, input) {
    return this.mutate((state) => {
      const index = state.rules.findIndex((rule) => rule.name === input.name);
      if (action === 'create') {
        if (index >= 0) throw new Error('Name already exists.');
        state.rules.push({ ...input, trigger: normalize(input.trigger), enabled: false, lastAt: 0, lastMessageId: null });
      } else {
        if (index < 0) throw new Error('Unknown responder.');
        const rule = state.rules[index];
        if (action === 'update') Object.assign(rule, { trigger: normalize(input.trigger), reply: input.reply, cooldown: input.cooldown, enabled: false });
        else if (action === 'enable' || action === 'disable') rule.enabled = action === 'enable';
        else if (action === 'delete') state.rules.splice(index, 1);
        else throw new Error('Unknown action.');
      }
    });
  }
  claim(name, messageId, now, channelId, trigger) {
    return this.mutate((state) => {
      const rule = state.rules.find((item) => item.name === name);
      if (!rule?.enabled || rule.channelId !== channelId || rule.trigger !== trigger || rule.lastMessageId === messageId || now - rule.lastAt < rule.cooldown * 1000) return false;
      rule.lastMessageId = messageId; rule.lastAt = now;
      return structuredClone(rule);
    });
  }
}
module.exports = { ResponderStore, normalize };
