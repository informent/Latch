'use strict';

const TICK_MS = 15_000;

function giveawayMessage(job) {
  const ended = ['drawn', 'finished', 'cancelled'].includes(job.state);
  const summary = job.state === 'cancelled' ? 'Cancelled by staff.' : ended ? (job.winners.length ? `Winners: ${job.winners.map((id) => `<@${id}>`).join(', ')}` : 'No eligible entries were received.') : `Ends <t:${Math.floor(Date.parse(job.dueAt) / 1000)}:R>\nWinners: ${job.winnerCount}\nUse the buttons below to enter or leave.`;
  return {
    embeds: [{ title: job.state === 'cancelled' ? 'Giveaway cancelled' : ended ? 'Giveaway ended' : 'Community giveaway', description: `**Prize:** ${job.text}\n\n${summary}${ended ? `\nEntries: ${job.entrants.length}` : ''}`, color: ended ? 0x747f8d : 0x5865f2, footer: { text: `Giveaway ID: ${job.id}` } }],
    components: ended ? [] : [{ type: 1, components: [{ type: 2, style: 3, label: 'Enter giveaway', custom_id: `giveaway:enter:${job.id}` }, { type: 2, style: 2, label: 'Leave giveaway', custom_id: `giveaway:leave:${job.id}` }] }],
    allowed_mentions: { parse: [] }
  };
}

class CommunityService {
  constructor({ config, store, discord, logger = () => {}, now = () => new Date() }) {
    this.config = config;
    this.store = store;
    this.discord = discord;
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
    return this.#serialize(() => this.store.create({ ...data, guildId: this.config.guildId, kind: 'reminder' }, this.now()));
  }

  createGiveaway(data) {
    return this.#serialize(async () => {
      const job = await this.store.create({ ...data, guildId: this.config.guildId, kind: 'giveaway' }, this.now());
      if (job.state === 'draft') await this.#attempt(job);
      return this.store.get(job.id);
    });
  }

  enter(data) { return this.store.enter({ ...data, guildId: this.config.guildId }, this.now()); }

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
      const drawn = await this.store.draw(id, this.now(), true);
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
      const job = await this.store.reroll({ id, guildId: this.config.guildId, requestId });
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
      const ready = this.store.list(this.config.guildId).filter((job) => (!job.retryAt || Date.parse(job.retryAt) <= now) && (['draft', 'drawn', 'cancelled'].includes(job.state) || (job.state === 'open' && Boolean(job.retryAt)) || Date.parse(job.dueAt) <= now)).slice(0, 20);
      for (const job of ready) {
        if (this.stopping) break;
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
        if (job.state === 'open') job = await this.store.draw(job.id, this.now());
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
