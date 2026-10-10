'use strict';

const ID = /^\d{5,25}$/;
const PERMISSIONS = Object.freeze({ ban: 4n, kick: 2n, timeout: 1n << 40n, untimeout: 1n << 40n });
class ModerationDenied extends Error {
  constructor(message) { super(message); this.name = 'ModerationDenied'; }
}
function deny(message) { throw new ModerationDenied(message); }

class ModerationGuard {
  constructor({ config, discord, botUserId }) { this.config = config; this.discord = discord; this.botUserId = botUserId; }
  async check(action, actorId, targetId) {
    const permission = PERMISSIONS[action];
    if (!permission || !ID.test(actorId) || !ID.test(targetId)) deny('Choose a valid member moderation action.');
    if (actorId === targetId) deny('You cannot use this moderation action on yourself.');
    const botId = this.botUserId || (await this.discord.getCurrentUser()).id;
    if (!ID.test(botId)) throw new Error('Bot identity unavailable.');
    if (targetId === botId) deny('You cannot use this moderation action on OpenDesk.');
    const guildId = this.config.guildId;
    const [guild, roles, actor, target, bot] = await Promise.all([
      this.discord.getGuild(guildId), this.discord.request('GET', `/guilds/${guildId}/roles`),
      this.discord.getGuildMember(guildId, actorId), this.discord.getGuildMember(guildId, targetId), this.discord.getGuildMember(guildId, botId)
    ]);
    if (guild?.id !== guildId || !ID.test(guild.owner_id) || !Array.isArray(roles) || !roles.length || roles.length > 1000) throw new Error('Guild roles unavailable.');
    const roleMap = new Map();
    for (const role of roles) {
      if (!role || !ID.test(role.id) || roleMap.has(role.id) || !Number.isInteger(role.position) || role.position < 0
        || typeof role.permissions !== 'string' || !/^\d{1,30}$/.test(role.permissions)) throw new Error('Guild roles invalid.');
      roleMap.set(role.id, role);
    }
    if (!roleMap.has(guildId)) throw new Error('Everyone role unavailable.');
    const snapshot = (member, expectedId) => {
      if (member?.user?.id !== expectedId || !Array.isArray(member.roles) || member.roles.length > 1000
        || member.roles.some((id) => typeof id !== 'string' || !roleMap.has(id))) throw new Error('Member roles unavailable.');
      const assigned = [roleMap.get(guildId), ...member.roles.map((id) => roleMap.get(id))];
      return { permissions: assigned.reduce((bits, role) => bits | BigInt(role.permissions), 0n), position: Math.max(...assigned.map((role) => role.position)) };
    };
    const staff = snapshot(actor, actorId); const subject = snapshot(target, targetId); const app = snapshot(bot, botId);
    if (targetId === guild.owner_id) deny('The server owner cannot be targeted by this moderation action.');
    if (actorId !== guild.owner_id) {
      if (!(staff.permissions & 8n) && !(staff.permissions & permission)) deny('Your current server roles no longer permit this moderation action.');
      if (staff.position <= subject.position) deny('The target must be below your highest role. Administrator does not bypass this check.');
    }
    if (!(app.permissions & 8n) && !(app.permissions & permission)) deny('OpenDesk lacks the server permission required for this action.');
    if (app.position <= subject.position) deny('The target must be below OpenDesk\'s highest role.');
    if (['timeout', 'untimeout'].includes(action) && (subject.permissions & 8n || target.user.bot)) deny('Timeout actions cannot target administrators or bots.');
  }
}
module.exports = { ModerationGuard, ModerationDenied };
