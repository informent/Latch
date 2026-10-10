'use strict';

const crypto = require('node:crypto');
const { createCommunityHandler } = require('./community-interactions');
const { createResponderHandler } = require('./responder-interactions');
const { createTimerHandler } = require('./timer-interactions');
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

const MODERATION_PERMISSIONS = Object.freeze({ ban: 4n, unban: 4n, kick: 2n, timeout: 1n << 40n, untimeout: 1n << 40n, purge: 1n << 13n, slowmode: 1n << 4n, warn: 1n << 40n, warnings: 1n << 40n, 'clear-warnings': 1n << 40n });

function createInteractionHandler({ config, tickets, moderation, economy, levels, automod, community, voice, roleMenus, templates, responders, timers, discord, logger = () => {}, now = () => new Date() }) {
  const handleCommunity = createCommunityHandler({ config, community, discord, logger }, { response, defer, hasPermission, safeText, findOption });
  const handleResponder = createResponderHandler({ config, responders, discord, logger }, { response, defer, hasPermission, findOption });
  const handleTimer = createTimerHandler({ config, timers, discord, logger }, { response, defer, hasPermission, findOption });
  return async function handle(interaction) {
    if (interaction.type === 1) return { immediate: { type: 1 } };
    if (![2, 3].includes(interaction.type) || interaction.guild_id !== config.guildId) return { immediate: response('This command is not available here.') };
    const user = userFrom(interaction);
    if (!user?.id || !interaction.channel_id || !interaction.token) return { immediate: response('This command requires a server channel.') };
    const [subcommand] = optionsOf(interaction);
    const commandName = interaction.data?.name;
    if (interaction.type === 2 && commandName === 'timer') return handleTimer(interaction);
    if (interaction.type === 2 && commandName === 'responder') return handleResponder(interaction);
    if (interaction.type === 2 && commandName === 'template') {
      if (!hasPermission(interaction.member?.permissions, 8192n)) return { immediate: response('You need Manage Messages to use templates.') };
      if (!templates) return { immediate: response('Templates are unavailable.') };
      const action = subcommand?.name;
      const options = subcommand?.options || [];
      const name = findOption(options, 'name');
      return { immediate: defer(), work: async () => {
        try {
          let content;
          let embeds = [];
          if (action === 'create' || action === 'update') {
            const color = String(findOption(options, 'color') || '5865f2').replace(/^#/, '');
            if (!/^[0-9a-f]{6}$/i.test(color)) throw new Error();
            await templates.change(action, { name, title: findOption(options, 'title'), description: findOption(options, 'description'), color: parseInt(color, 16) });
            content = `Template ${safeText(name)} saved.`;
          } else if (action === 'list') content = templates.list().map((item) => item.name).join('\n') || 'No saved templates.';
          else {
            const item = templates.get(name);
            if (!item) throw new Error();
            const embed = { title: item.title, description: item.description, color: item.color };
            if (action === 'delete') { await templates.change('delete', { name }); content = 'Template deleted. Previously published messages remain in Discord.'; }
            else if (action === 'info') content = `Name: ${item.name}\nTitle: ${safeText(item.title)}\nBody length: ${item.description.length}\nColor: #${item.color.toString(16).padStart(6, '0')}`;
            else if (action === 'preview') { content = `Private preview: ${item.name}`; embeds = [embed]; }
            else if (action === 'send') {
              const channel = await discord.request('GET', `/channels/${interaction.channel_id}`);
              if (channel.guild_id !== config.guildId || ![0, 5].includes(channel.type)) throw new Error();
              await discord.createMessage(interaction.channel_id, { embeds: [embed], allowed_mentions: { parse: [] }, nonce: interaction.id, enforce_nonce: true });
              content = `Template ${item.name} published in this channel.`;
            } else throw new Error();
          }
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: content.slice(0, 1900), embeds, allowed_mentions: { parse: [] } });
        } catch {
          logger('template_action_failed', { action });
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Template action failed. Check the name, title/body, color, 50-template limit and channel permissions. Create needs a new name; update needs an existing name. Delivery failures require checking the channel before sending again.', allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
    const roleButton = interaction.type === 3 ? /^rolemenu:(grant|revoke):(\d{5,25}):(\d{5,25})$/.exec(interaction.data?.custom_id || '') : null;
    if (roleButton || ['rolemenu', 'autorole'].includes(commandName)) {
      if (!roleMenus) return { immediate: response('Role automation is unavailable.') };
      if (user.bot) return { immediate: response('Role automation is available to human members only.') };
      if (!roleButton && !hasPermission(interaction.member?.permissions, 1n << 28n)) return { immediate: response('You need Manage Roles to configure role automation.') };
      const action = roleButton ? roleButton[1] : subcommand?.name;
      const options = subcommand?.options || [];
      const id = roleButton ? roleButton[2] : action === 'create' ? interaction.id : findOption(options, 'id');
      return { immediate: defer(), work: async () => {
        try {
          let content;
          if (roleButton) content = await roleMenus.button({ action, id, roleId: roleButton[3], guildId: interaction.guild_id, channelId: interaction.channel_id, messageId: interaction.message?.id, userId: user.id });
          else if (commandName === 'autorole') {
            if (action === 'list') content = `Member events: ${config.memberEventsEnabled ? 'enabled' : 'disabled'}\nJoin roles: ${roleMenus.autoroles().map((role) => `<@&${role}>`).join(', ') || 'none'}`;
            else if (['add', 'remove'].includes(action)) { await roleMenus.configureAutorole(findOption(options, 'role'), action === 'remove', user.id); content = 'Autorole configuration saved. Existing member roles are unchanged.'; }
            else if (action === 'apply') { const count = await roleMenus.applyAutoroles(findOption(options, 'user'), user.id); content = `Applied ${count} configured join role(s).`; }
            else throw new Error('Unknown autorole action.');
          } else if (action === 'create') {
            const menu = await roleMenus.create({ id, channelId: interaction.channel_id, title: findOption(options, 'title') });
            content = `Draft role menu ${menu.id} saved. Add roles, then publish it.`;
          } else if (action === 'list') {
            content = roleMenus.list().map((menu) => `${menu.id}: ${safeText(menu.title).slice(0, 60)} | ${menu.state} | ${menu.roles.length} roles${menu.pending ? ' | update pending' : ''}`).join('\n') || 'No role menus configured.';
          } else if (action === 'info') {
            const menu = roleMenus.get(id);
            if (!menu) throw new Error('Unknown role menu.');
            content = `**${safeText(menu.title)}**\nID: ${menu.id}\nChannel: <#${menu.channelId}>\nState: ${menu.state}\nRoles: ${menu.roles.map((role) => `<@&${role.id}>`).join(', ') || 'none'}\nUpdate: ${menu.pending ? 'pending' : 'complete'}`;
          } else if (['add', 'remove', 'publish', 'disable', 'delete'].includes(action)) {
            const menu = await roleMenus.change(id, action, { roleId: findOption(options, 'role'), label: findOption(options, 'label'), actorId: user.id });
            content = menu ? `Role menu ${id}: ${menu.state}${menu.pending ? '. Public message update will retry automatically.' : '. Saved.'}` : 'Role menu deleted.';
          } else throw new Error('Unknown role menu action.');
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: content.slice(0, 1900), allowed_mentions: { parse: [] } });
        } catch {
          logger('role_automation_failed', { action });
          const content = roleButton ? 'Could not update your role. The menu may be disabled or stale, screening may be incomplete, or the role no longer meets permission and hierarchy rules.' : 'Could not complete this role action. Use a valid menu ID, a server text channel, up to 10 permission-free unmanaged roles below your role and the bot, and up to 20 menus. Autoroles require member events; limit five. Complete member screening before applying roles.';
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content, allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
    if (commandName === 'voice') {
      const action = subcommand?.name;
      if (!voice) return { immediate: response('The voice suite is unavailable.') };
      if (['setup', 'disable'].includes(action) && !hasPermission(interaction.member?.permissions, 32n)) return { immediate: response('You need Manage Server to configure temporary voice channels.') };
      if (user.bot) return { immediate: response('Voice ownership is available to human members only.') };
      return { immediate: defer(), work: async () => {
        try {
          const options = subcommand?.options || [];
          let content;
          if (action === 'setup') content = await voice.configure({ lobbyId: findOption(options, 'lobby'), categoryId: findOption(options, 'category') });
          else if (action === 'disable') content = await voice.disable();
          else if (action === 'status') content = voice.status();
          else content = await voice.manage({ action, userId: user.id, targetId: findOption(options, 'user'), value: findOption(options, action === 'limit' ? 'members' : 'name') });
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content, allowed_mentions: { parse: [] } });
        } catch {
          logger('voice_command_failed', { action });
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Could not complete this voice action. Enable the voice suite and wait for its Gateway snapshot, join a managed room, and check ownership, target membership and bot permissions. Claim requires the previous owner to be absent; transfer requires a human in your room who owns no other room.', allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
    if (interaction.type === 3 || ['reminder', 'giveaway'].includes(commandName)) return handleCommunity(interaction, user);
    if (commandName === 'poll') {
      if (!hasPermission(interaction.member?.permissions, 8192n)) return { immediate: response('You need Manage Messages to publish a poll.') };
      const options = optionsOf(interaction);
      const question = findOption(options, 'question');
      const rawAnswers = findOption(options, 'answers');
      const hours = findOption(options, 'hours') ?? 24;
      const multiple = findOption(options, 'multiple') ?? false;
      const answers = typeof rawAnswers === 'string' ? rawAnswers.split('|').map((text) => text.trim()) : [];
      if (typeof question !== 'string' || !question.trim() || question.length > 300 || answers.length < 2 || answers.length > 10 || answers.some((text) => !text || text.length > 55) || new Set(answers.map((text) => text.toLowerCase())).size !== answers.length || !Number.isInteger(hours) || hours < 1 || hours > 768 || typeof multiple !== 'boolean') return { immediate: response('Use a question up to 300 characters, 2 to 10 distinct choices separated by | (55 characters each), and 1 to 768 hours.') };
      return { immediate: defer(), work: async () => {
        try {
          await discord.createMessage(interaction.channel_id, { poll: { question: { text: question.trim() }, answers: answers.map((text) => ({ poll_media: { text } })), duration: hours, allow_multiselect: multiple, layout_type: 1 }, allowed_mentions: { parse: [] } });
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Poll published in this channel. Discord manages voting and expiration even while OpenDesk is offline.', allowed_mentions: { parse: [] } });
        } catch {
          logger('poll_publish_failed', {});
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Could not publish the poll. Check the bot Send Messages and Send Polls permissions and that this channel supports polls.', allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
    if (commandName === 'fun') {
      const action = subcommand?.name;
      if (action === 'coin') return { immediate: response(`Coin flip: **${crypto.randomInt(2) ? 'Heads' : 'Tails'}**.`) };
      if (action === 'roll') {
        const sides = findOption(subcommand.options || [], 'sides') ?? 6;
        if (!Number.isInteger(sides) || sides < 2 || sides > 1000) return { immediate: response('Choose a die with 2 to 1000 sides.') };
        return { immediate: response(`D${sides}: **${crypto.randomInt(1, sides + 1)}**.`) };
      }
      if (action === 'eightball') {
        const question = findOption(subcommand.options || [], 'question');
        if (typeof question !== 'string' || !question.trim() || question.length > 300) return { immediate: response('Enter a question up to 300 characters.') };
        const answers = ['Yes.', 'No.', 'Most likely.', 'Ask again later.', 'The outlook is good.', 'Very doubtful.', 'Signs point to yes.', 'Cannot predict now.'];
        return { immediate: response(`Magic eight ball: **${answers[crypto.randomInt(answers.length)]}**`) };
      }
      return { immediate: response('Choose a game.') };
    }
    if (commandName === 'embed') {
      if (!hasPermission(interaction.member?.permissions, 8192n)) return { immediate: response('You need Manage Messages to publish an embed.') };
      const options = optionsOf(interaction);
      const title = findOption(options, 'title');
      const description = findOption(options, 'description');
      const colorText = findOption(options, 'color') || '5865f2';
      if (typeof title !== 'string' || !title.trim() || title.length > 256 || typeof description !== 'string' || !description.trim() || description.length > 4000 || typeof colorText !== 'string' || !/^#?[0-9a-f]{6}$/i.test(colorText)) return { immediate: response('Enter a title up to 256 characters, a body up to 4000 characters, and a six-digit hex color.') };
      return { immediate: defer(), work: async () => {
        try {
          await discord.createMessage(interaction.channel_id, { embeds: [{ title, description, color: parseInt(colorText.replace('#', ''), 16) }], allowed_mentions: { parse: [] } });
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Embed published in this channel.', allowed_mentions: { parse: [] } });
        } catch {
          logger('embed_publish_failed', {});
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Could not publish the embed. Check the bot Send Messages and Embed Links permissions.', allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
    if (commandName === 'automod') {
      if (!hasPermission(interaction.member?.permissions, 32n)) return { immediate: response('You need Manage Server to manage AutoMod rules.') };
      if (!automod) return { immediate: response('AutoMod is unavailable. Ask an administrator to check the bot setup.') };
      const action = subcommand?.name;
      if (!['list', 'keywords', 'mentions', 'spam', 'enable', 'disable', 'remove'].includes(action)) return { immediate: response('Choose an AutoMod action.') };
      return { immediate: defer(), work: async () => {
        try {
          const options = subcommand.options || [];
          let content;
          if (action === 'list') {
            const rules = await automod.list();
            content = rules.length ? `**Server AutoMod rules**\n${rules.slice(0, 20).map((rule) => `${safeText(rule.name)} | ID: ${rule.id} | ${rule.enabled ? 'enabled' : 'disabled'}`).join('\n')}` : 'No AutoMod rules are configured.';
          } else if (['keywords', 'mentions', 'spam'].includes(action)) {
            const rule = await automod.create({ kind: action, name: findOption(options, 'name'), keywords: findOption(options, 'keywords'), limit: findOption(options, 'limit'), actorId: user.id });
            content = `Created disabled AutoMod rule ${rule.id}. Review it in Server Settings > AutoMod, then use /automod enable with that ID.`;
          } else {
            await automod.change({ ruleId: findOption(options, 'rule'), action, actorId: user.id });
            content = `AutoMod rule ${action === 'remove' ? 'removed' : action + 'd'}.`;
          }
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: content.slice(0, 1900), allowed_mentions: { parse: [] } });
        } catch (error) {
          logger('automod_action_failed', { action });
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Could not complete the AutoMod action. Check the rule ID, keyword limits, bot Manage Server permission, and Discord rule limits. OpenDesk only changes rules it created.', allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
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
    if (commandName === 'ticket' && ['list', 'stats', 'claim', 'unclaim', 'rename'].includes(subcommand?.name)) {
      const action = subcommand.name;
      const actor = { userId: user.id, roles: interaction.member?.roles || [], permissions: interaction.member?.permissions || '0' };
      return { immediate: defer(), work: async () => {
        try {
          let result;
          let content;
          if (action === 'list') {
            result = tickets.list({ ...actor, page: findOption(subcommand.options || [], 'page') ?? 1 });
            content = result.ok ? `**Open tickets: ${result.total} (page ${result.page}/${result.pages})**\n${result.tickets.map((ticket) => `<#${ticket.channelId}> | owner <@${ticket.ownerId}> | ${ticket.status} | ${ticket.claimedBy ? `handler <@${ticket.claimedBy}>` : 'unclaimed'}`).join('\n') || 'No tickets on this page.'}` : result.reason;
          } else if (action === 'stats') {
            result = tickets.stats(actor);
            content = result.ok ? `**Ticket statistics**\nTotal: ${result.total}\nOpen: ${result.open}\nClosing: ${result.closing}\nClosed: ${result.closed}\nOpen and claimed: ${result.claimed}` : result.reason;
          } else {
            result = await tickets.manage({ ...actor, action, channelId: findOption(subcommand.options || [], 'channel') || interaction.channel_id, name: findOption(subcommand.options || [], 'name') });
            content = result.ok ? result.content : result.reason;
          }
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: content.slice(0, 1900), allowed_mentions: { parse: [] } });
        } catch {
          logger('ticket_management_failed', { action });
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Could not manage this ticket. Check the ticket ID, support role, bot permissions and writable ticket store.', allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
    if (commandName === 'moderation') {
      const action = subcommand?.name;
      const requiredPermission = MODERATION_PERMISSIONS[action];
      if (!requiredPermission) return { immediate: response('Choose a moderation action.') };
      if (!hasPermission(interaction.member?.permissions, requiredPermission)) return { immediate: response('You do not have permission to use this moderation action.') };
      const options = subcommand.options || [];
      const targetUser = findOption(options, action === 'unban' ? 'user-id' : 'user');
      const targetId = typeof targetUser === 'object' ? targetUser.id : targetUser;
      const providedReason = findOption(options, 'reason');
      const reasonText = typeof providedReason === 'string' && providedReason.trim() ? providedReason.trim() : 'No reason provided.';
      const targetActions = ['ban', 'unban', 'kick', 'timeout', 'untimeout', 'warn', 'warnings', 'clear-warnings'];
      if (targetActions.includes(action) && !/^\d{5,25}$/.test(targetId || '')) return { immediate: response('Choose a valid server member.') };
      if (['warn', 'warnings', 'clear-warnings'].includes(action) && !moderation) return { immediate: response('The moderation store is unavailable. Ask an administrator to check the bot setup.') };
      if (action === 'warn' && (typeof providedReason !== 'string' || !providedReason.trim())) return { immediate: response('Enter a reason for the warning.') };
      return { immediate: defer(), work: async () => {
        try {
          if (action === 'ban') await discord.banMember(interaction.guild_id, targetId, reasonText);
          else if (action === 'unban') await discord.unbanMember(interaction.guild_id, targetId, reasonText);
          else if (action === 'kick') await discord.kickMember(interaction.guild_id, targetId, reasonText);
          else if (action === 'timeout') {
            const minutes = Number(findOption(options, 'minutes'));
            if (!Number.isInteger(minutes) || minutes < 1 || minutes > 40_320) throw new Error('Timeout length must be between 1 and 40320 minutes.');
            await discord.timeoutMember(interaction.guild_id, targetId, new Date(now().getTime() + minutes * 60_000).toISOString(), reasonText);
          } else if (action === 'untimeout') await discord.timeoutMember(interaction.guild_id, targetId, null, reasonText);
          else if (action === 'purge') {
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
              ? `Recent warnings for <@${targetId}>:\n${records.map((warning, index) => `${index + 1}. ${safeText(warning.reason)} - <t:${Math.floor(Date.parse(warning.createdAt) / 1000)}:R>`).join('\n')}`
              : `No warnings are recorded for <@${targetId}>.`;
            await discord.editOriginalResponse(config.applicationId, interaction.token, { content: content.slice(0, 1900), allowed_mentions: { parse: [] } });
            return;
          } else if (action === 'clear-warnings') {
            const removed = await moderation.clearWarnings(interaction.guild_id, targetId);
            await discord.editOriginalResponse(config.applicationId, interaction.token, { content: `Cleared ${removed} warning${removed === 1 ? '' : 's'} for <@${targetId}>.`, allowed_mentions: { parse: [] } });
            return;
          }
          const label = action === 'timeout' ? `for ${findOption(options, 'minutes')} minute(s)` : '';
          const content = action === 'unban' ? `Removed the server ban for user ${targetId}.` : action === 'warn' ? `Recorded a warning for <@${targetId}>.` : action === 'untimeout' ? `Removed the timeout for <@${targetId}>.` : `<@${targetId}> ${action}${label ? ` ${label}` : ''}.`;
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content, allowed_mentions: { parse: [] } });
        } catch (error) {
          logger('moderation_action_failed', { action, message: error.message });
          const detail = action === 'unban' ? 'Check Ban Members permission and confirm this user ID has an active server ban.' : ['ban', 'kick', 'timeout', 'untimeout'].includes(action) ? 'Check the bot permissions and role hierarchy, and confirm the target is still in the server.' : 'Check the bot permissions and moderation store.';
          await discord.editOriginalResponse(config.applicationId, interaction.token, { content: `Could not complete ${action}. ${detail}`, allowed_mentions: { parse: [] } }).catch(() => {});
        }
      } };
    }
    if (commandName === 'utility') {
      if (['user', 'avatar'].includes(subcommand?.name)) {
        const selected = findOption(subcommand.options || [], 'user');
        const targetId = typeof selected === 'object' ? selected.id : selected || user.id;
        if (!/^\d{5,25}$/.test(targetId || '')) return { immediate: response('Choose a valid server member.') };
        return { immediate: defer(), work: async () => {
          try {
            const member = await discord.getGuildMember(interaction.guild_id, targetId);
            const account = member.user;
            if (!account || account.id !== targetId) throw new Error('Member unavailable.');
            const hash = member.avatar || account.avatar;
            const validHash = typeof hash === 'string' && /^(?:a_)?[a-f0-9]{32}$/.test(hash);
            const extension = validHash && hash.startsWith('a_') ? 'gif' : 'png';
            const defaultIndex = account.discriminator && account.discriminator !== '0' ? Number(account.discriminator) % 5 : Number((BigInt(targetId) >> 22n) % 6n);
            const avatar = validHash ? member.avatar
              ? `https://cdn.discordapp.com/guilds/${interaction.guild_id}/users/${targetId}/avatars/${hash}.${extension}?size=1024`
              : `https://cdn.discordapp.com/avatars/${targetId}/${hash}.${extension}?size=1024`
              : `https://cdn.discordapp.com/embed/avatars/${Number.isInteger(defaultIndex) ? defaultIndex : 0}.png`;
            const created = Math.floor((1_420_070_400_000 + Number(BigInt(targetId) >> 22n)) / 1000);
            const joined = Math.floor(Date.parse(member.joined_at) / 1000);
            const embed = { title: safeText(member.nick || account.global_name || account.username).slice(0, 256), image: { url: avatar } };
            if (subcommand.name === 'user') {
              embed.description = `User ID: ${targetId}\nAccount: <t:${created}:D>\nJoined: ${Number.isFinite(joined) ? `<t:${joined}:D>` : 'unavailable'}\nBot: ${account.bot ? 'yes' : 'no'}\nRoles: ${Array.isArray(member.roles) ? member.roles.length : 0}`;
              embed.thumbnail = embed.image;
              delete embed.image;
            }
            await discord.editOriginalResponse(config.applicationId, interaction.token, { content: '', embeds: [embed], allowed_mentions: { parse: [] } });
          } catch {
            logger('utility_member_failed', { action: subcommand.name });
            await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Could not load that server member. Confirm they are still in this server.', allowed_mentions: { parse: [] } }).catch(() => {});
          }
        } };
      }
      if (subcommand?.name === 'help') return { immediate: response(`**OpenDesk features**\n/ticket: private support\n/moderation: staff actions and warnings\n/roles: roles and nicknames\n/automod: native Discord filters (Manage Server required)\n/embed: custom announcements (Manage Messages required)\n/template: saved embeds and private previews (Manage Messages required)\n/responder: opt-in exact-text channel replies (Manage Server required)\n/rolemenu and /autorole: permission-free role automation\n/voice: temporary room lifecycle and owner controls\n/poll: native community voting\n/reminder: public channel reminders with private list/cancel\n/timer: persistent recurring channel messages (Manage Server required)\n/giveaway: staff giveaways with persistent entry buttons\n/economy and /leaderboard coins: server coins\n/level and /leaderboard levels: XP (awards ${config.levelingEnabled ? 'enabled' : 'disabled'})\n/fun: coin flips, dice, and eight ball\nGateway events: ${config.gatewayEnabled ? 'enabled' : 'disabled'}`) };
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
        const content = leaders.length ? `**Server XP leaderboard**\n${leaders.map((account, index) => `${index + 1}. <@${account.userId}> - level **${account.level}** (${account.xp} XP)`).join('\n')}` : 'No one has earned XP yet.';
        return { immediate: response(content) };
      }
      if (action === 'coins') {
        if (!economy) return { immediate: response('The economy store is unavailable. Ask an administrator to check the bot setup.') };
        const leaders = economy.leaderboard(interaction.guild_id, 10);
        const content = leaders.length ? `**Server coin leaderboard**\n${leaders.map((account, index) => `${index + 1}. <@${account.userId}> - **${account.balance}**`).join('\n')}` : 'No one has earned coins yet.';
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
