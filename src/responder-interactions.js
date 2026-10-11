'use strict';

function createResponderHandler({ config, responders, discord, logger }, { response, defer, hasPermission, findOption }) {
  return (interaction) => {
    if (!hasPermission(interaction.member?.permissions, 32n)) return { immediate: response('You need Manage Server to configure responders.') };
    if (!responders) return { immediate: response('Responders are unavailable.') };
    const subcommand = interaction.data.options?.[0];
    const action = subcommand?.name;
    const options = subcommand?.options || [];
    const name = findOption(options, 'name');
    return { immediate: defer(), work: async () => {
      try {
        let content;
        if (action === 'create' || action === 'update') {
          const channel = await discord.request('GET', `/channels/${interaction.channel_id}`);
          if (channel.guild_id !== config.guildId || channel.type !== 0) throw new Error();
          if (action === 'update' && responders.get(name)?.channelId !== interaction.channel_id) throw new Error();
          await responders.change(action, { name, channelId: interaction.channel_id, trigger: findOption(options, 'trigger'), reply: findOption(options, 'reply'), cooldown: findOption(options, 'cooldown') ?? 30 });
          content = `Responder ${name} saved and disabled. Review with info or preview, then enable it.`;
        } else if (action === 'list') {
          const rules = responders.list().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
          const page = findOption(options, 'page') ?? 1;
          const pages = Math.max(1, Math.ceil(rules.length / 10));
          if (!Number.isInteger(page) || page < 1 || page > pages) {
            content = `Choose a page from 1 to ${pages}.`;
          } else {
            content = `Message automation: ${config.respondersEnabled ? 'enabled' : 'disabled in environment'}\nResponders: ${rules.length} | Page ${page}/${pages}\n` + (rules.slice((page - 1) * 10, page * 10).map((rule) => `${rule.name}: ${rule.enabled ? 'enabled' : 'disabled'} | <#${rule.channelId}> | ${rule.cooldown}s`).join('\n') || 'No responders configured.');
          }
        } else {
          const rule = responders.get(name);
          if (!rule) throw new Error();
          if (action === 'info') content = `Name: ${rule.name}\nChannel: <#${rule.channelId}>\nState: ${rule.enabled ? 'enabled' : 'disabled'}\nCooldown: ${rule.cooldown}s\nExact trigger: ${rule.trigger}\nReply length: ${rule.reply.length}\nMessage automation: ${config.respondersEnabled ? 'enabled' : 'disabled in environment'}`;
          else if (action === 'preview') content = rule.reply;
          else if (['enable', 'disable', 'delete'].includes(action)) {
            if (action === 'enable' && !config.respondersEnabled) throw new Error();
            await responders.change(action, { name }); content = `Responder ${name}: ${action} complete.`;
          } else throw new Error();
        }
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: content.slice(0, 1900), allowed_mentions: { parse: [] } });
      } catch {
        logger('responder_configuration_failed', { action });
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Responder action failed. Use an existing name or a new create name, unique exact trigger per channel, nonempty reply and a cooldown of 15-3600 seconds. Maximum 50 rules. Create/update must run in the assigned server text channel. Enabling requires DISCORD_RESPONDERS_ENABLED=true and Gateway Message Content access.', allowed_mentions: { parse: [] } }).catch(() => {});
      }
    } };
  };
}
module.exports = { createResponderHandler };
