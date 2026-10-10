'use strict';
function createLevelHandler({ config, levels, discord, logger = () => {} }, { response, defer, hasPermission, findOption }) {
  return async (interaction) => {
    if (!hasPermission(interaction.member?.permissions, 32n)) return { immediate: response('You need Manage Server to configure leveling.') };
    if (!levels) return { immediate: response('Leveling is unavailable.') };
    const sub = interaction.data.options?.[0], action = sub?.name;
    if (!['show', 'tune', 'reset', 'ignore', 'unignore', 'ignored', 'enable', 'disable'].includes(action)) return { immediate: response('Choose a leveling configuration action.') };
    return { immediate: defer(), work: async () => {
      try {
        const get = (name) => findOption(sub.options || [], name);
        let setting;
        if (action === 'show' || action === 'ignored') setting = levels.getSettings(config.guildId);
        else {
          const channelId = get('channel');
          if (action === 'ignore') {
            if (typeof channelId !== 'string' || !/^\d{5,25}$/.test(channelId)) throw new Error();
            const channel = await discord.request('GET', `/channels/${channelId}`);
            if (channel?.id !== channelId || channel.guild_id !== config.guildId || ![0, 5, 10, 11, 12, 15, 16].includes(channel.type)) throw new Error();
          }
          setting = await levels.configure(config.guildId, action, { xp: get('xp'), cooldownMs: get('cooldown') * 1000, channelId });
        }
        const page = get('page') ?? 1;
        if (!Number.isSafeInteger(page) || page < 1 || page > 5) throw new Error();
        const content = action === 'ignored'
          ? `**Ignored XP channels (${setting.ignoredChannels.length}/100), page ${page}/5**\n${setting.ignoredChannels.slice((page - 1) * 20, page * 20).map((id) => `<#${id}>`).join('\n') || 'No entries on this page.'}\nOnly these exact channel IDs are ignored; threads need their own entry.`
          : `**Leveling settings${action === 'show' ? '' : ' saved'}**\nXP per message: ${setting.xp}\nCooldown: ${setting.cooldownMs / 1000} seconds\nServer awards: ${setting.enabled ? 'enabled' : 'paused'}\nGateway XP setting: ${config.levelingEnabled ? 'enabled' : 'disabled in environment'}\nIgnored channels: ${setting.ignoredChannels.length}/100\nExisting XP and last-award cooldowns are preserved.${action === 'reset' ? '\nDefaults restored, ignored channels cleared and server awards enabled.' : ''}`;
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: content.slice(0, 1900), allowed_mentions: { parse: [] } });
      } catch {
        try { logger('level_configuration_failed', { action }); } catch {}
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Level configuration failed. Check XP (1-100), cooldown (15-3600 seconds), channel ownership/type, the 100-channel limit and store access. Use /levelconfig show before retrying.', allowed_mentions: { parse: [] } }).catch(() => {});
      }
    } };
  };
}
module.exports = { createLevelHandler };
