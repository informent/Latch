# OpenDesk

OpenDesk is a free, open-source, self-hosted Discord server bot. Its feature suites cover moderation, AutoMod, roles, staff warnings, utilities, tickets, coins, XP, embeds, polls, reminders, giveaways, games, and optional temporary voice channels. It requires no SaaS account, paid tier, database server, or third-party runtime package.

[![CI](https://github.com/informent/OpenDesk/actions/workflows/ci.yml/badge.svg)](https://github.com/informent/OpenDesk/actions/workflows/ci.yml) · [MIT license](LICENSE) · [Operations guide](docs/OPERATIONS.md) · [Changelog](CHANGELOG.md) · [Feature roadmap](ROADMAP.md)

## Start here

Command-for-command coverage is tracked in the [coverage inventory](docs/COMMAND-COVERAGE.md). Full Bleed/Greed parity remains unfinished. Run `npm run commands` for the actual registered OpenDesk command paths, or `npm run commands -- --json` for a machine-readable catalog.

Install Node 22.9+ or Node 24, then run:

```powershell
npm run setup
# Edit .env locally with your Discord application and server settings.
npm run doctor
npm run invite
npm run register
npm start
```

You also need a public HTTPS interaction endpoint configured in Discord. The setup command preserves existing settings. Doctor is an offline, read-only inspection, and invite prints a permission-based installation link without opening a browser. See the [operations guide](docs/OPERATIONS.md) for Docker Compose, Linux services, backups, upgrades, and troubleshooting.

All upstream OpenDesk features are free and published as MIT-licensed source. There is no subscription check, license key, premium command gate, or required OpenDesk hosted account. Self-hosting needs a machine and network access; external integrations may have provider costs. The project currently supports one configured guild per process.

Economy now includes durable 15-minute begging rewards, profiles and free profession progression with bounded work bonuses. See the [economy guide](docs/ECONOMY.md) for cooldowns, rank rules and rollback limits.

Tickets now support private owner/staff information, staff-set reasons and category moves that preserve and verify explicit channel overwrites. See the [ticket guide](docs/TICKETS.md).

Role assignment/removal and nickname changes now verify current actor/bot permissions and member/role hierarchy. Non-admin staff cannot grant permissions they do not hold. `/utility role` privately shows role position and permission metadata. See the [member-management guide](docs/MEMBER-MANAGEMENT.md).

Ban, kick, timeout and timeout removal now verify current actor/bot permissions and member role positions before sending the action. Owner, self and bot protections apply; see the [moderation guide](docs/MODERATION.md).

This is an early prototype. Automated tests cover command authorization, native AutoMod configuration, embed publishing, persistent warnings, economy and XP records, ticket workflows, and Gateway reconnect/event handling. It has not yet been exercised against a live Discord server. Native AutoMod rules provide message blocking once explicitly enabled. Join burst detection reports alerts; automatic join-raid response and music are still planned. See [the feature roadmap](ROADMAP.md) for the larger all-in-one scope.

## What it stores

Ticket records may include the assigned support member ID. Giveaway records may include the last reroll interaction ID for duplicate-request handling. These fields contain no interaction token. Back up stores before upgrading; older releases can reject records containing these new fields.

The optional voice suite uses `data/voice.json` for guild/lobby/category IDs, managed room IDs, owners and creation times. Current voice occupancy stays in memory; no audio or voice session IDs are recorded. Include this sixth store in backups. See the [voice guide](docs/VOICE.md) for recovery and access-control limits.

Recurring channel messages use `data/timers.json`, a tenth guild-bound store with up to 25 schedules, saved deadlines and attempt results. Timers start disabled and need no Gateway connection. See the [timer guide](docs/TIMERS.md).

Automatic responders use `data/responders.json`, a ninth guild-bound store containing configured triggers/replies, channel IDs, enable state and durable cooldown/last-message metadata. Incoming message content is not persisted or logged. Responders are opt-in; see the [responder guide](docs/RESPONDERS.md).

Saved embed templates use `data/templates.json`, an eighth guild-bound store with up to 50 named titles, bodies and colors. Back it up with the other stores. See the [template guide](docs/TEMPLATES.md).

Role menus and join-role configuration use `data/role-menus.json` for guild, menu/channel/message IDs, titles, labels, role IDs, menu states and publication retry metadata. Include this seventh store in backups. Member role assignments remain in Discord; interaction tokens are not stored.

OpenDesk stores ticket state in `data/tickets.json`, staff warning records in `data/moderation.json`, per-server coin balances and reward cooldowns in `data/economy.json`, per-server XP in `data/levels.json`, and scheduled community jobs in `data/community.json`. Community records include reminder text or giveaway prizes, user/channel IDs, deadlines, entrants, winners, and retry status; they never include interaction tokens. Completed/cancelled jobs are pruned after seven days while the scheduler runs. Warning records contain guild, target, and staff user IDs, a reason, and a timestamp. Leveling uses message events but stores only guild/user IDs, XP, and award timestamps; received message content is never persisted or logged. Welcome messages use member join events when enabled. Keep all data files private and back them up together. Ticket conversations remain in Discord and follow your server's retention settings.

## Requirements

- Node.js 22.9 or newer, or Node.js 24
- A Discord application/bot added to the target server
- Node.js's built-in WebSocket client (Node.js 22.9+)
- A public HTTPS URL that forwards `POST /interactions` to this process (for example, your own reverse proxy)
- The bot's `Manage Channels`, `Manage Roles`, `Manage Nicknames`, `Manage Messages`, `Ban Members`, `Kick Members`, and `Moderate Members` permissions for the enabled suites; the bot also needs to remain in the server

The app handles slash commands over Discord's HTTP interaction endpoint. It opens a Gateway connection when member events, leveling, temporary voice channels or responders are enabled, or when explicitly configured. Configure the public HTTPS interaction URL in the Discord Developer Portal. Do not expose the local HTTP listener directly to the internet; terminate HTTPS at a trusted reverse proxy and restrict the forwarded route to this service.

For process monitoring, `GET /healthz` returns plain-text `ok`. It confirms only that the HTTP process is responding; it does not check Discord API connectivity or store health. On `SIGINT` or `SIGTERM`, OpenDesk stops accepting new requests, stops scheduling jobs, and drains acknowledged interaction work and current scheduled delivery. If work remains after 30 seconds, it logs the pending interaction count and marks the process for a non-zero exit; configure your process manager with a stop grace period of at least 30 seconds.

## Setup

1. Create a Discord application in the Developer Portal, add a bot, and install it into a **test** server with the `bot` and `applications.commands` scopes. The bot needs `Manage Channels` (`16`) to create/rename ticket channels and set slowmode, `Manage Roles` (`268435456`) for channel permission overwrites and role assignment, `Manage Nicknames` (`134217728`) for nickname changes, `Manage Messages` (`8192`) for purge, and moderation permissions `Ban Members` (`4`), `Kick Members` (`2`), and `Moderate Members` (`1099511627776`). Discord requires `Manage Roles` for channel permission overwrites ([official endpoint docs](https://docs.discord.com/developers/resources/channel#edit-channel-permissions)). Do not grant Administrator; put the bot role above roles it must moderate or assign. Test in a private server first.
2. Copy `.env.example` to `.env`. Fill in the application ID, bot token, public key, and test-server guild ID. Optionally set the support-role ID, ticket category ID, and data file paths. Never commit `.env` or share the bot token.
3. Install Node.js 22+, then run:

   ```powershell
   npm test
   npm run check
   npm run register
   npm start
   ```

   `register` adds or updates all sixteen command suites for the configured test server using individual upserts. It makes a Discord API change, so verify the IDs and bot credentials before running it. Re-run it when upgrading to receive new commands.
4. Configure the Discord application's **Interactions Endpoint URL** to your HTTPS proxy URL ending in `/interactions`. Discord will send a signed ping while validating it; OpenDesk verifies Ed25519 request signatures and answers that ping.
5. For XP, set `DISCORD_LEVELING_ENABLED=true` and enable **Message Content Intent** in the Developer Portal. Discord may require approval for privileged intents at larger bot scales. XP awards 15 points no more than once per member each minute. Set `DISCORD_ENABLE_MEMBER_EVENTS=true` for welcome messages or join burst reports; enable **Server Members Intent**, configure `DISCORD_WELCOME_CHANNEL_ID` for welcomes, and set `DISCORD_RAID_JOIN_THRESHOLD` above zero for reports. Burst reports do not trigger automatic moderation. Set `DISCORD_GATEWAY_ENABLED=true` only if you want the Gateway with other intents disabled.
6. In the test server, verify `/utility ping`, `/utility server`, `/ticket create`, `/ticket close`, `/level`, `/leaderboard levels`, and `/leaderboard coins`. Use a disposable test member to check moderation and role commands. Confirm unauthorized members are rejected and the bot's role position permits each operation.

The start and register scripts load `.env` with Node's built-in env-file support, so no dotenv package is needed. In production, a process manager or secret store is preferable to a plaintext `.env` file. On PowerShell, you can instead set values for the current session with `$env:NAME = 'value'`.

## Commands

The catalog currently declares 115 command paths across 19 suites. `/voice` adds optional join-to-create rooms, persistent ownership and access controls; follow the [voice guide](docs/VOICE.md). `/rolemenu` adds stored self-service button menus with explicit Get/Remove actions and publication retries. `/autorole` adds join-role configuration and staff reconciliation. Automated roles must have zero permission bits and satisfy live hierarchy checks; follow the [role-menu guide](docs/ROLE-MENUS.md). Voice and role automation have not been validated on a live server, and existing CI does not exercise their new workflows.

- `/utility help` shows available suites and whether Gateway and XP awards are enabled.
- `/automod list`, `/automod keywords`, `/automod mentions`, and `/automod spam` manage native Discord message filters. Staff and bot need **Manage Server**. New rules are disabled for review; `/automod enable`, `/automod disable`, and `/automod remove` take a rule ID. Only rules created by this bot with the OpenDesk name prefix can be changed. Keyword input supports up to 100 comma-separated terms, with Discord wildcard matching. Mention limits range from 1 to 50. Discord applies its own rule-count limits. Native rules continue running while the bot is offline and do not require OpenDesk to receive chat content. Review exemptions in Server Settings > AutoMod. [Discord AutoMod reference](https://docs.discord.com/developers/resources/auto-moderation).
- `/embed title description color` posts a custom announcement in the current channel. Staff need **Manage Messages**; the bot needs **Send Messages** and **Embed Links**. Mentions are disabled. Publishing to another channel is not supported.
- `/fun coin`, `/fun roll`, and `/fun eightball` provide coin flips, dice with 2 to 1000 sides, and random answers. These have no currency stakes or paid features.

- `/moderation ban`, `/moderation kick`, `/moderation timeout`, and `/moderation untimeout` perform Discord moderation actions with audit-log reasons. Discord enforces the bot's permissions and role hierarchy.
- `/moderation purge` deletes up to 100 recent messages from the current channel and skips messages older than 14 days. `/moderation slowmode` sets or disables the current channel's slowmode.
- `/roles grant`, `/roles revoke`, `/roles nickname`, and `/roles clear-nickname` manage member roles and nicknames. Discord enforces role hierarchy and permissions.
- `/moderation warn`, `/moderation warnings`, and `/moderation clear-warnings` maintain a local staff-warning register.
- `/utility ping` and `/utility server` check the bot response and show basic server information.
- Optional welcome messages and join burst reports use member join events. Both require the Server Members privileged intent; burst detection only logs an alert.
- `/economy balance`, `/economy daily`, `/economy work`, and `/economy pay` provide a small per-server coin system. Daily rewards are 100 coins; work rewards 25-100 coins with a one-hour cooldown. Transfers are limited to 1,000,000 coins per command.
- `/level` and `/leaderboard levels` show XP from non-empty human messages when leveling is enabled. Each member can earn 15 XP once per minute; level N starts at N² × 100 XP.
- `/leaderboard coins` shows the coin economy ranking.
- Gateway sessions send heartbeats, track event sequence numbers, and resume when Discord allows it. Gateway connection logs never include message content or bot tokens.

- `/ticket create` - create one active private ticket per member. Repeated requests return the existing open channel.
- `/ticket close` - close the ticket in the current ticket channel, or choose a ticket channel with the optional `channel` field. The owner, configured support role, or a server administrator may close it. The owner retains read access but cannot send more messages; the optional channel field also lets the owner retry a partially completed close from another channel.
- `/ticket list page:1` - privately list active tickets, ten per page. Members see their own; the configured support role and administrators see the queue.
- `/ticket stats` - support staff see retained lifetime counts for open, closing, closed and claimed tickets. This does not measure per-staff workload or timed activity.
- `/ticket claim` and `/ticket unclaim` - support staff assign themselves or clear the current assignment. The owner cannot claim their own ticket; an existing different claimer must be cleared first. Any support staff may unclaim. Assignments persist across restarts and do not alter channel permissions or who can close a ticket.
- `/ticket rename name:billing-question` - support staff rename an open OpenDesk ticket. Names use 1–90 lowercase letters, digits or hyphens. Claim/unclaim/rename accept an optional `channel`; otherwise they use the current channel.

The bot keeps no transcript. Deleting a ticket channel manually does not delete its small state record; remove that record while the bot is stopped if you need to clean up stale entries. Never edit the JSON file while the bot is running, and run only one OpenDesk process against a given store file.

## Community scheduling

- `/poll question:"Next event?" answers:"Games | Movie | Trivia" hours:24 multiple:false` publishes a native Discord poll. Staff need Manage Messages; the bot needs Send Messages and Send Polls. Questions allow 300 characters, with 2–10 distinct choices of up to 55 characters each. Voting lasts 1–768 hours and continues while OpenDesk is offline. Discord manages votes and expiration; OpenDesk does not store voter records. See the [Discord poll API](https://docs.discord.com/developers/resources/poll).
- `/reminder create minutes:30 text:"Community event"` saves a reminder for the current channel. It is posted **publicly in that channel**, mentioning only its owner; it is not a DM. `/reminder list` and `/reminder cancel id:...` privately manage your pending reminders. Limits: 10 pending per member, 500 text characters, 1–43200 minutes. Both the requesting member and the bot need Send Messages in the channel.
- `/giveaway create prize:"Community prize" minutes:60 winners:2` publishes persistent Enter/Leave buttons in the current channel. Staff need Manage Messages; the bot needs Send Messages and Embed Links. `/giveaway list`, `/giveaway info id:...`, `/giveaway end id:...`, and `/giveaway cancel id:...` manage giveaways. Limits: 20 active per server, 10000 entries each, 1–20 winners, 200 prize characters, and 1–43200 minutes. Each human member gets one entry and may leave before the deadline. Winners are drawn uniformly without replacement using cryptographic randomness and saved before the original message is updated. A retry preserves the same draw. The host supplies and distributes the prize; role eligibility and departure checks remain planned.
- `/giveaway edit prize id:... prize:"New prize"`, `/giveaway edit winners id:... winners:3`, and `/giveaway edit duration id:... minutes:120` change an active giveaway before its deadline. Duration means time remaining from now, within a maximum total lifetime of 30 days since creation. Edits persist before Discord message updates; a failed refresh retries automatically, including after restart.
- `/giveaway reroll id:...` draws replacements after a completed result has been published. The immediately previous winners are excluded. A small remaining pool can yield fewer winners; no remaining entrants means the current result is preserved. Replaying the latest reroll interaction reuses the stored result; older superseded requests are rejected. Delivery retries edit the original message without redrawing. Ended records are retained for seven days after result delivery, so older giveaways are unavailable for reroll.

Reminders and giveaways use a durable queue checked every 15 seconds, with up to 20 ready jobs processed per pass. The bot must be running to deliver reminders or end giveaways; overdue jobs resume after restart. Delivery failures retry with exponential backoff up to 15 minutes. Cancelled giveaways reject entries immediately even if their public message update is pending. Runtime data is limited to 5000 total retained jobs and a 32 MiB store; use only one bot process per store.

Reminder delivery is **at least once**: Discord message nonces suppress repeats only within its short deduplication window. A crash after Discord accepts a message but before the disk write can cause a duplicate later. Giveaway results edit the saved message, so result retries do not create new announcements or select new winners. A crash during initial giveaway publication can leave an extra message; only the message ID saved in the store accepts entries. Review `/giveaway info` and pending reminders when correcting bot permissions. Interaction tokens and reminder/prize text are never included in scheduler logs.

## Security notes

- Interaction requests must have a valid Ed25519 signature and a timestamp within five minutes.
- Raw interaction bodies and tokens are not logged. Errors are logged with bounded message text; review proxy/process logs too.
- The interaction endpoint is unauthenticated at the HTTP layer by design; signature verification is mandatory. Keep the public route HTTPS-only and use rate limiting at the proxy.
- The bot token is a secret. Rotate it in the Developer Portal if exposed.
- The `Server Members` and `Message Content` intents are privileged Discord intents. OpenDesk requests member events only if `DISCORD_ENABLE_MEMBER_EVENTS=true`; it requests message content when `DISCORD_LEVELING_ENABLED=true` or `DISCORD_ENABLE_MESSAGE_CONTENT=true`. The message content itself is not stored or logged.
- This project is not affiliated with or endorsed by Discord.

## Development

There are no third-party runtime dependencies. Run `npm test` and `npm run check` before proposing changes. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
