'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  { randomUUID } = require('node:crypto');
const ID = (value) => typeof value === 'string' && /^\d{5,25}$/.test(value);
class StarboardStore {
  constructor(filePath, guildId) {
    this.filePath = filePath;
    this.guildId = guildId;
    this.state = { version: 2, guildId, settings: null, entries: [] };
    this.queue = Promise.resolve();
  }
  valid(s) {
    const c = s?.settings;
    return (
      s &&
      Object.keys(s).sort().join(',') === 'entries,guildId,settings,version' &&
      [1, 2].includes(s.version) &&
      s.guildId === this.guildId &&
      ID(s.guildId) &&
      (c === null ||
        (Object.keys(c).sort().join(',') ===
          'destination,enabled,sources,threshold' &&
          ID(c.destination) &&
          typeof c.enabled === 'boolean' &&
          Number.isInteger(c.threshold) &&
          c.threshold >= 2 &&
          c.threshold <= 50 &&
          Array.isArray(c.sources) &&
          c.sources.length >= (s.version === 1 ? 1 : 0) &&
          (!c.enabled || c.sources.length > 0) &&
          c.sources.length <= 20 &&
          c.sources.every(ID) &&
          !c.sources.includes(c.destination) &&
          new Set(c.sources).size === c.sources.length)) &&
      Array.isArray(s.entries) &&
      s.entries.length <= 500 &&
      (!s.entries.length || c !== null) &&
      s.entries.every(
        (e) =>
          e &&
          Object.keys(e).sort().join(',') ===
            'author,channel,count,id,nonce,post,status' &&
          [e.id, e.channel, e.author].every(ID) &&
          (s.version === 2 || c.sources.includes(e.channel)) &&
          typeof e.nonce === 'string' &&
          /^[a-f0-9]{24}$/.test(e.nonce) &&
          Number.isInteger(e.count) &&
          e.count >= 0 &&
          e.count <= 1000 &&
          (s.version === 1
            ? ['pending', 'posted', 'deleted']
            : ['pending', 'posted', 'deleting', 'deleted']
          ).includes(e.status) &&
          (['posted', 'deleting'].includes(e.status)
            ? ID(e.post)
            : e.post === null),
      ) &&
      new Set(s.entries.map((e) => e.id)).size === s.entries.length &&
      new Set(s.entries.map((e) => e.nonce)).size === s.entries.length &&
      new Set(
        s.entries
          .filter((e) => ['posted', 'deleting'].includes(e.status))
          .map((e) => e.post),
      ).size ===
        s.entries.filter((e) => ['posted', 'deleting'].includes(e.status))
          .length
    );
  }
  async load() {
    try {
      if ((await fs.stat(this.filePath)).size > 1024 * 1024) throw new Error();
      const s = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!this.valid(s)) throw new Error();
      this.state = s;
    } catch (e) {
      if (e.code !== 'ENOENT')
        throw new Error('Starboard store is invalid or unreadable.');
    }
  }
  snapshot() {
    return structuredClone(this.state);
  }
  mutate(work) {
    const task = this.queue.then(async () => {
      const s = this.snapshot();
      s.version = 2;
      work(s);
      if (!this.valid(s))
        throw new Error('Invalid starboard state or capacity reached.');
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(s) + '\n', {
          flag: 'wx',
          mode: 0o600,
        });
        await fs.rename(temporary, this.filePath);
        this.state = s;
      } finally {
        await fs.unlink(temporary).catch(() => {});
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
module.exports = { StarboardStore, ID };
