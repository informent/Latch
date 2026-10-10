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
    options: [subcommand('reopen', 'Reopen a closed ticket as support staff.', [option(7, 'channel', 'Closed ticket channel; defaults to this channel.', { channel_types: [0] })]), subcommand('create', 'Open a private support ticket.'), subcommand('close', 'Close a ticket in this channel or a selected channel.', [option(7, 'channel', 'Ticket channel to close.', { required: false, channel_types: [0] })]),
      subcommand('list', 'List open tickets; members see only their own.', [option(4, 'page', 'Results page, ten tickets per page.', { min_value: 1, max_value: 10000 })]),
      subcommand('stats', 'Show support team ticket statistics.'),
      subcommand('info', 'Privately inspect your ticket or any ticket as support staff.', [option(7, 'channel', 'Ticket channel; defaults to this channel.', { channel_types: [0] })]),
      subcommand('reason', 'Save a ticket reason as support staff.', [option(3, 'reason', 'Reason visible to the owner and support team.', { required: true, min_length: 1, max_length: 400 }), option(7, 'channel', 'Open ticket channel; defaults to this channel.', { channel_types: [0] })]),
      subcommand('move', 'Move an open ticket while preserving its channel overwrites.', [option(7, 'category', 'Destination category in this server.', { required: true, channel_types: [4] }), option(7, 'channel', 'Open ticket channel; defaults to this channel.', { channel_types: [0] })]),
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
    options: [subcommand('ping', 'Check whether OpenDesk is responding.'), subcommand('server', 'Show basic information about this server.'), subcommand('user', 'Show account and server membership information.', [option(6, 'user', 'Member to inspect; defaults to yourself.')]), subcommand('avatar', 'Show a member avatar.', [option(6, 'user', 'Member to inspect; defaults to yourself.')]), subcommand('role', 'Privately inspect a server role and its permission bits.', [option(8, 'role', 'Server role to inspect.', { required: true })]), subcommand('help', 'Show available feature suites and configuration status.')]
  },
  {
    name: 'economy', description: 'Earn, save, and share server coins.', type: 1,
    options: [
      subcommand('balance', 'Check your balance or another member’s balance.', [option(6, 'user', 'Member to check.', { required: false })]),
      subcommand('daily', 'Claim your daily coin reward.'),
      subcommand('work', 'Earn coins by working. Cooldown applies.'),
      subcommand('beg', 'Try for 0-25 coins every 15 minutes.'),
      subcommand('profile', 'Privately inspect coins, profession and reward readiness.', [option(6, 'user', 'Member to inspect; defaults to yourself.')]),
      { type: 2, name: 'profession', description: 'Choose a profession and progress through work rewards.', options: [
        subcommand('list', 'List free professions and rank bonuses.'),
        subcommand('choose', 'Choose a profession; changing resets rank, with a 24-hour cooldown.', [option(3, 'name', 'Profession; all have the same reward progression.', { required: true, choices: ['developer', 'artist', 'builder'].map((value) => ({ name: value, value })) })]),
        subcommand('status', 'Privately inspect your profession and work progression.')
      ] },
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
      subcommand('info', 'Inspect an OpenDesk rule, filters, actions and exemptions.', [option(3, 'rule', 'Rule ID.', { required: true, max_length: 25 })]),
      subcommand('presets', 'Create a disabled native preset filter for review.', [option(3, 'name', 'Rule name.', { required: true, max_length: 80 }), option(3, 'preset', 'Built-in wordsets.', { required: true, choices: [{ name: 'Profanity', value: 'profanity' }, { name: 'Sexual content', value: 'sexual' }, { name: 'Slurs', value: 'slurs' }, { name: 'All wordsets', value: 'all' }] })]),
      ...['exempt-role', 'unexempt-role', 'exempt-channel', 'unexempt-channel'].map((action) => subcommand(action, `${action} on an OpenDesk rule.`, [option(3, 'rule', 'Rule ID.', { required: true, max_length: 25 }), option(action.endsWith('role') ? 8 : 7, 'target', 'Server role or channel.', { required: true })])),
      subcommand('allow-words', 'Replace allowed words on a keyword/preset rule; omit to clear.', [option(3, 'rule', 'Rule ID.', { required: true, max_length: 25 }), option(3, 'words', 'Comma-separated exceptions, up to 100 words of 60 characters.', { max_length: 2000 })]),
      subcommand('block-message', 'Set the explanation shown when a rule blocks a message.', [option(3, 'rule', 'Rule ID.', { required: true, max_length: 25 }), option(3, 'message', 'Explanation shown to the member.', { required: true, min_length: 1, max_length: 150 })]),
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
  },
  {
    name: 'shop', description: 'Server coin shop, inventory, gifts and transaction history.', type: 1,
    options: [
      ...['create', 'update'].map((action) => subcommand(action, `${action} a shop item as staff. New items start disabled.`, [
        option(3, 'item', 'Stable lowercase item ID: letters, digits and hyphens.', { required: true, min_length: 1, max_length: 32 }),
        option(3, 'title', 'Item display name.', { required: true, min_length: 1, max_length: 80 }),
        option(4, 'price', 'Coin price per unit.', { required: true, min_value: 1, max_value: 1000000 }),
        option(3, 'description', 'Item description.', { max_length: 300 }),
        option(4, 'stock', 'Available units; -1 means unlimited (default).', { min_value: -1, max_value: 1000000 })
      ])),
      ...['enable', 'disable', 'info'].map((action) => subcommand(action, `${action} a server shop item.`, [option(3, 'item', 'Item ID.', { required: true, min_length: 1, max_length: 32 })])),
      ...['list', 'inventory', 'history'].map((action) => subcommand(action, `${action} entries with private pagination.`, [option(4, 'page', 'Results page, ten entries per page.', { min_value: 1, max_value: 5000 })])),
      ...['buy', 'use', 'gift'].map((action) => subcommand(action, `${action} inventory items using server coins.`, [option(3, 'item', 'Item ID.', { required: true, min_length: 1, max_length: 32 }), ...(action === 'gift' ? [target] : []), option(4, 'quantity', 'Units (default 1); consuming an item is permanent.', { min_value: 1, max_value: 100 })]))
    ]
  }
];


