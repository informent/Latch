'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const MAX_JOBS = 5000;
const MAX_ENTRANTS = 10_000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ID = /^\d{5,25}$/;
const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const keys = 'attempts,channelId,createdAt,deliveredAt,dueAt,entrants,guildId,id,kind,messageId,retryAt,state,text,userId,winnerCount,winners';

class CommunityStore {
  constructor(filePath, { pick = randomInt } = {}) {
    this.filePath = filePath;
    this.jobs = new Map();
    this.queue = Promise.resolve();
    this.pick = pick;
  }

  async load() {
    try {
      const stat = await fs.stat(this.filePath);
      if (stat.size > 32 * 1024 * 1024) throw new Error('Community store exceeds the size limit.');
      let parsed;
      const content = await fs.readFile(this.filePath, 'utf8');
      try { parsed = JSON.parse(content); }
      catch { throw new Error('Community store is not valid JSON; refusing to modify it.'); }
      if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).sort().join(',') !== 'jobs,version' || parsed.version !== 1 || !Array.isArray(parsed.jobs) || parsed.jobs.length > MAX_JOBS) throw new Error('Community store contains invalid records.');
      const records = new Map();
      for (const record of parsed.jobs) {
        if (!this.#valid(record) || records.has(record.id)) throw new Error('Community store contains invalid or duplicate records; refusing to modify it.');
        records.set(record.id, record);
      }
      this.jobs = records;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  get(id) { const record = this.jobs.get(id); return record ? structuredClone(record) : null; }
  list(guildId, { kind, userId, active = true } = {}) {
    return [...this.jobs.values()].filter((job) => job.guildId === guildId && (!kind || job.kind === kind) && (!userId || job.userId === userId) && (!active || !job.deliveredAt))
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)).map((job) => structuredClone(job));
  }

  prune(now = new Date()) {
    return this.#mutate(() => {
      let removed = 0;
      for (const [id, job] of this.jobs) if (job.deliveredAt && now.getTime() - Date.parse(job.deliveredAt) > RETENTION_MS) { this.jobs.delete(id); removed++; }
      return { changed: removed > 0, value: removed };
    });
  }

  async create({ id, kind, guildId, channelId, userId, text, minutes, winnerCount = 1 }, now = new Date()) {
    if (![id, guildId, channelId, userId].every((value) => typeof value === 'string' && ID.test(value)) || !['reminder', 'giveaway'].includes(kind)
      || typeof text !== 'string' || !text.trim() || text.length > (kind === 'reminder' ? 500 : 200)
      || !Number.isInteger(minutes) || minutes < 1 || minutes > 43_200
      || !Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 20 || !Number.isFinite(now.getTime())) throw new Error('Invalid community job.');
    return this.#mutate(() => {
      const existing = this.jobs.get(id);
      if (existing) {
        if (existing.guildId !== guildId || existing.userId !== userId || existing.kind !== kind) throw new Error('Job ID conflict.');
        return { changed: false, value: structuredClone(existing) };
      }
      for (const [key, job] of this.jobs) if (job.deliveredAt && now.getTime() - Date.parse(job.deliveredAt) > RETENTION_MS) this.jobs.delete(key);
      if (this.jobs.size >= MAX_JOBS) throw new Error('Community job limit reached.');
      const active = this.list(guildId, { kind, ...(kind === 'reminder' ? { userId } : {}) });
      if (active.length >= (kind === 'reminder' ? 10 : 20)) throw new Error('Active job limit reached.');
      const job = { id, kind, guildId, channelId, userId, text: text.trim(), createdAt: now.toISOString(), dueAt: new Date(now.getTime() + minutes * 60_000).toISOString(), state: kind === 'reminder' ? 'scheduled' : 'draft', messageId: null, entrants: [], winnerCount: kind === 'giveaway' ? winnerCount : 0, winners: [], deliveredAt: null, attempts: 0, retryAt: null };
      this.jobs.set(id, job);
      return { value: structuredClone(job) };
    });
  }

  activate(id, messageId) {
    if (typeof messageId !== 'string' || !ID.test(messageId)) throw new Error('Invalid giveaway message ID.');
    return this.#mutate(() => {
      const job = this.jobs.get(id);
      if (!job || job.kind !== 'giveaway' || job.state !== 'draft') throw new Error('Giveaway is not awaiting publication.');
      const updated = { ...job, messageId, state: 'open', attempts: 0, retryAt: null };
      this.jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  enter({ id, guildId, channelId, messageId, userId, leave = false }, now = new Date()) {
    if (typeof userId !== 'string' || !ID.test(userId)) throw new Error('Invalid entrant ID.');
    return this.#mutate(() => {
      const job = this.jobs.get(id);
      if (!job || job.guildId !== guildId || job.channelId !== channelId || job.messageId !== messageId || job.kind !== 'giveaway' || job.state !== 'open' || Date.parse(job.dueAt) <= now.getTime()) throw new Error('Giveaway is closed or unavailable.');
      const already = job.entrants.includes(userId);
      if (leave && !already || !leave && already) return { changed: false, value: { status: already ? 'already' : 'not-entered', count: job.entrants.length } };
      if (!leave && job.entrants.length >= MAX_ENTRANTS) throw new Error('Giveaway entry limit reached.');
      const entrants = leave ? job.entrants.filter((entrant) => entrant !== userId) : [...job.entrants, userId];
      this.jobs.set(id, { ...job, entrants });
      return { value: { status: leave ? 'left' : 'entered', count: entrants.length } };
    });
  }

  draw(id, now = new Date(), force = false) {
    return this.#mutate(() => {
      const job = this.jobs.get(id);
      if (job?.state === 'drawn' || job?.state === 'finished') return { changed: false, value: structuredClone(job) };
      if (!job || job.kind !== 'giveaway' || job.state !== 'open' || !force && Date.parse(job.dueAt) > now.getTime()) throw new Error('Giveaway is not ready to end.');
      const pool = [...job.entrants];
      const winners = [];
      while (pool.length && winners.length < job.winnerCount) {
        const index = this.pick(pool.length);
        if (!Number.isInteger(index) || index < 0 || index >= pool.length) throw new Error('Invalid random selection.');
        winners.push(pool.splice(index, 1)[0]);
      }
      const updated = { ...job, state: 'drawn', winners, attempts: 0, retryAt: null };
      this.jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  editGiveaway({ id, guildId, field, value }, now = new Date()) {
    return this.#mutate(() => {
      const job = this.jobs.get(id);
      if (!job || job.kind !== 'giveaway' || job.guildId !== guildId || !['draft', 'open'].includes(job.state) || Date.parse(job.dueAt) <= now.getTime()) throw new Error('Only active giveaways can be edited.');
      const updated = { ...job };
      if (field === 'prize') {
        if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Invalid prize.');
        updated.text = value.trim();
      } else if (field === 'winners') {
        if (!Number.isInteger(value) || value < 1 || value > 20) throw new Error('Invalid winner count.');
        updated.winnerCount = value;
      } else if (field === 'duration') {
        if (!Number.isInteger(value) || value < 1 || value > 43_200) throw new Error('Invalid duration.');
        const dueAt = now.getTime() + value * 60_000;
        if (!Number.isFinite(dueAt) || dueAt - Date.parse(job.createdAt) > 43_200 * 60_000) throw new Error('Total giveaway lifetime cannot exceed 30 days.');
        updated.dueAt = new Date(dueAt).toISOString();
      } else throw new Error('Unknown giveaway field.');
      // An open job with retryAt is also a durable pending message refresh.
      // Saving happens before Discord is updated, so a restart cannot lose the edit.
      updated.retryAt = now.toISOString();
      updated.attempts = 0;
      this.jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  acknowledgeRefresh(id) {
    return this.#mutate(() => {
      const job = this.jobs.get(id);
      if (!job || job.kind !== 'giveaway' || job.state !== 'open') throw new Error('Giveaway is not open.');
      this.jobs.set(id, { ...job, retryAt: null, attempts: 0 });
      return { value: null };
    });
  }

  reroll({ id, guildId, requestId }) {
    if (typeof requestId !== 'string' || !ID.test(requestId)) throw new Error('Invalid reroll request.');
    return this.#mutate(() => {
      const job = this.jobs.get(id);
      if (!job || job.kind !== 'giveaway' || job.guildId !== guildId) throw new Error('Giveaway not found.');
      if (job.rerollRequestId === requestId) return { changed: false, value: structuredClone(job) };
      if (job.rerollRequestId && BigInt(requestId) < BigInt(job.rerollRequestId)) throw new Error('This reroll request has been superseded.');
      if (job.state !== 'finished') throw new Error('Publish the current result before rerolling.');
      const pool = job.entrants.filter((entrant) => !job.winners.includes(entrant));
      if (!pool.length) throw new Error('No replacement entrants remain.');
      const winners = [];
      while (pool.length && winners.length < job.winnerCount) {
        const index = this.pick(pool.length);
        if (!Number.isInteger(index) || index < 0 || index >= pool.length) throw new Error('Invalid random selection.');
        winners.push(pool.splice(index, 1)[0]);
      }
      const updated = { ...job, winners, rerollRequestId: requestId, state: 'drawn', deliveredAt: null, attempts: 0, retryAt: null };
      this.jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  cancel({ id, guildId, userId, kind }, now = new Date()) {
    return this.#mutate(() => {
      const job = this.jobs.get(id);
      if (!job || job.guildId !== guildId || job.kind !== kind || kind === 'reminder' && job.userId !== userId) throw new Error('Job is unavailable or belongs to another member.');
      if (job.state === 'cancelled') return { changed: false, value: structuredClone(job) };
      if (!['scheduled', 'open', 'draft'].includes(job.state)) throw new Error('Job has already ended.');
      // Giveaway cancellation remains pending until its public message is updated.
      const updated = { ...job, state: 'cancelled', retryAt: null, attempts: 0, deliveredAt: kind === 'reminder' || !job.messageId ? now.toISOString() : null };
      this.jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  complete(id, now = new Date()) {
    return this.#mutate(() => {
      const job = this.jobs.get(id);
      if (!job || !['scheduled', 'drawn', 'cancelled'].includes(job.state)) throw new Error('Job cannot be marked delivered.');
      if (job.deliveredAt) return { changed: false, value: null };
      this.jobs.set(id, { ...job, state: job.state === 'cancelled' ? 'cancelled' : job.kind === 'reminder' ? 'sent' : 'finished', deliveredAt: now.toISOString(), retryAt: null });
      return { value: null };
    });
  }

  retry(id, now = new Date()) {
    return this.#mutate(() => {
      const job = this.jobs.get(id);
      if (!job || job.deliveredAt) return { changed: false, value: null };
      const attempts = Math.min(job.attempts + 1, 1_000_000);
      this.jobs.set(id, { ...job, attempts, retryAt: new Date(now.getTime() + Math.min(900_000, 15_000 * 2 ** Math.min(attempts - 1, 6))).toISOString() });
      return { value: null };
    });
  }

  #valid(job) {
    if (!job || typeof job !== 'object' || Array.isArray(job) || Object.keys(job).filter((key) => key !== 'rerollRequestId').sort().join(',') !== keys
      || (Object.hasOwn(job, 'rerollRequestId') && (job.kind !== 'giveaway' || typeof job.rerollRequestId !== 'string' || !ID.test(job.rerollRequestId) || !['drawn', 'finished'].includes(job.state)))
      || !['id', 'guildId', 'channelId', 'userId'].every((key) => typeof job[key] === 'string' && ID.test(job[key]))
      || !['reminder', 'giveaway'].includes(job.kind) || typeof job.text !== 'string' || !job.text.trim() || job.text.length > (job.kind === 'reminder' ? 500 : 200)
      || !timestamp(job.createdAt) || !timestamp(job.dueAt) || Date.parse(job.dueAt) <= Date.parse(job.createdAt) || Date.parse(job.dueAt) - Date.parse(job.createdAt) > 43_200 * 60_000
      || !(job.deliveredAt === null || timestamp(job.deliveredAt)) || !(job.retryAt === null || timestamp(job.retryAt))
      || !Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > 1_000_000
      || !Array.isArray(job.entrants) || job.entrants.length > MAX_ENTRANTS || !Array.isArray(job.winners) || job.winners.length > 20
      || [...job.entrants, ...job.winners].some((id) => typeof id !== 'string' || !ID.test(id))
      || new Set(job.entrants).size !== job.entrants.length || new Set(job.winners).size !== job.winners.length || job.winners.some((id) => !job.entrants.includes(id))) return false;
    if (job.kind === 'reminder') return ['scheduled', 'sent', 'cancelled'].includes(job.state) && job.messageId === null && job.winnerCount === 0 && !job.entrants.length && !job.winners.length && (job.state === 'scheduled' ? job.deliveredAt === null : job.deliveredAt !== null);
    return Number.isInteger(job.winnerCount) && job.winnerCount >= 1 && job.winnerCount <= 20 && job.winners.length <= job.winnerCount
      && ['draft', 'open', 'drawn', 'finished', 'cancelled'].includes(job.state)
      && (job.state === 'draft' ? job.messageId === null && !job.entrants.length : job.state === 'cancelled' ? job.messageId === null || typeof job.messageId === 'string' && ID.test(job.messageId) : typeof job.messageId === 'string' && ID.test(job.messageId))
      && (!['draft', 'open', 'cancelled'].includes(job.state) || !job.winners.length)
      && (['draft', 'open', 'drawn'].includes(job.state) ? job.deliveredAt === null : job.state === 'finished' ? job.deliveredAt !== null : true);
  }

  #mutate(update) {
    const task = this.queue.then(async () => {
      const previous = new Map(this.jobs);
      const temporary = `${this.filePath}.${process.pid}.${randomInt(1_000_000_000)}.tmp`;
      try {
        const result = update();
        if (result.changed === false) return result.value;
        const data = `${JSON.stringify({ version: 1, jobs: [...this.jobs.values()] })}\n`;
        if (Buffer.byteLength(data) > 32 * 1024 * 1024) throw new Error('Community store exceeds the size limit.');
        await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
        await fs.writeFile(temporary, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, this.filePath);
        return result.value;
      } catch (error) {
        this.jobs = previous;
        await fs.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
}

module.exports = { CommunityStore, MAX_JOBS, MAX_ENTRANTS, RETENTION_MS };
