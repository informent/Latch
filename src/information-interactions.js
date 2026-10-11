'use strict';

const { validId, decodeSnowflake, timestamp, inspectColor, calculate } = require('./utility-tools');
const ACTIONS = Object.freeze(['banner', 'servericon', 'serverbanner', 'roles', 'emojis', 'emoji', 'stickers', 'sticker', 'boosts', 'snowflake', 'timestamp', 'color', 'calculate']);
const LOCAL = new Set(['snowflake', 'timestamp', 'color', 'calculate']);
const PAGE_SIZE = 15;
const text = (value, limit = 80) => String(value).replace(/[\r\n\t]/g, ' ').replace(/@/g, '\uff20').replace(/[\\`*_~|<>\[\]()]/g, '\\$&').slice(0, limit);
function hashAsset(path, hash) {
  if (hash === null || hash === undefined) return null;
  if (typeof hash !== 'string' || !/^(?:a_)?[a-f0-9]{32}$/.test(hash)) throw new Error();
  return `https://cdn.discordapp.com/${path}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=1024`;
}
function stickerAsset(sticker) {
  if (sticker.format_type === 4) return `https://media.discordapp.net/stickers/${sticker.id}.gif`;
  return `https://cdn.discordapp.com/stickers/${sticker.id}.${sticker.format_type === 3 ? 'json' : 'png'}`;
}
function assertItem(item, guildId, kind) {
  if (!item || !validId(item.id) || typeof item.name !== 'string' || item.name.length > 100 || (item.guild_id !== undefined && item.guild_id !== guildId)) throw new Error();
  if (kind === 'roles' && (!Number.isSafeInteger(item.position) || item.position < 0)) throw new Error();
  if (kind === 'stickers' && (![1, 2, 3, 4].includes(item.format_type) || item.type !== 2)) throw new Error();
  return item;
}
function pageOf(items, page, title, render) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  if (page > pages) return { content: `Choose a page from 1 to ${pages}.` };
  return { embeds: [{ title, description: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(render).join('\n') || 'None configured in this server.', footer: { text: `Page ${page}/${pages} | ${items.length} total` } }] };
}

