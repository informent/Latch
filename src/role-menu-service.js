'use strict';

function menuMessage(menu) {
  const enabled = menu.state === 'enabled';
  const buttons = enabled ? menu.roles.flatMap((role) => [
    { type: 2, style: 3, label: `Get ${role.label}`, custom_id: `rolemenu:grant:${menu.id}:${role.id}` },
    { type: 2, style: 2, label: `Remove ${role.label}`, custom_id: `rolemenu:revoke:${menu.id}:${role.id}` }
  ]) : [];
  const components = [];
  for (let index = 0; index < buttons.length; index += 5) components.push({ type: 1, components: buttons.slice(index, index + 5) });
  return { embeds: [{ title: menu.title, description: enabled ? 'Use Get to add a role and Remove to remove it. Each action is explicit and can safely be repeated.' : 'This role menu is disabled.', color: enabled ? 0x5865f2 : 0x747f8d, footer: { text: `Role menu ID: ${menu.id}` } }], components, allowed_mentions: { parse: [] } };
}

class RoleMenuService {
  constructor({ config, store, discord, botUserId, logger = () => {}, now = Date.now }) {
    Object.assign(this, { config, store, discord, botUserId, logger, now });
    this.queue = Promise.resolve(); this.timer = null; this.tickTask = null; this.stopping = false;
  }

