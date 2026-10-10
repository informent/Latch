'use strict';

class TimerService {
  constructor({ config, store, discord, logger = () => {}, now = Date.now }) {
    this.config = config; this.store = store; this.discord = discord; this.logger = logger; this.now = now;
    this.queue = Promise.resolve(); this.timer = null; this.tickTask = null; this.stopping = false;
  }
  serialize(work) {
    const task = this.queue.then(work); this.queue = task.catch(() => {}); return task;
  }
  start() {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => { void this.tick().catch(() => this.log('timer_tick_failed')); }, 15000);
    this.timer.unref?.();
    void this.tick().catch(() => this.log('timer_tick_failed'));
  }
  stop() { this.stopping = true; clearInterval(this.timer); this.timer = null; return this.queue; }
  log(event, name) { try { this.logger(event, name ? { name } : {}); } catch {} }
  list() { return this.store.list(); }
  get(name) { return this.store.get(name); }
  change(action, input) { return this.serialize(() => this.store.change(action, input, this.now())); }
  tick() {
    if (this.stopping) return Promise.resolve();
    if (this.tickTask) return this.tickTask;
    this.tickTask = this.serialize(async () => {
      if (this.stopping) return;
      const now = this.now();
      const due = this.store.list().filter((item) => item.enabled && item.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt || a.name.localeCompare(b.name))[0];
      if (!due) return;
      const item = await this.store.claim(due.name, now);
      if (!item) return;
      let success = false;
      try {
        const channel = await this.discord.request('GET', `/channels/${item.channelId}`);
        if (channel.guild_id !== this.config.guildId || channel.type !== 0) throw new Error();
        await this.discord.createMessage(item.channelId, { content: item.text, allowed_mentions: { parse: [] }, nonce: item.nonce, enforce_nonce: true });
        success = true;
      } catch { this.log('timer_delivery_failed', item.name); }
      await this.store.finish(item.name, item.nonce, success);
    }).finally(() => { this.tickTask = null; });
    return this.tickTask;
  }
}
module.exports = { TimerService };
