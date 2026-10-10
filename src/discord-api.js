'use strict';

const API = 'https://discord.com/api/v10';
const REQUEST_BUDGET_MS = 12_000;
const MAX_RATE_LIMIT_RETRIES = 2;

class DiscordApi {
  constructor(token, fetchImpl = fetch) {
    this.token = token;
    this.fetch = fetchImpl;
    this.globalRetryAt = 0;
  }

  async request(method, path, body, { botAuth = true, auditReason } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (botAuth) headers.Authorization = `Bot ${this.token}`;
    if (auditReason) headers['X-Audit-Log-Reason'] = encodeURIComponent(auditReason);
    const deadline = Date.now() + REQUEST_BUDGET_MS;
    const signal = AbortSignal.timeout(REQUEST_BUDGET_MS);
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    for (let attempt = 0; ; attempt++) {
      if (botAuth) await this.#waitUntil(this.globalRetryAt, deadline);
      let response;
      try {
        response = await this.fetch(`${API}${path}`, { method, headers, body: serializedBody, signal });
      } catch {
        // A write may already have succeeded; do not retry ambiguous network failures.
        throw new Error('Discord API request failed before receiving a response.');
      }
      if (response.status === 429) {
        let limit;
        try { limit = await response.json(); } catch { limit = null; }
        const header = response.headers?.get('retry-after');
        const seconds = typeof limit?.retry_after === 'number' ? limit.retry_after : header ? Number(header) : NaN;
        if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Discord API request failed (429).');
        const retryAt = Date.now() + Math.max(50, Math.ceil(seconds * 1000));
        if (!Number.isFinite(retryAt) || !Number.isSafeInteger(retryAt)) throw new Error('Discord API request failed (429).');
        if (botAuth && (limit?.global === true || response.headers?.get('x-ratelimit-global') === 'true')) this.globalRetryAt = Math.max(this.globalRetryAt, retryAt);
        if (attempt >= MAX_RATE_LIMIT_RETRIES) throw new Error('Discord API request failed (429).');
        await this.#waitUntil(retryAt, deadline);
        continue;
      }
      if (!response.ok) throw Object.assign(new Error(`Discord API request failed (${response.status}).`), { statusCode: response.status });
      if (response.status === 204) return null;
      try { return await response.json(); }
      catch { throw new Error('Discord API response could not be decoded.'); }
    }
  }

  async #waitUntil(retryAt, deadline) {
    while (Date.now() < retryAt) {
      const delay = retryAt - Date.now();
      if (retryAt >= deadline || Date.now() >= deadline) throw new Error('Discord API rate limit exceeds the request time budget.');
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (Date.now() >= deadline) throw new Error('Discord API request time budget exceeded.');
  }

  getCurrentUser() { return this.request('GET', '/users/@me'); }
  listAutoModRules(guildId) { return this.request('GET', `/guilds/${guildId}/auto-moderation/rules`); }
  getAutoModRule(guildId, ruleId) { return this.request('GET', `/guilds/${guildId}/auto-moderation/rules/${ruleId}`); }
  createAutoModRule(guildId, data, reason) { return this.request('POST', `/guilds/${guildId}/auto-moderation/rules`, data, { auditReason: reason }); }
  editAutoModRule(guildId, ruleId, data, reason) { return this.request('PATCH', `/guilds/${guildId}/auto-moderation/rules/${ruleId}`, data, { auditReason: reason }); }
  deleteAutoModRule(guildId, ruleId, reason) { return this.request('DELETE', `/guilds/${guildId}/auto-moderation/rules/${ruleId}`, undefined, { auditReason: reason }); }
  getGatewayBot() { return this.request('GET', '/gateway/bot'); }
  getGuild(guildId) { return this.request('GET', `/guilds/${guildId}?with_counts=true`); }
  getGuildMember(guildId, userId) { return this.request('GET', `/guilds/${guildId}/members/${userId}`); }
  createMessage(channelId, data) { return this.request('POST', `/channels/${channelId}/messages`, data); }
  editMessage(channelId, messageId, data) { return this.request('PATCH', `/channels/${channelId}/messages/${messageId}`, data); }
  banMember(guildId, userId, reason) { return this.request('PUT', `/guilds/${guildId}/bans/${userId}`, { delete_message_seconds: 0 }, { auditReason: reason }); }
  unbanMember(guildId, userId, reason) { return this.request('DELETE', `/guilds/${guildId}/bans/${userId}`, undefined, { auditReason: reason }); }
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

module.exports = { DiscordApi, REQUEST_BUDGET_MS, MAX_RATE_LIMIT_RETRIES };
