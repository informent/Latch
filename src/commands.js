'use strict';

const option = (type, name, description, extra = {}) => ({ type, name, description, ...extra });
const subcommand = (name, description, options = []) => ({ type: 1, name, description, ...(options.length ? { options } : {}) });
const target = option(6, 'user', 'Member to act on.', { required: true });
const reason = option(3, 'reason', 'Reason recorded in the server audit log.', { required: false, max_length: 400 });

const commands = [
  {
    name: 'poll', description: 'Create a native Discord community poll.', type: 1, default_member_permissions: '8192',
    options: [option(3, 'question', 'Question to vote on.', { required: true, max_length: 300 }), option(3, 'answers', 'Separate 2 to 10 choices with | (each up to 55 characters).', { required: true, max_length: 600 }), option(4, 'hours', 'Voting duration in hours (default 24).', { min_value: 1, max_value: 768 }), option(5, 'multiple', 'Allow voters to select multiple choices.')]
  },
  {
    name: 'ticket', description: 'Create or close a private support ticket.', type: 1,
    options: [subcommand('create', 'Open a private support ticket.'), subcommand('close', 'Close a ticket in this channel or a selected channel.', [option(7, 'channel', 'Ticket channel to close.', { required: false, channel_types: [0] })]),
      subcommand('list', 'List open tickets; members see only their own.', [option(4, 'page', 'Results page, ten tickets per page.', { min_value: 1, max_value: 10000 })]),
      subcommand('stats', 'Show support team ticket statistics.'),
      ...['claim', 'unclaim'].map((action) => subcommand(action, `${action} an open ticket as support staff.`, [option(7, 'channel', 'Ticket channel; defaults to this channel.', { channel_types: [0] })])),
      subcommand('rename', 'Rename an open ticket as support staff.', [option(3, 'name', 'Lowercase letters, digits and hyphens; maximum 90 characters.', { required: true, min_length: 1, max_length: 90 }), option(7, 'channel', 'Ticket channel; defaults to this channel.', { channel_types: [0] })])]
  },
  {
    name: 'moderation', description: 'Moderate members and manage server warnings.', type: 1,
    options: [
      subcommand('ban', 'Ban a member from this server.', [target, reason]),
      subcommand('unban', 'Remove a server ban by user ID.', [option(3, 'user-id', 'ID of the banned user.', { required: true, min_length: 5, max_length: 25 }), reason]),
      subcommand('kick', 'Remove a member from this server.', [target, reason]),
      subcommand('timeout', 'Temporarily prevent a member from participating.', [target, option(4, 'minutes', 'Timeout length in minutes (1 to 40320).', { required: true, min_value: 1, max_value: 40320 }), reason]),
      subcommand('untimeout', 'Remove a member timeout.', [target, reason]),
      subcommand('purge', 'Delete recent messages from this channel.', [option(4, 'count', 'Number of recent messages to remove (2 to 100).', { required: true, min_value: 2, max_value: 100 })]),
      subcommand('slowmode', 'Set the current channel slowmode.', [option(4, 'seconds', 'Delay between messages (0 to disable, maximum 21600).', { required: true, min_value: 0, max_value: 21600 })]),
      subcommand('warn', 'Record a staff warning for a member.', [target, option(3, 'reason', 'Why this warning was issued.', { required: true, max_length: 400 })]),
      subcommand('warnings', 'Show recorded warnings for a member.', [target]),
      subcommand('clear-warnings', 'Clear recorded warnings for a member.', [target])
    ]
  },
  {
    name: 'utility', description: 'Useful server information and bot health.', type: 1,
    options: [subcommand('ping', 'Check whether OpenDesk is responding.'), subcommand('server', 'Show basic information about this server.'), subcommand('user', 'Show account and server membership information.', [option(6, 'user', 'Member to inspect; defaults to yourself.')]), subcommand('avatar', 'Show a member avatar.', [option(6, 'user', 'Member to inspect; defaults to yourself.')]), subcommand('help', 'Show available feature suites and configuration status.')]
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
  },
  {
    name: 'automod', description: 'Manage Discord native message filtering rules.', type: 1, default_member_permissions: '32',
    options: [
      subcommand('list', 'List server AutoMod rules and their IDs.'),
      subcommand('keywords', 'Create a disabled keyword filter for review.', [option(3, 'name', 'Rule name.', { required: true, max_length: 80 }), option(3, 'keywords', 'Comma-separated words or phrases; Discord wildcards supported.', { required: true, max_length: 2000 })]),
      subcommand('mentions', 'Create a disabled mention spam and raid filter.', [option(3, 'name', 'Rule name.', { required: true, max_length: 80 }), option(4, 'limit', 'Maximum unique mentions allowed per message.', { required: true, min_value: 1, max_value: 50 })]),
      subcommand('spam', 'Create a disabled Discord spam filter.', [option(3, 'name', 'Rule name.', { required: true, max_length: 80 })]),
      ...['enable', 'disable', 'remove'].map((action) => subcommand(action, `${action} an OpenDesk rule by ID.`, [option(3, 'rule', 'Rule ID from /automod list.', { required: true, max_length: 25 })]))
    ]
  },
  {
    name: 'embed', description: 'Publish a custom embed in the current channel.', type: 1, default_member_permissions: '8192',
    options: [option(3, 'title', 'Announcement title.', { required: true, max_length: 256 }), option(3, 'description', 'Announcement body.', { required: true, max_length: 4000 }), option(3, 'color', 'Optional six-digit hex color, for example 5865f2.', { required: false, max_length: 7 })]
  },
  {
    name: 'fun', description: 'Free random games and utilities.', type: 1,
    options: [subcommand('coin', 'Flip a coin.'), subcommand('roll', 'Roll a die.', [option(4, 'sides', 'Number of sides.', { required: false, min_value: 2, max_value: 1000 })]), subcommand('eightball', 'Ask the magic eight ball.', [option(3, 'question', 'Your question.', { required: true, max_length: 300 })])]
  },
  {
    name: 'reminder', description: 'Schedule reminders posted in the current channel.', type: 1,
    options: [
      subcommand('create', 'Schedule a reminder posted publicly in this channel.', [option(4, 'minutes', 'Minutes from now (up to 30 days).', { required: true, min_value: 1, max_value: 43200 }), option(3, 'text', 'Reminder text visible to this channel.', { required: true, max_length: 500 })]),
      subcommand('list', 'List your pending reminders privately.'),
      subcommand('cancel', 'Cancel one of your pending reminders.', [option(3, 'id', 'Reminder ID from /reminder list.', { required: true, max_length: 25 })])
    ]
  },
  {
    name: 'giveaway', description: 'Host free community giveaways with persistent entry buttons.', type: 1, default_member_permissions: '8192',
    options: [
      subcommand('create', 'Create a giveaway in this channel.', [option(3, 'prize', 'Prize supplied by the giveaway host.', { required: true, max_length: 200 }), option(4, 'minutes', 'Entry period in minutes (up to 30 days).', { required: true, min_value: 1, max_value: 43200 }), option(4, 'winners', 'Number of winners (default 1).', { min_value: 1, max_value: 20 })]),
      subcommand('list', 'List active giveaways in this server.'),
      { type: 2, name: 'edit', description: 'Edit an active giveaway; staff permission required.', options: [
        subcommand('prize', 'Change the prize of an active giveaway.', [option(3, 'id', 'Giveaway ID.', { required: true, max_length: 25 }), option(3, 'prize', 'New prize.', { required: true, min_length: 1, max_length: 200 })]),
        subcommand('winners', 'Change how many winners will be selected.', [option(3, 'id', 'Giveaway ID.', { required: true, max_length: 25 }), option(4, 'winners', 'Number of winners.', { required: true, min_value: 1, max_value: 20 })]),
        subcommand('duration', 'Set time remaining, within a total lifetime of 30 days.', [option(3, 'id', 'Giveaway ID.', { required: true, max_length: 25 }), option(4, 'minutes', 'Minutes remaining from now.', { required: true, min_value: 1, max_value: 43200 })])
      ] },
      ...['end', 'cancel', 'info', 'reroll'].map((action) => subcommand(action, `${action} a giveaway by ID.`, [option(3, 'id', 'Giveaway ID shown in its message footer.', { required: true, max_length: 25 })]))
    ]
  }
];


module.exports = { commands };
