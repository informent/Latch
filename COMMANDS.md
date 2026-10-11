# Latch command reference

All 191 registered command paths across 25 slash command roots are listed below. Every Latch feature is free and MIT-licensed.

Generated from `src/commands.js` with `npm run commands:write`. CI runs `npm run commands:check` to reject an outdated reference. These are implemented Latch declarations, not a claim of full Bleed/Greed parity.

Required options must be supplied. Optional values use the handler default when omitted. Default permissions control Discord visibility; runtime checks also enforce guild, identity, current permissions, hierarchy and feature configuration. Administrators can adjust command visibility in Discord, but runtime checks still apply. Commands require a configured server and are not DM commands.

Start with `/utility help`. See [README](README.md), [operations](docs/OPERATIONS.md) and [feature coverage](docs/COMMAND-COVERAGE.md) for setup and operating limits.

## Suites

- [/poll](#poll): Create a native Discord community poll.
- [/ticket](#ticket): Create or close a private support ticket.
- [/moderation](#moderation): Moderate members and manage server warnings.
- [/utility](#utility): Useful server information and bot health.
- [/economy](#economy): Earn, save, and share server coins.
- [/roles](#roles): Manage server roles and member nicknames.
- [/level](#level): View a member’s level and XP.
- [/leaderboard](#leaderboard): Show a server leaderboard.
- [/automod](#automod): Manage Discord native message filtering rules.
- [/embed](#embed): Publish a custom embed in the current channel.
- [/fun](#fun): Free random games and utilities.
- [/reminder](#reminder): Schedule reminders posted in the current channel.
- [/giveaway](#giveaway): Host free community giveaways with persistent entry buttons.
- [/shop](#shop): Server coin shop, inventory, gifts and transaction history.
- [/voice](#voice): Own and manage temporary join-to-create voice channels.
- [/rolemenu](#rolemenu): Manage persistent self-service role button menus.
- [/autorole](#autorole): Configure permission-free roles for new human members.
- [/template](#template): Save, preview and publish reusable embeds.
- [/responder](#responder): Manage channel-specific automatic message replies.
- [/timer](#timer): Manage persistent recurring channel messages.
- [/levelreward](#levelreward): Manage free earned role rewards with durable retries.
- [/levelconfig](#levelconfig): Configure free server XP awards and ignored channels.
- [/ticketpanel](#ticketpanel): Build persistent support panels with category buttons.
- [/pollmanage](#pollmanage): Inspect and end native polls created by Latch.
- [/economyadmin](#economyadmin): Adjust server coins with a durable staff audit ledger.

## poll

Create a native Discord community poll.

Default command visibility: Manage Messages (8192).

### /poll

Create a native Discord community poll.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| question | text | yes | Question to vote on.; Maximum text length: 300 |
| answers | text | yes | Separate 2 to 10 choices with \| (each up to 55 characters).; Maximum text length: 600 |
| hours | integer | no | Voting duration in hours (default 24).; Minimum: 1; Maximum: 768 |
| multiple | boolean | no | Allow voters to select multiple choices. |

## ticket

Create or close a private support ticket.

Default command visibility: all members; individual staff actions require runtime permission checks.

### /ticket reopen

Reopen a closed ticket as support staff.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| channel | channel | no | Closed ticket channel; defaults to this channel.; Allowed Discord channel type IDs: 0 |

### /ticket create

Open a private support ticket.

Options: none.

### /ticket close

Close a ticket in this channel or a selected channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| channel | channel | no | Ticket channel to close.; Allowed Discord channel type IDs: 0 |

### /ticket list

List open tickets; members see only their own.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| page | integer | no | Results page, ten tickets per page.; Minimum: 1; Maximum: 10000 |

### /ticket stats

Show support team ticket statistics.

Options: none.

### /ticket info

Privately inspect your ticket or any ticket as support staff.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| channel | channel | no | Ticket channel; defaults to this channel.; Allowed Discord channel type IDs: 0 |

### /ticket reason

Save a ticket reason as support staff.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| reason | text | yes | Reason visible to the owner and support team.; Minimum text length: 1; Maximum text length: 400 |
| channel | channel | no | Open ticket channel; defaults to this channel.; Allowed Discord channel type IDs: 0 |

### /ticket move

Move an open ticket while preserving its channel overwrites.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| category | channel | yes | Destination category in this server.; Allowed Discord channel type IDs: 4 |
| channel | channel | no | Open ticket channel; defaults to this channel.; Allowed Discord channel type IDs: 0 |

### /ticket claim

claim an open ticket as support staff.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| channel | channel | no | Ticket channel; defaults to this channel.; Allowed Discord channel type IDs: 0 |

### /ticket unclaim

unclaim an open ticket as support staff.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| channel | channel | no | Ticket channel; defaults to this channel.; Allowed Discord channel type IDs: 0 |

### /ticket rename

Rename an open ticket as support staff.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Lowercase letters, digits and hyphens; maximum 90 characters.; Minimum text length: 1; Maximum text length: 90 |
| channel | channel | no | Ticket channel; defaults to this channel.; Allowed Discord channel type IDs: 0 |

## moderation

Moderate members and manage server warnings.

Default command visibility: all members; individual staff actions require runtime permission checks.

### /moderation ban

Ban a member from this server.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Member to act on. |
| reason | text | no | Reason recorded in the server audit log.; Maximum text length: 400 |

### /moderation unban

Remove a server ban by user ID.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user-id | text | yes | ID of the banned user.; Minimum text length: 5; Maximum text length: 25 |
| reason | text | no | Reason recorded in the server audit log.; Maximum text length: 400 |

### /moderation kick

Remove a member from this server.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Member to act on. |
| reason | text | no | Reason recorded in the server audit log.; Maximum text length: 400 |

### /moderation timeout

Temporarily prevent a member from participating.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Member to act on. |
| minutes | integer | yes | Timeout length in minutes (1 to 40320).; Minimum: 1; Maximum: 40320 |
| reason | text | no | Reason recorded in the server audit log.; Maximum text length: 400 |

### /moderation untimeout

Remove a member timeout.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Member to act on. |
| reason | text | no | Reason recorded in the server audit log.; Maximum text length: 400 |

### /moderation purge

Delete recent messages from this channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| count | integer | yes | Number of recent messages to remove (2 to 100).; Minimum: 2; Maximum: 100 |

### /moderation slowmode

Set the current channel slowmode.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| seconds | integer | yes | Delay between messages (0 to disable, maximum 21600).; Minimum: 0; Maximum: 21600 |

### /moderation warn

Record a staff warning for a member.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Member to act on. |
| reason | text | yes | Why this warning was issued.; Maximum text length: 400 |

### /moderation warnings

Show recorded warnings for a member.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Member to act on. |

### /moderation clear-warnings

Clear recorded warnings for a member.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Member to act on. |

## utility

Useful server information and bot health.

Default command visibility: all members; individual staff actions require runtime permission checks.

### /utility ping

Check whether Latch is responding.

Options: none.

### /utility server

Show basic information about this server.

Options: none.

### /utility user

Show account and server membership information.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | no | Member to inspect; defaults to yourself. |

### /utility avatar

Show a member avatar.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | no | Member to inspect; defaults to yourself. |

### /utility role

Privately inspect a server role and its permission bits.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| role | role | yes | Server role to inspect. |

### /utility help

Show available feature suites and configuration status.

Options: none.

### /utility banner

Show a member banner from this server.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | no | Current member; defaults to yourself. |
| profile | text | no | Server profile falls back to the global banner.; Choices: Server profile = server, Global profile = global |

### /utility servericon

Show the server icon and its original image link.

Options: none.

### /utility serverbanner

Show the server banner and its original image link.

Options: none.

### /utility boosts

Show the current server boost level and boost count.

Options: none.

### /utility roles

Browse server roles, 15 per page.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| page | integer | no | Page number; defaults to 1.; Minimum: 1; Maximum: 1000 |

### /utility emojis

Browse server emojis, 15 per page.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| page | integer | no | Page number; defaults to 1.; Minimum: 1; Maximum: 1000 |

### /utility stickers

Browse server stickers, 15 per page.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| page | integer | no | Page number; defaults to 1.; Minimum: 1; Maximum: 1000 |

### /utility emoji

Inspect a server emoji and open its original asset.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | ID of a emoji in this server.; Minimum text length: 5; Maximum text length: 20 |

### /utility sticker

Inspect a server sticker and open its original asset.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | ID of a sticker in this server.; Minimum text length: 5; Maximum text length: 20 |

### /utility snowflake

Decode a Discord ID creation time and bit fields.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Decimal Discord ID; this does not look up an object.; Minimum text length: 5; Maximum text length: 20 |

### /utility timestamp

Create a copyable Discord timestamp.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| seconds | text | no | Unix seconds; omit for the current time.; Minimum text length: 1; Maximum text length: 12 |
| style | text | no | Display style; defaults to full date and time.; Choices: Short time = t, Long time = T, Short date = d, Long date = D, Date and time = f, Full date and time = F, Relative time = R |

### /utility color

Inspect a hex color and its RGB and decimal values.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| hex | text | yes | Three or six hex digits, optionally prefixed with #.; Minimum text length: 3; Maximum text length: 7 |

### /utility calculate

Calculate arithmetic with parentheses and powers.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| expression | text | yes | Numbers and + - * / % ^; ^ means exponentiation.; Minimum text length: 1; Maximum text length: 200 |

## economy

Earn, save, and share server coins.

Default command visibility: all members; individual staff actions require runtime permission checks.

### /economy balance

Check your balance or another member’s balance.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | no | Member to check. |

### /economy daily

Claim your daily coin reward.

Options: none.

### /economy work

Earn coins by working. Cooldown applies.

Options: none.

### /economy beg

Try for 0-25 coins every 15 minutes.

Options: none.

### /economy profile

Privately inspect coins, profession and reward readiness.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | no | Member to inspect; defaults to yourself. |

### /economy profession list

List free professions and rank bonuses.

Options: none.

### /economy profession choose

Choose a profession; changing resets rank, with a 24-hour cooldown.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Profession; all have the same reward progression.; Choices: developer = developer, artist = artist, builder = builder |

### /economy profession status

Privately inspect your profession and work progression.

Options: none.

### /economy pay

Send coins to another member.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Member to pay. |
| amount | integer | yes | Number of coins to send.; Minimum: 1; Maximum: 1000000 |

## roles

Manage server roles and member nicknames.

Default command visibility: all members; individual staff actions require runtime permission checks.

### /roles grant

Give a role to a member.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Member to act on. |
| role | role | yes | Role to grant. |

### /roles revoke

Remove a role from a member.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Member to act on. |
| role | role | yes | Role to remove. |

### /roles nickname

Set a member nickname.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Member to act on. |
| nickname | text | yes | New nickname (up to 32 characters).; Minimum text length: 1; Maximum text length: 32 |

### /roles clear-nickname

Clear a member nickname.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Member to act on. |

## level

View a member’s level and XP.

Default command visibility: all members; individual staff actions require runtime permission checks.

### /level

View a member’s level and XP.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | no | Member to check. |

## leaderboard

Show a server leaderboard.

Default command visibility: all members; individual staff actions require runtime permission checks.

### /leaderboard levels

Show the XP leaderboard.

Options: none.

### /leaderboard coins

Show the coin leaderboard.

Options: none.

## automod

Manage Discord native message filtering rules.

Default command visibility: Manage Server (32).

### /automod list

List server AutoMod rules and their IDs.

Options: none.

### /automod info

Inspect an Latch rule, filters, actions and exemptions.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| rule | text | yes | Rule ID.; Maximum text length: 25 |

### /automod presets

Create a disabled native preset filter for review.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Rule name.; Maximum text length: 80 |
| preset | text | yes | Built-in wordsets.; Choices: Profanity = profanity, Sexual content = sexual, Slurs = slurs, All wordsets = all |

### /automod exempt-role

exempt-role on an Latch rule.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| rule | text | yes | Rule ID.; Maximum text length: 25 |
| target | role | yes | Server role or channel. |

### /automod unexempt-role

unexempt-role on an Latch rule.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| rule | text | yes | Rule ID.; Maximum text length: 25 |
| target | role | yes | Server role or channel. |

### /automod exempt-channel

exempt-channel on an Latch rule.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| rule | text | yes | Rule ID.; Maximum text length: 25 |
| target | channel | yes | Server role or channel. |

### /automod unexempt-channel

unexempt-channel on an Latch rule.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| rule | text | yes | Rule ID.; Maximum text length: 25 |
| target | channel | yes | Server role or channel. |

### /automod allow-words

Replace allowed words on a keyword/preset rule; omit to clear.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| rule | text | yes | Rule ID.; Maximum text length: 25 |
| words | text | no | Comma-separated exceptions, up to 100 words of 60 characters.; Maximum text length: 2000 |

### /automod block-message

Set the explanation shown when a rule blocks a message.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| rule | text | yes | Rule ID.; Maximum text length: 25 |
| message | text | yes | Explanation shown to the member.; Minimum text length: 1; Maximum text length: 150 |

### /automod keywords

Create a disabled keyword filter for review.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Rule name.; Maximum text length: 80 |
| keywords | text | yes | Comma-separated words or phrases; Discord wildcards supported.; Maximum text length: 2000 |

### /automod mentions

Create a disabled mention spam and raid filter.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Rule name.; Maximum text length: 80 |
| limit | integer | yes | Maximum unique mentions allowed per message.; Minimum: 1; Maximum: 50 |

### /automod spam

Create a disabled Discord spam filter.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Rule name.; Maximum text length: 80 |

### /automod enable

enable an Latch rule by ID.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| rule | text | yes | Rule ID from /automod list.; Maximum text length: 25 |

### /automod disable

disable an Latch rule by ID.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| rule | text | yes | Rule ID from /automod list.; Maximum text length: 25 |

### /automod remove

remove an Latch rule by ID.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| rule | text | yes | Rule ID from /automod list.; Maximum text length: 25 |

## embed

Publish a custom embed in the current channel.

Default command visibility: Manage Messages (8192).

### /embed

Publish a custom embed in the current channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| title | text | yes | Announcement title.; Maximum text length: 256 |
| description | text | yes | Announcement body.; Maximum text length: 4000 |
| color | text | no | Optional six-digit hex color, for example 5865f2.; Maximum text length: 7 |

## fun

Free random games and utilities.

Default command visibility: all members; individual staff actions require runtime permission checks.

### /fun coin

Flip a coin.

Options: none.

### /fun roll

Roll a die.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| sides | integer | no | Number of sides.; Minimum: 2; Maximum: 1000 |

### /fun eightball

Ask the magic eight ball.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| question | text | yes | Your question.; Maximum text length: 300 |

## reminder

Schedule reminders posted in the current channel.

Default command visibility: all members; individual staff actions require runtime permission checks.

### /reminder create

Schedule a reminder posted publicly in this channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| minutes | integer | yes | Minutes from now (up to 30 days).; Minimum: 1; Maximum: 43200 |
| text | text | yes | Reminder text visible to this channel.; Maximum text length: 500 |

### /reminder list

List your pending reminders privately.

Options: none.

### /reminder info

Privately inspect one of your saved reminders.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Your reminder ID.; Maximum text length: 25 |

### /reminder edit

Change the text of your future reminder.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Your reminder ID.; Maximum text length: 25 |
| text | text | yes | Replacement text posted publicly when due.; Maximum text length: 500 |

### /reminder reschedule

Move your future reminder to a new time from now.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Your reminder ID.; Maximum text length: 25 |
| minutes | integer | yes | Minutes from now, up to 30 days.; Minimum: 1; Maximum: 43200 |

### /reminder cancel

Cancel one of your pending reminders.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Reminder ID from /reminder list.; Maximum text length: 25 |

## giveaway

Host free community giveaways with persistent entry buttons.

Default command visibility: Manage Messages (8192).

### /giveaway create

Create a giveaway in this channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| prize | text | yes | Prize supplied by the giveaway host.; Maximum text length: 200 |
| minutes | integer | yes | Entry period in minutes (up to 30 days).; Minimum: 1; Maximum: 43200 |
| winners | integer | no | Number of winners (default 1).; Minimum: 1; Maximum: 20 |

### /giveaway list

List active giveaways in this server.

Options: none.

### /giveaway edit prize

Change the prize of an active giveaway.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Giveaway ID.; Maximum text length: 25 |
| prize | text | yes | New prize.; Minimum text length: 1; Maximum text length: 200 |

### /giveaway edit winners

Change how many winners will be selected.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Giveaway ID.; Maximum text length: 25 |
| winners | integer | yes | Number of winners.; Minimum: 1; Maximum: 20 |

### /giveaway edit duration

Set time remaining, within a total lifetime of 30 days.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Giveaway ID.; Maximum text length: 25 |
| minutes | integer | yes | Minutes remaining from now.; Minimum: 1; Maximum: 43200 |

### /giveaway requirements role-add

Require a current server role; all required roles must be held.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Giveaway ID.; Maximum text length: 25 |
| role | role | yes | Required server role other than everyone. |

### /giveaway requirements role-remove

Remove a required role, including a deleted reference.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Giveaway ID.; Maximum text length: 25 |
| role | text | yes | Role ID.; Minimum text length: 5; Maximum text length: 25 |

### /giveaway requirements levels

Set an inclusive level range; omit max for no upper bound.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Giveaway ID.; Maximum text length: 25 |
| min | integer | yes | Minimum level.; Minimum: 0; Maximum: 1000 |
| max | integer | no | Maximum level, at least min.; Minimum: 0; Maximum: 1000 |

### /giveaway requirements clear

Clear role/level requirements; membership checks remain.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Giveaway ID.; Maximum text length: 25 |

### /giveaway eligibility

Preview current member eligibility without entering.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Giveaway ID.; Maximum text length: 25 |
| user | user | yes | Member to inspect. |

### /giveaway entrants

Privately list entries and selection progress.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Giveaway ID.; Maximum text length: 25 |
| page | integer | no | Page of 20 entries.; Minimum: 1; Maximum: 500 |

### /giveaway end

end a giveaway by ID.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Giveaway ID shown in its message footer.; Maximum text length: 25 |

### /giveaway cancel

cancel a giveaway by ID.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Giveaway ID shown in its message footer.; Maximum text length: 25 |

### /giveaway info

info a giveaway by ID.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Giveaway ID shown in its message footer.; Maximum text length: 25 |

### /giveaway reroll

reroll a giveaway by ID.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Giveaway ID shown in its message footer.; Maximum text length: 25 |

## shop

Server coin shop, inventory, gifts and transaction history.

Default command visibility: all members; individual staff actions require runtime permission checks.

### /shop create

create a shop item as staff. New items start disabled.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| item | text | yes | Stable lowercase item ID: letters, digits and hyphens.; Minimum text length: 1; Maximum text length: 32 |
| title | text | yes | Item display name.; Minimum text length: 1; Maximum text length: 80 |
| price | integer | yes | Coin price per unit.; Minimum: 1; Maximum: 1000000 |
| description | text | no | Item description.; Maximum text length: 300 |
| stock | integer | no | Available units; -1 means unlimited (default).; Minimum: -1; Maximum: 1000000 |

### /shop update

update a shop item as staff. New items start disabled.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| item | text | yes | Stable lowercase item ID: letters, digits and hyphens.; Minimum text length: 1; Maximum text length: 32 |
| title | text | yes | Item display name.; Minimum text length: 1; Maximum text length: 80 |
| price | integer | yes | Coin price per unit.; Minimum: 1; Maximum: 1000000 |
| description | text | no | Item description.; Maximum text length: 300 |
| stock | integer | no | Available units; -1 means unlimited (default).; Minimum: -1; Maximum: 1000000 |

### /shop enable

enable a server shop item.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| item | text | yes | Item ID.; Minimum text length: 1; Maximum text length: 32 |

### /shop disable

disable a server shop item.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| item | text | yes | Item ID.; Minimum text length: 1; Maximum text length: 32 |

### /shop info

info a server shop item.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| item | text | yes | Item ID.; Minimum text length: 1; Maximum text length: 32 |

### /shop list

list entries with private pagination.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| page | integer | no | Results page, ten entries per page.; Minimum: 1; Maximum: 5000 |

### /shop inventory

inventory entries with private pagination.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| page | integer | no | Results page, ten entries per page.; Minimum: 1; Maximum: 5000 |

### /shop history

history entries with private pagination.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| page | integer | no | Results page, ten entries per page.; Minimum: 1; Maximum: 5000 |

### /shop buy

buy inventory items using server coins.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| item | text | yes | Item ID.; Minimum text length: 1; Maximum text length: 32 |
| quantity | integer | no | Units (default 1); consuming an item is permanent.; Minimum: 1; Maximum: 100 |

### /shop use

use inventory items using server coins.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| item | text | yes | Item ID.; Minimum text length: 1; Maximum text length: 32 |
| quantity | integer | no | Units (default 1); consuming an item is permanent.; Minimum: 1; Maximum: 100 |

### /shop gift

gift inventory items using server coins.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| item | text | yes | Item ID.; Minimum text length: 1; Maximum text length: 32 |
| user | user | yes | Member to act on. |
| quantity | integer | no | Units (default 1); consuming an item is permanent.; Minimum: 1; Maximum: 100 |

## voice

Own and manage temporary join-to-create voice channels.

Default command visibility: all members; individual staff actions require runtime permission checks.

### /voice setup

Configure existing lobby and category; requires Manage Server.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| lobby | channel | yes | Existing join-to-create voice channel.; Allowed Discord channel type IDs: 2 |
| category | channel | yes | Category for temporary rooms.; Allowed Discord channel type IDs: 4 |

### /voice status

Show voice configuration and occupancy readiness.

Options: none.

### /voice disable

Stop creating rooms; existing rooms still expire when empty.

Options: none.

### /voice rename

Rename your temporary voice channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | New voice channel name.; Minimum text length: 1; Maximum text length: 100 |

### /voice limit

Set your voice room member limit.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| members | integer | yes | Limit from 0 (unlimited) to 99.; Minimum: 0; Maximum: 99 |

### /voice lock

lock your temporary voice channel.

Options: none.

### /voice unlock

unlock your temporary voice channel.

Options: none.

### /voice ghost

ghost your temporary voice channel.

Options: none.

### /voice unghost

unghost your temporary voice channel.

Options: none.

### /voice claim

claim your temporary voice channel.

Options: none.

### /voice info

info your temporary voice channel.

Options: none.

### /voice permit

permit a member in your temporary voice channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Server member. |

### /voice reject

reject a member in your temporary voice channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Server member. |

### /voice transfer

transfer a member in your temporary voice channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Server member. |

## rolemenu

Manage persistent self-service role button menus.

Default command visibility: Manage Roles (268435456).

### /rolemenu create

Create an unpublished menu in this channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| title | text | yes | Menu title.; Minimum text length: 1; Maximum text length: 200 |

### /rolemenu add

Add a permission-free role below your role and the bot.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Menu ID.; Maximum text length: 25 |
| role | role | yes | Role to offer. |
| label | text | yes | Button label.; Minimum text length: 1; Maximum text length: 60 |

### /rolemenu remove

Remove a role from a menu.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Menu ID.; Maximum text length: 25 |
| role | role | yes | Role to remove. |

### /rolemenu list

List stored role menus.

Options: none.

### /rolemenu publish

publish a role menu by ID.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Menu ID.; Maximum text length: 25 |

### /rolemenu disable

disable a role menu by ID.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Menu ID.; Maximum text length: 25 |

### /rolemenu delete

delete a role menu by ID.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Menu ID.; Maximum text length: 25 |

### /rolemenu info

info a role menu by ID.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Menu ID.; Maximum text length: 25 |

## autorole

Configure permission-free roles for new human members.

Default command visibility: Manage Roles (268435456).

### /autorole add

Add a permission-free join role; member events must be enabled.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| role | role | yes | Role below your role and the bot. |

### /autorole remove

Stop assigning a configured join role.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| role | role | yes | Role to remove. |

### /autorole list

List configured join roles and event status.

Options: none.

### /autorole apply

Apply configured join roles to a screened human member.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Member to reconcile. |

## template

Save, preview and publish reusable embeds.

Default command visibility: Manage Messages (8192).

### /template create

create a saved embed template.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Lowercase letters, numbers, underscore or hyphen; 1-32 characters.; Minimum text length: 1; Maximum text length: 32 |
| title | text | yes | Embed title.; Minimum text length: 1; Maximum text length: 256 |
| description | text | yes | Embed body.; Minimum text length: 1; Maximum text length: 4000 |
| color | text | no | Six-digit hex color; defaults to 5865f2.; Maximum text length: 7 |

### /template update

update a saved embed template.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Lowercase letters, numbers, underscore or hyphen; 1-32 characters.; Minimum text length: 1; Maximum text length: 32 |
| title | text | yes | Embed title.; Minimum text length: 1; Maximum text length: 256 |
| description | text | yes | Embed body.; Minimum text length: 1; Maximum text length: 4000 |
| color | text | no | Six-digit hex color; defaults to 5865f2.; Maximum text length: 7 |

### /template list

List saved embed names.

Options: none.

### /template info

info a saved embed; send publishes in this channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Saved template name.; Maximum text length: 32 |

### /template preview

preview a saved embed; send publishes in this channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Saved template name.; Maximum text length: 32 |

### /template send

send a saved embed; send publishes in this channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Saved template name.; Maximum text length: 32 |

### /template delete

delete a saved embed; send publishes in this channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Saved template name.; Maximum text length: 32 |

## responder

Manage channel-specific automatic message replies.

Default command visibility: Manage Server (32).

### /responder create

create a disabled responder in this text channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Lowercase letters, numbers, underscore or hyphen; 1-32 characters.; Minimum text length: 1; Maximum text length: 32 |
| trigger | text | yes | Exact text, ignoring case and surrounding whitespace.; Minimum text length: 1; Maximum text length: 200 |
| reply | text | yes | Reply text; mentions are suppressed.; Minimum text length: 1; Maximum text length: 1800 |
| cooldown | integer | no | Seconds between attempts for this rule; defaults to 30.; Minimum: 15; Maximum: 3600 |

### /responder update

update a disabled responder in this text channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Lowercase letters, numbers, underscore or hyphen; 1-32 characters.; Minimum text length: 1; Maximum text length: 32 |
| trigger | text | yes | Exact text, ignoring case and surrounding whitespace.; Minimum text length: 1; Maximum text length: 200 |
| reply | text | yes | Reply text; mentions are suppressed.; Minimum text length: 1; Maximum text length: 1800 |
| cooldown | integer | no | Seconds between attempts for this rule; defaults to 30.; Minimum: 15; Maximum: 3600 |

### /responder list

List responder states, channels and automation status.

Options: none.

### /responder info

info a configured responder.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Responder name.; Maximum text length: 32 |

### /responder preview

preview a configured responder.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Responder name.; Maximum text length: 32 |

### /responder enable

enable a configured responder.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Responder name.; Maximum text length: 32 |

### /responder disable

disable a configured responder.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Responder name.; Maximum text length: 32 |

### /responder delete

delete a configured responder.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Responder name.; Maximum text length: 32 |

## timer

Manage persistent recurring channel messages.

Default command visibility: Manage Server (32).

### /timer create

create a disabled recurring message in this text channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Lowercase letters, numbers, underscore or hyphen; 1-32 characters.; Minimum text length: 1; Maximum text length: 32 |
| minutes | integer | yes | Minutes between attempts, from 5 to 30 days.; Minimum: 5; Maximum: 43200 |
| text | text | yes | Recurring message text; mentions are suppressed.; Minimum text length: 1; Maximum text length: 1800 |

### /timer update

update a disabled recurring message in this text channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Lowercase letters, numbers, underscore or hyphen; 1-32 characters.; Minimum text length: 1; Maximum text length: 32 |
| minutes | integer | yes | Minutes between attempts, from 5 to 30 days.; Minimum: 5; Maximum: 43200 |
| text | text | yes | Recurring message text; mentions are suppressed.; Minimum text length: 1; Maximum text length: 1800 |

### /timer list

List recurring message states, intervals and last results.

Options: none.

### /timer reschedule

Change the next attempt without changing the recurring interval.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Enabled timer name.; Maximum text length: 32 |
| minutes | integer | yes | Delay from now, from 5 minutes to 30 days.; Minimum: 5; Maximum: 43200 |

### /timer move

Move a timer to another text channel and disable it for review.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Timer name.; Maximum text length: 32 |
| channel | channel | yes | Destination text channel in this server.; Allowed Discord channel type IDs: 0 |

### /timer info

info a saved recurring message.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Timer name.; Maximum text length: 32 |

### /timer preview

preview a saved recurring message.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Timer name.; Maximum text length: 32 |

### /timer enable

enable a saved recurring message.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Timer name.; Maximum text length: 32 |

### /timer disable

disable a saved recurring message.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Timer name.; Maximum text length: 32 |

### /timer delete

delete a saved recurring message.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| name | text | yes | Timer name.; Maximum text length: 32 |

## levelreward

Manage free earned role rewards with durable retries.

Default command visibility: Manage Server (32).

### /levelreward add

Create or update a permission-free role milestone.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| role | role | yes | Unmanaged role below staff and bot. |
| level | integer | yes | Level required to earn this role.; Minimum: 1; Maximum: 1000 |

### /levelreward remove

Remove a reward rule; member roles are preserved.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| role | text | yes | Role ID, including a deleted role reference.; Minimum text length: 5; Maximum text length: 25 |

### /levelreward list

List role milestones and whether rewards are enabled.

Options: none.

### /levelreward info

Show pending count, configuration revision and scan policy.

Options: none.

### /levelreward enable

Enable rewards after checking every configured role.

Options: none.

### /levelreward disable

Pause role rewards without changing XP or member roles.

Options: none.

### /levelreward preview

Inspect eligibility and saved retry state without assigning roles.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Server member. |

### /levelreward reconcile

Apply eligible roles to a current screened human member.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Server member. |

## levelconfig

Configure free server XP awards and ignored channels.

Default command visibility: Manage Server (32).

### /levelconfig show

Show current server XP settings and Gateway status.

Options: none.

### /levelconfig tune

Set XP per message and per-member cooldown.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| xp | integer | yes | XP per eligible message.; Minimum: 1; Maximum: 100 |
| cooldown | integer | yes | Cooldown in seconds.; Minimum: 15; Maximum: 3600 |

### /levelconfig reset

Restore defaults, clear ignored channels and resume server awards.

Options: none.

### /levelconfig ignore

ignore an exact channel ID for XP awards.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| channel | text | yes | Channel ID, including threads or deleted references.; Minimum text length: 5; Maximum text length: 25 |

### /levelconfig unignore

unignore an exact channel ID for XP awards.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| channel | text | yes | Channel ID, including threads or deleted references.; Minimum text length: 5; Maximum text length: 25 |

### /levelconfig ignored

List ignored XP channels.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| page | integer | no | Page of 20 ignored channels.; Minimum: 1; Maximum: 5 |

### /levelconfig enable

Resume server XP awards; the environment setting must also be enabled.

Options: none.

### /levelconfig disable

Pause server XP awards without clearing accounts.

Options: none.

## ticketpanel

Build persistent support panels with category buttons.

Default command visibility: Manage Server (32).

### /ticketpanel create

Create an unpublished panel in this text channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| title | text | yes | Panel title.; Minimum text length: 1; Maximum text length: 200 |
| description | text | no | Explain what members should select.; Maximum text length: 1000 |

### /ticketpanel add

Add one of five topic/category buttons.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Panel ID.; Maximum text length: 25 |
| topic | text | yes | Lowercase topic ID: letters, digits, hyphens; up to 20.; Minimum text length: 1; Maximum text length: 20 |
| label | text | yes | Button label.; Minimum text length: 1; Maximum text length: 60 |
| category | channel | yes | Category for private tickets.; Allowed Discord channel type IDs: 4 |

### /ticketpanel remove

Remove a topic button.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Panel ID.; Maximum text length: 25 |
| topic | text | yes | Topic ID.; Maximum text length: 20 |

### /ticketpanel list

List stored panels and publication state.

Options: none.

### /ticketpanel info

info a ticket panel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Panel ID.; Maximum text length: 25 |

### /ticketpanel publish

publish a ticket panel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Panel ID.; Maximum text length: 25 |

### /ticketpanel disable

disable a ticket panel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Panel ID.; Maximum text length: 25 |

### /ticketpanel delete

delete a ticket panel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Panel ID.; Maximum text length: 25 |

## pollmanage

Inspect and end native polls created by Latch.

Default command visibility: Manage Messages (8192).

### /pollmanage info

info an Latch poll in this text channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| message | text | yes | Poll message ID in this channel.; Minimum text length: 5; Maximum text length: 25 |

### /pollmanage end

end an Latch poll in this text channel.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| message | text | yes | Poll message ID in this channel.; Minimum text length: 5; Maximum text length: 25 |

### /pollmanage voters

Privately list up to 25 voters for one poll answer.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| message | text | yes | Poll message ID in this channel.; Minimum text length: 5; Maximum text length: 25 |
| answer | integer | yes | Answer ID from pollmanage info.; Minimum: 1; Maximum: 2147483647 |
| after | text | no | User ID cursor from the previous page.; Minimum text length: 5; Maximum text length: 25 |

## economyadmin

Adjust server coins with a durable staff audit ledger.

Default command visibility: Manage Server (32).

### /economyadmin grant

grant a member balance with an audit reason.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Current human server member. |
| amount | integer | yes | Coin amount; set accepts zero.; Minimum: 1; Maximum: 1000000000 |
| reason | text | yes | Required reason stored in the staff audit ledger.; Minimum text length: 1; Maximum text length: 400 |

### /economyadmin remove

remove a member balance with an audit reason.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Current human server member. |
| amount | integer | yes | Coin amount; set accepts zero.; Minimum: 1; Maximum: 1000000000 |
| reason | text | yes | Required reason stored in the staff audit ledger.; Minimum text length: 1; Maximum text length: 400 |

### /economyadmin set

set a member balance with an audit reason.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | yes | Current human server member. |
| amount | integer | yes | Coin amount; set accepts zero.; Minimum: 0; Maximum: 1000000000 |
| reason | text | yes | Required reason stored in the staff audit ledger.; Minimum text length: 1; Maximum text length: 400 |

### /economyadmin history

Privately list staff coin adjustments, five per page.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| user | user | no | Filter adjustments to this member. |
| page | integer | no | History page.; Minimum: 1; Maximum: 10000 |

### /economyadmin receipt

Inspect a saved staff adjustment and full reason.

| Option | Type | Required | Description and constraints |
| --- | --- | --- | --- |
| id | text | yes | Adjustment receipt ID.; Minimum text length: 5; Maximum text length: 25 |
