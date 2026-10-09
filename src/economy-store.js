'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomInt } = require('node:crypto');

const MAX_ACCOUNTS = 50_000;
const MAX_BALANCE = 9_000_000_000_000_000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const WORK_COOLDOWN_MS = 60 * 60 * 1000;

class EconomyStore {
  constructor(filePath, { rollWork = () => randomInt(25, 101) } = {}) {
    this.filePath = filePath;
    this.accounts = new Map();
    this.queue = Promise.resolve();
    this.rollWork = rollWork;
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.accounts) || parsed.accounts.length > MAX_ACCOUNTS
        || parsed.accounts.some((account) => !this.#valid(account))) {
        throw new Error('Economy store contains invalid records; refusing to modify it.');
      }
      const accounts = new Map();
      for (const account of parsed.accounts) {
        const key = this.#key(account.guildId, account.userId);
        if (accounts.has(key)) throw new Error('Economy store contains duplicate accounts; refusing to modify it.');
        accounts.set(key, Object.freeze({ ...account }));
      }
      this.accounts = accounts;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  balance(guildId, userId) { return this.accounts.get(this.#key(guildId, userId))?.balance || 0; }

  leaderboard(guildId, limit = 10) {
    return [...this.accounts.values()].filter((account) => account.guildId === guildId && account.balance > 0)
      .sort((left, right) => right.balance - left.balance || left.userId.localeCompare(right.userId))
      .slice(0, limit);
  }

  async claim(guildId, userId, kind, now = new Date()) {
    const cooldown = kind === 'daily' ? DAILY_COOLDOWN_MS : kind === 'work' ? WORK_COOLDOWN_MS : 0;
    if (!cooldown) throw new Error('Unknown reward type.');
    return this.#transaction(() => {
      const key = this.#key(guildId, userId);
      const existing = this.accounts.get(key) || this.#empty(guildId, userId);
      const lastKey = kind === 'daily' ? 'lastDaily' : 'lastWork';
      const last = existing[lastKey] ? Date.parse(existing[lastKey]) : 0;
      if (last && now.getTime() - last < cooldown) return { claimed: false, nextAt: new Date(last + cooldown).toISOString() };
      const reward = kind === 'daily' ? 100 : this.rollWork();
      const updated = Object.freeze({ ...existing, balance: existing.balance + reward, [lastKey]: now.toISOString() });
      if (!Number.isSafeInteger(updated.balance) || updated.balance > MAX_BALANCE) throw new Error('Balance limit reached.');
      this.accounts.set(key, updated);
      return { claimed: true, reward, balance: updated.balance };
    });
  }

  async transfer(guildId, fromUserId, toUserId, amount) {
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) throw new Error('Transfer amount must be from 1 to 1000000.');
    if (fromUserId === toUserId) throw new Error('You cannot transfer coins to yourself.');
    return this.#transaction(() => {
      const fromKey = this.#key(guildId, fromUserId);
      const toKey = this.#key(guildId, toUserId);
      const from = this.accounts.get(fromKey) || this.#empty(guildId, fromUserId);
      const to = this.accounts.get(toKey) || this.#empty(guildId, toUserId);
      if (from.balance < amount) throw new Error('You do not have enough coins for that transfer.');
      if (to.balance + amount > MAX_BALANCE) throw new Error('The recipient balance limit would be exceeded.');
      this.accounts.set(fromKey, Object.freeze({ ...from, balance: from.balance - amount }));
      this.accounts.set(toKey, Object.freeze({ ...to, balance: to.balance + amount }));
      return { fromBalance: from.balance - amount, toBalance: to.balance + amount };
    });
  }

  #key(guildId, userId) { return `${guildId}:${userId}`; }
  #empty(guildId, userId) { return { guildId, userId, balance: 0, lastDaily: null, lastWork: null }; }

  #valid(account) {
    return account && typeof account === 'object' && !Array.isArray(account)
      && Object.keys(account).sort().join(',') === ['balance', 'guildId', 'lastDaily', 'lastWork', 'userId'].sort().join(',')
      && /^\d{5,25}$/.test(account.guildId) && /^\d{5,25}$/.test(account.userId)
      && Number.isSafeInteger(account.balance) && account.balance >= 0 && account.balance <= MAX_BALANCE
      && ['lastDaily', 'lastWork'].every((key) => account[key] === null || (typeof account[key] === 'string' && Number.isFinite(Date.parse(account[key]))));
  }

  async #transaction(update) {
    const task = this.queue.then(async () => {
      const previous = new Map(this.accounts);
      let result;
      try { result = update(); }
      catch (error) { this.accounts = previous; throw error; }
      if (result.claimed === false) return result;
      if (this.accounts.size > MAX_ACCOUNTS) { this.accounts = previous; throw new Error('Economy account limit reached.'); }
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

module.exports = { EconomyStore, MAX_ACCOUNTS, MAX_BALANCE, DAILY_COOLDOWN_MS, WORK_COOLDOWN_MS };