commands.push({
  name: 'voice', description: 'Own and manage temporary join-to-create voice channels.', type: 1,
  options: [
    subcommand('setup', 'Configure existing lobby and category; requires Manage Server.', [option(7, 'lobby', 'Existing join-to-create voice channel.', { required: true, channel_types: [2] }), option(7, 'category', 'Category for temporary rooms.', { required: true, channel_types: [4] })]),
    subcommand('status', 'Show voice configuration and occupancy readiness.'),
    subcommand('disable', 'Stop creating rooms; existing rooms still expire when empty.'),
    subcommand('rename', 'Rename your temporary voice channel.', [option(3, 'name', 'New voice channel name.', { required: true, min_length: 1, max_length: 100 })]),
    subcommand('limit', 'Set your voice room member limit.', [option(4, 'members', 'Limit from 0 (unlimited) to 99.', { required: true, min_value: 0, max_value: 99 })]),
    ...['lock', 'unlock', 'ghost', 'unghost', 'claim', 'info'].map((action) => subcommand(action, `${action} your temporary voice channel.`)),
    ...['permit', 'reject', 'transfer'].map((action) => subcommand(action, `${action} a member in your temporary voice channel.`, [option(6, 'user', 'Server member.', { required: true })]))
  ]
});

commands.push({
  name: 'rolemenu', description: 'Manage persistent self-service role button menus.', type: 1, default_member_permissions: '268435456',
  options: [
    subcommand('create', 'Create an unpublished menu in this channel.', [option(3, 'title', 'Menu title.', { required: true, min_length: 1, max_length: 200 })]),
    subcommand('add', 'Add a permission-free role below your role and the bot.', [option(3, 'id', 'Menu ID.', { required: true, max_length: 25 }), option(8, 'role', 'Role to offer.', { required: true }), option(3, 'label', 'Button label.', { required: true, min_length: 1, max_length: 60 })]),
    subcommand('remove', 'Remove a role from a menu.', [option(3, 'id', 'Menu ID.', { required: true, max_length: 25 }), option(8, 'role', 'Role to remove.', { required: true })]),
    subcommand('list', 'List stored role menus.'),
    ...['publish', 'disable', 'delete', 'info'].map((action) => subcommand(action, `${action} a role menu by ID.`, [option(3, 'id', 'Menu ID.', { required: true, max_length: 25 })]))
  ]
}, {
  name: 'autorole', description: 'Configure permission-free roles for new human members.', type: 1, default_member_permissions: '268435456',
  options: [
    subcommand('add', 'Add a permission-free join role; member events must be enabled.', [option(8, 'role', 'Role below your role and the bot.', { required: true })]),
    subcommand('remove', 'Stop assigning a configured join role.', [option(8, 'role', 'Role to remove.', { required: true })]),
    subcommand('list', 'List configured join roles and event status.'),
    subcommand('apply', 'Apply configured join roles to a screened human member.', [option(6, 'user', 'Member to reconcile.', { required: true })])
  ]
});

