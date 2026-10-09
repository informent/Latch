'use strict';

const crypto = require('node:crypto');
const MAX_CLOCK_SKEW_SECONDS = 300;
const EPHEMERAL = 64;

function publicKeyFromHex(hex) {
  return crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
}

function verifySignature({ publicKey, timestamp, signature, rawBody, now = Date.now() }) {
  if (!timestamp || !signature || !/^\d{1,20}$/.test(timestamp)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(now / 1000) - seconds) > MAX_CLOCK_SKEW_SECONDS) return false;
  if (!/^[0-9a-f]{128}$/i.test(signature)) return false;
  try { return crypto.verify(null, Buffer.concat([Buffer.from(timestamp), rawBody]), publicKey, Buffer.from(signature, 'hex')); }
  catch { return false; }
}

function response(content) { return { type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } }; }
function defer() { return { type: 5, data: { flags: EPHEMERAL } }; }

function userFrom(interaction) { return interaction.member?.user || interaction.user || null; }
function optionsOf(interaction) { return interaction.data?.options || []; }
function findOption(options, name) { return options.find((option) => option.name === name)?.value; }
function hasPermission(permissions, bit) {
  try {
    const flags = BigInt(permissions || '0');
    return (flags & 8n) === 8n || (flags & bit) === bit;
  }
  catch { return false; }
}
function safeText(value) { return String(value).replace(/[`@<>]/g, (character) => ({ '`': 'ˋ', '@': '＠', '<': '‹', '>': '›' })[character]); }

const MODERATION_PERMISSIONS = Object.freeze({ ban: 4n, kick: 2n, timeout: 1n << 40n, purge: 1n << 13n, slowmode: 1n << 4n, warn: 1n << 40n, warnings: 1n << 40n, 'clear-warnings': 1n << 40n });

function createInteractionHandler({ config, tickets, moderation, economy, levels, discord, logger = () => {}, now = () => new Date() }) {
  return async function handle(interaction) {
    if (interaction.type === 1) return { immediate: { type: 1 } };
    if (interaction.type !== 2 || interaction.guild_id !== config.guildId) return { immediate: response('This command is not available here.') };
    const user = userFrom(interaction);
    if (!user?.id || !interaction.channel_id || !interaction.token) return { immediate: response('This command requires a server channel.') };
    const [subcommand] = optionsOf(interaction);
    const commandName = interaction.data?.name;
    if (commandName === 'ticket' && subcommand?.name === 'create') {
      return { immediate: defer(), work: async () => {
        try {
          const result = await tickets.create(user);
          const content = result.created ? `Your private ticket is ready: <#${result.channelId}>` : `You already have an open ticket: <#${result.channelId}>`;
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content, allowed_mentions: { parse: [] } });
        } catch (error) {
          logger('ticket_create_failed', { message: error.message });
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Could not create your ticket. Please ask a server administrator to check the bot configuration.', allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
    if (commandName === 'ticket' && subcommand?.name === 'close') {
      const roles = interaction.member?.roles || [];
      const permissions = interaction.member?.permissions || '0';
      const targetChannelId = subcommand.options?.find((option) => option.name === 'channel')?.value || interaction.channel_id;
      return { immediate: defer(), work: async () => {
        try {
          const result = await tickets.close({ channelId: targetChannelId, userId: user.id, roles, permissions });
          const content = result.ok ? (result.alreadyClosed ? 'This ticket is already closed.' : 'Ticket closed.') : result.reason;
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content, allowed_mentions: { parse: [] } });
        } catch (error) {
          logger('ticket_close_failed', { message: error.message });
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Could not close this ticket. Please ask a server administrator for help.', allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
    if (commandName === 'moderation') {
      const action = subcommand?.name;
      const requiredPermission = MODERATION_PERMISSIONS[action];
      if (!requiredPermission) return { immediate: response('Choose a moderation action.') };
      if (!hasPermission(interaction.member?.permissions, requiredPermission)) return { immediate: response('You do not have permission to use this moderation action.') };
      const options = subcommand.options || [];
      const targetUser = findOption(options, 'user');
      const targetId = typeof targetUser === 'object' ? targetUser.id : targetUser;
      const providedReason = findOption(options, 'reason');
      const reasonText = typeof providedReason === 'string' && providedReason.trim() ? providedReason.trim() : 'No reason provided.';
      const targetActions = ['ban', 'kick', 'timeout', 'warn', 'warnings', 'clear-warnings'];
      if (targetActions.includes(action) && !/^\d{5,25}$/.test(targetId || '')) return { immediate: response('Choose a valid server member.') };
      if (['warn', 'warnings', 'clear-warnings'].includes(action) && !moderation) return { immediate: response('The moderation store is unavailable. Ask an administrator to check the bot setup.') };
      if (action === 'warn' && (typeof providedReason !== 'string' || !providedReason.trim())) return { immediate: response('Enter a reason for the warning.') };
      return { immediate: defer(), work: async () => {
        try {
          if (action === 'ban') await discord.banMember(interaction.guild_id, targetId, reasonText);
          else if (action === 'kick') await discord.kickMember(interaction.guild_id, targetId, reasonText);
          else if (action === 'timeout') {
            const minutes = Number(findOption(options, 'minutes'));
            if (!Number.isInteger(minutes) || minutes < 1 || minutes > 40_320) throw new Error('Timeout length must be between 1 and 40320 minutes.');
            await discord.timeoutMember(interaction.guild_id, targetId, new Date(now().getTime() + minutes * 60_000).toISOString(), reasonText);
          } else if (action === 'purge') {
            const count = Number(findOption(options, 'count'));
            if (!Number.isInteger(count) || count < 2 || count > 100) throw new Error('Purge count must be between 2 and 100.');
            const messages = await discord.getChannelMessages(interaction.channel_id, count);
            const cutoff = now().getTime() - 14 * 24 * 60 * 60 * 1000;
            const recent = messages.filter((message) => Number.isFinite(Date.parse(message.timestamp)) && Date.parse(message.timestamp) > cutoff);
            if (recent.length === 1) await discord.deleteChannelMessage(interaction.channel_id, recent[0].id, `Purged by ${user.id}`);
            else if (recent.length > 1) await discord.bulkDeleteChannelMessages(interaction.channel_id, recent.map((message) => message.id), `Purged by ${user.id}`);
            const content = recent.length ? `Deleted ${recent.length} recent message${recent.length === 1 ? '' : 's'}.` : 'No recent messages were available to delete. Messages older than 14 days are skipped.';
            await discord.editOriginalResponse(config.applicationId, interaction.token, { content, allowed_mentions: { parse: [] } });
            return;
          } else if (action === 'slowmode') {
            const seconds = Number(findOption(options, 'seconds'));
            if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21_600) throw new Error('Slowmode must be between 0 and 21600 seconds.');
            await discord.editChannel(interaction.channel_id, { rate_limit_per_user: seconds });
            await discord.editOriginalResponse(config.applicationId, interaction.token, { content: seconds ? `Channel slowmode set to ${seconds} seconds.` : 'Channel slowmode disabled.', allowed_mentions: { parse: [] } });
            return;
          } else if (action === 'warn') {
            await moderation.addWarning({ id: crypto.randomUUID(), guildId: interaction.guild_id, userId: targetId, actorId: user.id, reason: reasonText, createdAt: now().toISOString() });
          } else if (action === 'warnings') {
            const records = moderation.listWarnings(interaction.guild_id, targetId).slice(-8);
            const content = records.length
              ? `Recent warnings for <@${targetId}>:\n${records.map((warning, index) => `${index + 1}. ${safeText(warning.reason)} — <t:${Math.floor(Date.parse(warning.createdAt) / 1000)}:R>`).join('\n')}`
              : `No warnings are recorded for <@${targetId}>.`;
            await discord.editOriginalResponse(config.applicationId, interaction.token, { content: content.slice(0, 1900), allowed_mentions: { parse: [] } });
            return;
          } else if (action === 'clear-warnings') {
            const removed = await moderation.clearWarnings(interaction.guild_id, targetId);
            await discord.editOriginalResponse(config.applicationId, interaction.token, { content: `Cleared ${removed} warning${removed === 1 ? '' : 's'} for <@${targetId}>.`, allowed_mentions: { parse: [] } });
            return;
          }
          const label = action === 'timeout' ? `for ${findOption(options, 'minutes')} minute(s)` : '';
          const content = action === 'warn' ? `Recorded a warning for <@${targetId}>.` : `<@${targetId}> ${action}${label ? ` ${label}` : ''}.`;
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content, allowed_mentions: { parse: [] } });
        } catch (error) {
          logger('moderation_action_failed', { action, message: error.message });
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: `Could not complete ${action}. Check the bot's permissions, role position, and moderation store.`, allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
    if (commandName === 'utility') {
      if (subcommand?.name === 'ping') return { immediate: response('OpenDesk is responding.') };
      if (subcommand?.name === 'server') return { immediate: defer(), work: async () => {
        try {
          const guild = await discord.getGuild(interaction.guild_id);
          const createdAt = guild.id ? 1_420_070_400_000 + Number(BigInt(guild.id) >> 22n) : now().getTime();
          const content = `**${safeText(guild.name)}**\nMembers: ${guild.approximate_member_count ?? 'unavailable'}\nCreated: <t:${Math.floor(createdAt / 1000)}:D>`;
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content, allowed_mentions: { parse: [] } });
        } catch (error) {
          logger('utility_server_failed', { message: error.message });
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Could not load server information.', allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
    if (commandName === 'level') {
      if (!levels) return { immediate: response('The level store is unavailable. Ask an administrator to check the bot setup.') };
      const selected = findOption(optionsOf(interaction), 'user');
      const targetId = typeof selected === 'object' ? selected.id : selected || user.id;
      if (!/^\d{5,25}$/.test(targetId)) return { immediate: response('Choose a valid server member.') };
      const account = levels.get(interaction.guild_id, targetId);
      return { immediate: response(`<@${targetId}> is level **${account.level}** with **${account.xp} XP** (${account.xpToNextLevel} XP to next level).`) };
    }
    if (commandName === 'leaderboard') {
      const action = subcommand?.name;
      if (action === 'levels') {
        if (!levels) return { immediate: response('The level store is unavailable. Ask an administrator to check the bot setup.') };
        const leaders = levels.leaderboard(interaction.guild_id, 10);
        const content = leaders.length ? `**Server XP leaderboard**\n${leaders.map((account, index) => `${index + 1}. <@${account.userId}> — level **${account.level}** (${account.xp} XP)`).join('\n')}` : 'No one has earned XP yet.';
        return { immediate: response(content) };
      }
      if (action === 'coins') {
        if (!economy) return { immediate: response('The economy store is unavailable. Ask an administrator to check the bot setup.') };
        const leaders = economy.leaderboard(interaction.guild_id, 10);
        const content = leaders.length ? `**Server coin leaderboard**\n${leaders.map((account, index) => `${index + 1}. <@${account.userId}> — **${account.balance}**`).join('\n')}` : 'No one has earned coins yet.';
        return { immediate: response(content) };
      }
      return { immediate: response('Choose a leaderboard.') };
    }
    if (commandName === 'roles') {
      const action = subcommand?.name;
      const permission = action === 'nickname' || action === 'clear-nickname' ? 1n << 27n : action === 'grant' || action === 'revoke' ? 1n << 28n : 0n;
      if (!permission) return { immediate: response('Choose a role-management action.') };
      if (!hasPermission(interaction.member?.permissions, permission)) return { immediate: response('You do not have permission to use this role-management action.') };
      const options = subcommand.options || [];
      const rawUser = findOption(options, 'user');
      const targetId = typeof rawUser === 'object' ? rawUser.id : rawUser;
      if (!/^\d{5,25}$/.test(targetId || '')) return { immediate: response('Choose a valid server member.') };
      const roleId = findOption(options, 'role');
      if (action !== 'nickname' && action !== 'clear-nickname' && !/^\d{5,25}$/.test(roleId || '')) return { immediate: response('Choose a valid server role.') };
      const nickname = findOption(options, 'nickname');
      if (action === 'nickname' && (typeof nickname !== 'string' || !nickname.length || nickname.length > 32)) return { immediate: response('Nickname must contain 1 to 32 characters.') };
      return { immediate: defer(), work: async () => {
        try {
          if (action === 'grant') await discord.grantRole(interaction.guild_id, targetId, roleId, `Role granted by ${user.id}`);
          else if (action === 'revoke') await discord.revokeRole(interaction.guild_id, targetId, roleId, `Role removed by ${user.id}`);
          else if (action === 'nickname' || action === 'clear-nickname') await discord.setNickname(interaction.guild_id, targetId, action === 'nickname' ? nickname : null, `Nickname changed by ${user.id}`);
          const content = action === 'nickname' || action === 'clear-nickname'
            ? (action === 'nickname' ? `Updated <@${targetId}>'s nickname.` : `Cleared <@${targetId}>'s nickname.`)
            : `${action === 'grant' ? 'Granted' : 'Removed'} <@&${roleId}> ${action === 'grant' ? 'to' : 'from'} <@${targetId}>.`;
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content, allowed_mentions: { parse: [] } });
        } catch (error) {
          logger('role_action_failed', { action, message: error.message });
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Could not complete the role change. Check the bot permissions and role position.', allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
    if (commandName === 'economy') {
      if (!economy) return { immediate: response('The economy store is unavailable. Ask an administrator to check the bot setup.') };
      const action = subcommand?.name;
      if (!['balance', 'daily', 'work', 'pay'].includes(action)) return { immediate: response('Choose an economy action.') };
      const options = subcommand.options || [];
      if (action === 'balance') {
        const selected = findOption(options, 'user');
        const targetId = typeof selected === 'object' ? selected.id : selected || user.id;
        if (!/^\d{5,25}$/.test(targetId)) return { immediate: response('Choose a valid server member.') };
        return { immediate: response(`<@${targetId}> has **${economy.balance(interaction.guild_id, targetId)}** coins.`) };
      }
      if (action === 'pay') {
        const selected = findOption(options, 'user');
        const targetId = typeof selected === 'object' ? selected.id : selected;
        const amount = Number(findOption(options, 'amount'));
        if (!/^\d{5,25}$/.test(targetId || '') || !Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) {
          return { immediate: response('Choose a valid member and an amount from 1 to 1000000.') };
        }
        if (targetId === user.id) return { immediate: response('You cannot transfer coins to yourself.') };
      }
      return { immediate: defer(), work: async () => {
        try {
          let content;
          if (action === 'daily' || action === 'work') {
            const result = await economy.claim(interaction.guild_id, user.id, action, now());
            content = result.claimed
              ? `You earned **${result.reward}** coins. Your balance is **${result.balance}**.`
              : `You can claim again <t:${Math.floor(Date.parse(result.nextAt) / 1000)}:R>.`;
          } else {
            const selected = findOption(options, 'user');
            const targetId = typeof selected === 'object' ? selected.id : selected;
            const amount = Number(findOption(options, 'amount'));
            if (!/^\d{5,25}$/.test(targetId || '') || !Number.isSafeInteger(amount)) throw new Error('Choose a valid member and transfer amount.');
            const result = await economy.transfer(interaction.guild_id, user.id, targetId, amount);
            content = `Sent **${amount}** coins to <@${targetId}>. Your balance is **${result.fromBalance}**.`;
          }
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content, allowed_mentions: { parse: [] } });
        } catch (error) {
          logger('economy_action_failed', { action, message: error.message });
          const content = error.message.includes('enough coins') || error.message.includes('yourself') || error.message.includes('amount')
            ? error.message
            : `Could not complete ${action}. Try again or ask an administrator to check the economy store.`;
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content, allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
    return { immediate: response('Choose Create or Close.') };
  };
}

module.exports = { publicKeyFromHex, verifySignature, createInteractionHandler, MAX_CLOCK_SKEW_SECONDS, MODERATION_PERMISSIONS, hasPermission };
