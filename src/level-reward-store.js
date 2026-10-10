'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const MAX_REWARDS = 20;
const MAX_MEMBERS = 50_000;
const MAX_BYTES = 32 * 1024 * 1024;
const id = (value) => typeof value === 'string' && /^\d{5,25}$/.test(value);
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === names.sort().join(',');
const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

class LevelRewardStore {
  constructor(filePath, guildId) {
    if (!id(guildId)) throw new Error('Invalid reward guild.');
    this.filePath = filePath;
    this.guildId = guildId;
    this.state = { version: 1, guildId, enabled: false, revision: 0, rewards: [], members: [] };
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      if ((await fs.stat(this.filePath)).size > MAX_BYTES) throw new Error();
      const raw = await fs.readFile(this.filePath, 'utf8');
      if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error();
      const state = JSON.parse(raw);
      if (!this.#valid(state)) throw new Error();
      this.state = state;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Level reward store is invalid or unreadable; refusing to modify it.');
    }
  }

  get() { return structuredClone(this.state); }
  member(userId) { return structuredClone(this.state.members.find((member) => member.userId === userId) || null); }

  configure(action, input = {}) {
    const values = { ...input };
    return this.#mutate((state) => {
      if (action === 'add') {
        if (!id(values.roleId) || values.roleId === this.guildId || !Number.isSafeInteger(values.level) || values.level < 1 || values.level > 1000) throw new Error('Invalid reward role or level.');
        const existing = state.rewards.find((reward) => reward.roleId === values.roleId);
        if (existing) existing.level = values.level;
        else state.rewards.push({ roleId: values.roleId, level: values.level });
        state.rewards.sort((a, b) => a.level - b.level || a.roleId.localeCompare(b.roleId));
      } else if (action === 'remove') {
        if (!id(values.roleId)) throw new Error('Invalid reward role.');
        state.rewards = state.rewards.filter((reward) => reward.roleId !== values.roleId);
      } else if (action === 'enable' || action === 'disable') state.enabled = action === 'enable';
      else throw new Error('Unknown reward action.');
      state.revision++;
      return { changed: true, result: () => this.get() };
    });
  }

  schedule(userId, level, force = false) {
    return this.#mutate((state) => {
      if (!id(userId) || !Number.isSafeInteger(level) || level < 0 || level > 10_000_000 || typeof force !== 'boolean') throw new Error('Invalid reward member.');
      if (!state.enabled || !state.rewards.some((reward) => reward.level <= level)) return { changed: false, result: () => null };
      let member = state.members.find((entry) => entry.userId === userId);
      if (member && !force && member.revision === state.revision && member.level >= level) return { changed: false, result: () => this.member(userId) };
      const keepRetry = member?.pending && member.revision === state.revision && !force;
      const updated = { userId, level, revision: state.revision, pending: true, attempts: keepRetry ? member.attempts : 0, retryAt: keepRetry ? member.retryAt : null };
      if (member) Object.assign(member, updated);
      else state.members.push(updated);
      return { changed: true, result: () => this.member(userId) };
    });
  }

  finish(job, now, failed = false) {
    const expected = { ...job };
    return this.#mutate((state) => {
      if (typeof failed !== 'boolean') throw new Error('Invalid reward completion state.');
      if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('Invalid reward clock.');
      const member = state.members.find((entry) => entry.userId === expected.userId);
      if (!member || member.revision !== expected.revision || member.level !== expected.level || !member.pending) return { changed: false, result: () => null };
      if (failed) {
        member.attempts = Math.min(member.attempts + 1, 1_000_000);
        member.retryAt = new Date(now + Math.min(900_000, 15_000 * 2 ** Math.min(member.attempts - 1, 6))).toISOString();
      } else { member.pending = false; member.attempts = 0; member.retryAt = null; }
      return { changed: true, result: () => this.member(expected.userId) };
    });
  }

  #valid(state) {
    return keys(state, ['version', 'guildId', 'enabled', 'revision', 'rewards', 'members']) && state.version === 1 && state.guildId === this.guildId
      && typeof state.enabled === 'boolean' && Number.isSafeInteger(state.revision) && state.revision >= 0 && state.revision <= 1_000_000
      && Array.isArray(state.rewards) && state.rewards.length <= MAX_REWARDS && state.rewards.every((reward) => keys(reward, ['roleId', 'level'])
        && id(reward.roleId) && reward.roleId !== state.guildId && Number.isSafeInteger(reward.level) && reward.level >= 1 && reward.level <= 1000)
      && new Set(state.rewards.map((reward) => reward.roleId)).size === state.rewards.length
      && Array.isArray(state.members) && state.members.length <= MAX_MEMBERS && state.members.every((member) => keys(member, ['userId', 'level', 'revision', 'pending', 'attempts', 'retryAt'])
        && id(member.userId) && Number.isSafeInteger(member.level) && member.level >= 0 && member.level <= 10_000_000
        && Number.isSafeInteger(member.revision) && member.revision >= 0 && member.revision <= state.revision && typeof member.pending === 'boolean'
        && Number.isSafeInteger(member.attempts) && member.attempts >= 0 && member.attempts <= 1_000_000 && (member.retryAt === null || timestamp(member.retryAt))
        && (member.pending || member.retryAt === null && member.attempts === 0) && (member.attempts === 0 ? member.retryAt === null : member.retryAt !== null))
      && new Set(state.members.map((member) => member.userId)).size === state.members.length;
  }

  #mutate(update) {
    const operation = this.queue.then(async () => {
      const state = this.get();
      const { changed, result } = update(state);
      if (!changed) return result();
      if (!this.#valid(state)) throw new Error('Invalid reward update or store limit reached.');
      const raw = JSON.stringify(state) + '\n';
      if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('Level reward store size limit reached.');
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
        await fs.writeFile(temporary, raw, { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, this.filePath);
        this.state = state;
        return result();
      } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

module.exports = { LevelRewardStore, MAX_REWARDS, MAX_MEMBERS, MAX_BYTES };
