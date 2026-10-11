'use strict';

function createTimerHandler({ config, timers, discord, logger }, { response, defer, hasPermission, findOption }) {
  return (interaction) => {
    if (!hasPermission(interaction.member?.permissions, 32n)) return { immediate: response('You need Manage Server to configure recurring messages.') };
    if (!timers) return { immediate: response('Recurring messages are unavailable.') };
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
          if (action === 'update' && timers.get(name)?.channelId !== interaction.channel_id) throw new Error();
          await timers.change(action, { name, channelId: interaction.channel_id, text: findOption(options, 'text'), interval: findOption(options, 'minutes') });
          content = `Timer ${name} saved and disabled. Review its preview, then enable it.`;
        } else if (action === 'list') {
          const items = timers.list().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
          const page = findOption(options, 'page') ?? 1;
          const pages = Math.max(1, Math.ceil(items.length / 10));
          if (!Number.isInteger(page) || page < 1 || page > pages) {
            content = `Choose a page from 1 to ${pages}.`;
          } else {
            content = `Timers: ${items.length} | Page ${page}/${pages}\n` + (items.slice((page - 1) * 10, page * 10).map((item) => `${item.name}: ${item.enabled ? 'enabled' : 'disabled'} | <#${item.channelId}> | ${item.interval}m | ${item.lastResult}`).join('\n') || 'No recurring messages configured.');
          }
        } else {
          const item = timers.get(name);
          if (!item) throw new Error();
          if (action === 'info') content = `Name: ${item.name}\nChannel: <#${item.channelId}>\nState: ${item.enabled ? 'enabled' : 'disabled'}\nInterval: ${item.interval} minutes\nNext attempt: ${item.enabled ? `<t:${Math.floor(item.nextAt / 1000)}:R>` : 'none'}\nLast result: ${item.lastResult}\nLast attempt: ${item.lastAttemptAt ? `<t:${Math.floor(item.lastAttemptAt / 1000)}:R>` : 'none'}`;
          else if (action === 'preview') content = item.text;
          else if (action === 'reschedule') {
            await timers.change(action, { name, minutes: findOption(options, 'minutes') });
            content = `Timer ${name}: next attempt rescheduled. The recurring interval is unchanged. An already running delivery cannot be undone.`;
          } else if (action === 'move') {
            const channelId = findOption(options, 'channel');
            if (typeof channelId !== 'string' || !/^\d{5,25}$/.test(channelId)) throw new Error();
            const channel = await discord.request('GET', `/channels/${channelId}`);
            if (channel.id !== channelId || channel.guild_id !== config.guildId || channel.type !== 0) throw new Error();
            await timers.change(action, { name, channelId });
            content = `Timer ${name}: moved to <#${channelId}> and disabled. Preview it and enable it when ready. An already running delivery cannot be undone.`;
          }
          else if (['enable', 'disable', 'delete'].includes(action)) {
            await timers.change(action, { name });
            content = `Timer ${name}: ${action} complete. Enabling starts after one full interval; disabling cannot undo a delivery already in flight.`;
          } else throw new Error();
        }
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: content.slice(0, 1900), allowed_mentions: { parse: [] } });
      } catch {
        logger('timer_configuration_failed', { action });
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Timer action failed. Use a valid new create name or existing name, nonempty text up to 1800 characters and an interval of 5-43200 minutes. Maximum 25 timers. Reschedule requires an enabled timer and 5-43200 minutes. Move requires an ordinary text channel in this server. Create/update must run in the assigned server text channel. Check bot channel access and store permissions.', allowed_mentions: { parse: [] } }).catch(() => {});
      }
    } };
  };
}
module.exports = { createTimerHandler };
