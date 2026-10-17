'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_WARNINGS = 5000;
const MAX_STRIKES = 10000;
const ID = /^\d{5,25}$/;
const CASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

class ModerationStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.warnings = [];
    this.strikes = [];
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      const legacy = parsed.version === 1 && Array.isArray(parsed.warnings);
      if ((!legacy && (parsed.version !== 2 || !Array.isArray(parsed.strikes)))
        || Object.keys(parsed).sort().join(',') !== (legacy ? 'version,warnings' : 'strikes,version,warnings')
        || !Array.isArray(parsed.warnings) || parsed.warnings.length > MAX_WARNINGS
        || parsed.warnings.some((warning) => !this.#validWarning(warning))
        || (!legacy && (parsed.strikes.length > MAX_STRIKES || parsed.strikes.some((strike) => !this.#validStrike(strike))
          || new Set(parsed.strikes.map((strike) => strike.id)).size !== parsed.strikes.length))) {
        throw new Error('Moderation store contains invalid records; refusing to modify it.');
      }
      this.warnings = parsed.warnings.map((warning) => Object.freeze({ ...warning }));
      this.strikes = legacy ? [] : parsed.strikes.map((strike) => Object.freeze({ ...strike }));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  listWarnings(guildId, userId) {
    return this.warnings.filter((warning) => warning.guildId === guildId && warning.userId === userId);
  }

  getWarning(guildId, warningId) {
    return this.warnings.find((warning) => warning.guildId === guildId && warning.id === warningId) || null;
  }

  listStrikes(guildId, userId, { includeInactive = false, now = Date.now() } = {}) {
    const currentTime = now instanceof Date ? now.getTime() : Number(now);
    if (!Number.isFinite(currentTime)) throw new Error('Strike listing requires a valid current time.');
    return this.strikes.filter((strike) => strike.guildId === guildId && strike.userId === userId
      && (includeInactive || (!strike.removedAt && (!strike.expiresAt || Date.parse(strike.expiresAt) > currentTime))));
  }

  async addWarning(warning) {
    return this.#transaction(() => {
      if (!this.#validWarning(warning)) throw new Error('Invalid warning record.');
      if (this.warnings.length >= MAX_WARNINGS) throw new Error('Warning store is full; clear old records before adding more.');
      this.warnings = [...this.warnings, Object.freeze({ ...warning })];
      return warning;
    });
  }

  async clearWarnings(guildId, userId) {
    return this.#transaction(() => {
      const previous = this.warnings;
      this.warnings = previous.filter((warning) => warning.guildId !== guildId || warning.userId !== userId);
      return previous.length - this.warnings.length;
    });
  }

  async removeWarning(guildId, warningId) {
    return this.#transaction(() => {
      const index = this.warnings.findIndex((warning) => warning.guildId === guildId && warning.id === warningId);
      if (index < 0) return null;
      const [removed] = this.warnings.splice(index, 1);
      return removed;
    });
  }

  async addStrike(strike) {
    return this.#transaction(() => {
      if (!this.#validStrike(strike) || this.strikes.some((existing) => existing.id === strike.id)) throw new Error('Invalid or duplicate strike record.');
      if (this.strikes.length >= MAX_STRIKES) throw new Error('Strike store is full. Back up and archive old history according to your retention policy before adding more.');
      this.strikes = [...this.strikes, Object.freeze({ ...strike })];
      return strike;
    });
  }

  async removeStrike(guildId, userId, strikeId, { actorId, removedAt, reason }) {
    return this.#transaction(() => {
      if (!ID.test(guildId || '') || !ID.test(userId || '') || !CASE_ID.test(strikeId || '') || !ID.test(actorId || '')
        || !validDate(removedAt) || typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
        throw new Error('Invalid strike removal details.');
      }
      const index = this.strikes.findIndex((strike) => strike.id === strikeId && strike.guildId === guildId && strike.userId === userId
        && !strike.removedAt && (!strike.expiresAt || Date.parse(strike.expiresAt) > Date.parse(removedAt)));
      if (index < 0) return null;
      const updated = Object.freeze({ ...this.strikes[index], removedAt, removedBy: actorId, removalReason: reason });
      if (!this.#validStrike(updated)) throw new Error('Invalid strike removal details.');
      this.strikes = this.strikes.map((strike, position) => position === index ? updated : strike);
      return updated;
    });
  }

  async clearStrikes(guildId, userId, { actorId, removedAt, reason }) {
    return this.#transaction(() => {
      const now = Date.parse(removedAt);
      if (!ID.test(guildId || '') || !ID.test(userId || '') || !ID.test(actorId || '') || !validDate(removedAt) || typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
        throw new Error('Invalid strike removal details.');
      }
      let removed = 0;
      this.strikes = this.strikes.map((strike) => {
        if (strike.guildId !== guildId || strike.userId !== userId || strike.removedAt || (strike.expiresAt && Date.parse(strike.expiresAt) <= now)) return strike;
        removed += 1;
        return Object.freeze({ ...strike, removedAt, removedBy: actorId, removalReason: reason.trim() });
      });
      return removed;
    });
  }

  #validWarning(warning) {
    return warning && typeof warning === 'object' && !Array.isArray(warning)
      && Object.keys(warning).sort().join(',') === ['actorId', 'createdAt', 'guildId', 'id', 'reason', 'userId'].sort().join(',')
      && ['guildId', 'userId', 'actorId'].every((key) => ID.test(warning[key]))
      && CASE_ID.test(warning.id)
      && typeof warning.reason === 'string' && warning.reason.length >= 1 && warning.reason.length <= 500
      && validDate(warning.createdAt);
  }

  #validStrike(strike) {
    if (!strike || typeof strike !== 'object' || Array.isArray(strike)
      || Object.keys(strike).sort().join(',') !== ['actorId', 'createdAt', 'expiresAt', 'guildId', 'id', 'reason', 'removedAt', 'removedBy', 'removalReason', 'userId'].sort().join(',')) return false;
    const removalIsEmpty = strike.removedAt === null && strike.removedBy === null && strike.removalReason === null;
    const creationTime = Date.parse(strike.createdAt);
    const removalIsComplete = validDate(strike.removedAt) && Date.parse(strike.removedAt) >= creationTime && ID.test(strike.removedBy || '')
      && typeof strike.removalReason === 'string' && strike.removalReason.trim().length >= 1 && strike.removalReason.length <= 500;
    return ['guildId', 'userId', 'actorId'].every((key) => ID.test(strike[key]))
      && CASE_ID.test(strike.id) && typeof strike.reason === 'string' && strike.reason.trim().length >= 1 && strike.reason.length <= 500
      && validDate(strike.createdAt) && (strike.expiresAt === null || (validDate(strike.expiresAt) && Date.parse(strike.expiresAt) > creationTime))
      && (removalIsEmpty || removalIsComplete);
  }

  async #transaction(update) {
    const write = this.queue.then(async () => {
      const previousWarnings = this.warnings;
      const previousStrikes = this.strikes;
      const result = update();
      if (result === 0 || result === null) return result;
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      try {
        await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
        await fs.writeFile(tempPath, `${JSON.stringify({ version: 2, warnings: this.warnings, strikes: this.strikes }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await fs.rename(tempPath, this.filePath);
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        this.warnings = previousWarnings;
        this.strikes = previousStrikes;
        throw error;
      }
      return result;
    });
    this.queue = write.catch(() => {});
    return write;
  }
}

module.exports = { ModerationStore, MAX_WARNINGS, MAX_STRIKES };
