'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ids, fakeDiscord } = require('./feature-fixtures');
const { ModerationGuard, ModerationDenied } = require('../src/moderation-guard');
const actions = ['ban', 'kick', 'timeout', 'untimeout', 'grant', 'revoke', 'nickname', 'clear-nickname'];
for (const action of actions) {
  test(`delegation ${action}: valid staff, self, owner, bot and equal hierarchy`, async () => {
    const f = fakeDiscord(); const guard = new ModerationGuard({ config: { guildId: ids.guild }, discord: f.discord, botUserId: ids.bot });
    await guard.check(action, ids.actor, ids.user, ids.role);
    for (const target of [ids.actor, ids.owner, ids.bot]) await assert.rejects(guard.check(action, ids.actor, target, ids.role), ModerationDenied);
    f.members.get(ids.user).roles = [ids.actorRole]; await assert.rejects(guard.check(action, ids.actor, ids.user, ids.role), /below your highest/);
    f.members.get(ids.user).roles = [ids.botRole]; await assert.rejects(guard.check(action, ids.owner, ids.user, ids.role), /below OpenDesk/);
  });
  test(`delegation ${action}: live permission removal and invalid role snapshots`, async () => {
    const f = fakeDiscord(); const guard = new ModerationGuard({ config: { guildId: ids.guild }, discord: f.discord });
    f.roles.find((role) => role.id === ids.actorRole).permissions = '0'; await assert.rejects(guard.check(action, ids.actor, ids.user, ids.role), /no longer permit/);
    f.roles.find((role) => role.id === ids.actorRole).permissions = '8'; f.members.get(ids.actor).roles.push(ids.message); await assert.rejects(guard.check(action, ids.actor, ids.user, ids.role), /roles unavailable/);
  });
}
test('role delegation refuses managed/everyone/higher roles and unauthorized grant bits', async () => {
  const f = fakeDiscord(); const guard = new ModerationGuard({ config: { guildId: ids.guild }, discord: f.discord }); const role = f.roles.find((r) => r.id === ids.role);
  role.managed = true; await assert.rejects(guard.check('grant', ids.actor, ids.user, ids.role), /unmanaged/);
  role.managed = false; await assert.rejects(guard.check('grant', ids.actor, ids.user, ids.guild), /everyone/);
  role.position = 20; await assert.rejects(guard.check('grant', ids.actor, ids.user, ids.role), /selected role/);
  role.position = 1; role.permissions = String(1n << 29n); await assert.rejects(guard.check('grant', ids.actor, ids.user, ids.role), /do not hold/);
  await guard.check('revoke', ids.actor, ids.user, ids.role); await guard.check('grant', ids.owner, ids.user, ids.role);
});
test('timeout targets and timed-out staff are protected', async () => {
  const f = fakeDiscord(); const guard = new ModerationGuard({ config: { guildId: ids.guild }, discord: f.discord });
  f.members.get(ids.user).user.bot = true; await assert.rejects(guard.check('timeout', ids.actor, ids.user), /administrators or bots/);
  f.members.get(ids.user).user.bot = false; f.roles.find((r) => r.id === ids.role).permissions = '8'; f.members.get(ids.user).roles = [ids.role];
  await assert.rejects(guard.check('untimeout', ids.actor, ids.user), /administrators or bots/);
  f.members.get(ids.actor).communication_disabled_until = new Date(Date.now() + 60000).toISOString(); await assert.rejects(guard.check('kick', ids.actor, ids.user), /Timed-out staff/);
});
