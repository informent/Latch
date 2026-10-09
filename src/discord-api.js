'use strict';

const API = 'https://discord.com/api/v10';

class DiscordApi {
  constructor(token, fetchImpl = fetch) {
    this.token = token;
    this.fetch = fetchImpl;
  }

  async request(method, path, body, { botAuth = true, auditReason } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (botAuth) headers.Authorization = `Bot ${this.token}`;
    if (auditReason) headers['X-Audit-Log-Reason'] = encodeURIComponent(auditReason);
    let response;
    try {
      response = await this.fetch(`${API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(12_000)
      });
    } catch {
      // Never surface fetch errors: webhook URLs contain interaction tokens.
      throw new Error('Discord API request failed before receiving a response.');
    }
    if (!response.ok) {
      throw new Error(`Discord API request failed (${response.status}).`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  getCurrentUser() { return this.request('GET', '/users/@me'); }
  listAutoModRules(guildId) { return this.request('GET', `/guilds/${guildId}/auto-moderation/rules`); }
  getAutoModRule(guildId, ruleId) { return this.request('GET', `/guilds/${guildId}/auto-moderation/rules/${ruleId}`); }
  createAutoModRule(guildId, data, reason) { return this.request('POST', `/guilds/${guildId}/auto-moderation/rules`, data, { auditReason: reason }); }
  editAutoModRule(guildId, ruleId, data, reason) { return this.request('PATCH', `/guilds/${guildId}/auto-moderation/rules/${ruleId}`, data, { auditReason: reason }); }
  deleteAutoModRule(guildId, ruleId, reason) { return this.request('DELETE', `/guilds/${guildId}/auto-moderation/rules/${ruleId}`, undefined, { auditReason: reason }); }
  getGatewayBot() { return this.request('GET', '/gateway/bot'); }
  getGuild(guildId) { return this.request('GET', `/guilds/${guildId}?with_counts=true`); }
  createMessage(channelId, data) { return this.request('POST', `/channels/${channelId}/messages`, data); }
  banMember(guildId, userId, reason) { return this.request('PUT', `/guilds/${guildId}/bans/${userId}`, { delete_message_seconds: 0 }, { auditReason: reason }); }
  kickMember(guildId, userId, reason) { return this.request('DELETE', `/guilds/${guildId}/members/${userId}`, undefined, { auditReason: reason }); }
  timeoutMember(guildId, userId, until, reason) { return this.request('PATCH', `/guilds/${guildId}/members/${userId}`, { communication_disabled_until: until }, { auditReason: reason }); }
  getChannelMessages(channelId, limit) { return this.request('GET', `/channels/${channelId}/messages?limit=${limit}`); }
  deleteChannelMessage(channelId, messageId, reason) { return this.request('DELETE', `/channels/${channelId}/messages/${messageId}`, undefined, { auditReason: reason }); }
  bulkDeleteChannelMessages(channelId, messageIds, reason) { return this.request('POST', `/channels/${channelId}/messages/bulk-delete`, { messages: messageIds }, { auditReason: reason }); }
  grantRole(guildId, userId, roleId, reason) { return this.request('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, undefined, { auditReason: reason }); }
  revokeRole(guildId, userId, roleId, reason) { return this.request('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, undefined, { auditReason: reason }); }
  setNickname(guildId, userId, nickname, reason) { return this.request('PATCH', `/guilds/${guildId}/members/${userId}`, { nick: nickname || null }, { auditReason: reason }); }
  createChannel(guildId, data) { return this.request('POST', `/guilds/${guildId}/channels`, data); }
  editChannel(channelId, data) { return this.request('PATCH', `/channels/${channelId}`, data); }
  setMemberOverwrite(channelId, userId, data) {
    return this.request('PUT', `/channels/${channelId}/permissions/${userId}`, data);
  }
  editOriginalResponse(appId, token, data) {
    return this.request('PATCH', `/webhooks/${appId}/${encodeURIComponent(token)}/messages/@original`, data, { botAuth: false });
  }
}

module.exports = { DiscordApi };
