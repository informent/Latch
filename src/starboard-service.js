'use strict';
const { randomBytes } = require('node:crypto');
const { ID } = require('./starboard-store');
const STAR = String.fromCodePoint(0x2b50);
class StarboardService {
  constructor({ config, store, discord, botUserId, logger = () => {} }) {
    Object.assign(this, { config, store, discord, botUserId, logger });
    this.queue = Promise.resolve();
    this.timer = null;
    this.offset = 0;
    this.scheduled = 0;
    this.reconciling = false;
    this.reconcileTask = null;
    this.running = false;
  }
  serialize(work) {
    if (this.scheduled >= 100)
      return Promise.reject(new Error('Starboard queue is full.'));
    this.scheduled++;
    const task = this.queue.then(work).finally(() => {
      this.scheduled--;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  start() {
    if (!this.config.starboardEnabled || this.timer) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.reconcile();
    }, 60000);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    return Promise.all([this.queue, this.reconcileTask]);
  }
  reconcile() {
    if (this.reconcileTask) return this.reconcileTask;
    const task = this.reconcileBatch().finally(() => {
      if (this.reconcileTask === task) this.reconcileTask = null;
    });
    this.reconcileTask = task;
    return task;
  }
  async reconcileBatch() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const s = this.store.snapshot();
      if (!s.settings?.enabled) return;
      const active = s.entries.filter((e) => e.status !== 'deleted');
      if (!active.length) return;
      const batch = Array.from(
        { length: Math.min(5, active.length) },
        (_, n) => active[(this.offset + n) % active.length],
      );
      this.offset = (this.offset + batch.length) % active.length;
      for (const e of batch) {
        if (!this.running) break;
        try {
          await this.sync(e.channel, e.id);
        } catch {
          try {
            this.logger('starboard_reconcile_failed', {});
          } catch {}
        }
      }
    } finally {
      this.reconciling = false;
    }
  }
  async publicChannel(id) {
    if (!ID(id)) throw new Error('Invalid channel ID.');
    const [channel, roles] = await Promise.all([
      this.discord.request('GET', `/channels/${id}`),
      this.discord.request('GET', `/guilds/${this.config.guildId}/roles`),
    ]);
    if (
      channel?.id !== id ||
      channel.guild_id !== this.config.guildId ||
      channel.type !== 0 ||
      (channel.nsfw !== undefined && channel.nsfw !== false) ||
      !Array.isArray(channel.permission_overwrites) ||
      !Array.isArray(roles)
    )
      throw new Error('Choose a public, non-NSFW server text channel.');
    const everyone = roles.find((r) => r.id === this.config.guildId);
    if (!everyone || !/^\d+$/.test(everyone.permissions))
      throw new Error('Invalid server permissions.');
    let flags = BigInt(everyone.permissions);
    const seen = new Set();
    for (const o of channel.permission_overwrites) {
      if (
        !o ||
        !ID(o.id) ||
        ![0, 1].includes(o.type) ||
        !/^\d+$/.test(o.allow) ||
        !/^\d+$/.test(o.deny) ||
        seen.has(`${o.type}:${o.id}`)
      )
        throw new Error('Invalid channel permissions.');
      seen.add(`${o.type}:${o.id}`);
      if (o.id === this.config.guildId && o.type === 0)
        flags = (flags & ~BigInt(o.deny)) | BigInt(o.allow);
    }
    if ((flags & 1024n) !== 1024n)
      throw new Error('Private channels cannot be used for starboards.');
    return channel;
  }
  configure({ destination, source, threshold }) {
    return this.serialize(async () => {
      if (!this.config.starboardEnabled)
        throw new Error('Enable DISCORD_STARBOARD_ENABLED first.');
      if (
        destination === source ||
        !Number.isInteger(threshold) ||
        threshold < 2 ||
        threshold > 50
      )
        throw new Error(
          'Choose separate channels and a threshold from 2 to 50.',
        );
      await Promise.all([
        this.publicChannel(destination),
        this.publicChannel(source),
      ]);
      await this.store.mutate((s) => {
        if (s.entries.length && s.settings.destination !== destination)
          throw new Error(
            'Destination cannot change while tracked highlights exist.',
          );
        const sources =
          s.settings?.destination === destination
            ? [...new Set([...s.settings.sources, source])]
            : [source];
        s.settings = { destination, sources, threshold, enabled: true };
      });
    });
  }
  pause() {
    return this.serialize(() =>
      this.store.mutate((s) => {
        if (!s.settings) throw new Error('Configure starboard first.');
        s.settings.enabled = false;
      }),
    );
  }
  async count(channel, id, author) {
    const started = Date.now();
    let after,
      count = 0;
    const seen = new Set();
    for (let page = 0; page < 10; page++) {
      if (Date.now() - started > 45000)
        throw new Error('Reaction scan timed out.');
      const users = await this.discord.request(
        'GET',
        `/channels/${channel}/messages/${id}/reactions/${encodeURIComponent(STAR)}?type=0&limit=100${after ? `&after=${after}` : ''}`,
      );
      if (Date.now() - started > 45000)
        throw new Error('Reaction scan timed out.');
      if (!Array.isArray(users) || users.length > 100)
        throw new Error('Invalid reaction page.');
      for (const user of users) {
        if (
          !ID(user?.id) ||
          seen.has(user.id) ||
          (after && BigInt(user.id) <= BigInt(after))
        )
          throw new Error('Invalid reaction cursor.');
        seen.add(user.id);
        if (!user.bot && user.id !== author) count++;
      }
      if (users.length < 100) return count;
      after = users.reduce(
        (max, u) => (BigInt(u.id) > BigInt(max) ? u.id : max),
        users[0].id,
      );
    }
    throw new Error(
      'Reaction scan exceeds 1000 users; no partial count was published.',
    );
  }
  marker(e) {
    return `Latch starboard ${e.id}`;
  }
  body(e) {
    return {
      content: `${STAR} ${e.count} | <https://discord.com/channels/${this.config.guildId}/${e.channel}/${e.id}>\n${this.marker(e)}`,
      flags: 4,
      allowed_mentions: { parse: [] },
    };
  }
  owned(post, e) {
    return (
      post?.author?.id === this.botUserId &&
      post.channel_id === this.store.snapshot().settings.destination &&
      typeof post.content === 'string' &&
      post.content.split('\n').at(-1) === this.marker(e)
    );
  }
  sync(channel, id) {
    return this.serialize(() => this.refresh(channel, id));
  }
  async refresh(channel, id) {
    if (!ID(channel) || !ID(id)) throw new Error('Invalid message IDs.');
    let s = this.store.snapshot();
    const c = s.settings;
    if (
      !this.config.starboardEnabled ||
      !c?.enabled ||
      !c.sources.includes(channel)
    )
      return 'Starboard is paused or the source is not configured.';
    await Promise.all([
      this.publicChannel(channel),
      this.publicChannel(c.destination),
    ]);
    const message = await this.discord.request(
      'GET',
      `/channels/${channel}/messages/${id}`,
    );
    if (
      message?.id !== id ||
      message.channel_id !== channel ||
      !ID(message.author?.id) ||
      message.author.bot ||
      message.webhook_id ||
      ![0, 19].includes(message.type ?? 0)
    )
      throw new Error('Choose a regular human message in a configured source.');
    const count = await this.count(channel, id, message.author.id);
    let e = s.entries.find((e) => e.id === id);
    if (e?.channel !== channel && e)
      throw new Error('Message channel mismatch.');
    if (e?.status === 'deleted')
      return 'This highlight was retired after source deletion.';
    if (!e && count < c.threshold)
      return `Below threshold: ${count}/${c.threshold}.`;
    // Recheck visibility after the reaction scan before any destination write.
    await Promise.all([
      this.publicChannel(channel),
      this.publicChannel(c.destination),
    ]);
    if (e?.status === 'pending') {
      const posts = await this.discord.getChannelMessages(c.destination, 100);
      if (!Array.isArray(posts) || posts.length > 100)
        throw new Error('Invalid recovery history.');
      const found = posts.filter((p) => this.owned(p, e));
      if (found.length !== 1 || !ID(found[0].id))
        throw new Error(
          'Pending publication needs staff inspection; no duplicate was sent.',
        );
      await this.store.mutate((s) => {
        const saved = s.entries.find((x) => x.id === id);
        saved.post = found[0].id;
        saved.status = 'posted';
      });
      e = this.store.snapshot().entries.find((x) => x.id === id);
    }
    if (!e) {
      e = {
        id,
        channel,
        author: message.author.id,
        count,
        nonce: randomBytes(12).toString('hex'),
        post: null,
        status: 'pending',
      };
      await this.store.mutate((s) => s.entries.push(e));
      const post = await this.discord.createMessage(c.destination, {
        ...this.body(e),
        nonce: e.nonce,
        enforce_nonce: true,
      });
      if (!ID(post?.id) || !this.owned(post, e))
        throw new Error('Publication receipt could not be verified.');
      await this.store.mutate((s) => {
        const saved = s.entries.find((x) => x.id === id);
        saved.post = post.id;
        saved.status = 'posted';
      });
    } else {
      const post = await this.discord.request(
        'GET',
        `/channels/${c.destination}/messages/${e.post}`,
      );
      if (!this.owned(post, e))
        throw new Error('Highlight ownership could not be verified.');
      const next = { ...e, count };
      await this.discord.editMessage(c.destination, e.post, this.body(next));
      await this.store.mutate((s) => {
        s.entries.find((x) => x.id === id).count = count;
      });
    }
    return `Highlight synchronized: ${count} eligible normal stars.`;
  }
  remove(channel, id) {
    return this.serialize(async () => {
      const s = this.store.snapshot(),
        e = s.entries.find((e) => e.id === id && e.channel === channel);
      if (!e || e.status === 'deleted') return;
      if (e.status === 'pending')
        throw new Error('Resolve pending highlight before deletion.');
      const p = await this.discord.request(
        'GET',
        `/channels/${s.settings.destination}/messages/${e.post}`,
      );
      if (!this.owned(p, e))
        throw new Error('Highlight ownership could not be verified.');
      await this.discord.deleteChannelMessage(s.settings.destination, e.post);
      await this.store.mutate((s) => {
        const saved = s.entries.find((x) => x.id === id);
        saved.status = 'deleted';
        saved.post = null;
      });
    });
  }
  async dispatch(type, data) {
    if (!this.config.starboardEnabled || data?.guild_id !== this.config.guildId)
      return;
    try {
      if (type === 'MESSAGE_DELETE')
        await this.remove(data.channel_id, data.id);
      else if (
        [
          'MESSAGE_REACTION_ADD',
          'MESSAGE_REACTION_REMOVE',
          'MESSAGE_REACTION_REMOVE_ALL',
          'MESSAGE_REACTION_REMOVE_EMOJI',
        ].includes(type) &&
        (type === 'MESSAGE_REACTION_REMOVE_ALL' ||
          (data.emoji?.id == null && data.emoji?.name === STAR))
      )
        await this.sync(data.channel_id, data.message_id);
    } catch {
      try {
        this.logger('starboard_sync_failed', {});
      } catch {}
    }
  }
}
module.exports = { StarboardService, STAR };
