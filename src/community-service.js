'use strict';

const TICK_MS = 15_000;

function giveawayMessage(job) {
  const ended = ['drawn', 'finished', 'cancelled'].includes(job.state);
  const selecting = job.state === 'selecting';
  const summary = selecting ? `Checking current member eligibility: ${job.selection.remaining.length} entries remain.` : job.state === 'cancelled' ? 'Cancelled by staff.' : ended ? (job.winners.length ? `Winners: ${job.winners.map((id) => `<@${id}>`).join(', ')}` : 'No eligible entries were received.') : `Ends <t:${Math.floor(Date.parse(job.dueAt) / 1000)}:R>\nWinners: ${job.winnerCount}\nUse the buttons below to enter or leave.`;
  const requirements = job.requirements ? `\nRequired roles (all): ${job.requirements.roles.map((id) => `<@&${id}>`).join(', ') || 'none'}\nLevel range: ${job.requirements.minLevel}-${job.requirements.maxLevel ?? 'unlimited'}\nHuman membership and screening are checked at entry and during selection.` : '';
  return {
    embeds: [{ title: job.state === 'cancelled' ? 'Giveaway cancelled' : ended ? 'Giveaway ended' : 'Community giveaway', description: `**Prize:** ${job.text}\n\n${summary}${requirements}${ended ? `\nEntries: ${job.entrants.length}` : ''}`, color: ended ? 0x747f8d : 0x5865f2, footer: { text: `Giveaway ID: ${job.id}` } }],
    components: ended || selecting ? [] : [{ type: 1, components: [{ type: 2, style: 3, label: 'Enter giveaway', custom_id: `giveaway:enter:${job.id}` }, { type: 2, style: 2, label: 'Leave giveaway', custom_id: `giveaway:leave:${job.id}` }] }],
    allowed_mentions: { parse: [] }
  };
}

class CommunityService {
  constructor({ config, store, discord, levels, logger = () => {}, now = () => new Date() }) {
    this.config = config;
    this.store = store;
    this.discord = discord;
    this.levels = levels;
    this.logger = logger;
    this.now = now;
    this.queue = Promise.resolve();
    this.timer = null;
    this.tickTask = null;
    this.stopping = false;
  }

