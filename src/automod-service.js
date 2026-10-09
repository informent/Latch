'use strict';

const PREFIX = 'OpenDesk: ';
class AutoModService {
  constructor({ discord, guildId, botUserId }) {
    this.discord = discord;
    this.guildId = guildId;
    this.botUserId = botUserId;
  }
  async list() { return this.discord.listAutoModRules(this.guildId); }
  async create({ kind, name, keywords, limit, actorId }) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new Error('Rule name must contain 1 to 80 characters.');
    let trigger_type;
    let trigger_metadata = {};
    if (kind === 'keywords') {
      const terms = [...new Set(String(keywords || '').split(',').map((term) => term.trim()).filter(Boolean))];
      if (!terms.length || terms.length > 100 || terms.some((term) => term.length > 60)) throw new Error('Enter 1 to 100 comma-separated keywords, each at most 60 characters.');
      trigger_type = 1;
      trigger_metadata = { keyword_filter: terms };
    } else if (kind === 'mentions') {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Mention limit must be from 1 to 50.');
      trigger_type = 5;
      trigger_metadata = { mention_total_limit: limit, mention_raid_protection_enabled: true };
    } else if (kind === 'spam') trigger_type = 3;
    else throw new Error('Choose a supported AutoMod rule type.');
    return this.discord.createAutoModRule(this.guildId, {
      name: PREFIX + name.trim(), event_type: 1, trigger_type, trigger_metadata,
      actions: [{ type: 1 }], enabled: false, exempt_roles: [], exempt_channels: []
    }, `AutoMod rule created by ${actorId}`);
  }
  async change({ ruleId, action, actorId }) {
    if (!/^\d{5,25}$/.test(ruleId || '')) throw new Error('Enter a valid rule ID.');
    const rule = await this.discord.getAutoModRule(this.guildId, ruleId);
    if (rule.creator_id !== this.botUserId || !rule.name?.startsWith(PREFIX)) throw new Error('OpenDesk can only change its own AutoMod rules.');
    if (action === 'remove') return this.discord.deleteAutoModRule(this.guildId, ruleId, `AutoMod rule removed by ${actorId}`);
    if (!['enable', 'disable'].includes(action)) throw new Error('Choose enable, disable, or remove.');
    return this.discord.editAutoModRule(this.guildId, ruleId, { enabled: action === 'enable' }, `AutoMod rule ${action}d by ${actorId}`);
  }
}
module.exports = { AutoModService };
