'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomInt } = require('node:crypto');
const ID = /^\d{5,25}$/;
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const timestamp = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;

class TimerStore {
  constructor(filePath, guildId) {
    this.filePath = filePath; this.guildId = guildId;
    this.state = { version: 1, guildId, timers: [] }; this.queue = Promise.resolve();
  }
  valid(state) {
    return state && Object.keys(state).sort().join(',') === 'guildId,timers,version'
      && state.version === 1 && typeof state.guildId === 'string' && state.guildId === this.guildId && ID.test(state.guildId)
      && Array.isArray(state.timers) && state.timers.length <= 25
      && state.timers.every((item) => item && Object.keys(item).sort().join(',') === 'channelId,enabled,interval,lastAttemptAt,lastResult,name,nextAt,nonce,text'
        && typeof item.name === 'string' && NAME.test(item.name)
        && typeof item.channelId === 'string' && ID.test(item.channelId)
        && typeof item.text === 'string' && item.text.trim().length > 0 && item.text.length <= 1800
        && typeof item.enabled === 'boolean' && Number.isInteger(item.interval) && item.interval >= 5 && item.interval <= 43200
        && timestamp(item.nextAt) && timestamp(item.lastAttemptAt)
        && (item.enabled ? item.nextAt > 0 : item.nextAt === 0)
        && ['never', 'pending', 'sent', 'failed'].includes(item.lastResult)
        && (item.nonce === null || typeof item.nonce === 'string' && ID.test(item.nonce))
        && (item.lastResult === 'never' ? item.nonce === null && item.lastAttemptAt === 0 : item.nonce !== null && item.lastAttemptAt > 0))
      && new Set(state.timers.map((item) => item.name)).size === state.timers.length;
  }
  async load() {
    try {
      if ((await fs.stat(this.filePath)).size > 1024 * 1024) throw new Error();
      const state = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!this.valid(state)) throw new Error();
      this.state = state;
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('Timer store is invalid or unreadable; refusing to modify it.'); }
  }
  list() { return structuredClone(this.state.timers); }
  get(name) { return this.list().find((item) => item.name === name) || null; }
  mutate(change) {
    const operation = this.queue.then(async () => {
      const state = structuredClone(this.state);
      const result = change(state);
      if (result === false) return false;
      if (!this.valid(state)) throw new Error('Invalid timer configuration.');
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
  change(action, input, now = Date.now()) {
    return this.mutate((state) => {
      const index = state.timers.findIndex((item) => item.name === input.name);
      if (action === 'create') {
        if (index >= 0) throw new Error('Name already exists.');
        state.timers.push({ ...input, enabled: false, nextAt: 0, lastAttemptAt: 0, lastResult: 'never', nonce: null });
      } else {
        if (index < 0) throw new Error('Unknown timer.');
        const item = state.timers[index];
        if (action === 'update') Object.assign(item, { text: input.text, interval: input.interval, enabled: false, nextAt: 0 });
        else if (action === 'enable') { if (!item.enabled) { item.enabled = true; item.nextAt = now + item.interval * 60000; } }
        else if (action === 'disable') { item.enabled = false; item.nextAt = 0; }
        else if (action === 'delete') state.timers.splice(index, 1);
        else throw new Error('Unknown timer action.');
      }
    });
  }
  claim(name, now) {
    return this.mutate((state) => {
      const item = state.timers.find((timer) => timer.name === name);
      if (!item?.enabled || item.nextAt > now) return false;
      item.nextAt = now + item.interval * 60000;
      item.lastAttemptAt = now; item.lastResult = 'pending';
      item.nonce = `${now}${randomInt(100000000, 1000000000)}`;
      return structuredClone(item);
    });
  }
  finish(name, nonce, success) {
    return this.mutate((state) => {
      const item = state.timers.find((timer) => timer.name === name);
      if (!item || item.nonce !== nonce) return false;
      item.lastResult = success ? 'sent' : 'failed';
    });
  }
}
module.exports = { TimerStore };
