'use strict';
function createLevelRewardHandler({ config, levelRewards, discord, logger = () => {} }, { response, defer, hasPermission, findOption }) {
  return async (interaction) => {
    if (!hasPermission(interaction.member?.permissions, 32n)) return { immediate: response('You need Manage Server to manage level rewards.') };
    if (!levelRewards) return { immediate: response('Level rewards are unavailable.') };
    const sub = interaction.data.options?.[0], action = sub?.name;
    if (!['add', 'remove', 'list', 'info', 'enable', 'disable', 'preview', 'reconcile'].includes(action)) return { immediate: response('Choose a level reward action.') };
    return { immediate: defer(), work: async () => {
      try {
        const get = (name) => findOption(sub.options || [], name);
        const actorId = interaction.member.user.id;
        let content;
        if (action === 'list') {
          const state = levelRewards.get();
          content = `**Level rewards (${state.enabled ? 'enabled' : 'paused'})**\n${state.rewards.map((reward) => `Level ${reward.level}: <@&${reward.roleId}>`).join('\n') || 'No rewards configured.'}\nRewards accumulate; removing a rule does not remove member roles.`;
        } else if (action === 'info') {
          const state = levelRewards.get();
          content = `**Level reward status**\nAwards: ${state.enabled ? 'enabled' : 'paused'}\nRules: ${state.rewards.length}/20\nRevision: ${state.revision}\nTracked members: ${state.members.length}/50000\nPending: ${state.members.filter((member) => member.pending).length}\nExisting XP is scanned in batches of 25 every 15 seconds; one pending member is processed per tick.`;
        } else if (action === 'preview') {
          const preview = levelRewards.preview(get('user'));
          content = `**Reward eligibility**\nMember: <@${preview.userId}>\nLevel: ${preview.level}\nRewards: ${preview.rewards.map((reward) => `<@&${reward.roleId}>`).join(', ') || 'None'}\nAwards: ${preview.enabled ? 'enabled' : 'paused'}\nPending: ${Boolean(preview.job?.pending)}\nRetry: ${preview.job?.retryAt || 'none'}\nThis preview makes no role changes; current screening and hierarchy are checked when assigning.`;
        } else if (action === 'reconcile') {
          const result = await levelRewards.reconcile(get('user'), actorId);
          content = result.pending ? 'Reward assignment is pending. Check current role permissions, member screening and hierarchy. Saved retries will continue while rewards are enabled.' : `Reconciliation confirmed. Added ${result.granted} eligible role(s).`;
        } else {
          const state = await levelRewards.configure(action, { roleId: get('role'), level: get('level') }, actorId);
          content = `Level reward configuration saved: ${state.rewards.length}/20 rules, ${state.enabled ? 'enabled' : 'paused'}. Configuration needs current Manage Server and Manage Roles. Existing roles are preserved; new rewards are applied by the background scan or /levelreward reconcile.`;
        }
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: content.slice(0, 1900), allowed_mentions: { parse: [] } });
      } catch {
        try { logger('level_reward_command_failed', { action }); } catch {}
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Level reward action failed. Check current Manage Server/Manage Roles, permission-free unmanaged roles below staff and bot, levels 1-1000, the 20-rule limit, screened member identity and store access. Use /levelreward info before retrying.', allowed_mentions: { parse: [] } }).catch(() => {});
      }
    } };
  };
}
module.exports = { createLevelRewardHandler };
