'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const MAX_TICKETS = 50000;
const MAX_GUESTS = 20;
const freezeTicket = ticket => Object.freeze({ ...ticket, ...(ticket.guests ? { guests: Object.freeze([...ticket.guests]) } : {}) });
const MAX_BYTES = 32 * 1024 * 1024;
function validTicket(ticket) {
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) return false;
  const keys = ['channelId', 'ownerId', 'status', 'createdAt', ...(['closed', 'reopening'].includes(ticket.status) ? ['closedAt'] : []), ...['claimedBy', 'reason', 'guests'].filter((key) => Object.hasOwn(ticket, key))];
  return Object.keys(ticket).sort().join(',') === keys.sort().join(',')
    && [ticket.channelId, ticket.ownerId].every((id) => typeof id === 'string' && /^\d{5,25}$/.test(id))
    && ['open', 'closing', 'closed', 'reopening'].includes(ticket.status)
    && typeof ticket.createdAt === 'string' && Number.isFinite(Date.parse(ticket.createdAt))
    && (!['closed', 'reopening'].includes(ticket.status) || typeof ticket.closedAt === 'string' && Number.isFinite(Date.parse(ticket.closedAt)))
    && (!Object.hasOwn(ticket, 'claimedBy') || typeof ticket.claimedBy === 'string' && /^\d{5,25}$/.test(ticket.claimedBy) && ticket.claimedBy !== ticket.ownerId)
    && (!Object.hasOwn(ticket, 'reason') || typeof ticket.reason === 'string' && ticket.reason.trim().length > 0 && ticket.reason.length <= 400)
    && (!Object.hasOwn(ticket, 'guests') || Array.isArray(ticket.guests) && ticket.guests.length <= MAX_GUESTS && new Set(ticket.guests).size === ticket.guests.length && ticket.guests.every(id => typeof id === 'string' && /^\d{5,25}$/.test(id) && id !== ticket.ownerId) && (ticket.status !== 'closed' || ticket.guests.length === 0));
}

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
      if ((await fs.stat(this.filePath)).size > MAX_BYTES) throw new Error('Ticket store exceeds its size limit.');
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!parsed || Object.keys(parsed).sort().join(',') !== 'tickets,version' || ![1, 2].includes(parsed.version) || !Array.isArray(parsed.tickets) || parsed.tickets.length > MAX_TICKETS) throw new Error('Ticket store has an unsupported format.');
      const channelIds = new Set();
      const activeOwners = new Set();
      const loadedTickets = new Map();
      for (const ticket of parsed.tickets) {
        if (!validTicket(ticket) || parsed.version === 1 && Object.hasOwn(ticket, 'guests') || channelIds.has(ticket.channelId)
          || (ticket.status !== 'closed' && activeOwners.has(ticket.ownerId))) {
          throw new Error('Ticket store contains invalid records; refusing to modify it.');
        }
        channelIds.add(ticket.channelId);
        if (ticket.status !== 'closed') activeOwners.add(ticket.ownerId);
        loadedTickets.set(ticket.channelId, freezeTicket(ticket));
      }
      this.byChannel = loadedTickets;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  getByChannel(channelId) { return this.byChannel.get(channelId) || null; }
  list() { return [...this.byChannel.values()].map((ticket) => ({ ...ticket, ...(ticket.guests ? { guests: [...ticket.guests] } : {}) })); }

  async setClaim(channelId, userId) {
    if (userId !== null && (typeof userId !== 'string' || !/^\d{5,25}$/.test(userId))) throw new Error('Invalid ticket claimer.');
    return this.#transaction((next) => {
      const previous = next.get(channelId);
      if (!previous || previous.status !== 'open' || userId === previous.ownerId) throw new Error('Ticket cannot be claimed.');
      const updated = { ...previous };
      if (userId === null) delete updated.claimedBy;
      else updated.claimedBy = userId;
      next.set(channelId, freezeTicket(updated));
      return next.get(channelId);
    });
  }
  findActiveByOwner(ownerId) {
    return [...this.byChannel.values()].find((ticket) => ticket.ownerId === ownerId && ticket.status !== 'closed') || null;
  }

  async setReason(channelId, reason) {
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 400) throw new Error('Invalid ticket reason.');
    return this.#transaction((next) => {
      const previous = next.get(channelId);
      if (!previous || previous.status !== 'open') throw new Error('Choose an open ticket.');
      next.set(channelId, freezeTicket({ ...previous, reason: reason.trim() }));
      return next.get(channelId);
    });
  }

  setGuest(channelId, userId, present) {
    if (typeof userId !== 'string' || !/^\d{5,25}$/.test(userId) || typeof present !== 'boolean') throw new Error('Invalid ticket guest.');
    return this.#transaction(next => {
      const ticket = next.get(channelId);
      if (!ticket || ticket.status !== 'open' || userId === ticket.ownerId) throw new Error('Choose an open ticket and a different member.');
      const guests = (ticket.guests || []).filter(id => id !== userId);
      if (present) guests.push(userId);
      if (guests.length > MAX_GUESTS) throw new Error('Ticket guest limit reached.');
      next.set(channelId, freezeTicket({ ...ticket, guests }));
    });
  }

  async withUserLock(userId, operation) { return this.#withLock(this.userLocks, userId, operation); }
  async withChannelLock(channelId, operation) { return this.#withLock(this.channelLocks, channelId, operation); }

  async add(ticket) {
    const input = freezeTicket(ticket);
    return this.#transaction((next) => {
      if (next.has(input.channelId)) throw new Error('Ticket channel already exists in the local store.');
      if (input.status !== 'closed' && [...next.values()].some((record) => record.ownerId === input.ownerId && record.status !== 'closed')) throw new Error('Owner already has an active ticket in the local store.');
      next.set(input.channelId, input);
    });
  }

  async markClosing(channelId) {
    return this.#transaction((next) => {
      const previous = next.get(channelId);
      if (!previous || previous.status !== 'open') return previous || null;
      const updated = freezeTicket({ ...previous, status: 'closing' });
      next.set(channelId, updated);
      return updated;
    });
  }

  async markClosed(channelId, closedAt) {
    return this.#transaction((next) => {
      const previous = next.get(channelId);
      if (!previous) return null;
      if (previous.status === 'closed') return previous;
      const updated = freezeTicket({ ...previous, status: 'closed', closedAt, ...(previous.guests ? { guests: [] } : {}) });
      next.set(channelId, updated);
      return updated;
    });
  }

  markReopening(channelId) {
    return this.#transaction((next) => {
      const ticket = next.get(channelId);
      if (!ticket || !['closed', 'reopening'].includes(ticket.status)) throw new Error('Choose a closed ticket.');
      next.set(channelId, Object.freeze({ ...ticket, status: 'reopening' }));
    });
  }
  markReopened(channelId) {
    return this.#transaction((next) => {
      const ticket = next.get(channelId);
      if (!ticket || ticket.status !== 'reopening') throw new Error('Ticket is not reopening.');
      const updated = { ...ticket, status: 'open' }; delete updated.closedAt; delete updated.claimedBy;
      next.set(channelId, freezeTicket(updated));
    });
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

  async #transaction(update) {
    const write = this.saveQueue.then(async () => {
      const next = new Map(this.byChannel);
      const result = update(next);
      const active = [...next.values()].filter((ticket) => ticket.status !== 'closed');
      if (next.size > MAX_TICKETS || [...next.values()].some((ticket) => !validTicket(ticket)) || new Set(active.map((ticket) => ticket.ownerId)).size !== active.length) throw new Error('Invalid ticket store update.');
      await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      const contents = JSON.stringify({ version: 2, tickets: [...next.values()] }, null, 2) + '\n';
      if (Buffer.byteLength(contents) > MAX_BYTES) throw new Error('Ticket store exceeds its size limit.');
      try {
        await fs.writeFile(tempPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await fs.rename(tempPath, this.filePath);
        this.byChannel = next;
        return result;
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw error;
      }
    });
    this.saveQueue = write.catch(() => {});
    return write;
  }
}

module.exports = { TicketStore, MAX_GUESTS };
