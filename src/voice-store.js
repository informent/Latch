'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ID = /^\d{5,25}$/;
const MAX_CHANNELS = 50;

class VoiceStore {
  constructor(filePath, guildId = null) {
    this.filePath = filePath;
    this.guildId = guildId;
    this.state = { version: 1, guildId, lobbyId: null, categoryId: null, channels: [] };
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      if ((await fs.stat(this.filePath)).size > 1024 * 1024) throw new Error('Voice store exceeds its size limit.');
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!this.#valid(parsed) || this.guildId && parsed.guildId !== this.guildId) throw new Error('Invalid voice store or guild mismatch.');
      this.state = parsed;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw new Error('Voice store is unreadable or invalid; refusing to modify it.');
    }
  }

  get() { return structuredClone(this.state); }

  configure(lobbyId, categoryId) {
    return this.#mutate((state) => { state.lobbyId = lobbyId; state.categoryId = categoryId; });
  }

  add(channelId, ownerId, createdAt) {
    return this.#mutate((state) => {
      if (state.channels.length >= MAX_CHANNELS || state.channels.some((record) => record.channelId === channelId || record.ownerId === ownerId)) throw new Error('Temporary channel limit or duplicate owner.');
      state.channels.push({ channelId, ownerId, createdAt });
    });
  }

  transfer(channelId, ownerId) {
    return this.#mutate((state) => {
      const record = state.channels.find((item) => item.channelId === channelId);
      if (!record || state.channels.some((item) => item.channelId !== channelId && item.ownerId === ownerId)) throw new Error('Member already owns a temporary channel.');
      record.ownerId = ownerId;
    });
  }

  remove(channelId) { return this.#mutate((state) => { state.channels = state.channels.filter((record) => record.channelId !== channelId); }); }

  #valid(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state) || Object.keys(state).sort().join(',') !== 'categoryId,channels,guildId,lobbyId,version'
      || state.version !== 1 || typeof state.guildId !== 'string' || !ID.test(state.guildId)
      || ![state.lobbyId, state.categoryId].every((id) => id === null || typeof id === 'string' && ID.test(id))
      || (state.lobbyId === null) !== (state.categoryId === null)
      || state.lobbyId !== null && state.lobbyId === state.categoryId
      || !Array.isArray(state.channels) || state.channels.length > MAX_CHANNELS) return false;
    const ids = new Set();
    const owners = new Set();
    for (const record of state.channels) {
      if (!record || typeof record !== 'object' || Object.keys(record).sort().join(',') !== 'channelId,createdAt,ownerId'
        || ![record.channelId, record.ownerId].every((id) => typeof id === 'string' && ID.test(id))
        || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
        || ids.has(record.channelId) || owners.has(record.ownerId) || record.channelId === state.lobbyId || record.channelId === state.categoryId) return false;
      ids.add(record.channelId); owners.add(record.ownerId);
    }
    return true;
  }

  #mutate(update) {
    const task = this.queue.then(async () => {
      const state = this.get();
      update(state);
      if (!this.#valid(state)) throw new Error('Invalid voice store update.');
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
        await fs.writeFile(temporary, `${JSON.stringify(state)}\n`, { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, this.filePath);
        this.state = state;
        return this.get();
      } catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
    });
    this.queue = task.catch(() => {});
    return task;
  }
}

module.exports = { VoiceStore, MAX_CHANNELS };
