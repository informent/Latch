'use strict';
function createTicketPanelHandler({ config, ticketPanels, discord, logger = () => {} }, { response, defer, hasPermission, findOption, safeText }) {
  return async (interaction) => {
    if (!ticketPanels) return { immediate: response('Ticket panels are unavailable.') };
    const button = interaction.type === 3;
    const subcommand = interaction.data.options?.[0]; const action = subcommand?.name;
    if (!button && !hasPermission(interaction.member?.permissions, 32n)) return { immediate: response('You need Manage Server to configure ticket panels.') };
    if (!button && !['create', 'add', 'remove', 'list', 'info', 'publish', 'disable', 'delete'].includes(action)) return { immediate: response('Choose a ticket panel action.') };
    return { immediate: defer(), work: async () => {
      try {
        let content;
        const options = subcommand?.options || []; const get = (name) => findOption(options, name);
        if (button) {
          const result = await ticketPanels.click(interaction);
          content = result.created ? `Your private ticket is ready: <#${result.channelId}>. The support team can see the selected topic. Use /ticket close when finished.` : `You already have an active ticket: <#${result.channelId}>.`;
        } else if (action === 'create') {
          const panel = await ticketPanels.create({ id: interaction.id, channelId: interaction.channel_id, title: get('title'), description: get('description') ?? '' });
          content = `Draft panel ${panel.id} created. Add up to five topic/category buttons, then publish it. Nothing has been posted yet.`;
        } else if (action === 'list') {
          content = '**Ticket panels**\n' + (ticketPanels.list().map((panel) => `${panel.id}: ${safeText(panel.title)} | ${panel.state} | ${panel.topics.length} topics${panel.pending ? ' | publication pending' : ''}`).join('\n') || 'No panels yet.');
        } else if (action === 'info') {
          const panel = ticketPanels.get(get('id')); if (!panel) throw new Error();
          content = `**${safeText(panel.title)}**\nID: ${panel.id}\nChannel: <#${panel.channelId}>\nState: ${panel.state}\nMessage: ${panel.messageId || 'unpublished'}\nPending: ${panel.pending}\nRetry: ${panel.retryAt || 'none'}\n${panel.topics.map((topic) => `${topic.id}: ${safeText(topic.label)} -> <#${topic.categoryId}>`).join('\n')}`;
        } else {
          const panel = await ticketPanels.change(get('id'), action, action === 'add' ? { id: get('topic'), label: get('label'), categoryId: get('category') } : action === 'remove' ? { id: get('topic') } : {});
          content = !panel ? 'Panel deleted.' : `Panel ${panel.id}: ${panel.state}. ${panel.pending ? 'Publication pending; the scheduler will retry. Buttons refuse clicks until publication is confirmed.' : 'Saved and publication state confirmed.'}`;
        }
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: content.slice(0, 1900), allowed_mentions: { parse: [] } });
      } catch {
        try { logger(button ? 'ticket_panel_click_failed' : 'ticket_panel_action_failed', { action }); } catch {}
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: button ? 'This ticket button is unavailable. The panel may be updating, disabled or copied. Ask support to check the panel and category; use /ticket list to find an existing ticket.' : 'Panel action failed. Check panel/topic IDs, the five-topic limit, channel/category permissions and the panel store. Inspect panel info before retrying publication.', allowed_mentions: { parse: [] } }).catch(() => {});
      }
    } };
  };
}
module.exports = { createTicketPanelHandler };
