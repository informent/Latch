'use strict';

const PREFIX = 'Latch: ';
const LEGACY_PREFIX = 'OpenDesk: ';
const ID = (value) => typeof value === 'string' && /^\d{5,25}$/.test(value);
const PRESETS = Object.freeze({ profanity: Object.freeze([1]), sexual: Object.freeze([2]), slurs: Object.freeze([3]), all: Object.freeze([1, 2, 3]) });
class AutoModService {
  constructor({ discord, guildId, botUserId }) {
    this.discord = discord;
    this.guildId = guildId;
    this.botUserId = botUserId;
    this.queue = Promise.resolve();
  }
  async list() { return this.discord.listAutoModRules(this.guildId); }
  async create({ kind, name, keywords, limit, preset, actorId }) {
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
    } else if (kind === 'presets') {
      if (!Object.hasOwn(PRESETS, preset || '')) throw new Error('Choose a supported preset.');
      trigger_type = 4;
      trigger_metadata = { presets: [...PRESETS[preset]], allow_list: [] };
    } else if (kind === 'spam') trigger_type = 3;
    else throw new Error('Choose a supported AutoMod rule type.');
    return this.discord.createAutoModRule(this.guildId, {
      name: PREFIX + name.trim(), event_type: 1, trigger_type, trigger_metadata,
      actions: [{ type: 1 }], enabled: false, exempt_roles: [], exempt_channels: []
    }, `AutoMod rule created by ${actorId}`);
  }
  async change({ ruleId, action, actorId }) {
    return this.#serialize(async () => {
      const rule = await this.#owned(ruleId);
      if (action === 'remove') return this.discord.deleteAutoModRule(this.guildId, ruleId, `AutoMod rule removed by ${actorId}`);
      if (!['enable', 'disable'].includes(action)) throw new Error('Choose enable, disable, or remove.');
      return this.discord.editAutoModRule(this.guildId, ruleId, { enabled: action === 'enable' }, `AutoMod rule ${action}d by ${actorId}`);
    });
  }
  async inspect(ruleId) { return structuredClone(await this.#owned(ruleId)); }
  configure({ ruleId, action, targetId, words, message, actorId }) {
    return this.#serialize(async () => {
      const rule = await this.#owned(ruleId); let patch;
      if (['exempt-role', 'unexempt-role', 'exempt-channel', 'unexempt-channel'].includes(action)) {
        const role = action.endsWith('role'); const adding = !action.startsWith('unexempt');
        const field = role ? 'exempt_roles' : 'exempt_channels'; const maximum = role ? 20 : 50;
        const previous = rule[field];
        if (!ID(targetId) || role && targetId === this.guildId) throw new Error('Choose a valid target; everyone cannot be exempted.');
        if (!Array.isArray(previous) || previous.length > maximum || previous.some((id) => !ID(id)) || new Set(previous).size !== previous.length) throw new Error('Rule exemptions are invalid.');
        if (adding) {
          if (role) {
            const roles = await this.discord.request('GET', `/guilds/${this.guildId}/roles`);
            if (!Array.isArray(roles) || !roles.some((entry) => entry.id === targetId)) throw new Error('Choose a current server role.');
          } else {
            const channel = await this.discord.request('GET', `/channels/${targetId}`);
            if (channel.id !== targetId || channel.guild_id !== this.guildId) throw new Error('Choose a channel in this server.');
          }
        }
        const next = adding ? [...new Set([...previous, targetId])] : previous.filter((id) => id !== targetId);
        if (next.length > maximum) throw new Error('Exemption limit reached.');
        if (next.join(',') === previous.join(',')) return { changed: false };
        patch = { [field]: next };
      } else if (action === 'allow-words') {
        if (![1, 4].includes(rule.trigger_type) || !rule.trigger_metadata || typeof words !== 'string') throw new Error('Allow words require a keyword or preset rule.');
        const allow_list = [...new Set(words.split(',').map((word) => word.trim()).filter(Boolean))];
        if (words.trim() && !allow_list.length || allow_list.length > 100 || allow_list.some((word) => word.length > 60)) throw new Error('Use up to 100 allowed words, each at most 60 characters.');
        patch = { trigger_metadata: { ...rule.trigger_metadata, allow_list } };
      } else if (action === 'block-message') {
        if (typeof message !== 'string' || !message.trim() || message.length > 150 || !Array.isArray(rule.actions) || !rule.actions.some((entry) => entry.type === 1)) throw new Error('Use a 1 to 150 character explanation on a message-blocking rule.');
        patch = { actions: rule.actions.map((entry) => entry.type === 1 ? { ...entry, metadata: { ...entry.metadata, custom_message: message.trim() } } : entry) };
      } else throw new Error('Choose a supported AutoMod configuration action.');
      await this.discord.editAutoModRule(this.guildId, ruleId, patch, `AutoMod ${action} by ${actorId}`);
      return { changed: true };
    });
  }
  policy({ ruleId, mode, channelId, seconds, actorId }) {
    return this.#serialize(async () => {
      const rule = await this.#owned(ruleId);
      if (![1, 3, 4, 5].includes(rule.trigger_type) || rule.event_type !== 1) throw new Error('Only message filtering rules support this policy.');
      if (!['block', 'alert', 'block-alert', 'block-timeout', 'block-alert-timeout'].includes(mode)) throw new Error('Choose a supported action policy.');
      const alert = mode.includes('alert'); const timeout = mode.includes('timeout');
      if (alert !== (channelId !== undefined) || timeout !== (seconds !== undefined)) throw new Error('Provide a channel only for alert policies and seconds only for timeout policies.');
      if (timeout && (![1, 5].includes(rule.trigger_type) || !Number.isInteger(seconds) || seconds < 1 || seconds > 2419200)) throw new Error('Timeouts require a keyword or mention rule and 1 to 2419200 seconds.');
      if (alert) {
        if (!ID(channelId)) throw new Error('Choose a valid alert channel.');
        const channel = await this.discord.request('GET', `/channels/${channelId}`);
        if (!channel || channel.id !== channelId || channel.guild_id !== this.guildId || ![0, 5].includes(channel.type)) throw new Error('Choose a server text or announcement channel for alerts.');
      }
      if (!Array.isArray(rule.actions) || rule.actions.some((entry) => !entry || ![1, 2, 3].includes(entry.type)) || new Set(rule.actions.map((entry) => entry.type)).size !== rule.actions.length) throw new Error('Rule actions are invalid or unsupported.');
      const actions = [];
      if (mode !== 'alert') {
        const message = rule.actions.find((entry) => entry.type === 1)?.metadata?.custom_message;
        if (message !== undefined && (typeof message !== 'string' || !message.trim() || message.length > 150)) throw new Error('Rule block explanation is invalid.');
        actions.push(message === undefined ? { type: 1 } : { type: 1, metadata: { custom_message: message } });
      }
      if (alert) actions.push({ type: 2, metadata: { channel_id: channelId } });
      if (timeout) actions.push({ type: 3, metadata: { duration_seconds: seconds } });
      if (JSON.stringify(actions) === JSON.stringify(rule.actions)) return { changed: false };
      await this.discord.editAutoModRule(this.guildId, ruleId, { actions }, `AutoMod action policy by ${actorId}`);
      return { changed: true };
    });
  }
  editFilter({ ruleId, kind, keywords, limit, raidProtection, name, actorId }) {
    return this.#serialize(async () => {
      const rule = await this.#owned(ruleId); let patch;
      if (kind === 'rename') {
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\r\n\u0000]/.test(name)) throw new Error('Use a single-line rule name of 1 to 80 characters.');
        patch = { name: PREFIX + name.trim() };
      } else {
        if (rule.event_type !== 1 || !rule.trigger_metadata || typeof rule.trigger_metadata !== 'object' || Array.isArray(rule.trigger_metadata)) throw new Error('Rule metadata is invalid.');
        if (kind === 'keywords-edit') {
          if (rule.trigger_type !== 1 || typeof keywords !== 'string') throw new Error('Choose a keyword message rule and enter keywords.');
          const terms = [...new Set(keywords.split(',').map((term) => term.trim()).filter(Boolean))];
          if (!terms.length || terms.length > 100 || terms.some((term) => term.length > 60)) throw new Error('Use 1 to 100 keywords, each at most 60 characters.');
          patch = { trigger_metadata: { ...rule.trigger_metadata, keyword_filter: terms } };
        } else if (kind === 'mentions-edit') {
          if (rule.trigger_type !== 5 || !Number.isInteger(limit) || limit < 1 || limit > 50 || raidProtection !== undefined && typeof raidProtection !== 'boolean') throw new Error('Choose a mention rule, a limit from 1 to 50 and an optional boolean raid setting.');
          patch = { trigger_metadata: { ...rule.trigger_metadata, mention_total_limit: limit, ...(raidProtection === undefined ? {} : { mention_raid_protection_enabled: raidProtection }) } };
        } else throw new Error('Choose a supported filter edit.');
      }
      if (Object.entries(patch).every(([key, value]) => JSON.stringify(value) === JSON.stringify(rule[key]))) return { changed: false };
      await this.discord.editAutoModRule(this.guildId, ruleId, patch, `AutoMod ${kind} by ${actorId}`);
      return { changed: true };
    });
  }
  async #owned(ruleId) {
    if (!ID(ruleId)) throw new Error('Enter a valid rule ID.');
    const rule = await this.discord.getAutoModRule(this.guildId, ruleId);
    if (!rule || rule.id !== ruleId || rule.guild_id !== this.guildId || rule.creator_id !== this.botUserId || typeof rule.name !== 'string' || ![PREFIX, LEGACY_PREFIX].some((prefix) => rule.name.startsWith(prefix))) throw new Error('Latch can only change its own AutoMod rules.');
    return structuredClone(rule);
  }
  #serialize(work) { const task = this.queue.then(work); this.queue = task.catch(() => {}); return task; }
}
module.exports = { AutoModService, PRESETS };
