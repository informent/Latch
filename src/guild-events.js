'use strict';

class GuildEventService {
  constructor({ config, discord, levels, levelRewards, logger = () => {}, now = Date.now }) {
    this.config = config;
    this.discord = discord;
    this.levels = levels;
    this.levelRewards = levelRewards;
    this.logger = logger;
    this.now = now;
    this.joins = [];
    this.alertedAt = 0;
  }

  async dispatch(type, data) {
    if (type === 'MESSAGE_CREATE') {
      if (this.config.levelingEnabled && data?.guild_id === this.config.guildId && data.channel_id && data.author?.id && !data.author.bot && !data.webhook_id && typeof data.content === 'string' && data.content.trim().length > 0) {
        if (![data.guild_id, data.channel_id, data.author.id, data.id].every((id) => typeof id === 'string' && /^\d{5,25}$/.test(id))) return;
        if (![0, 19].includes(data.type ?? 0)) return;
        if (typeof data.timestamp !== 'string') return;
        {
          const created = Date.parse(data.timestamp), now = this.now();
          if (!Number.isFinite(created) || created > now + 5000 || now - created > 300_000) return;
        }
        let award;
        try { award = await this.levels?.awardMessage(data.guild_id, data.author.id, { channelId: data.channel_id, messageId: data.id }); }
        catch (error) { this.#log('level_award_failed', { guildId: data.guild_id, message: error.message }); return; }
        if (award?.awarded) {
          try { await this.levelRewards?.schedule(data.author.id); }
          catch { this.#log('level_reward_schedule_failed', { guildId: data.guild_id, userId: data.author.id }); }
        }
      }
      return;
    }
    if (type !== 'GUILD_MEMBER_ADD' || !this.config.memberEventsEnabled || !data?.guild_id || data.guild_id !== this.config.guildId || !data.user?.id || data.user.bot) return;
    const threshold = this.config.raidJoinThreshold;
    if (threshold > 0) {
      const now = this.now();
      this.joins = this.joins.filter((at) => now - at < this.config.raidJoinWindowMs);
      this.joins.push(now);
      if (this.joins.length >= threshold && (this.alertedAt === 0 || now - this.alertedAt >= this.config.raidJoinWindowMs)) {
        this.alertedAt = now;
        this.#log('raid_join_burst_detected', { guildId: data.guild_id, joinCount: this.joins.length, windowMs: this.config.raidJoinWindowMs });
      }
    }
    if (!this.config.welcomeChannelId) return;
    const message = this.config.welcomeMessage
      .replaceAll('{user}', `<@${data.user.id}>`)
      .replaceAll('{server}', String(data.guild_name || 'the server').slice(0, 100))
      .slice(0, 1900);
    try {
      await this.discord.createMessage(this.config.welcomeChannelId, { content: message, allowed_mentions: { parse: [], users: [data.user.id] } });
    } catch (error) {
      this.#log('welcome_message_failed', { guildId: data.guild_id, channelId: this.config.welcomeChannelId, message: error.message });
    }
  }

  #log(event, details) {
    try { this.logger(event, details); } catch {}
  }
}

module.exports = { GuildEventService };