  start() {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => { void this.tick().catch(() => this.#log('community_tick_failed', {})); }, TICK_MS);
    this.timer.unref?.();
    void this.tick().catch(() => this.#log('community_tick_failed', {}));
  }

  stop() {
    this.stopping = true;
    clearInterval(this.timer);
    this.timer = null;
    return this.queue;
  }

  createReminder(data) {
    const input = structuredClone(data);
    return this.#serialize(() => this.store.create({ ...input, guildId: this.config.guildId, kind: 'reminder' }, this.now()));
  }

  getReminder(id, userId) {
    const job = this.store.get(id);
    if (!job || job.kind !== 'reminder' || job.guildId !== this.config.guildId || job.userId !== userId) throw new Error('Reminder is unavailable or belongs to another member.');
    return job;
  }

  editReminder(data) {
    const input = structuredClone(data);
    return this.#serialize(() => this.store.editReminder({ ...input, guildId: this.config.guildId }, this.now()));
  }

  createGiveaway(data) {
    const input = structuredClone(data);
    return this.#serialize(async () => {
      const job = await this.store.create({ ...input, requirements: input.requirements ?? { roles: [], minLevel: 0, maxLevel: null }, guildId: this.config.guildId, kind: 'giveaway' }, this.now());
      if (job.state === 'draft') await this.#attempt(job);
      return this.store.get(job.id);
    });
  }

  enter(data) {
    const input = { ...data };
    return this.#serialize(async () => {
      const job = this.getGiveaway(input.id);
      if (!job || job.state !== 'open' || job.channelId !== input.channelId || job.messageId !== input.messageId || Date.parse(job.dueAt) <= this.now().getTime()) throw new Error('Giveaway is closed or unavailable.');
      if (!input.leave && job.requirements && !(await this.eligibility(job.id, input.userId)).eligible) throw new Error('Giveaway requirements are not met.');
      return this.store.enter({ ...input, guildId: this.config.guildId }, this.now());
    });
  }

  async eligibility(id, userId) {
    const job = this.getGiveaway(id);
    if (!job || typeof userId !== 'string' || !/^\d{5,25}$/.test(userId)) throw new Error('Invalid giveaway or member.');
    let member;
    try { member = await this.discord.getGuildMember(this.config.guildId, userId); }
    catch (error) { if (error.statusCode === 404) return { eligible: false, reason: 'Member has left the server.' }; throw error; }
    if (member?.user?.id !== userId || !Array.isArray(member.roles) || member.roles.length > 1000 || new Set(member.roles).size !== member.roles.length
      || member.roles.some((role) => typeof role !== 'string' || !/^\d{5,25}$/.test(role))) throw new Error('Current member identity unavailable.');
    if (member.user.bot || member.pending) return { eligible: false, reason: 'Human membership with completed screening is required.' };
    const policy = job.requirements || { roles: [], minLevel: 0, maxLevel: null };
    if (policy.roles.some((role) => !member.roles.includes(role))) return { eligible: false, reason: 'One or more required roles are missing.' };
    if (!this.levels && (policy.minLevel > 0 || policy.maxLevel !== null)) throw new Error('XP records unavailable.');
    const level = this.levels?.get(this.config.guildId, userId).level ?? 0;
    if (!Number.isSafeInteger(level) || level < 0) throw new Error('Invalid XP level.');
    return level < policy.minLevel || policy.maxLevel !== null && level > policy.maxLevel
      ? { eligible: false, level, reason: 'Member level is outside the configured range.' } : { eligible: true, level, reason: 'Current eligibility checks passed.' };
  }

  configureRequirements(id, action, values = {}) {
    const input = { ...values };
    return this.#serialize(async () => {
      if (action === 'role-add') {
        const roles = await this.discord.request('GET', `/guilds/${this.config.guildId}/roles`);
        if (!Array.isArray(roles) || !roles.some((role) => role.id === input.roleId && role.id !== this.config.guildId)) throw new Error('Choose a current guild role other than everyone.');
      }
      const job = await this.store.requirements({ ...input, id, guildId: this.config.guildId, action }, this.now());
      await this.#attempt(job);
      return this.store.get(id);
    });
  }

  cancelReminder(id, userId) {
    return this.#serialize(() => this.store.cancel({ id, userId, guildId: this.config.guildId, kind: 'reminder' }, this.now()));
  }

  cancelGiveaway(id) {
    return this.#serialize(async () => {
      const job = await this.store.cancel({ id, guildId: this.config.guildId, kind: 'giveaway' }, this.now());
      if (!job.deliveredAt) await this.#attempt(job);
      return this.store.get(id);
    });
  }

  endGiveaway(id) {
    return this.#serialize(async () => {
      const job = this.store.get(id);
      if (!job || job.guildId !== this.config.guildId || job.kind !== 'giveaway') throw new Error('Giveaway not found.');
      const drawn = job.requirements ? await this.store.beginSelection({ id, guildId: this.config.guildId, force: true }, this.now()) : await this.store.draw(id, this.now(), true);
      if (!drawn.deliveredAt) await this.#attempt(drawn);
      return this.store.get(id);
    });
  }

  list(kind, userId) { return this.store.list(this.config.guildId, { kind, userId }); }

  editGiveaway(id, field, value) {
    return this.#serialize(async () => {
      const job = await this.store.editGiveaway({ id, guildId: this.config.guildId, field, value }, this.now());
      await this.#attempt(job);
      return this.store.get(id);
    });
  }

  rerollGiveaway(id, requestId) {
    return this.#serialize(async () => {
      const current = this.getGiveaway(id);
      const job = current?.requirements ? await this.store.beginSelection({ id, guildId: this.config.guildId, requestId }, this.now()) : await this.store.reroll({ id, guildId: this.config.guildId, requestId });
      if (!job.deliveredAt) await this.#attempt(job);
      return this.store.get(id);
    });
  }

  getGiveaway(id) {
    const job = this.store.get(id);
    return job?.guildId === this.config.guildId && job.kind === 'giveaway' ? job : null;
  }

  tick() {
    if (this.stopping) return Promise.resolve();
    if (this.tickTask) return this.tickTask;
    const task = this.#serialize(async () => {
      await this.store.prune(this.now());
      const now = this.now().getTime();
      const ready = this.store.list(this.config.guildId).filter((job) => (!job.retryAt || Date.parse(job.retryAt) <= now) && (['draft', 'selecting', 'drawn', 'cancelled'].includes(job.state) || (job.state === 'open' && Boolean(job.retryAt)) || Date.parse(job.dueAt) <= now)).slice(0, 20);
      let selectionChecked = false;
      for (const job of ready) {
        if (this.stopping) break;
        const selecting = job.kind === 'giveaway' && job.requirements && (job.state === 'selecting' || ['draft', 'open'].includes(job.state) && Date.parse(job.dueAt) <= now);
        if (selecting && selectionChecked) continue;
        if (selecting) selectionChecked = true;
        await this.#attempt(job);
      }
    });
    this.tickTask = task;
    void task.finally(() => { if (this.tickTask === task) this.tickTask = null; }).catch(() => {});
    return task;
  }

  async #attempt(job) {
    try {
      if (job.kind === 'reminder') {
        await this.discord.createMessage(job.channelId, { content: `<@${job.userId}> Reminder: ${job.text}`, allowed_mentions: { parse: [], users: [job.userId] }, nonce: job.id, enforce_nonce: true });
      } else {
        if (job.state === 'draft') {
          const message = await this.discord.createMessage(job.channelId, { ...giveawayMessage(job), nonce: job.id, enforce_nonce: true });
          job = await this.store.activate(job.id, message.id);
          if (Date.parse(job.dueAt) > this.now().getTime()) return;
        }
        if (job.state === 'open' && Date.parse(job.dueAt) > this.now().getTime()) {
          await this.discord.editMessage(job.channelId, job.messageId, giveawayMessage(job));
          await this.store.acknowledgeRefresh(job.id);
          return;
        }
        if (job.state === 'open') job = job.requirements ? await this.store.beginSelection({ id: job.id, guildId: this.config.guildId }, this.now()) : await this.store.draw(job.id, this.now());
        if (job.state === 'selecting') {
          const decisions = [];
          try {
            for (const userId of job.selection.remaining.slice(0, 25)) {
              if (this.stopping) break;
              decisions.push({ userId, eligible: (await this.eligibility(job.id, userId)).eligible });
            }
          } catch (error) {
            if (decisions.length) await this.store.advanceSelection(job.id, decisions);
            throw error;
          }
          if (decisions.length) job = await this.store.advanceSelection(job.id, decisions);
          if (job.selection.remaining.length) {
            await this.discord.editMessage(job.channelId, job.messageId, giveawayMessage(job));
            return;
          }
          const candidates = this.store.candidates(job.id);
          if (candidates.length > 25 - decisions.length) {
            await this.discord.editMessage(job.channelId, job.messageId, giveawayMessage(job));
            return;
          }
          const rejected = [];
          for (const userId of candidates) {
            if (this.stopping) return;
            if (!(await this.eligibility(job.id, userId)).eligible) rejected.push(userId);
          }
          if (rejected.length) {
            job = await this.store.discardCandidates(job.id, rejected);
            await this.discord.editMessage(job.channelId, job.messageId, giveawayMessage(job));
            return;
          }
          job = await this.store.finishSelection(job.id, candidates);
        }
        await this.discord.editMessage(job.channelId, job.messageId, giveawayMessage(job));
      }
      await this.store.complete(job.id, this.now());
    } catch {
      this.#log('community_delivery_failed', { jobId: job.id, kind: job.kind });
      await this.store.retry(job.id, this.now()).catch(() => this.#log('community_retry_save_failed', { jobId: job.id }));
    }
  }

  #serialize(work) {
    const task = this.queue.then(work);
    this.queue = task.catch(() => {});
    return task;
  }

  #log(event, details) { try { this.logger(event, details); } catch {} }
}

module.exports = { CommunityService, giveawayMessage, TICK_MS };
