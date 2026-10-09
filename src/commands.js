'use strict';

const option = (type, name, description, extra = {}) => ({ type, name, description, ...extra });
const subcommand = (name, description, options = []) => ({ type: 1, name, description, ...(options.length ? { options } : {}) });
const target = option(6, 'user', 'Member to act on.', { required: true });
const reason = option(3, 'reason', 'Reason recorded in the server audit log.', { required: false, max_length: 400 });

const commands = [
  {
    name: 'ticket', description: 'Create or close a private support ticket.', type: 1,
    options: [subcommand('create', 'Open a private support ticket.'), subcommand('close', 'Close a ticket in this channel or a selected channel.', [option(7, 'channel', 'Ticket channel to close.', { required: false, channel_types: [0] })])]
  },
  {
    name: 'moderation', description: 'Moderate members and manage server warnings.', type: 1,
    options: [
      subcommand('ban', 'Ban a member from this server.', [target, reason]),
      subcommand('kick', 'Remove a member from this server.', [target, reason]),
      subcommand('timeout', 'Temporarily prevent a member from participating.', [target, option(4, 'minutes', 'Timeout length in minutes (1 to 40320).', { required: true, min_value: 1, max_value: 40320 }), reason]),
      subcommand('purge', 'Delete recent messages from this channel.', [option(4, 'count', 'Number of recent messages to remove (2 to 100).', { required: true, min_value: 2, max_value: 100 })]),
      subcommand('slowmode', 'Set the current channel slowmode.', [option(4, 'seconds', 'Delay between messages (0 to disable, maximum 21600).', { required: true, min_value: 0, max_value: 21600 })]),
      subcommand('warn', 'Record a staff warning for a member.', [target, option(3, 'reason', 'Why this warning was issued.', { required: true, max_length: 400 })]),
      subcommand('warnings', 'Show recorded warnings for a member.', [target]),
      subcommand('clear-warnings', 'Clear recorded warnings for a member.', [target])
    ]
  },
  {
    name: 'utility', description: 'Useful server information and bot health.', type: 1,
    options: [subcommand('ping', 'Check whether OpenDesk is responding.'), subcommand('server', 'Show basic information about this server.')]
  },
  {
    name: 'economy', description: 'Earn, save, and share server coins.', type: 1,
    options: [
      subcommand('balance', 'Check your balance or another member’s balance.', [option(6, 'user', 'Member to check.', { required: false })]),
      subcommand('daily', 'Claim your daily coin reward.'),
      subcommand('work', 'Earn coins by working. Cooldown applies.'),
      subcommand('pay', 'Send coins to another member.', [option(6, 'user', 'Member to pay.', { required: true }), option(4, 'amount', 'Number of coins to send.', { required: true, min_value: 1, max_value: 1_000_000 })])
    ]
  },
  {
    name: 'roles', description: 'Manage server roles and member nicknames.', type: 1,
    options: [
      subcommand('grant', 'Give a role to a member.', [target, option(8, 'role', 'Role to grant.', { required: true })]),
      subcommand('revoke', 'Remove a role from a member.', [target, option(8, 'role', 'Role to remove.', { required: true })]),
      subcommand('nickname', 'Set a member nickname.', [target, option(3, 'nickname', 'New nickname (up to 32 characters).', { required: true, min_length: 1, max_length: 32 })]),
      subcommand('clear-nickname', 'Clear a member nickname.', [target])
    ]
  },
  {
    name: 'level', description: 'View a member’s level and XP.', type: 1,
    options: [option(6, 'user', 'Member to check.', { required: false })]
  },
  {
    name: 'leaderboard', description: 'Show a server leaderboard.', type: 1,
    options: [subcommand('levels', 'Show the XP leaderboard.'), subcommand('coins', 'Show the coin leaderboard.')]
  }
];

module.exports = { commands };
