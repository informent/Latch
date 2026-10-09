'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class TicketStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.byChannel = new Map();
    this.userLocks = new Map();
    this.channelLocks = new Map();
    this.saveQueue = Promise.resolve();
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.tickets)) throw new Error('Ticket store has an unsupported format.');
      const channelIds = new Set();
      const activeOwners = new Set();
      const loadedTickets = new Map();
      for (const ticket of parsed.tickets) {
        const expectedKeys = ticket?.status === 'closed'
          ? ['channelId', 'ownerId', 'status', 'createdAt', 'closedAt']
          : ['channelId', 'ownerId', 'status', 'createdAt'];
        if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)
          || Object.keys(ticket).sort().join(',') !== expectedKeys.sort().join(',')
          || !/^\d{5,25}$/.test(ticket.channelId) || !/^\d{5,25}$/.test(ticket.ownerId)
          || !['open', 'closing', 'closed'].includes(ticket.status)
          || typeof ticket.createdAt !== 'string' || !Number.isFinite(Date.parse(ticket.createdAt))
          || (ticket.status === 'closed' && (typeof ticket.closedAt !== 'string' || !Number.isFinite(Date.parse(ticket.closedAt))))
          || channelIds.has(ticket.channelId)
          || (ticket.status !== 'closed' && activeOwners.has(ticket.ownerId))) {
          throw new Error('Ticket store contains invalid records; refusing to modify it.');
        }
        channelIds.add(ticket.channelId);
        if (ticket.status !== 'closed') activeOwners.add(ticket.ownerId);
        loadedTickets.set(ticket.channelId, Object.freeze({ ...ticket }));
      }
      this.byChannel = loadedTickets;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  getByChannel(channelId) { return this.byChannel.get(channelId) || null; }
  findActiveByOwner(ownerId) {
    return [...this.byChannel.values()].find((ticket) => ticket.ownerId === ownerId && ticket.status !== 'closed') || null;
  }

  async withUserLock(userId, operation) { return this.#withLock(this.userLocks, userId, operation); }
  async withChannelLock(channelId, operation) { return this.#withLock(this.channelLocks, channelId, operation); }

  async add(ticket) {
    if (this.byChannel.has(ticket.channelId)) throw new Error('Ticket channel already exists in the local store.');
    if (ticket.status !== 'closed' && this.findActiveByOwner(ticket.ownerId)) throw new Error('Owner already has an active ticket in the local store.');
    this.byChannel.set(ticket.channelId, Object.freeze({ ...ticket }));
    try { await this.#save(); }
    catch (error) {
      this.byChannel.delete(ticket.channelId);
      throw error;
    }
  }

  async markClosing(channelId) {
    const previous = this.byChannel.get(channelId);
    if (!previous || previous.status !== 'open') return previous || null;
    const updated = Object.freeze({ ...previous, status: 'closing' });
    this.byChannel.set(channelId, updated);
    try { await this.#save(); }
    catch (error) { this.byChannel.set(channelId, previous); throw error; }
    return updated;
  }

  async markClosed(channelId, closedAt) {
    const previous = this.byChannel.get(channelId);
    if (!previous) return null;
    if (previous.status === 'closed') return previous;
    const updated = Object.freeze({ ...previous, status: 'closed', closedAt });
    this.byChannel.set(channelId, updated);
    try { await this.#save(); }
    catch (error) { this.byChannel.set(channelId, previous); throw error; }
    return updated;
  }

  async #withLock(map, key, operation) {
    const previous = map.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    map.set(key, current);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (map.get(key) === current) map.delete(key);
    }
  }

  async #save() {
    const write = this.saveQueue.then(async () => {
      await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      const contents = JSON.stringify({ version: 1, tickets: [...this.byChannel.values()] }, null, 2) + '\n';
      try {
        await fs.writeFile(tempPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await fs.rename(tempPath, this.filePath);
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw error;
      }
    });
    this.saveQueue = write.catch(() => {});
    return write;
  }
}

module.exports = { TicketStore };
