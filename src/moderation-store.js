'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_WARNINGS = 5000;

class ModerationStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.warnings = [];
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.warnings) || parsed.warnings.length > MAX_WARNINGS
        || parsed.warnings.some((warning) => !this.#valid(warning))) {
        throw new Error('Moderation store contains invalid records; refusing to modify it.');
      }
      this.warnings = parsed.warnings.map((warning) => Object.freeze({ ...warning }));
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

  async removeWarning(guildId, warningId) {
    return this.#transaction(() => {
      const previous = this.warnings;
      const warning = previous.find((item) => item.guildId === guildId && item.id === warningId);
      if (!warning) return null;
      this.warnings = previous.filter((item) => item !== warning);
      return warning;
    });
  }

  async addWarning(warning) {
    return this.#transaction(() => {
      if (!this.#valid(warning)) throw new Error('Invalid warning record.');
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

  #valid(warning) {
    return warning && typeof warning === 'object' && !Array.isArray(warning)
      && Object.keys(warning).sort().join(',') === ['actorId', 'createdAt', 'guildId', 'id', 'reason', 'userId'].sort().join(',')
      && ['guildId', 'userId', 'actorId'].every((key) => /^\d{5,25}$/.test(warning[key]))
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(warning.id)
      && typeof warning.reason === 'string' && warning.reason.length >= 1 && warning.reason.length <= 500
      && typeof warning.createdAt === 'string' && Number.isFinite(Date.parse(warning.createdAt));
  }

  async #transaction(update) {
    const write = this.queue.then(async () => {
      const previous = this.warnings;
      const result = update();
      if (result === 0) return result;
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      try {
        await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
        await fs.writeFile(tempPath, `${JSON.stringify({ version: 1, warnings: this.warnings }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await fs.rename(tempPath, this.filePath);
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        this.warnings = previous;
        throw error;
      }
      return result;
    });
    this.queue = write.catch(() => {});
    return write;
  }
}

module.exports = { ModerationStore, MAX_WARNINGS };
