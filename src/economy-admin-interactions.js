'use strict';
async function requireStaff(config, discord, actorId, at = Date.now()) {
  const [guild, roles, member] = await Promise.all([discord.getGuild(config.guildId), discord.request('GET', `/guilds/${config.guildId}/roles`), discord.getGuildMember(config.guildId, actorId)]);
  if (guild?.id !== config.guildId || typeof guild.owner_id !== 'string' || !/^\d{5,25}$/.test(guild.owner_id) || !Array.isArray(roles) || roles.length > 1000
    || roles.some((role) => typeof role?.id !== 'string' || !/^\d{5,25}$/.test(role.id) || typeof role.permissions !== 'string' || !/^\d{1,30}$/.test(role.permissions)) || new Set(roles.map((role) => role.id)).size !== roles.length
    || member?.user?.id !== actorId || member.user.bot || member.pending || !Array.isArray(member.roles) || member.roles.length > 1000 || new Set(member.roles).size !== member.roles.length
    || member.roles.some((id) => !roles.some((role) => role.id === id)) || !roles.some((role) => role.id === config.guildId)) throw new Error('Current staff roles unavailable.');
  if (Number.isFinite(Date.parse(member.communication_disabled_until)) && Date.parse(member.communication_disabled_until) > at) throw new Error('Timed-out staff cannot adjust coins.');
  const permissions = roles.filter((role) => role.id === config.guildId || member.roles.includes(role.id)).reduce((bits, role) => bits | BigInt(role.permissions), 0n);
  if (actorId !== guild.owner_id && !(permissions & 8n) && !(permissions & 32n)) throw new Error('Current Manage Server permission is required.');
}
function createEconomyAdminHandler({ config, economy, discord, logger, now }, { response, defer, hasPermission, findOption, safeText }) {
  return async (interaction, user) => {
    if (!hasPermission(interaction.member?.permissions, 32n)) return { immediate: response('You need Manage Server to use audited economy controls.') };
    if (!economy) return { immediate: response('Economy storage is unavailable.') };
    const command = interaction.data?.options?.[0], action = command?.name, options = command?.options || [];
    const targetId = findOption(options, 'user'), page = findOption(options, 'page') ?? 1, receiptId = findOption(options, 'id');
    if (!['grant', 'remove', 'set', 'history', 'receipt'].includes(action)) return { immediate: response('Choose an economy administration action.') };
    if (targetId !== undefined && (typeof targetId !== 'string' || !/^\d{5,25}$/.test(targetId)) || !Number.isInteger(page) || page < 1 || page > 10000
      || action === 'receipt' && (typeof receiptId !== 'string' || !/^\d{5,25}$/.test(receiptId))) return { immediate: response('Choose a valid member, receipt ID and page.') };
    return { immediate: defer(), work: async () => {
      try {
        await requireStaff(config, discord, user.id, now().getTime()); let content;
        if (action === 'history') {
          const entries = economy.adjustmentHistory(config.guildId, targetId), pageEntries = entries.slice((page - 1) * 5, page * 5);
          content = `**Economy adjustments: page ${page}/${Math.max(1, Math.ceil(entries.length / 5))}**\n${pageEntries.length ? pageEntries.map((entry) => `${entry.id}: ${entry.action} ${entry.amount} for <@${entry.userId}> by <@${entry.actorId}> | ${entry.before} -> ${entry.after}\n${safeText(entry.reason.slice(0, 100))}`).join('\n') : 'No adjustments on this page.'}`;
        } else if (action === 'receipt') {
          const entry = economy.adjustment(config.guildId, receiptId); if (!entry) throw new Error('Receipt unavailable.');
          content = `**Adjustment ${entry.id}**\nAction: ${entry.action}\nAmount: ${entry.amount}\nMember: <@${entry.userId}>\nStaff: <@${entry.actorId}>\nBalance: ${entry.before} -> ${entry.after}\nTime: <t:${Math.floor(Date.parse(entry.createdAt) / 1000)}:F>\nReason: ${safeText(entry.reason)}`;
        } else {
          if (typeof targetId !== 'string' || !/^\d{5,25}$/.test(targetId)) throw new Error('Choose a member.');
          const member = await discord.getGuildMember(config.guildId, targetId);
          if (member?.user?.id !== targetId || member.user.bot || member.pending) throw new Error('Choose a current human member who completed screening.');
          const entry = await economy.adjustCoins({ id: interaction.id, guildId: config.guildId, actorId: user.id, userId: targetId, action, amount: findOption(options, 'amount'), reason: findOption(options, 'reason') }, now());
          content = `${entry.duplicate ? 'Previously saved adjustment' : 'Adjustment saved'}: ${entry.id}\nMember: <@${targetId}>\nBalance: ${entry.before} -> ${entry.after}\nReason: ${safeText(entry.reason)}`;
        }
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content, allowed_mentions: { parse: [] } });
      } catch {
        try { logger('economy_admin_failed', { action }); } catch {}
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Economy action failed. Check current Manage Server permission, human membership, amount, reason and store access. Removing cannot exceed the balance. If a reply was lost, inspect economyadmin history or receipt before submitting a new adjustment.', allowed_mentions: { parse: [] } }).catch(() => {});
      }
    } };
  };
}
module.exports = { createEconomyAdminHandler, requireStaff };
