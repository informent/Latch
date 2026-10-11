'use strict';
const definitions = [
  ['Tickets', 'storePath', 'tickets.json', require('./ticket-store').TicketStore],
  ['Warnings', 'moderationStorePath', 'moderation.json', require('./moderation-store').ModerationStore],
  ['Coins', 'economyStorePath', 'economy.json', require('./economy-store').EconomyStore],
  ['XP', 'levelStorePath', 'levels.json', require('./level-store').LevelStore],
  ['Community jobs', 'communityStorePath', 'community.json', require('./community-store').CommunityStore],
  ['Voice', 'voiceStorePath', 'voice.json', require('./voice-store').VoiceStore, true],
  ['Role menus', 'roleMenuStorePath', 'role-menus.json', require('./role-menu-store').RoleMenuStore, true],
  ['Templates', 'templateStorePath', 'templates.json', require('./template-store').TemplateStore, true],
  ['Responders', 'responderStorePath', 'responders.json', require('./responder-store').ResponderStore, true],
  ['Timers', 'timerStorePath', 'timers.json', require('./timer-store').TimerStore, true],
  ['Ticket panels', 'ticketPanelStorePath', 'ticket-panels.json', require('./ticket-panel-store').TicketPanelStore, true],
  ['Level rewards', 'levelRewardStorePath', 'level-rewards.json', require('./level-reward-store').LevelRewardStore, true]
].map(([name, key, file, Store, guildBound = false]) => Object.freeze({ name, key, file, Store, guildBound }));
const storeDefinitions = Object.freeze(definitions);
function openStore(definition, file, guildId) { return definition.guildBound ? new definition.Store(file, guildId) : new definition.Store(file); }
module.exports = { storeDefinitions, openStore };
