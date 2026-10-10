'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
function validItem(item) {
  return item && Object.keys(item).sort().join(',') === 'color,description,name,title'
    && typeof item.name === 'string' && NAME.test(item.name)
    && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 256
    && typeof item.description === 'string' && item.description.trim().length > 0 && item.description.length <= 4000
    && Number.isInteger(item.color) && item.color >= 0 && item.color <= 0xffffff;
}
class TemplateStore {
  constructor(filePath, guildId) {
    this.filePath = filePath; this.guildId = guildId;
    this.state = { version: 1, guildId, templates: [] }; this.queue = Promise.resolve();
  }
  async load() {
    try {
      if ((await fs.stat(this.filePath)).size > 1024 * 1024) throw new Error();
      const state = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!this.valid(state)) throw new Error();
      this.state = state;
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('Template store is invalid or unreadable; refusing to modify it.'); }
  }
  valid(state) {
    return state && Object.keys(state).sort().join(',') === 'guildId,templates,version'
      && state.version === 1 && state.guildId === this.guildId && /^\d{5,25}$/.test(state.guildId)
      && Array.isArray(state.templates) && state.templates.length <= 50 && state.templates.every(validItem)
      && new Set(state.templates.map((item) => item.name)).size === state.templates.length;
  }
  list() { return structuredClone(this.state.templates); }
  get(name) { return this.list().find((item) => item.name === name) || null; }
  change(action, item) {
    const operation = this.queue.then(async () => {
      const state = structuredClone(this.state);
      const index = state.templates.findIndex((entry) => entry.name === item.name);
      if (action === 'create') {
        if (index >= 0) throw new Error('That template already exists. Use update.');
        state.templates.push(item);
      } else if (action === 'update') {
        if (index < 0) throw new Error('Unknown template.');
        state.templates[index] = item;
      } else if (action === 'delete') {
        if (index < 0) throw new Error('Unknown template.');
        state.templates.splice(index, 1);
      } else throw new Error('Unknown template action.');
      if (!this.valid(state)) throw new Error('Use a valid template name, nonempty title/body, six-digit color and at most 50 templates.');
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, this.filePath);
        this.state = state;
      } finally { await fs.unlink(temporary).catch(() => {}); }
    });
    this.queue = operation.catch(() => {}); return operation;
  }
}
module.exports = { TemplateStore };