commands.push({
  name: 'template', description: 'Save, preview and publish reusable embeds.', type: 1, default_member_permissions: '8192',
  options: [
    ...['create', 'update'].map((action) => subcommand(action, `${action} a saved embed template.`, [
      option(3, 'name', 'Lowercase letters, numbers, underscore or hyphen; 1-32 characters.', { required: true, min_length: 1, max_length: 32 }),
      option(3, 'title', 'Embed title.', { required: true, min_length: 1, max_length: 256 }),
      option(3, 'description', 'Embed body.', { required: true, min_length: 1, max_length: 4000 }),
      option(3, 'color', 'Six-digit hex color; defaults to 5865f2.', { max_length: 7 })
    ])),
    subcommand('list', 'List saved embed names.'),
    ...['info', 'preview', 'send', 'delete'].map((action) => subcommand(action, `${action} a saved embed; send publishes in this channel.`, [option(3, 'name', 'Saved template name.', { required: true, max_length: 32 })]))
  ]
});

commands.push({
  name: 'responder', description: 'Manage channel-specific automatic message replies.', type: 1, default_member_permissions: '32',
  options: [
    ...['create', 'update'].map((action) => subcommand(action, `${action} a disabled responder in this text channel.`, [
      option(3, 'name', 'Lowercase letters, numbers, underscore or hyphen; 1-32 characters.', { required: true, min_length: 1, max_length: 32 }),
      option(3, 'trigger', 'Exact text, ignoring case and surrounding whitespace.', { required: true, min_length: 1, max_length: 200 }),
      option(3, 'reply', 'Reply text; mentions are suppressed.', { required: true, min_length: 1, max_length: 1800 }),
      option(4, 'cooldown', 'Seconds between attempts for this rule; defaults to 30.', { min_value: 15, max_value: 3600 })
    ])),
    subcommand('list', 'List responder states, channels and automation status.'),
    ...['info', 'preview', 'enable', 'disable', 'delete'].map((action) => subcommand(action, `${action} a configured responder.`, [option(3, 'name', 'Responder name.', { required: true, max_length: 32 })]))
  ]
});

commands.push({
  name: 'timer', description: 'Manage persistent recurring channel messages.', type: 1, default_member_permissions: '32',
  options: [
    ...['create', 'update'].map((action) => subcommand(action, `${action} a disabled recurring message in this text channel.`, [
      option(3, 'name', 'Lowercase letters, numbers, underscore or hyphen; 1-32 characters.', { required: true, min_length: 1, max_length: 32 }),
      option(4, 'minutes', 'Minutes between attempts, from 5 to 30 days.', { required: true, min_value: 5, max_value: 43200 }),
      option(3, 'text', 'Recurring message text; mentions are suppressed.', { required: true, min_length: 1, max_length: 1800 })
    ])),
    subcommand('list', 'List recurring message states, intervals and last results.'),
    ...['info', 'preview', 'enable', 'disable', 'delete'].map((action) => subcommand(action, `${action} a saved recurring message.`, [option(3, 'name', 'Timer name.', { required: true, max_length: 32 })]))
  ]
});

module.exports = { commands };

commands.push({
  name: 'ticketpanel', description: 'Build persistent support panels with category buttons.', type: 1, default_member_permissions: '32',
  options: [
    subcommand('create', 'Create an unpublished panel in this text channel.', [option(3, 'title', 'Panel title.', { required: true, min_length: 1, max_length: 200 }), option(3, 'description', 'Explain what members should select.', { max_length: 1000 })]),
    subcommand('add', 'Add one of five topic/category buttons.', [option(3, 'id', 'Panel ID.', { required: true, max_length: 25 }), option(3, 'topic', 'Lowercase topic ID: letters, digits, hyphens; up to 20.', { required: true, min_length: 1, max_length: 20 }), option(3, 'label', 'Button label.', { required: true, min_length: 1, max_length: 60 }), option(7, 'category', 'Category for private tickets.', { required: true, channel_types: [4] })]),
    subcommand('remove', 'Remove a topic button.', [option(3, 'id', 'Panel ID.', { required: true, max_length: 25 }), option(3, 'topic', 'Topic ID.', { required: true, max_length: 20 })]),
    subcommand('list', 'List stored panels and publication state.'),
    ...['info', 'publish', 'disable', 'delete'].map((action) => subcommand(action, `${action} a ticket panel.`, [option(3, 'id', 'Panel ID.', { required: true, max_length: 25 })]))
  ]
});
