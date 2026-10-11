'use strict';

const ID = /^\d{5,25}$/;
const MANAGE_ROLES = 1n << 28n;

class LevelRewardService {
  constructor({ config, store, levels, discord, botUserId, logger = () => {}, now = Date.now }) {
    Object.assign(this, { config, store, levels, discord, botUserId, logger, now });
    this.queue = Promise.resolve();
    this.timer = null;
    this.tickTask = null;
    this.stopping = false;
    this.cursor = 0;
  }

  start() {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => { void this.tick().catch(() => this.#log('level_reward_tick_failed')); }, 15_000);
    this.timer.unref?.();
    void this.tick().catch(() => this.#log('level_reward_tick_failed'));
  }
  stop() { this.stopping = true; clearInterval(this.timer); this.timer = null; return this.queue; }
  get() { return this.store.get(); }

  configure(action, values = {}, actorId) {
    const input = { ...values };
    return this.#serialize(async () => {
      const context = await this.#context(actorId);
      if (action === 'add') this.#role(input.roleId, context);
      if (action === 'enable') for (const reward of this.get().rewards) this.#role(reward.roleId, context);
      return this.store.configure(action, input);
    });
  }

  preview(userId) {
    if (typeof userId !== 'string' || !ID.test(userId)) throw new Error('Invalid member ID.');
    const level = this.levels.get(this.config.guildId, userId).level;
    const state = this.get();
    return { userId, level, enabled: state.enabled, rewards: state.rewards.filter((reward) => reward.level <= level), job: this.store.member(userId) };
  }

  schedule(userId) {
    return this.#serialize(() => this.store.schedule(userId, this.levels.get(this.config.guildId, userId).level));
  }

  reconcile(userId, actorId) {
    return this.#serialize(async () => {
      if (!this.get().enabled) throw new Error('Enable rewards before reconciliation.');
      const context = await this.#context(actorId);
      await this.#member(userId, context);
      const job = await this.store.schedule(userId, this.levels.get(this.config.guildId, userId).level, true);
      if (!job) return { granted: 0, pending: false };
      return this.#attempt(job, context);
    });
  }

  tick() {
    if (this.stopping || this.tickTask) return this.tickTask || Promise.resolve();
    const task = this.#serialize(async () => {
      const state = this.get();
      if (!state.enabled || !state.rewards.length || this.stopping) return;
      // Bounded scans also recover a crash between committing XP and queuing rewards.
      const accounts = [...this.levels.accounts.values()].filter((account) => account.guildId === this.config.guildId);
      const batch = accounts.slice(this.cursor, this.cursor + 25);
      this.cursor = this.cursor + 25 >= accounts.length ? 0 : this.cursor + 25;
      for (const account of batch) {
        if (this.stopping) return;
        await this.store.schedule(account.userId, this.levels.levelFor(account.xp));
      }
      const jobs = this.get().members.filter((member) => member.pending && (!member.retryAt || Date.parse(member.retryAt) <= this.now()));
      jobs.sort((a, b) => Date.parse(a.retryAt || '1970-01-01') - Date.parse(b.retryAt || '1970-01-01') || a.userId.localeCompare(b.userId));
      if (jobs[0] && !this.stopping) await this.#attempt(jobs[0]);
    });
    this.tickTask = task;
    void task.finally(() => { if (this.tickTask === task) this.tickTask = null; }).catch(() => {});
    return task;
  }

  async #attempt(job, suppliedContext) {
    try {
      const state = this.get();
      if (!state.enabled) return { granted: 0, pending: true };
      const context = suppliedContext || await this.#context();
      const member = await this.#member(job.userId, context);
      const currentLevel = this.levels.get(this.config.guildId, job.userId).level;
      const eligible = state.rewards.filter((reward) => reward.level <= currentLevel);
      // Validate all selected roles before the first side effect.
      for (const reward of eligible) this.#role(reward.roleId, context);
      let granted = 0;
      for (const reward of eligible) {
        if (member.roles.includes(reward.roleId)) continue;
        await this.discord.grantRole(this.config.guildId, job.userId, reward.roleId, 'Latch earned level reward');
        granted++;
      }
      const confirmed = await this.#member(job.userId, context);
      if (eligible.some((reward) => !confirmed.roles.includes(reward.roleId))) throw new Error('Reward role assignment was not confirmed.');
      await this.store.finish(job, this.now());
      return { granted, pending: false };
    } catch {
      this.#log('level_reward_assignment_failed', { userId: job.userId });
      await this.store.finish(job, this.now(), true).catch(() => this.#log('level_reward_retry_save_failed', { userId: job.userId }));
      return { granted: 0, pending: true };
    }
  }

  async #context(actorId) {
    if (typeof this.botUserId !== 'string' || !ID.test(this.botUserId)) throw new Error('Bot identity unavailable.');
    const guildId = this.config.guildId;
    const [guild, roles, bot] = await Promise.all([
      this.discord.getGuild(guildId), this.discord.request('GET', `/guilds/${guildId}/roles`), this.discord.getGuildMember(guildId, this.botUserId)
    ]);
    if (guild?.id !== guildId || typeof guild.owner_id !== 'string' || !ID.test(guild.owner_id) || !Array.isArray(roles) || !roles.length || roles.length > 1000) throw new Error('Guild roles unavailable.');
    const map = new Map();
    for (const role of roles) {
      if (typeof role?.id !== 'string' || !ID.test(role.id) || map.has(role.id) || !Number.isSafeInteger(role.position) || role.position < 0
        || typeof role.permissions !== 'string' || !/^\d{1,30}$/.test(role.permissions) || typeof role.managed !== 'boolean') throw new Error('Invalid role snapshot.');
      map.set(role.id, role);
    }
    if (!map.has(guildId)) throw new Error('Everyone role unavailable.');
    const context = { guild, map };
    context.bot = this.#snapshot(bot, this.botUserId, context);
    if (!(context.bot.permissions & (8n | MANAGE_ROLES))) throw new Error('Bot needs Manage Roles.');
    if (actorId !== undefined) {
      if (typeof actorId !== 'string' || !ID.test(actorId)) throw new Error('Invalid staff ID.');
      const actor = await this.discord.getGuildMember(guildId, actorId);
      context.actorId = actorId;
      context.actor = this.#snapshot(actor, actorId, context);
      if (actor.user.bot || actor.pending || Date.parse(actor.communication_disabled_until) > this.now()) throw new Error('Staff identity or screening unavailable.');
      if (actorId !== guild.owner_id && !(context.actor.permissions & 8n)
        && ((context.actor.permissions & (32n | MANAGE_ROLES)) !== (32n | MANAGE_ROLES))) throw new Error('Staff needs current Manage Server and Manage Roles.');
    }
    return context;
  }

  #snapshot(member, expectedId, context) {
    if (member?.user?.id !== expectedId || !Array.isArray(member.roles) || member.roles.length > 1000 || new Set(member.roles).size !== member.roles.length
      || member.roles.some((roleId) => typeof roleId !== 'string' || !context.map.has(roleId))) throw new Error('Member identity or role snapshot unavailable.');
    const roles = [context.map.get(this.config.guildId), ...member.roles.map((roleId) => context.map.get(roleId))];
    return { position: Math.max(...roles.map((role) => role.position)), permissions: roles.reduce((bits, role) => bits | BigInt(role.permissions), 0n) };
  }

  #role(roleId, context) {
    const role = typeof roleId === 'string' && context.map.get(roleId);
    if (!role || role.id === this.config.guildId || role.managed || BigInt(role.permissions) !== 0n || role.position >= context.bot.position
      || context.actor && context.actorId !== context.guild.owner_id && role.position >= context.actor.position) throw new Error('Choose a permission-free unmanaged role below bot and staff.');
    return role;
  }

  async #member(userId, context) {
    if (typeof userId !== 'string' || !ID.test(userId) || userId === this.botUserId || userId === context.guild.owner_id) throw new Error('Choose a human member other than the owner or bot.');
    const member = await this.discord.getGuildMember(this.config.guildId, userId);
    const subject = this.#snapshot(member, userId, context);
    if (member.user.bot || member.pending || subject.position >= context.bot.position
      || context.actor && context.actorId !== context.guild.owner_id && subject.position >= context.actor.position) throw new Error('Member must be screened and below bot and staff.');
    return member;
  }

  #serialize(work) { const task = this.queue.then(work); this.queue = task.catch(() => {}); return task; }
  #log(event, details = {}) { try { this.logger(event, details); } catch {} }
}

module.exports = { LevelRewardService };
