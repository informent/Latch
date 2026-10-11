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
      if (Buffer.byteLength(content) > 32 * 1024 * 1024) throw new Error('Community store exceeds the size limit.');
      try { parsed = JSON.parse(content); }
      catch { throw new Error('Community store is not valid JSON; refusing to modify it.'); }
      if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).sort().join(',') !== 'jobs,version' || ![1, 2].includes(parsed.version) || !Array.isArray(parsed.jobs) || parsed.jobs.length > MAX_JOBS) throw new Error('Community store contains invalid records.');
      const records = new Map();
      for (const record of parsed.jobs) {
        if (!this.#valid(record) || records.has(record.id) || parsed.version === 1 && (Object.hasOwn(record, 'requirements') || Object.hasOwn(record, 'selection'))) throw new Error('Community store contains invalid or duplicate records; refusing to modify it.');
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
    return this.#mutate((jobs) => {
      let removed = 0;
      for (const [id, job] of jobs) if (job.deliveredAt && now.getTime() - Date.parse(job.deliveredAt) > RETENTION_MS) { jobs.delete(id); removed++; }
      return { changed: removed > 0, value: removed };
    });
  }

  async create({ id, kind, guildId, channelId, userId, text, minutes, winnerCount = 1, requirements }, now = new Date()) {
    if (![id, guildId, channelId, userId].every((value) => typeof value === 'string' && ID.test(value)) || !['reminder', 'giveaway'].includes(kind)
      || typeof text !== 'string' || !text.trim() || text.length > (kind === 'reminder' ? 500 : 200)
      || !Number.isInteger(minutes) || minutes < 1 || minutes > 43_200
      || !Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 20 || !Number.isFinite(now.getTime())) throw new Error('Invalid community job.');
    const policy = requirements === undefined ? undefined : structuredClone(requirements);
    if (policy !== undefined && (kind !== 'giveaway' || !this.#validRequirements(policy))) throw new Error('Invalid giveaway requirements.');
    return this.#mutate((jobs) => {
      const existing = jobs.get(id);
      if (existing) {
        if (existing.guildId !== guildId || existing.userId !== userId || existing.kind !== kind) throw new Error('Job ID conflict.');
        return { changed: false, value: structuredClone(existing) };
      }
      for (const [key, job] of jobs) if (job.deliveredAt && now.getTime() - Date.parse(job.deliveredAt) > RETENTION_MS) jobs.delete(key);
      if (jobs.size >= MAX_JOBS) throw new Error('Community job limit reached.');
      const active = this.list(guildId, { kind, ...(kind === 'reminder' ? { userId } : {}) });
      if (active.length >= (kind === 'reminder' ? 10 : 20)) throw new Error('Active job limit reached.');
      const job = { id, kind, guildId, channelId, userId, text: text.trim(), createdAt: now.toISOString(), dueAt: new Date(now.getTime() + minutes * 60_000).toISOString(), state: kind === 'reminder' ? 'scheduled' : 'draft', messageId: null, entrants: [], winnerCount: kind === 'giveaway' ? winnerCount : 0, winners: [], deliveredAt: null, attempts: 0, retryAt: null, ...(policy === undefined ? {} : { requirements: policy }) };
      jobs.set(id, job);
      return { value: structuredClone(job) };
    });
  }

  editReminder({ id, guildId, userId, field, value }, now = new Date()) {
    if (!Number.isFinite(now.getTime())) throw new Error('Invalid reminder edit time.');
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
      if (!job || job.kind !== 'reminder' || job.guildId !== guildId || job.userId !== userId || job.state !== 'scheduled' || job.deliveredAt || job.attempts !== 0 || job.retryAt !== null || Date.parse(job.dueAt) <= now.getTime()) throw new Error('Only your future reminders without delivery attempts can be edited.');
      const updated = { ...job };
      if (field === 'text') {
        if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error('Use 1 to 500 characters of reminder text.');
        updated.text = value.trim();
      } else if (field === 'minutes') {
        if (!Number.isInteger(value) || value < 1 || value > 43200) throw new Error('Use 1 to 43200 minutes from now.');
        updated.dueAt = new Date(now.getTime() + value * 60000).toISOString();
      } else throw new Error('Choose a reminder edit field.');
      jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  activate(id, messageId) {
    if (typeof messageId !== 'string' || !ID.test(messageId)) throw new Error('Invalid giveaway message ID.');
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
      if (!job || job.kind !== 'giveaway' || job.state !== 'draft') throw new Error('Giveaway is not awaiting publication.');
      const updated = { ...job, messageId, state: 'open', attempts: 0, retryAt: null };
      jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  enter({ id, guildId, channelId, messageId, userId, leave = false }, now = new Date()) {
    if (typeof userId !== 'string' || !ID.test(userId)) throw new Error('Invalid entrant ID.');
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
      if (!job || job.guildId !== guildId || job.channelId !== channelId || job.messageId !== messageId || job.kind !== 'giveaway' || job.state !== 'open' || Date.parse(job.dueAt) <= now.getTime()) throw new Error('Giveaway is closed or unavailable.');
      const already = job.entrants.includes(userId);
      if (leave && !already || !leave && already) return { changed: false, value: { status: already ? 'already' : 'not-entered', count: job.entrants.length } };
      if (!leave && job.entrants.length >= MAX_ENTRANTS) throw new Error('Giveaway entry limit reached.');
      const entrants = leave ? job.entrants.filter((entrant) => entrant !== userId) : [...job.entrants, userId];
      jobs.set(id, { ...job, entrants });
      return { value: { status: leave ? 'left' : 'entered', count: entrants.length } };
    });
  }

  draw(id, now = new Date(), force = false) {
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
      if (job?.state === 'drawn' || job?.state === 'finished') return { changed: false, value: structuredClone(job) };
      if (job?.requirements) throw new Error('Use verified giveaway selection.');
      if (!job || job.kind !== 'giveaway' || job.state !== 'open' || !force && Date.parse(job.dueAt) > now.getTime()) throw new Error('Giveaway is not ready to end.');
      const pool = [...job.entrants];
      const winners = [];
      while (pool.length && winners.length < job.winnerCount) {
        const index = this.pick(pool.length);
        if (!Number.isInteger(index) || index < 0 || index >= pool.length) throw new Error('Invalid random selection.');
        winners.push(pool.splice(index, 1)[0]);
      }
      const updated = { ...job, state: 'drawn', winners, attempts: 0, retryAt: null };
      jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  editGiveaway({ id, guildId, field, value }, now = new Date()) {
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
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
      jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  acknowledgeRefresh(id) {
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
      if (!job || job.kind !== 'giveaway' || job.state !== 'open') throw new Error('Giveaway is not open.');
      jobs.set(id, { ...job, retryAt: null, attempts: 0 });
      return { value: null };
    });
  }

  reroll({ id, guildId, requestId }) {
    if (typeof requestId !== 'string' || !ID.test(requestId)) throw new Error('Invalid reroll request.');
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
      if (!job || job.kind !== 'giveaway' || job.guildId !== guildId) throw new Error('Giveaway not found.');
      if (job.requirements) throw new Error('Use verified giveaway selection.');
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
      jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  cancel({ id, guildId, userId, kind }, now = new Date()) {
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
      if (!job || job.guildId !== guildId || job.kind !== kind || kind === 'reminder' && job.userId !== userId) throw new Error('Job is unavailable or belongs to another member.');
      if (job.state === 'cancelled') return { changed: false, value: structuredClone(job) };
      if (!['scheduled', 'open', 'draft', 'selecting'].includes(job.state)) throw new Error('Job has already ended.');
      // Giveaway cancellation remains pending until its public message is updated.
      const { selection, rerollRequestId, ...cancellable } = job;
      const updated = { ...cancellable, state: 'cancelled', retryAt: null, attempts: 0, deliveredAt: kind === 'reminder' || !job.messageId ? now.toISOString() : null };
      jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  complete(id, now = new Date()) {
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
      if (!job || !['scheduled', 'drawn', 'cancelled'].includes(job.state)) throw new Error('Job cannot be marked delivered.');
      if (job.deliveredAt) return { changed: false, value: null };
      jobs.set(id, { ...job, state: job.state === 'cancelled' ? 'cancelled' : job.kind === 'reminder' ? 'sent' : 'finished', deliveredAt: now.toISOString(), retryAt: null });
      return { value: null };
    });
  }

  retry(id, now = new Date()) {
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
      if (!job || job.deliveredAt) return { changed: false, value: null };
      const attempts = Math.min(job.attempts + 1, 1_000_000);
      jobs.set(id, { ...job, attempts, retryAt: new Date(now.getTime() + Math.min(900_000, 15_000 * 2 ** Math.min(attempts - 1, 6))).toISOString() });
      return { value: null };
    });
  }

  requirements({ id, guildId, action, roleId, minLevel, maxLevel }, now = new Date()) {
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
      if (!job || job.guildId !== guildId || job.kind !== 'giveaway' || !['draft', 'open'].includes(job.state) || Date.parse(job.dueAt) <= now.getTime()) throw new Error('Only active giveaways can change requirements.');
      const policy = structuredClone(job.requirements || { roles: [], minLevel: 0, maxLevel: null });
      if (action === 'role-add' || action === 'role-remove') {
        if (typeof roleId !== 'string' || !ID.test(roleId) || roleId === guildId) throw new Error('Invalid requirement role.');
        policy.roles = policy.roles.filter((role) => role !== roleId);
        if (action === 'role-add') policy.roles.push(roleId);
      } else if (action === 'levels') { policy.minLevel = minLevel; policy.maxLevel = maxLevel; }
      else if (action === 'clear') { policy.roles = []; policy.minLevel = 0; policy.maxLevel = null; }
      else throw new Error('Unknown giveaway requirement action.');
      if (!this.#validRequirements(policy)) throw new Error('Invalid giveaway requirements.');
      const updated = { ...job, requirements: policy, retryAt: now.toISOString(), attempts: 0 };
      jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  beginSelection({ id, guildId, requestId = null, force = false }, now = new Date()) {
    return this.#mutate((jobs) => {
      if (typeof force !== 'boolean') throw new Error('Invalid selection action.');
      const job = jobs.get(id);
      if (!job || job.guildId !== guildId || job.kind !== 'giveaway') throw new Error('Giveaway not found.');
      if (requestId !== null) {
        if (typeof requestId !== 'string' || !ID.test(requestId)) throw new Error('Invalid reroll request.');
        if (job.rerollRequestId === requestId) return { changed: false, value: structuredClone(job) };
        if (job.rerollRequestId && BigInt(requestId) < BigInt(job.rerollRequestId)) throw new Error('Reroll request superseded.');
        if (job.state !== 'finished') throw new Error('Publish the current result before rerolling.');
      } else {
        if (['selecting', 'drawn', 'finished'].includes(job.state)) return { changed: false, value: structuredClone(job) };
        if (job.state !== 'open' || !force && Date.parse(job.dueAt) > now.getTime()) throw new Error('Giveaway is not ready.');
      }
      const excluded = requestId === null ? [] : [...job.winners];
      const remaining = job.entrants.filter((entrant) => !excluded.includes(entrant));
      if (requestId !== null && !remaining.length) throw new Error('No replacement entrants remain.');
      const updated = { ...job, requirements: job.requirements || { roles: [], minLevel: 0, maxLevel: null }, state: 'selecting', winners: [], deliveredAt: null, attempts: 0, retryAt: null,
        ...(requestId === null ? {} : { rerollRequestId: requestId }), selection: { remaining, eligible: [], excluded, startedAt: now.toISOString() } };
      jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  advanceSelection(id, decisions) {
    const input = structuredClone(decisions);
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
      if (!job || job.state !== 'selecting' || !Array.isArray(input) || !input.length || input.length > 25) throw new Error('Invalid selection progress.');
      const selection = structuredClone(job.selection);
      for (const decision of input) {
        if (!decision || Object.keys(decision).sort().join(',') !== 'eligible,userId' || typeof decision.eligible !== 'boolean' || decision.userId !== selection.remaining[0]) throw new Error('Selection progress changed.');
        selection.remaining.shift();
        if (decision.eligible) selection.eligible.push(decision.userId);
      }
      const updated = { ...job, selection, attempts: 0, retryAt: null };
      jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  candidates(id) {
    const job = this.get(id);
    if (!job || job.state !== 'selecting' || job.selection.remaining.length) throw new Error('Selection is incomplete.');
    const pool = [...job.selection.eligible], candidates = [];
    while (pool.length && candidates.length < job.winnerCount) {
      const index = this.pick(pool.length);
      if (!Number.isInteger(index) || index < 0 || index >= pool.length) throw new Error('Invalid random selection.');
      candidates.push(pool.splice(index, 1)[0]);
    }
    return candidates;
  }

  discardCandidates(id, candidates) {
    const input = structuredClone(candidates);
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
      if (!job || job.state !== 'selecting' || !Array.isArray(input) || !input.length || input.length > 20 || new Set(input).size !== input.length
        || input.some((userId) => !job.selection.eligible.includes(userId))) throw new Error('Invalid rejected candidates.');
      const selection = { ...job.selection, eligible: job.selection.eligible.filter((member) => !input.includes(member)) };
      const updated = { ...job, selection };
      jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  finishSelection(id, candidates) {
    const verified = structuredClone(candidates);
    return this.#mutate((jobs) => {
      const job = jobs.get(id);
      if (!job || job.state !== 'selecting' || job.selection.remaining.length) throw new Error('Selection is incomplete.');
      if (!Array.isArray(verified) || verified.length !== Math.min(job.winnerCount, job.selection.eligible.length) || new Set(verified).size !== verified.length
        || verified.some((member) => !job.selection.eligible.includes(member))) throw new Error('Invalid verified candidates.');
      const { selection, ...record } = job;
      const updated = { ...record, state: 'drawn', winners: verified, retryAt: null, attempts: 0 };
      jobs.set(id, updated);
      return { value: structuredClone(updated) };
    });
  }

  #validRequirements(policy) {
    return policy && Object.keys(policy).sort().join(',') === 'maxLevel,minLevel,roles' && Array.isArray(policy.roles) && policy.roles.length <= 5
      && policy.roles.every((role) => typeof role === 'string' && ID.test(role)) && new Set(policy.roles).size === policy.roles.length
      && Number.isInteger(policy.minLevel) && policy.minLevel >= 0 && policy.minLevel <= 1000
      && (policy.maxLevel === null || Number.isInteger(policy.maxLevel) && policy.maxLevel >= policy.minLevel && policy.maxLevel <= 1000);
  }

  #validSelection(job) {
    const selection = job.selection;
    if (!selection || Object.keys(selection).sort().join(',') !== 'eligible,excluded,remaining,startedAt' || !timestamp(selection.startedAt)) return false;
    if (![selection.remaining, selection.eligible, selection.excluded].every((list) => Array.isArray(list) && list.length <= MAX_ENTRANTS)) return false;
    const all = [...selection.remaining, ...selection.eligible, ...selection.excluded];
    const entrants = new Set(job.entrants);
    return selection.excluded.length <= 20 && all.length <= job.entrants.length && new Set(all).size === all.length
      && all.every((member) => typeof member === 'string' && ID.test(member) && entrants.has(member)) && !job.winners.length;
  }

  #valid(job) {
    if (!job || typeof job !== 'object' || Array.isArray(job) || Object.keys(job).filter((key) => !['rerollRequestId', 'requirements', 'selection'].includes(key)).sort().join(',') !== keys
      || (Object.hasOwn(job, 'rerollRequestId') && (job.kind !== 'giveaway' || typeof job.rerollRequestId !== 'string' || !ID.test(job.rerollRequestId) || !['selecting', 'drawn', 'finished'].includes(job.state)))
      || !['id', 'guildId', 'channelId', 'userId'].every((key) => typeof job[key] === 'string' && ID.test(job[key]))
      || !['reminder', 'giveaway'].includes(job.kind) || typeof job.text !== 'string' || !job.text.trim() || job.text.length > (job.kind === 'reminder' ? 500 : 200)
      || !timestamp(job.createdAt) || !timestamp(job.dueAt) || Date.parse(job.dueAt) <= Date.parse(job.createdAt) || Date.parse(job.dueAt) - Date.parse(job.createdAt) > 43_200 * 60_000
      || !(job.deliveredAt === null || timestamp(job.deliveredAt)) || !(job.retryAt === null || timestamp(job.retryAt))
      || !Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > 1_000_000
      || !Array.isArray(job.entrants) || job.entrants.length > MAX_ENTRANTS || !Array.isArray(job.winners) || job.winners.length > 20
      || [...job.entrants, ...job.winners].some((id) => typeof id !== 'string' || !ID.test(id))
      || new Set(job.entrants).size !== job.entrants.length || new Set(job.winners).size !== job.winners.length || job.winners.some((id) => !job.entrants.includes(id))) return false;
    if (Object.hasOwn(job, 'requirements') && (job.kind !== 'giveaway' || !this.#validRequirements(job.requirements) || job.requirements.roles.includes(job.guildId))) return false;
    if (Object.hasOwn(job, 'selection') ? job.state !== 'selecting' || !job.requirements || !this.#validSelection(job) : job.state === 'selecting') return false;
    if (job.kind === 'reminder') return ['scheduled', 'sent', 'cancelled'].includes(job.state) && job.messageId === null && job.winnerCount === 0 && !job.entrants.length && !job.winners.length && (job.state === 'scheduled' ? job.deliveredAt === null : job.deliveredAt !== null);
    return Number.isInteger(job.winnerCount) && job.winnerCount >= 1 && job.winnerCount <= 20 && job.winners.length <= job.winnerCount
      && ['draft', 'open', 'selecting', 'drawn', 'finished', 'cancelled'].includes(job.state)
      && (job.state === 'draft' ? job.messageId === null && !job.entrants.length : job.state === 'cancelled' ? job.messageId === null || typeof job.messageId === 'string' && ID.test(job.messageId) : typeof job.messageId === 'string' && ID.test(job.messageId))
      && (!['draft', 'open', 'selecting', 'cancelled'].includes(job.state) || !job.winners.length)
      && (['draft', 'open', 'selecting', 'drawn'].includes(job.state) ? job.deliveredAt === null : job.state === 'finished' ? job.deliveredAt !== null : true);
  }

  #mutate(update) {
    const task = this.queue.then(async () => {
      const jobs = new Map(this.jobs);
      const temporary = `${this.filePath}.${process.pid}.${randomInt(1_000_000_000)}.tmp`;
      try {
        const result = update(jobs);
        if (result.changed === false) return result.value;
        if (jobs.size > MAX_JOBS || [...jobs.values()].some((job) => !this.#valid(job))) throw new Error('Invalid community store update.');
        const data = `${JSON.stringify({ version: 2, jobs: [...jobs.values()] })}\n`;
        if (Buffer.byteLength(data) > 32 * 1024 * 1024) throw new Error('Community store exceeds the size limit.');
        await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
        await fs.writeFile(temporary, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, this.filePath);
        this.jobs = jobs;
        return result.value;
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
}

module.exports = { CommunityStore, MAX_JOBS, MAX_ENTRANTS, RETENTION_MS };
