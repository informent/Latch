'use strict';

function createCommunityHandler({ config, community, discord, logger }, { response, defer, hasPermission, safeText, findOption }) {
  return async (interaction, user) => {
    const name = interaction.data?.name;
    const component = interaction.type === 3 ? /^giveaway:(enter|leave):(\d{5,25})$/.exec(interaction.data?.custom_id || '') : null;
    if (interaction.type === 3 && !component) return { immediate: response('This button is not available.') };
    if (!community) return { immediate: response('Community scheduling is unavailable. Ask an administrator to check the bot setup.') };
    if (user.bot) return { immediate: response('These features are available to human members only.') };
    const subcommand = interaction.data?.options?.[0];
    const action = component ? component[1] : subcommand?.name;
    const edit = !component && name === 'giveaway' && action === 'edit' ? subcommand?.options?.[0] : null;
    const requirement = !component && name === 'giveaway' && action === 'requirements' ? subcommand?.options?.[0] : null;
    const options = edit ? edit.options || [] : requirement ? requirement.options || [] : subcommand?.options || [];
    if (name === 'reminder' && action === 'create' && !hasPermission(interaction.member?.permissions, 2048n)) return { immediate: response('You need Send Messages in this channel to schedule a public reminder.') };
    if (name === 'giveaway' && !hasPermission(interaction.member?.permissions, 8192n)) return { immediate: response('You need Manage Messages to manage giveaways. Members can enter with the giveaway buttons.') };
    if (!component && !['create', 'list', 'cancel', ...(name === 'giveaway' ? ['end', 'info', 'edit', 'reroll', 'requirements', 'eligibility', 'entrants'] : ['info', 'edit', 'reschedule'])].includes(action)) return { immediate: response('Choose a community action.') };
    if (action === 'requirements' && !['role-add', 'role-remove', 'levels', 'clear'].includes(requirement?.name)) return { immediate: response('Choose a giveaway requirement action.') };
    if (name === 'giveaway' && action === 'edit' && !['prize', 'duration', 'winners'].includes(edit?.name)) return { immediate: response('Choose a giveaway edit action.') };
    const id = component ? component[2] : action === 'create' ? interaction.id : findOption(options, 'id');
    if (action !== 'list' && (typeof id !== 'string' || !/^\d{5,25}$/.test(id))) return { immediate: response('Provide a valid reminder or giveaway ID.') };
    return { immediate: defer(), work: async () => {
      let content;
      try {
        if (component) {
          const result = await community.enter({ id, channelId: interaction.channel_id, messageId: interaction.message?.id, userId: user.id, leave: action === 'leave' });
          content = ({ entered: 'You entered the giveaway.', already: 'You are already entered.', left: 'You left the giveaway.', 'not-entered': 'You are not entered in this giveaway.' })[result.status];
        } else if (name === 'reminder') {
          if (action === 'create') {
            const job = await community.createReminder({ id, channelId: interaction.channel_id, userId: user.id, text: findOption(options, 'text'), minutes: findOption(options, 'minutes') });
            content = job.state === 'scheduled' ? `Reminder saved. It will be posted publicly in <#${job.channelId}> <t:${Math.floor(Date.parse(job.dueAt) / 1000)}:R>. ID: ${job.id}` : `Reminder ${job.id} is already ${job.state}.`;
          } else if (action === 'info') {
            const job = community.getReminder(id, user.id);
            content = `**Your reminder ${job.id}**\nState: ${job.state}\nChannel: <#${job.channelId}>\nDue: <t:${Math.floor(Date.parse(job.dueAt) / 1000)}:F>\nDelivery attempts: ${job.attempts}${job.retryAt ? `\nRetry: <t:${Math.floor(Date.parse(job.retryAt) / 1000)}:R>` : ''}\nText: ${safeText(job.text)}`;
          } else if (action === 'edit' || action === 'reschedule') {
            const job = await community.editReminder({ id, userId: user.id, field: action === 'edit' ? 'text' : 'minutes', value: findOption(options, action === 'edit' ? 'text' : 'minutes') });
            content = `Reminder ${job.id} ${action === 'edit' ? 'text saved' : 'rescheduled'}. It will be posted publicly in <#${job.channelId}> <t:${Math.floor(Date.parse(job.dueAt) / 1000)}:R>.`;
          } else if (action === 'cancel') {
            await community.cancelReminder(id, user.id);
            content = 'Reminder cancelled.';
          } else {
            const jobs = community.list('reminder', user.id);
            content = jobs.length ? `**Your pending reminders**\n${jobs.map((job) => `${job.id}: ${safeText(job.text.slice(0, 80))} | <t:${Math.floor(Date.parse(job.dueAt) / 1000)}:R>${job.attempts ? ' | delivery retry pending' : ''}`).join('\n')}` : 'You have no pending reminders.';
          }
        } else if (action === 'create') {
          const job = await community.createGiveaway({ id, channelId: interaction.channel_id, userId: user.id, text: findOption(options, 'prize'), minutes: findOption(options, 'minutes'), winnerCount: findOption(options, 'winners') ?? 1 });
          content = job.state === 'draft' ? `Giveaway ${job.id} is saved; publication will retry automatically. Check the bot Send Messages and Embed Links permissions.` : `Giveaway ${job.id} is ${job.state}. Members can enter using its buttons.`;
        } else if (action === 'requirements') {
          const job = await community.configureRequirements(id, requirement.name, { roleId: findOption(options, 'role'), minLevel: findOption(options, 'min') ?? 0, maxLevel: findOption(options, 'max') ?? null });
          content = `Giveaway ${id} requirements saved.${job.retryAt ? ' Public message update will retry.' : ''} Entrants are rechecked during selection.`;
        } else if (action === 'eligibility') {
          const result = await community.eligibility(id, findOption(options, 'user'));
          content = `**Current giveaway eligibility**\nEligible: ${result.eligible}\n${result.reason}${result.level === undefined ? '' : `\nLevel: ${result.level}`}\nThis preview makes no entry or winner changes.`;
        } else if (action === 'entrants') {
          const job = community.getGiveaway(id), page = findOption(options, 'page') ?? 1;
          if (!job || !Number.isSafeInteger(page) || page < 1 || page > 500) throw new Error();
          content = `**Giveaway entries (${job.entrants.length}), page ${page}/${Math.max(1, Math.ceil(job.entrants.length / 20))}**\n${job.entrants.slice((page - 1) * 20, page * 20).map((member) => `<@${member}>`).join('\n') || 'No entries on this page.'}\nSelection pending: ${job.selection?.remaining.length ?? 0}`;
        } else if (action === 'reroll') {
          const job = await community.rerollGiveaway(id, interaction.id);
          content = job.deliveredAt ? `Giveaway ${id} replacement winners published.` : job.state === 'selecting' ? `Giveaway ${id} replacement eligibility checks are saved and pending; the scheduler will continue.` : `Giveaway ${id} replacement winners saved. Result delivery will retry automatically.`;
        } else if (action === 'edit') {
          const field = edit.name;
          const value = findOption(options, field === 'duration' ? 'minutes' : field);
          const job = await community.editGiveaway(id, field, value);
          content = job.retryAt ? `Giveaway ${id} edit saved. Its public message update will retry automatically.` : `Giveaway ${id} ${field} updated.`;
        } else if (action === 'end') {
          const job = await community.endGiveaway(id);
          content = job.deliveredAt ? `Giveaway ${id} ended; its result is published.` : job.state === 'selecting' ? `Giveaway ${id} entry is closed. Eligibility checks are saved and pending; the scheduler will continue.` : `Giveaway ${id} ended. Winners are saved; result delivery will retry automatically.`;
        } else if (action === 'cancel') {
          const job = await community.cancelGiveaway(id);
          content = job.deliveredAt ? `Giveaway ${id} cancelled.` : `Giveaway ${id} cancelled; updating its message will retry automatically.`;
        } else if (action === 'info') {
          const job = community.getGiveaway(id);
          if (!job) throw new Error('Giveaway not found.');
          content = `**${safeText(job.text)}**\nID: ${job.id}\nStatus: ${job.state}\nEntries: ${job.entrants.length}\nEnds: <t:${Math.floor(Date.parse(job.dueAt) / 1000)}:R>\nWinners: ${job.winners.length ? job.winners.map((winner) => `<@${winner}>`).join(', ') : 'none selected'}\nRequired roles: ${job.requirements?.roles.map((role) => `<@&${role}>`).join(', ') || 'none'}\nLevel range: ${job.requirements?.minLevel ?? 0}-${job.requirements?.maxLevel ?? 'unlimited'}\nSelection remaining: ${job.selection?.remaining.length ?? 0}${job.attempts ? '\nDelivery retry pending.' : ''}`;
        } else {
          const jobs = community.list('giveaway');
          content = jobs.length ? `**Active giveaways**\n${jobs.map((job) => `${job.id}: ${safeText(job.text.slice(0, 40))} | ${job.state} | ${job.entrants.length} entries`).join('\n')}` : 'No active giveaways.';
        }
      } catch {
        try { logger('community_action_failed', { action, kind: component ? 'giveaway' : name }); } catch {}
        content = component ? 'Could not update your entry. Check current membership, screening, role/level requirements and the entry limit; the giveaway may be closed or unavailable.' : name === 'reminder' ? 'Could not complete the reminder action. Check the ID and ownership; use 1–43200 minutes, up to 500 characters, and at most 10 pending reminders. Only future reminders without delivery attempts can be edited or rescheduled.' : 'Could not complete the giveaway action. Check the ID; use 1–43200 minutes, a prize up to 200 characters, 1–20 winners, and at most 20 active giveaways.';
        if (!component && name === 'giveaway' && action === 'reroll') content = 'Could not reroll. The giveaway must have a published completed result and entrants other than its current winners. Previous winners are excluded from this draw.';
        if (!component && name === 'giveaway' && action === 'edit') content = 'Could not edit. Choose an active giveaway that has not reached its deadline. Prize: up to 200 characters; winners: 1–20; duration: minutes remaining, with total lifetime at most 30 days.';
      }
      await discord.editOriginalResponse(config.applicationId, interaction.token, { content: content.slice(0, 1900), allowed_mentions: { parse: [] } }).catch(() => { try { logger('community_response_failed', { action }); } catch {} });
    } };
  };
}

module.exports = { createCommunityHandler };
