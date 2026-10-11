'use strict';
const { MAX_UPLOAD_BYTES } = require('./discord-api');
const id = value => typeof value === 'string' && /^\d{5,25}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.length <= max;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const LIMIT = 100;
const NOTE = 'Recent message snapshot only. Older/deleted messages, attachment bytes, reactions, components, polls and stickers are not exported. Discord may omit content, embeds and attachments without Message Content access. Attachment links can expire. This file contains private conversation data.';
function normalize(message, channelId) {
  if (!message || !id(message.id) || message.channel_id !== channelId || !id(message.author?.id) || !text(message.author.username, 80) || !text(message.content, 4000) || !date(message.timestamp) || !(message.edited_timestamp == null || date(message.edited_timestamp)) || !Array.isArray(message.attachments) || message.attachments.length > 10 || !Array.isArray(message.embeds) || message.embeds.length > 10) throw new Error('Invalid transcript message.');
  const attachments = message.attachments.map(item => {
    if (!item || !id(item.id) || !text(item.filename, 256) || !text(item.url, 2048) || !Number.isSafeInteger(item.size) || item.size < 0) throw new Error('Invalid transcript attachment.');
    let url; try { url = new URL(item.url); } catch { throw new Error('Invalid transcript attachment URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid transcript attachment URL.');
    return { id: item.id, filename: item.filename, size: item.size, url: item.url };
  });
  let embedLength = 0;
  const embeds = message.embeds.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !(item.title === undefined || text(item.title,256)) || !(item.description === undefined || text(item.description,4096)) || !(item.fields === undefined || Array.isArray(item.fields) && item.fields.length <= 25)) throw new Error('Invalid transcript embed.');
    const fields = (item.fields || []).map(field => { if (!field || !text(field.name,256) || !text(field.value,1024)) throw new Error('Invalid transcript embed field.'); return { name: field.name, value: field.value }; });
    embedLength += (item.title || '').length + (item.description || '').length + fields.reduce((sum,field)=>sum+field.name.length+field.value.length,0);
    return { title: item.title || '', description: item.description || '', fields };
  });
  if (embedLength > 6000) throw new Error('Transcript embed text exceeds its limit.');
  const reference = message.message_reference;
  if (reference?.message_id !== undefined && !id(reference.message_id)) throw new Error('Invalid transcript reference.');
  return { id: message.id, author: { id: message.author.id, username: message.author.username, bot: message.author.bot === true }, content: message.content, timestamp: message.timestamp, editedAt: message.edited_timestamp || null, replyTo: reference?.message_id || null, attachments, embeds };
}
function channelAccess({ guild, roles, member, entries }) {
  if (!id(guild?.id) || !id(guild.owner_id) || !id(member?.user?.id) || !Array.isArray(roles) || roles.length > 1000 || !Array.isArray(member.roles) || member.roles.length > 1000) throw new Error('Transcript access roles unavailable.');
  const map = new Map();
  for (const role of roles) { if (!id(role?.id) || map.has(role.id) || typeof role.permissions !== 'string' || !/^\d{1,30}$/.test(role.permissions)) throw new Error('Transcript access roles invalid.'); map.set(role.id, BigInt(role.permissions)); }
  if (!map.has(guild.id) || new Set(member.roles).size !== member.roles.length || member.roles.some(role=>!map.has(role))) throw new Error('Transcript member roles invalid.');
  const base = member.roles.reduce((bits,role)=>bits|map.get(role),map.get(guild.id));
  if (member.user.id === guild.owner_id || base & 8n) return { base: base | 8n, readable: true };
  let bits = base; const everyone = entries.find(entry=>entry.type===0 && entry.id===guild.id);
  bits = (bits & ~BigInt(everyone.deny || '0')) | BigInt(everyone.allow || '0');
  let allow = 0n, deny = 0n;
  for (const entry of entries.filter(entry=>entry.type===0 && member.roles.includes(entry.id))) { allow |= BigInt(entry.allow || '0'); deny |= BigInt(entry.deny || '0'); }
  bits = (bits & ~deny) | allow;
  const overwrite = entries.find(entry=>entry.type===1 && entry.id===member.user.id);
  if (overwrite) bits = (bits & ~BigInt(overwrite.deny || '0')) | BigInt(overwrite.allow || '0');
  const required = (1n<<10n) | (1n<<16n);
  return { base, readable: (bits & required) === required };
}

function exportTranscript({ ticket, channelId, guildId, messages, limit = 50, format = 'text', exportedAt = new Date().toISOString() }) {
  if (!id(channelId) || !id(guildId) || ticket?.channelId !== channelId || !id(ticket.ownerId) || !['open','closing','closed','reopening'].includes(ticket.status) || !Number.isInteger(limit) || limit < 1 || limit > LIMIT || !['text','json'].includes(format) || !date(exportedAt) || !Array.isArray(messages) || messages.length > limit) throw new Error('Invalid transcript request.');
  const normalized = messages.map(message=>normalize(message,channelId)).sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
  if (new Set(normalized.map(message=>message.id)).size !== normalized.length) throw new Error('Duplicate transcript messages.');
  const snapshot = { version: 1, guildId, channelId, ownerId: ticket.ownerId, state: ticket.status, exportedAt, requestedMessages: limit, returnedMessages: normalized.length, scope: 'recent-snapshot', notes: NOTE, messages: normalized };
  let output;
  if (format === 'json') output = JSON.stringify(snapshot,null,2)+'\n';
  else {
    const lines = ['Latch ticket transcript', `Channel: ${channelId}`, `Server: ${guildId}`, `Owner: ${ticket.ownerId}`, `State: ${ticket.status}`, `Exported: ${exportedAt}`, `Messages: ${normalized.length} of up to ${limit} recent messages`, NOTE, ''];
    for (const message of normalized) {
      lines.push(`[${message.timestamp}] ${message.author.username.replace(/[\r\n\t]/g,' ')} (${message.author.id}) | message ${message.id}${message.author.bot?' | bot':''}`, ...(message.editedAt?[`Edited: ${message.editedAt}`]:[]), ...(message.replyTo?[`Reply to: ${message.replyTo}`]:[]), message.content || '[No text returned by Discord]');
      for (const attachment of message.attachments) lines.push(`Attachment: ${JSON.stringify(attachment.filename)} (${attachment.size} bytes) ${attachment.url}`);
      for (const embed of message.embeds) { if (embed.title) lines.push(`Embed title: ${embed.title}`); if (embed.description) lines.push(`Embed: ${embed.description}`); for (const field of embed.fields) lines.push(`${field.name}: ${field.value}`); }
      lines.push('');
    }
    output = lines.join('\n')+'\n';
  }
  const data = Buffer.from(output,'utf8');
  if (data.length > MAX_UPLOAD_BYTES) throw new Error('Transcript is too large. Request fewer messages.');
  return { filename: `ticket-${channelId}.${format === 'json'?'json':'txt'}`, contentType: format === 'json'?'application/json':'text/plain; charset=utf-8', data, count: normalized.length, limit };
}
module.exports = { exportTranscript, channelAccess, LIMIT, NOTE };
