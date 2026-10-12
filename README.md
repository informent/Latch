# Latch

Latch is a free, open-source, self-hosted Discord server bot. Its feature suites cover moderation, AutoMod, roles, staff warnings, utilities, tickets, coins, XP, embeds, polls, reminders, giveaways, games, and optional temporary voice channels. It requires no SaaS account, paid tier, database server, or third-party runtime package.

[![CI](https://github.com/informent/Latch/actions/workflows/ci.yml/badge.svg)](https://github.com/informent/Latch/actions/workflows/ci.yml) · [MIT license](LICENSE) · [Operations guide](docs/OPERATIONS.md) · [Changelog](CHANGELOG.md) · [Feature roadmap](ROADMAP.md)

## Start here

**Status: source prerelease.** Automated Windows, Linux and container checks pass, but live Discord acceptance testing is still pending. Full Bleed/Greed command parity, music and automatic join-raid response remain unfinished. See [release readiness](docs/RELEASE.md) and the [roadmap](ROADMAP.md).

### First installation

1. Install Node 24, download the source ZIP from [Releases](https://github.com/informent/Latch/releases), and extract it.
2. Double-click **Latch-Setup.cmd** on Windows, or run `npm run setup` from the extracted folder. The wizard explains the four Discord values, hides your token, checks settings and offers command registration.
3. Install the bot in your test server using the link from setup. Start **Latch-Start.cmd** or run `npm start`.
4. Connect a public HTTPS interaction endpoint, then try `/utility ping`. The [beginner guide](docs/GETTING-STARTED.md) walks through the Discord settings, a temporary test URL and common errors.

No npm package installation or database server is required. The bot supports **one configured server per process**. Hosting needs a machine and network access; external providers may have their own costs. All upstream features are MIT-licensed, with no subscription, license key or premium command gate.

### Find a feature

| Task | Guide |
| --- | --- |
| Find a command, its options and permissions | [Complete command reference](COMMANDS.md) |
| Moderate members and configure message filters | [Moderation](docs/MODERATION.md) / [AutoMod](docs/AUTOMOD.md) |
| Set up support tickets and topic buttons | [Tickets](docs/TICKETS.md) / [Ticket panels](docs/TICKET-PANELS.md) |
| Manage member roles, self-service menus and nicknames | [Member management](docs/MEMBER-MANAGEMENT.md) / [Role menus](docs/ROLE-MENUS.md) |
| Configure XP, ignored channels and earned roles | [Leveling](docs/LEVELING.md) / [Level rewards](docs/LEVEL-REWARDS.md) |
| Use coins, professions and staff balance controls | [Economy](docs/ECONOMY.md) / [Economy administration](docs/ECONOMY-ADMIN.md) |
| Run polls, reminders and giveaways | [Polls](docs/POLLS.md) / [Reminders](docs/REMINDERS.md) / [Giveaways](docs/GIVEAWAYS.md) |
| Reuse announcements and reorganize saved embeds | [Templates](docs/TEMPLATES.md) |
| Inspect server assets, create timestamps or calculate | [Utilities](docs/UTILITIES.md) |
| Create temporary voice rooms or a virtual shop | [Voice rooms](docs/VOICE.md) / [Shop](docs/SHOP.md) |
| Deploy, monitor or troubleshoot the process | [Operations](docs/OPERATIONS.md) / [Verification](docs/VERIFICATION.md) |

The command reference is generated from the registration payload and checked in CI. Run `npm run commands` for the current command paths or `npm run commands -- --json` for a machine-readable catalog. The [coverage inventory](docs/COMMAND-COVERAGE.md) tracks remaining competitor coverage.

### Upgrade safely

Stop the bot, then create and verify a backup before replacing files:

```sh
npm run backup -- create ../Latch-backup-before-upgrade
npm run backup -- verify ../Latch-backup-before-upgrade
```

Use a new backup folder for each upgrade. Follow the [backup guide](docs/BACKUPS.md) to preserve configuration and all thirteen stores. After upgrading, run `npm run doctor`, update command definitions with `npm run register`, and use `npm run doctor:live` to inspect Discord access and registration. Live checks do not replace trying commands in your test server.

For the complete automated release gate without Discord credentials, run `npm run release:verify`. Add `-- --json --output release-evidence/verification.json` to save a new report. See [release readiness](docs/RELEASE.md) for the remaining live checks.

## What it stores

Ticket panels use `data/ticket-panels.json`, an eleventh guild-bound store for panel/message IDs, topic categories and publication retries. Include it in every complete backup. Level rewards add `data/level-rewards.json`, the twelfth store, for rules and durable member retry/completion records. Reopening tickets can retain a durable `reopening` status until staff retry the command successfully. The everyone role is refused as a support role.

Ticket records may include the assigned support member ID. Giveaway records may include the last reroll interaction ID for duplicate-request handling. These fields contain no interaction token. Back up stores before upgrading; older releases can reject records containing these new fields.

The optional voice suite uses `data/voice.json` for guild/lobby/category IDs, managed room IDs, owners and creation times. Current voice occupancy stays in memory; no audio or voice session IDs are recorded. Include this sixth store in backups. See the [voice guide](docs/VOICE.md) for recovery and access-control limits.

Recurring channel messages use `data/timers.json`, a tenth guild-bound store with up to 25 schedules, saved deadlines and attempt results. Timers start disabled and need no Gateway connection. See the [timer guide](docs/TIMERS.md).

Automatic responders use `data/responders.json`, a ninth guild-bound store containing configured triggers/replies, channel IDs, enable state and durable cooldown/last-message metadata. Incoming message content is not persisted or logged. Responders are opt-in; see the [responder guide](docs/RESPONDERS.md).

Saved embed templates use `data/templates.json`, an eighth guild-bound store with up to 50 named titles, bodies and colors. Back it up with the other stores. See the [template guide](docs/TEMPLATES.md).

Role menus and join-role configuration use `data/role-menus.json` for guild, menu/channel/message IDs, titles, labels, role IDs, menu states and publication retry metadata. Include this seventh store in backups. Member role assignments remain in Discord; interaction tokens are not stored.

Latch stores ticket state in `data/tickets.json`, staff warning records in `data/moderation.json`, per-server coin balances and reward cooldowns in `data/economy.json`, per-server XP in `data/levels.json`, and scheduled community jobs in `data/community.json`. Community records include reminder text or giveaway prizes, user/channel IDs, deadlines, entrants, winners, host attribution, descriptions, media URLs and retry status; they never include interaction tokens. Completed/cancelled jobs are pruned after seven days while the scheduler runs. Warning records contain guild, target, and staff user IDs, a reason, and a timestamp. Leveling uses message events but stores guild/user IDs, XP, award timestamps, the latest awarded message ID and per-guild settings (including ignored channel IDs); received message content is never persisted or logged. Welcome messages use member join events when enabled. Keep all data files private and back them up together. Ticket conversations remain in Discord and follow your server's retention settings.

## Requirements

- Node.js 22.9 or newer, or Node.js 24
- A Discord application/bot added to the target server
- Node.js's built-in WebSocket client (Node.js 22.9+)
- A public HTTPS URL that forwards `POST /interactions` to this process (for example, your own reverse proxy)
- The bot's `Manage Channels`, `Manage Roles`, `Manage Nicknames`, `Manage Messages`, `Ban Members`, `Kick Members`, and `Moderate Members` permissions for the enabled suites; the bot also needs to remain in the server

The app handles slash commands over Discord's HTTP interaction endpoint. It opens a Gateway connection when member events, leveling, temporary voice channels or responders are enabled, or when explicitly configured. Configure the public HTTPS interaction URL in the Discord Developer Portal. Do not expose the local HTTP listener directly to the internet; terminate HTTPS at a trusted reverse proxy and restrict the forwarded route to this service.

For process monitoring, `GET /healthz` returns plain-text `ok`. It confirms only that the HTTP process is responding; it does not check Discord API connectivity or store health. On `SIGINT` or `SIGTERM`, Latch stops accepting new requests, stops scheduling jobs, and drains acknowledged interaction work and current scheduled delivery. If work remains after 30 seconds, it logs the pending interaction count and marks the process for a non-zero exit; configure your process manager with a stop grace period of at least 30 seconds.

## Setup details

The [beginner guide](docs/GETTING-STARTED.md) covers the wizard, installation, HTTPS routing and common errors. The [operations guide](docs/OPERATIONS.md) covers Docker, services and upgrades. For automation, `npm run setup -- --plain` preserves an existing `.env` or creates a blank template without prompting.

Run `npm run doctor` for offline checks and `npm run doctor:live` to inspect Discord access and registered commands. Runtime commands load `.env` with Node's built-in support. Keep credentials in local configuration or a secret store.

## Commands

See the generated [complete command reference](COMMANDS.md) for the current command count and every option. `/voice` adds optional join-to-create rooms, persistent ownership and access controls; follow the [voice guide](docs/VOICE.md). `/rolemenu` adds stored self-service button menus with explicit Get/Remove actions and publication retries. `/autorole` adds join-role configuration and staff reconciliation. Automated roles must have zero permission bits and satisfy live hierarchy checks; follow the [role-menu guide](docs/ROLE-MENUS.md). Voice and role automation have dedicated regression tests; live-server validation remains unfinished.

- `/shop` provides coin-priced virtual items, inventories, gifts, consumables and transaction history. Staff configure items with Manage Server; new items start disabled. See the [shop guide](docs/SHOP.md).
- `/utility help` shows available suites and whether Gateway and XP awards are enabled.
- `/automod list`, `/automod keywords`, `/automod mentions`, and `/automod spam` manage native Discord message filters. Staff and bot need **Manage Server**. New rules are disabled for review; `/automod enable`, `/automod disable`, and `/automod remove` take a rule ID. Only rules created by this bot with the Latch name prefix can be changed. Keyword input supports up to 100 comma-separated terms, with Discord wildcard matching. Mention limits range from 1 to 50. Discord applies its own rule-count limits. Native rules continue running while the bot is offline and do not require Latch to receive chat content. Use `/automod info`, `presets`, `exempt-role`, `unexempt-role`, `exempt-channel`, `unexempt-channel`, `allow-words` and `block-message` for configuration. See the [AutoMod guide](docs/AUTOMOD.md). [Discord AutoMod reference](https://docs.discord.com/developers/resources/auto-moderation).
- `/embed title description color` posts a custom announcement in the current channel. Staff need **Manage Messages**; the bot needs **Send Messages** and **Embed Links**. Mentions are disabled. Publishing to another channel is not supported.
- `/fun coin`, `/fun roll`, and `/fun eightball` provide coin flips, dice with 2 to 1000 sides, and random answers. These have no currency stakes or paid features.

- `/moderation ban`, `/moderation kick`, `/moderation timeout`, and `/moderation untimeout` perform Discord moderation actions with audit-log reasons. Discord enforces the bot's permissions and role hierarchy.
- `/moderation purge` deletes up to 100 recent messages from the current channel and skips messages older than 14 days. `/moderation slowmode` sets or disables the current channel's slowmode.
- `/roles grant`, `/roles revoke`, `/roles nickname`, and `/roles clear-nickname` manage member roles and nicknames. Discord enforces role hierarchy and permissions.
- `/moderation warn`, `/moderation warnings`, `/moderation case`, `/moderation unwarn`, and `/moderation clear-warnings` maintain a local staff-warning case register. Cases include a server-scoped UUID, issuing staff member, reason and timestamp.
- `/utility` now includes member banners, server artwork, paginated role/emoji/sticker browsers, boost status, timestamps, ID decoding, color inspection and a bounded calculator. All replies are private. See the [utility guide](docs/UTILITIES.md).
- Optional welcome messages and join burst reports use member join events. Both require the Server Members privileged intent; burst detection only logs an alert.
- `/economy balance`, `/economy daily`, `/economy work`, and `/economy pay` provide a small per-server coin system. Daily rewards are 100 coins; work rewards 25-100 coins with a one-hour cooldown. Transfers are limited to 1,000,000 coins per command.
- `/levelreward` configures free level-based role rewards, lists/statuses, eligibility previews, pause/resume and explicit member reconciliation.
- `/levelconfig` lets staff tune XP/cooldown, pause/resume, list/ignore/unignore exact channel IDs and reset defaults.
- `/level` and `/leaderboard levels` show XP from non-empty human messages when leveling is enabled. By default each member can earn 15 XP once per minute; level N starts at N² × 100 XP.
- `/leaderboard coins` shows the coin economy ranking.
- Gateway sessions send heartbeats, track event sequence numbers, and resume when Discord allows it. Gateway connection logs never include message content or bot tokens.

- `/ticket create` - create one active private ticket per member. Repeated requests return the existing open channel.
- `/ticket close` - close the ticket in the current ticket channel, or choose a ticket channel with the optional `channel` field. The owner, configured support role, or a server administrator may close it. The owner retains read access but cannot send more messages; the optional channel field also lets the owner retry a partially completed close from another channel.
- `/ticket list page:1` - privately list active tickets, ten per page. Members see their own; the configured support role and administrators see the queue.
- `/ticket stats` - support staff see retained lifetime counts for open, closing, closed and claimed tickets. This does not measure per-staff workload or timed activity.
- `/ticket claim` and `/ticket unclaim` - support staff assign themselves or clear the current assignment. The owner cannot claim their own ticket; an existing different claimer must be cleared first. Any support staff may unclaim. Assignments persist across restarts and do not alter channel permissions or who can close a ticket.
- `/ticket rename name:billing-question` - support staff rename an open Latch ticket. Names use 1–90 lowercase letters, digits or hyphens. Claim/unclaim/rename accept an optional `channel`; otherwise they use the current channel.

The bot keeps no transcript. Deleting a ticket channel manually does not delete its small state record; remove that record while the bot is stopped if you need to clean up stale entries. Never edit the JSON file while the bot is running, and run only one Latch process against a given store file.

## Community scheduling

- `/poll question:"Next event?" answers:"Games | Movie | Trivia" hours:24 multiple:false` publishes a native Discord poll. Staff need Manage Messages; the bot needs Send Messages and Send Polls. Questions allow 300 characters, with 2–10 distinct choices of up to 55 characters each. Voting lasts 1–768 hours and continues while Latch is offline. Discord manages votes and expiration; Latch does not store voter records. See the [Discord poll API](https://docs.discord.com/developers/resources/poll).
- `/reminder create minutes:30 text:"Community event"` saves a reminder for the current channel. It is posted **publicly in that channel**, mentioning only its owner; it is not a DM. `/reminder list` and `/reminder cancel id:...` privately manage your pending reminders. Limits: 10 pending per member, 500 text characters, 1–43200 minutes. Both the requesting member and the bot need Send Messages in the channel.
- `/giveaway create prize:"Community prize" minutes:60 winners:2` publishes persistent Enter/Leave buttons in the current channel. Staff need Manage Messages; the bot needs Send Messages and Embed Links. `/giveaway list`, `/giveaway info id:...`, `/giveaway end id:...`, and `/giveaway cancel id:...` manage giveaways. Limits: 20 active per server, 10000 entries each, 1–20 winners, 200 prize characters, and 1–43200 minutes. Each human member gets one entry and may leave before the deadline. Winners are drawn uniformly without replacement using cryptographic randomness and saved before the original message is updated. A retry preserves the same draw. The host supplies and distributes the prize; new giveaways support required roles and level ranges with current membership/screening checks at entry and selection. See the [giveaway guide](docs/GIVEAWAYS.md) for legacy behavior and selection limits.
- `/giveaway requirements role-add`, `role-remove`, `levels` and `clear` configure active giveaway eligibility. `/giveaway eligibility` previews a selected member; `/giveaway entrants` privately lists 20 entries per page. Requirements are checked again during selection.
- `/giveaway edit prize id:... prize:"New prize"`, `/giveaway edit winners id:... winners:3`, and `/giveaway edit duration id:... minutes:120` change an active giveaway before its deadline. Duration means time remaining from now, within a maximum total lifetime of 30 days since creation. Edits persist before Discord message updates; a failed refresh retries automatically, including after restart.
- `/giveaway create` also accepts description, host, image and thumbnail options. `/giveaway edit host`, `description`, `image`, and `thumbnail` update active giveaways, while `/giveaway edit clear` resets one field or all presentation details. `/giveaway preview` privately shows the saved embed without entry buttons. `/giveaway list page:2 scope:all` browses retained history with complete prizes and exact IDs. See the [giveaway guide](docs/GIVEAWAYS.md) for examples, media rules and the community format 3 upgrade.

- `/giveaway reroll id:...` draws replacements after a completed result has been published. The immediately previous winners are excluded. A small remaining pool can yield fewer winners; no remaining entrants means the current result is preserved. Replaying the latest reroll interaction reuses the stored result; older superseded requests are rejected. Delivery retries edit the original message without redrawing. Ended records are retained for seven days after result delivery, so older giveaways are unavailable for reroll.

Reminders and giveaways use a durable queue checked every 15 seconds, with up to 20 ready jobs processed per pass. At most one giveaway selection is checked per pass, with at most 25 member lookups including proposed-winner rechecks. The bot must be running to deliver reminders or end giveaways; overdue jobs resume after restart. Delivery failures retry with exponential backoff up to 15 minutes. Cancelled giveaways reject entries immediately even if their public message update is pending. Runtime data is limited to 5000 total retained jobs and a 32 MiB store; use only one bot process per store.

Reminder delivery is **at least once**: Discord message nonces suppress repeats only within its short deduplication window. A crash after Discord accepts a message but before the disk write can cause a duplicate later. Giveaway results edit the saved message, so result retries do not create new announcements or select new winners. A crash during initial giveaway publication can leave an extra message; only the message ID saved in the store accepts entries. Review `/giveaway info` and pending reminders when correcting bot permissions. Interaction tokens and reminder/prize text are never included in scheduler logs.

## Security notes

- Interaction requests must have a valid Ed25519 signature and a timestamp within five minutes.
- Raw interaction bodies and tokens are not logged. Errors are logged with bounded message text; review proxy/process logs too.
- The interaction endpoint is unauthenticated at the HTTP layer by design; signature verification is mandatory. Keep the public route HTTPS-only and use rate limiting at the proxy.
- The bot token is a secret. Rotate it in the Developer Portal if exposed.
- The `Server Members` and `Message Content` intents are privileged Discord intents. Latch requests member events only if `DISCORD_ENABLE_MEMBER_EVENTS=true`; it requests message content when `DISCORD_LEVELING_ENABLED=true` or `DISCORD_ENABLE_MESSAGE_CONTENT=true`. The message content itself is not stored or logged.
- This project is not affiliated with or endorsed by Discord.

Ticket guests: support staff can use `/ticket guest add`, `/ticket guest remove` and `/ticket guest list`. Close revokes saved guests; reopening does not reinvite them. See [guest access and recovery](docs/TICKET-GUESTS.md) for permission limits and the ticket format 2 upgrade.

Use `/ticket transcript` for a private text or JSON history snapshot of up to 1000 messages, with older-history cursors, optional gzip and download digests. See [conversation exports](docs/TICKET-TRANSCRIPTS.md) for access checks, content-intent requirements and omitted data.

Support queues: `/ticket list` now filters active/closed history, owner, handler and assignment status. Members retain access only to their own records. See [queue filters](docs/TICKET-QUEUE.md).

## Development

There are no third-party runtime dependencies. Run `npm run release:verify` before proposing changes. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

AutoMod staff controls: [action policies, timeout limits and alert privacy](docs/AUTOMOD-POLICIES.md).

Public-message highlights with private history, exact-post recovery and durable cleanup: [starboard setup, reaction counting and recovery](docs/STARBOARD.md).