function createInformationHandler({ config, discord, logger, now }, { response, defer, findOption }) {
  return function handleInformation(interaction) {
    const subcommand = interaction.data.options[0], action = subcommand.name, options = subcommand.options || [];
    const value = (name) => findOption(options, name);
    if (LOCAL.has(action)) {
      try {
        let content, embeds;
        if (action === 'snowflake') {
          const decoded = decodeSnowflake(value('id'));
          content = `ID: ${decoded.id}\nCreated: <t:${decoded.seconds}:F>\nUTC: ${decoded.iso}\nWorker: ${decoded.worker} | Process: ${decoded.process} | Increment: ${decoded.increment}\nDecoding an ID does not prove that an object exists.`;
        } else if (action === 'timestamp') {
          const result = timestamp(value('seconds'), value('style'), now());
          content = `${result.markup}\nCopy: \`${result.markup}\`\nUTC: ${result.iso}\nUnix seconds: ${result.seconds}`;
        } else if (action === 'color') {
          const result = inspectColor(value('hex'));
          embeds = [{ title: result.hex, color: result.decimal, description: `RGB: ${result.red}, ${result.green}, ${result.blue}\nDecimal: ${result.decimal}` }];
          content = '';
        } else content = `Result: \`${calculate(value('expression'))}\`\nUses floating-point arithmetic. ^ means exponentiation; % means remainder.`;
        const immediate = response(content);
        if (embeds) immediate.data.embeds = embeds;
        return { immediate };
      } catch (error) { return { immediate: response(error.message) }; }
    }
    const page = value('page') ?? 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000) return { immediate: response('Choose a page between 1 and 1000.') };
    const target = value('user') ?? (interaction.member?.user?.id || interaction.user?.id);
    const itemId = value('id');
    if (action === 'banner' && (!validId(target) || !['server', 'global'].includes(value('profile') ?? 'server'))) return { immediate: response('Choose a current server member and a valid profile type.') };
    if (['emoji', 'sticker'].includes(action) && !validId(itemId)) return { immediate: response('Enter a valid emoji or sticker ID from this server.') };
    return { immediate: defer(), work: async () => {
      try {
        let result;
        if (action === 'banner') {
          const member = await discord.getGuildMember(config.guildId, target);
          if (member?.user?.id !== target) throw new Error();
          let url = value('profile') !== 'global' ? hashAsset(`guilds/${config.guildId}/users/${target}/banners`, member.banner) : null;
          let source = 'Server profile';
          if (!url) {
            const account = await discord.request('GET', `/users/${target}`);
            if (account?.id !== target) throw new Error();
            url = hashAsset(`banners/${target}`, account.banner);
            source = 'Global profile';
          }
          result = url ? { embeds: [{ title: `${text(member.nick || member.user.global_name || member.user.username)} banner`, image: { url }, description: `[Open image](${url})`, footer: { text: source } }] } : { content: 'This member has no banner for the selected profile.' };
        } else if (['servericon', 'serverbanner', 'boosts'].includes(action)) {
          const guild = await discord.getGuild(config.guildId);
          if (guild?.id !== config.guildId || typeof guild.name !== 'string') throw new Error();
          if (action === 'boosts') {
            const tier = Number.isInteger(guild.premium_tier) && guild.premium_tier >= 0 && guild.premium_tier <= 3 ? guild.premium_tier : 'unavailable';
            const count = Number.isSafeInteger(guild.premium_subscription_count) && guild.premium_subscription_count >= 0 ? guild.premium_subscription_count : 'unavailable';
            result = { content: `**${text(guild.name)}**\nBoost level: ${tier}\nCurrent boosts: ${count}\nThis is the server boost total, not a list of individual boosters.` };
          } else {
            const icon = action === 'servericon', label = icon ? 'icon' : 'banner';
            const url = hashAsset(`${icon ? 'icons' : 'banners'}/${config.guildId}`, guild[label]);
            result = url ? { embeds: [{ title: `${text(guild.name)} ${label}`, image: { url }, description: `[Open image](${url})` }] } : { content: `This server has no ${label}.` };
          }
        } else if (['roles', 'emojis', 'stickers'].includes(action)) {
          const items = await discord.request('GET', `/guilds/${config.guildId}/${action}`);
          if (!Array.isArray(items) || items.length > 10000) throw new Error();
          const seen = new Set();
          for (const item of items) { assertItem(item, config.guildId, action); if (seen.has(item.id)) throw new Error(); seen.add(item.id); }
          const sorted = [...items].sort((a, b) => (action === 'roles' ? b.position - a.position : 0) || a.name.localeCompare(b.name) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
          result = pageOf(sorted, page, `Server ${action}`, (item) => `${text(item.name)} | \`${item.id}\`${action === 'roles' ? ` | position ${item.position}` : action === 'emojis' ? ` | ${item.animated ? 'animated' : 'static'}` : ` | ${['', 'PNG', 'APNG', 'Lottie', 'GIF'][item.format_type]}`}`);
        } else {
          const kind = action === 'emoji' ? 'emojis' : 'stickers';
          const item = assertItem(await discord.request('GET', `/guilds/${config.guildId}/${kind}/${itemId}`), config.guildId, kind);
          if (item.id !== itemId) throw new Error();
          const url = action === 'emoji' ? `https://cdn.discordapp.com/emojis/${item.id}.webp?size=128${item.animated ? '&animated=true' : ''}` : stickerAsset(item);
          const embed = { title: text(item.name), description: `ID: ${item.id}\nAvailable: ${item.available === true ? 'yes' : item.available === false ? 'no' : 'unknown'}\n[Open asset](${url})` };
          if (action === 'emoji' || item.format_type !== 3) embed.image = { url };
          if (action === 'sticker') embed.description += `\nFormat: ${['', 'PNG', 'APNG', 'Lottie', 'GIF'][item.format_type]}`;
          result = { embeds: [embed] };
        }
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: '', embeds: [], ...result, allowed_mentions: { parse: [] } });
      } catch {
        logger('utility_information_failed', { action });
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Could not load that information. Check that the member or asset belongs to this server and try again.', embeds: [], allowed_mentions: { parse: [] } }).catch(() => {});
      }
    } };
  };
}

module.exports = { createInformationHandler, INFORMATION_ACTIONS: ACTIONS };
