'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomInt } = require('node:crypto');

const MAX_ACCOUNTS = 50_000;
const MAX_BALANCE = 9_000_000_000_000_000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const WORK_COOLDOWN_MS = 60 * 60 * 1000;
const BEG_COOLDOWN_MS = 15 * 60 * 1000;
const PROFESSION_COOLDOWN_MS = DAILY_COOLDOWN_MS;
const PROFESSIONS = Object.freeze(['developer', 'artist', 'builder']);
const rankOf = (works) => Math.min(5, 1 + Math.floor(works / 10));

class EconomyStore {
  constructor(filePath, { rollWork = () => randomInt(25, 101), rollBeg = () => randomInt(0, 26) } = {}) {
    this.filePath = filePath;
    this.accounts = new Map();
    this.queue = Promise.resolve();
    this.rollWork = rollWork;
    this.rollBeg = rollBeg;
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
        accounts.set(key, Object.freeze({ ...account, ...(account.profession ? { profession: Object.freeze({ ...account.profession }) } : {}) }));
      }
      this.accounts = accounts;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  balance(guildId, userId) { return this.accounts.get(this.#key(guildId, userId))?.balance || 0; }
  profile(guildId, userId) {
    const account = this.accounts.get(this.#key(guildId, userId)) || this.#empty(guildId, userId);
    const profile = structuredClone(account);
    if (profile.profession) profile.profession.rank = rankOf(profile.profession.works);
    return profile;
  }

  async chooseProfession(guildId, userId, name, now = new Date()) {
    if (!PROFESSIONS.includes(name) || !Number.isFinite(now.getTime())) throw new Error('Choose a valid profession.');
    return this.#transaction((accounts) => {
      const key = this.#key(guildId, userId);
      const account = accounts.get(key) || this.#empty(guildId, userId);
      if (account.profession?.name === name) return { claimed: false, unchanged: true };
      const changed = account.profession ? Date.parse(account.profession.changedAt) : 0;
      if (changed && now.getTime() - changed < PROFESSION_COOLDOWN_MS) return { claimed: false, nextAt: new Date(changed + PROFESSION_COOLDOWN_MS).toISOString() };
      accounts.set(key, Object.freeze({ ...account, profession: Object.freeze({ name, works: 0, changedAt: now.toISOString() }) }));
      return { changed: true, name };
    });
  }

  leaderboard(guildId, limit = 10) {
    return [...this.accounts.values()].filter((account) => account.guildId === guildId && account.balance > 0)
      .sort((left, right) => right.balance - left.balance || left.userId.localeCompare(right.userId))
      .slice(0, limit).map((account) => structuredClone(account));
  }

  async claim(guildId, userId, kind, now = new Date()) {
    const cooldown = kind === 'daily' ? DAILY_COOLDOWN_MS : kind === 'work' ? WORK_COOLDOWN_MS : kind === 'beg' ? BEG_COOLDOWN_MS : 0;
    if (!cooldown) throw new Error('Unknown reward type.');
    if (!Number.isFinite(now.getTime())) throw new Error('Invalid reward time.');
    return this.#transaction((accounts) => {
      const key = this.#key(guildId, userId);
      const existing = accounts.get(key) || this.#empty(guildId, userId);
      const lastKey = kind === 'daily' ? 'lastDaily' : kind === 'beg' ? 'lastBeg' : 'lastWork';
      const last = existing[lastKey] ? Date.parse(existing[lastKey]) : 0;
      if (last && now.getTime() - last < cooldown) return { claimed: false, nextAt: new Date(last + cooldown).toISOString() };
      const baseReward = kind === 'daily' ? 100 : kind === 'beg' ? this.rollBeg() : this.rollWork();
      if (!Number.isInteger(baseReward) || baseReward < (kind === 'beg' ? 0 : 25) || baseReward > (kind === 'beg' ? 25 : 100)) throw new Error('Invalid reward amount.');
      const bonus = kind === 'work' && existing.profession ? rankOf(existing.profession.works) * 5 : 0;
      const reward = baseReward + bonus;
      const profession = kind === 'work' && existing.profession ? { profession: Object.freeze({ ...existing.profession, works: Math.min(1000, existing.profession.works + 1) }) } : {};
      const updated = Object.freeze({ ...existing, ...profession, balance: existing.balance + reward, [lastKey]: now.toISOString() });
      if (!Number.isSafeInteger(updated.balance) || updated.balance > MAX_BALANCE) throw new Error('Balance limit reached.');
      accounts.set(key, updated);
      return { claimed: true, reward, balance: updated.balance, ...(updated.profession ? { bonus, profession: { ...updated.profession, rank: rankOf(updated.profession.works) } } : {}) };
    });
  }

  async transfer(guildId, fromUserId, toUserId, amount) {
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) throw new Error('Transfer amount must be from 1 to 1000000.');
    if (fromUserId === toUserId) throw new Error('You cannot transfer coins to yourself.');
    return this.#transaction((accounts) => {
      const fromKey = this.#key(guildId, fromUserId);
      const toKey = this.#key(guildId, toUserId);
      const from = accounts.get(fromKey) || this.#empty(guildId, fromUserId);
      const to = accounts.get(toKey) || this.#empty(guildId, toUserId);
      if (from.balance < amount) throw new Error('You do not have enough coins for that transfer.');
      if (to.balance + amount > MAX_BALANCE) throw new Error('The recipient balance limit would be exceeded.');
      accounts.set(fromKey, Object.freeze({ ...from, balance: from.balance - amount }));
      accounts.set(toKey, Object.freeze({ ...to, balance: to.balance + amount }));
      return { fromBalance: from.balance - amount, toBalance: to.balance + amount };
    });
  }

  #key(guildId, userId) { return `${guildId}:${userId}`; }
  #empty(guildId, userId) { return { guildId, userId, balance: 0, lastDaily: null, lastWork: null }; }

  #valid(account) {
    return account && typeof account === 'object' && !Array.isArray(account)
      && Object.keys(account).sort().join(',') === ['balance', 'guildId', 'lastDaily', 'lastWork', 'userId', ...['lastBeg', 'profession'].filter((key) => Object.hasOwn(account, key))].sort().join(',')
      && /^\d{5,25}$/.test(account.guildId) && /^\d{5,25}$/.test(account.userId)
      && Number.isSafeInteger(account.balance) && account.balance >= 0 && account.balance <= MAX_BALANCE
      && (!Object.hasOwn(account, 'lastBeg') || account.lastBeg === null || typeof account.lastBeg === 'string' && Number.isFinite(Date.parse(account.lastBeg)))
      && (!Object.hasOwn(account, 'profession') || account.profession && Object.keys(account.profession).sort().join(',') === 'changedAt,name,works' && PROFESSIONS.includes(account.profession.name)
        && Number.isInteger(account.profession.works) && account.profession.works >= 0 && account.profession.works <= 1000 && typeof account.profession.changedAt === 'string' && Number.isFinite(Date.parse(account.profession.changedAt)))
      && ['lastDaily', 'lastWork'].every((key) => account[key] === null || (typeof account[key] === 'string' && Number.isFinite(Date.parse(account[key]))));
  }

  async #transaction(update) {
    const task = this.queue.then(async () => {
      const accounts = new Map(this.accounts);
      const result = update(accounts);
      if (result.claimed === false) return result;
      if (accounts.size > MAX_ACCOUNTS || [...accounts.values()].some((account) => !this.#valid(account))) throw new Error('Invalid economy account update.');
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      try {
        await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
        await fs.writeFile(tempPath, `${JSON.stringify({ version: 1, accounts: [...accounts.values()] }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await fs.rename(tempPath, this.filePath);
        this.accounts = accounts;
        return result;
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw error;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
}

module.exports = { EconomyStore, MAX_ACCOUNTS, MAX_BALANCE, DAILY_COOLDOWN_MS, WORK_COOLDOWN_MS };