  start() {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => { void this.tick().catch(() => this.#log('role_menu_tick_failed')); }, 15000);
    this.timer.unref?.();
    void this.tick().catch(() => this.#log('role_menu_tick_failed'));
  }
  stop() { this.stopping = true; clearInterval(this.timer); this.timer = null; return this.queue; }
  list() { return this.store.get().menus; }
  get(id) { return this.store.menu(id); }
  autoroles() { return this.store.get().autoroles; }

  create(data) {
    return this.#serialize(async () => {
      const channel = await this.discord.request('GET', `/channels/${data.channelId}`);
      if (channel.guild_id !== this.config.guildId || channel.type !== 0) throw new Error('Choose a server text channel.');
      return this.store.create(data);
    });
  }

  change(id, action, { roleId, label, actorId } = {}) {
    return this.#serialize(async () => {
      if (action === 'add') await this.#role(roleId, await this.#context(), actorId);
      if (action === 'publish') {
        const menu = this.store.menu(id);
        if (!menu) throw new Error('Role menu unavailable.');
        const context = await this.#context();
        for (const role of menu.roles) await this.#role(role.id, context, actorId);
      }
      const menu = await this.store.change(id, action, { roleId, label });
      if (menu.pending) await this.#attempt(menu);
      return this.store.menu(id);
    });
  }

  button({ id, roleId, action, guildId, channelId, messageId, userId }) {
    return this.#serialize(async () => {
      const menu = this.store.menu(id);
      if (!menu || menu.state !== 'enabled' || guildId !== this.config.guildId || menu.channelId !== channelId || menu.messageId !== messageId || !menu.roles.some((role) => role.id === roleId) || !['grant', 'revoke'].includes(action)) throw new Error('Role menu button unavailable.');
      const [context, member] = await Promise.all([this.#context(), this.discord.getGuildMember(this.config.guildId, userId)]);
      await this.#role(roleId, context);
      if (!member.user || member.user.id !== userId || member.user.bot || member.pending) throw new Error('Complete membership screening first.');
      const already = (member.roles || []).includes(roleId);
      if (already === (action === 'grant')) return already ? 'You already have that role.' : 'You do not have that role.';
      if (action === 'grant') await this.discord.grantRole(this.config.guildId, userId, roleId, 'Latch member requested role');
      else await this.discord.revokeRole(this.config.guildId, userId, roleId, 'Latch member requested role removal');
      return action === 'grant' ? 'Role added.' : 'Role removed.';
    });
  }

  configureAutorole(roleId, remove, actorId) {
    return this.#serialize(async () => {
      if (!remove) {
        if (!this.config.memberEventsEnabled) throw new Error('Enable member events first.');
        await this.#role(roleId, await this.#context(), actorId);
      }
      await this.store.autorole(roleId, remove);
    });
  }

  applyAutoroles(userId, actorId) {
    return this.#serialize(async () => {
      const ids = this.store.get().autoroles;
      if (!ids.length) return 0;
      const member = await this.discord.getGuildMember(this.config.guildId, userId);
      if (!member.user || member.user.id !== userId || member.user.bot || member.pending) throw new Error('Choose a human who completed membership screening.');
      const context = await this.#context();
      let applied = 0;
      for (const id of ids) {
        await this.#role(id, context, actorId);
        if ((member.roles || []).includes(id)) continue;
        await this.discord.grantRole(this.config.guildId, userId, id, 'Latch configured autorole');
        applied++;
      }
      return applied;
    });
  }

  async dispatch(type, data) {
    if (type !== 'GUILD_MEMBER_ADD' || !this.config.memberEventsEnabled || data?.guild_id !== this.config.guildId || !data.user?.id || data.user.bot || data.pending || !this.autoroles().length) return;
    try { await this.applyAutoroles(data.user.id); }
    catch { this.#log('autorole_assignment_failed'); }
  }

  tick() {
    if (this.stopping || this.tickTask) return this.tickTask || Promise.resolve();
    const task = this.#serialize(async () => {
      const ready = this.list().filter((menu) => menu.pending && (!menu.retryAt || Date.parse(menu.retryAt) <= this.now()));
      // One publication per pass bounds background API work and rotates failed jobs
      // through their retry times rather than blocking the rest of the queue.
      ready.sort((a, b) => Date.parse(a.retryAt || '1970-01-01') - Date.parse(b.retryAt || '1970-01-01'));
      if (!this.stopping && ready[0]) await this.#attempt(ready[0]);
    });
    this.tickTask = task;
    void task.finally(() => { if (this.tickTask === task) this.tickTask = null; }).catch(() => {});
    return task;
  }

  async #attempt(menu) {
    try {
      try {
        const channel = await this.discord.request('GET', `/channels/${menu.channelId}`);
        if (channel.guild_id !== this.config.guildId || channel.type !== 0) throw new Error('Role menu channel is outside the configured server.');
      } catch (error) {
        if (error.statusCode === 404 && menu.state !== 'enabled') { await this.store.delivered(menu.id, null); return; }
        throw error;
      }
      if (menu.messageId) {
        try {
          const message = await this.discord.request('GET', `/channels/${menu.channelId}/messages/${menu.messageId}`);
          if (message.author?.id !== this.botUserId) throw new Error('Role menu message was not created by this bot.');
        } catch (error) {
          if (error.statusCode !== 404) throw error;
          menu = { ...menu, messageId: null };
        }
      }
      if (menu.state === 'deleting') {
        if (menu.messageId) {
          try { await this.discord.deleteChannelMessage(menu.channelId, menu.messageId, 'Latch role menu deleted'); }
          catch (error) { if (error.statusCode !== 404) throw error; }
        }
        await this.store.delivered(menu.id, menu.messageId);
        return;
      }
      if (menu.state === 'enabled') {
        const context = await this.#context();
        for (const role of menu.roles) await this.#role(role.id, context);
      }
      const data = menuMessage(menu);
      let messageId = menu.messageId;
      if (messageId) {
        try { await this.discord.editMessage(menu.channelId, messageId, data); }
        catch (error) { if (error.statusCode !== 404) throw error; messageId = null; }
      }
      if (!messageId && menu.state === 'enabled') {
        const message = await this.discord.createMessage(menu.channelId, { ...data, nonce: menu.id, enforce_nonce: true });
        if (!message?.id) throw new Error('Role menu publication failed.');
        messageId = message.id;
      }
      await this.store.delivered(menu.id, messageId);
    } catch {
      this.#log('role_menu_publication_failed', { menuId: menu.id });
      await this.store.retry(menu.id, this.now()).catch(() => this.#log('role_menu_retry_save_failed'));
    }
  }

  async #context() {
    const [roles, bot] = await Promise.all([this.discord.request('GET', `/guilds/${this.config.guildId}/roles`), this.discord.getGuildMember(this.config.guildId, this.botUserId)]);
    if (!Array.isArray(roles) || !Array.isArray(bot.roles)) throw new Error('Role hierarchy unavailable.');
    const permissions = roles.filter((role) => role.id === this.config.guildId || bot.roles.includes(role.id)).reduce((bits, role) => bits | BigInt(role.permissions), 0n);
    if (!(permissions & ((1n << 28n) | 8n))) throw new Error('Bot needs Manage Roles.');
    const botPosition = Math.max(0, ...roles.filter((role) => bot.roles.includes(role.id)).map((role) => role.position));
    if (!Number.isInteger(botPosition)) throw new Error('Bot role hierarchy is invalid.');
    return { roles, botPosition };
  }

  async #role(id, context, actorId) {
    const role = context.roles.find((item) => item.id === id);
    if (!role || role.id === this.config.guildId || role.managed || BigInt(role.permissions) !== 0n || !Number.isInteger(role.position) || role.position >= context.botPosition) throw new Error('Only permission-free unmanaged roles below the bot are eligible.');
    if (actorId) {
      if (context.actorId !== actorId) {
        const [actor, guild] = await Promise.all([this.discord.getGuildMember(this.config.guildId, actorId), this.discord.getGuild(this.config.guildId)]);
        context.actor = actor; context.guild = guild; context.actorId = actorId;
      }
      const { actor, guild } = context;
      if (guild.owner_id !== actorId) {
        const permissions = context.roles.filter((item) => item.id === this.config.guildId || actor.roles?.includes(item.id)).reduce((bits, item) => bits | BigInt(item.permissions), 0n);
        const position = Math.max(0, ...context.roles.filter((item) => actor.roles?.includes(item.id)).map((item) => item.position));
        if (!Number.isInteger(position) || !(permissions & ((1n << 28n) | 8n)) || role.position >= position) throw new Error('Role must be below the configuring staff member.');
      }
    }
    return role;
  }

  #serialize(work) { const task = this.queue.then(work); this.queue = task.catch(() => {}); return task; }
  #log(event, details = {}) { try { this.logger(event, details); } catch {} }
}

module.exports = { RoleMenuService, menuMessage };
