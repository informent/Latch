'use strict';
const ID = /^\d{5,25}$/;
function validatePoll(message, messageId, channelId, botId) {
  const poll = message?.poll;
  if (message?.id !== messageId || message.channel_id !== channelId || message.author?.id !== botId || !poll
    || typeof poll.question?.text !== 'string' || poll.question.text.length > 300 || !Array.isArray(poll.answers) || poll.answers.length < 2 || poll.answers.length > 10
    || poll.answers.some((answer) => !Number.isSafeInteger(answer.answer_id) || answer.answer_id < 1 || typeof answer.poll_media?.text !== 'string' || answer.poll_media.text.length > 55)
    || new Set(poll.answers.map((answer) => answer.answer_id)).size !== poll.answers.length || typeof poll.allow_multiselect !== 'boolean'
    || !(poll.expiry === null || typeof poll.expiry === 'string' && Number.isFinite(Date.parse(poll.expiry)))) throw new Error('Poll identity or data unavailable.');
  if (poll.results !== undefined && (!poll.results || typeof poll.results.is_finalized !== 'boolean' || !Array.isArray(poll.results.answer_counts) || poll.results.answer_counts.length > poll.answers.length
    || poll.results.answer_counts.some((count) => !poll.answers.some((answer) => answer.answer_id === count.id) || !Number.isSafeInteger(count.count) || count.count < 0)
    || new Set(poll.results.answer_counts.map((count) => count.id)).size !== poll.results.answer_counts.length)) throw new Error('Poll results unavailable.');
  return poll;
}
function createPollHandler({ config, discord, logger, now }, { response, defer, hasPermission, findOption, safeText }) {
  const locks = new Map();
  return async (interaction) => {
    if (!hasPermission(interaction.member?.permissions, 8192n)) return { immediate: response('You need Manage Messages in this channel to manage OpenDesk polls.') };
    const command = interaction.data?.options?.[0], action = command?.name, options = command?.options || [];
    const messageId = findOption(options, 'message'), channelId = interaction.channel_id, answerId = findOption(options, 'answer'), after = findOption(options, 'after');
    if (!['info', 'end', 'voters'].includes(action)) return { immediate: response('Choose a poll management action.') };
    if (typeof messageId !== 'string' || !ID.test(messageId) || typeof channelId !== 'string' || !ID.test(channelId)
      || action === 'voters' && (!Number.isSafeInteger(answerId) || answerId < 1 || answerId > 2147483647 || after !== undefined && (typeof after !== 'string' || !ID.test(after)))) return { immediate: response('Provide a poll message ID in this channel and a valid answer ID or voter cursor.') };
    return { immediate: defer(), work: async () => {
      const key = `${channelId}:${messageId}`, previous = locks.get(key) || Promise.resolve(); let release;
      const gate = new Promise((resolve) => { release = resolve; }); locks.set(key, gate); await previous;
      try {
        let content;
        const [channel, bot] = await Promise.all([discord.request('GET', `/channels/${channelId}`), discord.getCurrentUser()]);
        if (channel?.id !== channelId || channel.guild_id !== config.guildId || channel.type !== 0 || typeof bot?.id !== 'string' || !ID.test(bot.id)) throw new Error('Poll channel or bot identity unavailable.');
        const route = `/channels/${channelId}/messages/${messageId}`;
        let poll = validatePoll(await discord.request('GET', route), messageId, channelId, bot.id);
        const ended = () => poll.results?.is_finalized === true || poll.expiry !== null && Date.parse(poll.expiry) <= now().getTime();
        if (action === 'end') {
          if (!ended()) {
            await discord.request('POST', `/channels/${channelId}/polls/${messageId}/expire`);
            poll = validatePoll(await discord.request('GET', route), messageId, channelId, bot.id);
            if (!ended()) throw new Error('Poll end could not be confirmed.');
          }
          content = `Poll ended. ${poll.results?.is_finalized ? 'Results are finalized.' : 'Final vote counting may still be pending.'} Use pollmanage info to inspect the results.`;
        } else if (action === 'voters') {
          if (!poll.answers.some((answer) => answer.answer_id === answerId)) throw new Error('Answer is not in this poll.');
          const result = await discord.request('GET', `/channels/${channelId}/polls/${messageId}/answers/${answerId}?limit=25${after ? `&after=${after}` : ''}`);
          if (!Array.isArray(result?.users) || result.users.length > 25 || result.users.some((user) => typeof user?.id !== 'string' || !ID.test(user.id) || after && BigInt(user.id) <= BigInt(after)) || new Set(result.users.map((user) => user.id)).size !== result.users.length) throw new Error('Voter page unavailable.');
          const users = [...result.users].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
          content = `**Voters for answer ${answerId}**\n${users.length ? users.map((user) => `<@${user.id}>`).join('\n') : 'No voters on this page.'}${users.length === 25 ? `\nNext cursor: ${users.at(-1).id}` : '\nEnd of this page set.'}\nVotes can change while the poll is open. This is one page, not a stored voter history.`;
        } else {
          const tally = poll.results ? poll.results.is_finalized ? 'Finalized' : 'Provisional' : 'Unavailable';
          content = `**${safeText(poll.question.text)}**\nState: ${ended() ? 'Ended' : 'Open'}\nResults: ${tally}\nMultiple choices: ${poll.allow_multiselect ? 'yes' : 'no'}${poll.expiry ? `\nExpiry: <t:${Math.floor(Date.parse(poll.expiry) / 1000)}:F>` : ''}\n${poll.answers.map((answer) => `${answer.answer_id}. ${safeText(answer.poll_media.text)}: ${poll.results ? (poll.results.answer_counts.find((count) => count.id === answer.answer_id)?.count ?? 0) : 'unknown'} votes`).join('\n')}`;
        }
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content, allowed_mentions: { parse: [] } });
      } catch {
        try { logger('poll_management_failed', { action }); } catch {}
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: 'Could not complete the poll action. Use an OpenDesk poll message in this server text channel, check permissions and the answer ID, then retry. If ending failed, inspect the poll because Discord may already have ended it.', allowed_mentions: { parse: [] } }).catch(() => {});
      } finally { release(); if (locks.get(key) === gate) locks.delete(key); }
    } };
  };
}
module.exports = { createPollHandler, validatePoll };
