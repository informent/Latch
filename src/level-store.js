'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const MAX_LEVEL_ACCOUNTS = 50_000, MAX_LEVEL_GUILDS = 1000, MAX_LEVEL_BYTES = 32 * 1024 * 1024;
const XP_COOLDOWN_MS = 60_000, XP_PER_MESSAGE = 15;
const id = (v) => typeof v === 'string' && /^\d{5,25}$/.test(v);
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === names.sort().join(',');
const stamp = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const freeze = (v) => Object.freeze({ ...v, ignoredChannels: Object.freeze([...v.ignoredChannels]) });
class LevelStore {
  constructor(filePath, { now = Date.now } = {}) {
    this.filePath = filePath; this.now = now; this.accounts = new Map(); this.settings = new Map(); this.queue = Promise.resolve();
  }
  async load() {
    try {
      if ((await fs.stat(this.filePath)).size > MAX_LEVEL_BYTES) throw new Error('Level store exceeds the size limit.');
      const raw = await fs.readFile(this.filePath, 'utf8');
      if (Buffer.byteLength(raw) > MAX_LEVEL_BYTES) throw new Error('Level store exceeds the size limit.');
      const p = JSON.parse(raw), v2 = p?.version === 2;
      if (!(p?.version === 1 || v2) || !keys(p, v2 ? ['version', 'accounts', 'settings'] : ['version', 'accounts'])
        || !Array.isArray(p.accounts) || p.accounts.length > MAX_LEVEL_ACCOUNTS || p.accounts.some((a) => !this.#valid(a))
        || v2 && (!Array.isArray(p.settings) || p.settings.length > MAX_LEVEL_GUILDS || p.settings.some((s) => !this.#validSettings(s)))) throw new Error('Level store contains invalid records; refusing to modify it.');
      const accounts = new Map(), settings = new Map();
      for (const a of p.accounts) {
        const key = this.#key(a.guildId, a.userId);
        if (accounts.has(key)) throw new Error('Level store contains duplicate accounts; refusing to modify it.');
        accounts.set(key, Object.freeze({ ...a }));
      }
      for (const s of p.settings || []) {
        if (settings.has(s.guildId)) throw new Error('Level store contains duplicate settings; refusing to modify it.');
        settings.set(s.guildId, freeze(s));
      }
      this.accounts = accounts; this.settings = settings;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  getSettings(guildId) {
    this.#ids(guildId);
    return this.settings.get(guildId) || freeze({ guildId, xp: XP_PER_MESSAGE, cooldownMs: XP_COOLDOWN_MS, enabled: true, ignoredChannels: [] });
  }
  async configure(guildId, action, values = {}) {
    this.#ids(guildId); const input = { ...values };
    return this.#transaction((accounts, settings) => {
      const current = settings.get(guildId) || this.getSettings(guildId);
      let next = { ...current, ignoredChannels: [...current.ignoredChannels] };
      if (action === 'reset') next = { guildId, xp: XP_PER_MESSAGE, cooldownMs: XP_COOLDOWN_MS, enabled: true, ignoredChannels: [] };
      else if (action === 'tune') { next.xp = input.xp; next.cooldownMs = input.cooldownMs; }
      else if (action === 'enable' || action === 'disable') next.enabled = action === 'enable';
      else if (action === 'ignore' || action === 'unignore') {
        this.#ids(input.channelId); next.ignoredChannels = next.ignoredChannels.filter((c) => c !== input.channelId);
        if (action === 'ignore') next.ignoredChannels.push(input.channelId);
      } else throw new Error('Unknown level configuration action.');
      if (!this.#validSettings(next)) throw new Error('Invalid leveling settings or ignored-channel limit reached.');
      if (!settings.has(guildId) && settings.size >= MAX_LEVEL_GUILDS) throw new Error('Level guild limit reached.');
      next = freeze(next); settings.set(guildId, next); return { result: next, changed: true };
    });
  }
  get(guildId, userId) {
    this.#ids(guildId, userId);
    return this.#view(this.accounts.get(this.#key(guildId, userId)) || { guildId, userId, xp: 0, lastAward: null });
  }
  leaderboard(guildId, limit = 10) {
    this.#ids(guildId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid leaderboard limit.');
    return [...this.accounts.values()].filter((a) => a.guildId === guildId && a.xp > 0).sort((a, b) => b.xp - a.xp || a.userId.localeCompare(b.userId)).slice(0, limit).map((a) => this.#view(a));
  }
  async awardMessage(guildId, userId, { channelId, messageId } = {}) {
    this.#ids(guildId, userId);
    if (channelId !== undefined) this.#ids(channelId);
    if (messageId !== undefined) this.#ids(messageId);
    return this.#transaction((accounts, settings) => {
      const key = this.#key(guildId, userId), existing = accounts.get(key) || { guildId, userId, xp: 0, lastAward: null };
      const setting = settings.get(guildId) || this.getSettings(guildId), currentTime = this.now();
      if (!Number.isSafeInteger(currentTime) || !Number.isFinite(new Date(currentTime).getTime())) throw new Error('Invalid level clock.');
      if (!setting.enabled || setting.ignoredChannels.includes(channelId) || messageId && existing.lastMessageId === messageId
        || existing.lastAward !== null && currentTime - Date.parse(existing.lastAward) < setting.cooldownMs) return { result: { awarded: false, ...this.#view(existing) }, changed: false };
      if (!accounts.has(key) && accounts.size >= MAX_LEVEL_ACCOUNTS) throw new Error('Level account limit reached.');
      if (existing.xp > Number.MAX_SAFE_INTEGER - setting.xp) throw new Error('XP limit reached.');
      const updated = Object.freeze({ guildId, userId, xp: existing.xp + setting.xp, lastAward: new Date(currentTime).toISOString(), ...(messageId ? { lastMessageId: messageId } : {}) });
      accounts.set(key, updated);
      return { result: { awarded: true, gained: setting.xp, leveledUp: this.levelFor(updated.xp) > this.levelFor(existing.xp), ...this.#view(updated) }, changed: true };
    });
  }
  levelFor(xp) { return Math.floor(Math.sqrt(xp / 100)); }
  xpForLevel(level) { return level * level * 100; }
  #key(g, u) { return `${g}:${u}`; }
  #ids(...values) { if (values.some((v) => !id(v))) throw new Error('Invalid Discord ID.'); }
  #view(a) { return Object.freeze({ ...a, level: this.levelFor(a.xp), xpToNextLevel: this.xpForLevel(this.levelFor(a.xp) + 1) - a.xp }); }
  #valid(a) {
    return keys(a, ['guildId', 'lastAward', 'userId', 'xp', ...(a?.lastMessageId !== undefined ? ['lastMessageId'] : [])]) && id(a.guildId) && id(a.userId)
      && Number.isSafeInteger(a.xp) && a.xp >= 0 && (a.lastAward === null || stamp(a.lastAward)) && (a.lastMessageId === undefined || id(a.lastMessageId) && a.lastAward !== null);
  }
  #validSettings(s) {
    return keys(s, ['guildId', 'xp', 'cooldownMs', 'enabled', 'ignoredChannels']) && id(s.guildId) && Number.isSafeInteger(s.xp) && s.xp >= 1 && s.xp <= 100
      && Number.isSafeInteger(s.cooldownMs) && s.cooldownMs >= 15_000 && s.cooldownMs <= 3_600_000 && typeof s.enabled === 'boolean'
      && Array.isArray(s.ignoredChannels) && s.ignoredChannels.length <= 100 && s.ignoredChannels.every(id) && new Set(s.ignoredChannels).size === s.ignoredChannels.length;
  }
  async #transaction(update) {
    const task = this.queue.then(async () => {
      const accounts = new Map(this.accounts), settings = new Map(this.settings);
      const { result, changed } = update(accounts, settings); if (!changed) return result;
      const raw = `${JSON.stringify({ version: 2, accounts: [...accounts.values()], settings: [...settings.values()] }, null, 2)}\n`;
      if (Buffer.byteLength(raw) > MAX_LEVEL_BYTES) throw new Error('Level store exceeds the size limit.');
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      try {
        await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
        await fs.writeFile(tempPath, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await fs.rename(tempPath, this.filePath); this.accounts = accounts; this.settings = settings; return result;
      } catch (error) { await fs.rm(tempPath, { force: true }).catch(() => {}); throw error; }
    });
    this.queue = task.catch(() => {}); return task;
  }
}
module.exports = { LevelStore, MAX_LEVEL_ACCOUNTS, MAX_LEVEL_GUILDS, MAX_LEVEL_BYTES, XP_COOLDOWN_MS, XP_PER_MESSAGE };
