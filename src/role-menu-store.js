'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ID = /^\d{5,25}$/;
const MAX_MENUS = 20;
const MAX_ROLES = 10;
const MAX_AUTOROLES = 5;

class RoleMenuStore {
  constructor(filePath, guildId = null) {
    this.filePath = filePath; this.guildId = guildId;
    this.state = { version: 1, guildId, menus: [], autoroles: [] };
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      if ((await fs.stat(this.filePath)).size > 1024 * 1024) throw new Error();
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!this.#valid(parsed) || this.guildId && parsed.guildId !== this.guildId) throw new Error();
      this.state = parsed;
    } catch (error) { if (error.code === 'ENOENT') return; throw new Error('Role menu store is unreadable or invalid; refusing to modify it.'); }
  }

  get() { return structuredClone(this.state); }
  menu(id) { return this.get().menus.find((menu) => menu.id === id) || null; }

  create({ id, channelId, title }) {
    return this.#mutate((state) => {
      if (state.menus.some((menu) => menu.id === id)) return;
      if (state.menus.length >= MAX_MENUS) throw new Error('Role menu limit reached.');
      state.menus.push({ id, channelId, title, roles: [], messageId: null, state: 'draft', pending: false, attempts: 0, retryAt: null });
    }).then(() => this.menu(id));
  }

  change(id, action, { roleId, label } = {}) {
    return this.#mutate((state) => {
      const menu = state.menus.find((item) => item.id === id);
      if (!menu || menu.state === 'deleting') throw new Error('Role menu unavailable.');
      if (action === 'add') {
        if (menu.roles.length >= MAX_ROLES || menu.roles.some((role) => role.id === roleId)) throw new Error('Duplicate role or menu role limit reached.');
        menu.roles.push({ id: roleId, label });
      } else if (action === 'remove') {
        if (!menu.roles.some((role) => role.id === roleId)) throw new Error('Role not in this menu.');
        menu.roles = menu.roles.filter((role) => role.id !== roleId);
        if (!menu.roles.length && menu.state === 'enabled') menu.state = 'disabled';
      } else if (action === 'publish') {
        if (!menu.roles.length) throw new Error('Add at least one role first.');
        menu.state = 'enabled';
      } else if (action === 'disable') menu.state = 'disabled';
      else if (action === 'delete') menu.state = 'deleting';
      else throw new Error('Unknown role menu action.');
      menu.pending = Boolean(menu.messageId || menu.state === 'enabled' || menu.state === 'deleting');
      menu.retryAt = null; menu.attempts = 0;
    }).then(() => this.menu(id));
  }

  delivered(id, messageId) {
    return this.#mutate((state) => {
      const menu = state.menus.find((item) => item.id === id);
      if (!menu) throw new Error('Role menu unavailable.');
      if (menu.state === 'deleting') state.menus = state.menus.filter((item) => item.id !== id);
      else { menu.messageId = messageId; menu.pending = false; menu.retryAt = null; menu.attempts = 0; }
    });
  }

  retry(id, now = Date.now()) {
    return this.#mutate((state) => {
      const menu = state.menus.find((item) => item.id === id);
      if (!menu || !menu.pending) return;
      menu.attempts = Math.min(menu.attempts + 1, 1000000);
      menu.retryAt = new Date(now + Math.min(900000, 15000 * 2 ** Math.min(menu.attempts - 1, 6))).toISOString();
    });
  }

  autorole(roleId, remove = false) {
    return this.#mutate((state) => {
      if (remove) state.autoroles = state.autoroles.filter((id) => id !== roleId);
      else if (!state.autoroles.includes(roleId)) {
        if (state.autoroles.length >= MAX_AUTOROLES) throw new Error('Autorole limit reached.');
        state.autoroles.push(roleId);
      }
    });
  }

  #valid(state) {
    if (!state || Object.keys(state).sort().join(',') !== 'autoroles,guildId,menus,version' || state.version !== 1 || typeof state.guildId !== 'string' || !ID.test(state.guildId)
      || !Array.isArray(state.autoroles) || state.autoroles.length > MAX_AUTOROLES || state.autoroles.some((id) => typeof id !== 'string' || !ID.test(id) || id === state.guildId) || new Set(state.autoroles).size !== state.autoroles.length
      || !Array.isArray(state.menus) || state.menus.length > MAX_MENUS) return false;
    const ids = new Set();
    for (const menu of state.menus) {
      if (!menu || Object.keys(menu).sort().join(',') !== 'attempts,channelId,id,messageId,pending,retryAt,roles,state,title'
        || ![menu.id, menu.channelId].every((id) => typeof id === 'string' && ID.test(id)) || ids.has(menu.id)
        || typeof menu.title !== 'string' || !menu.title.trim() || menu.title.length > 200
        || !['draft', 'enabled', 'disabled', 'deleting'].includes(menu.state) || typeof menu.pending !== 'boolean'
        || !(menu.messageId === null || typeof menu.messageId === 'string' && ID.test(menu.messageId))
        || !(menu.retryAt === null || typeof menu.retryAt === 'string' && Number.isFinite(Date.parse(menu.retryAt)))
        || !Number.isInteger(menu.attempts) || menu.attempts < 0 || menu.attempts > 1000000
        || (!menu.pending && (menu.attempts || menu.retryAt !== null))
        || (menu.state === 'enabled' && menu.messageId === null && !menu.pending)
        || menu.state === 'deleting' && !menu.pending
        || !Array.isArray(menu.roles) || menu.roles.length > MAX_ROLES || menu.state === 'enabled' && !menu.roles.length
        || menu.roles.some((role) => !role || Object.keys(role).sort().join(',') !== 'id,label' || typeof role.id !== 'string' || !ID.test(role.id) || role.id === state.guildId || typeof role.label !== 'string' || !role.label.trim() || role.label.length > 60)
        || new Set(menu.roles.map((role) => role.id)).size !== menu.roles.length) return false;
      ids.add(menu.id);
    }
    return true;
  }

  #mutate(update) {
    const task = this.queue.then(async () => {
      const state = this.get(); update(state);
      if (!this.#valid(state)) throw new Error('Invalid role menu store update.');
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
        await fs.writeFile(temporary, `${JSON.stringify(state)}\n`, { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, this.filePath); this.state = state;
      } catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
    });
    this.queue = task.catch(() => {}); return task;
  }
}

module.exports = { RoleMenuStore, MAX_MENUS, MAX_ROLES, MAX_AUTOROLES };
