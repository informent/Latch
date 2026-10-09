'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_LEVEL_ACCOUNTS = 50_000;
const XP_COOLDOWN_MS = 60_000;
const XP_PER_MESSAGE = 15;

class LevelStore {
  constructor(filePath, { now = Date.now } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.accounts = new Map();
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.accounts) || parsed.accounts.length > MAX_LEVEL_ACCOUNTS || parsed.accounts.some((account) => !this.#valid(account))) {
        throw new Error('Level store contains invalid records; refusing to modify it.');
      }
      const accounts = new Map();
      for (const account of parsed.accounts) {
        const key = this.#key(account.guildId, account.userId);
        if (accounts.has(key)) throw new Error('Level store contains duplicate accounts; refusing to modify it.');
        accounts.set(key, Object.freeze({ ...account }));
      }
      this.accounts = accounts;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  get(guildId, userId) {
    const account = this.accounts.get(this.#key(guildId, userId)) || { guildId, userId, xp: 0, lastAward: null };
    return Object.freeze({ ...account, level: this.levelFor(account.xp), xpToNextLevel: this.xpForLevel(this.levelFor(account.xp) + 1) - account.xp });
  }

  leaderboard(guildId, limit = 10) {
    return [...this.accounts.values()].filter((account) => account.guildId === guildId && account.xp > 0)
      .sort((left, right) => right.xp - left.xp || left.userId.localeCompare(right.userId))
      .slice(0, limit).map((account) => this.get(account.guildId, account.userId));
  }

  async awardMessage(guildId, userId) {
    return this.#transaction(() => {
      const key = this.#key(guildId, userId);
      const existing = this.accounts.get(key) || { guildId, userId, xp: 0, lastAward: null };
      const currentTime = this.now();
      const last = existing.lastAward ? Date.parse(existing.lastAward) : 0;
      if (last && currentTime - last < XP_COOLDOWN_MS) return { awarded: false, ...this.get(guildId, userId) };
      if (!this.accounts.has(key) && this.accounts.size >= MAX_LEVEL_ACCOUNTS) throw new Error('Level account limit reached.');
      if (existing.xp > Number.MAX_SAFE_INTEGER - XP_PER_MESSAGE) throw new Error('XP limit reached.');
      const updated = Object.freeze({ ...existing, xp: existing.xp + XP_PER_MESSAGE, lastAward: new Date(currentTime).toISOString() });
      this.accounts.set(key, updated);
      const before = this.levelFor(existing.xp);
      const after = this.levelFor(updated.xp);
      return { awarded: true, gained: XP_PER_MESSAGE, leveledUp: after > before, ...this.get(guildId, userId) };
    });
  }

  levelFor(xp) { return Math.floor(Math.sqrt(xp / 100)); }
  xpForLevel(level) { return level * level * 100; }
  #key(guildId, userId) { return `${guildId}:${userId}`; }

  #valid(account) {
    return account && typeof account === 'object' && !Array.isArray(account)
      && Object.keys(account).sort().join(',') === ['guildId', 'lastAward', 'userId', 'xp'].sort().join(',')
      && /^\d{5,25}$/.test(account.guildId) && /^\d{5,25}$/.test(account.userId)
      && Number.isSafeInteger(account.xp) && account.xp >= 0
      && (account.lastAward === null || (typeof account.lastAward === 'string' && Number.isFinite(Date.parse(account.lastAward))));
  }

  async #transaction(update) {
    const task = this.queue.then(async () => {
      const previous = new Map(this.accounts);
      const result = update();
      if (result.awarded === false) return result;
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      try {
        await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
        await fs.writeFile(tempPath, `${JSON.stringify({ version: 1, accounts: [...this.accounts.values()] }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await fs.rename(tempPath, this.filePath);
        return result;
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        this.accounts = previous;
        throw error;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
}

module.exports = { LevelStore, MAX_LEVEL_ACCOUNTS, XP_COOLDOWN_MS, XP_PER_MESSAGE };
