# OpenDesk

### Community polls

Use `/poll question:"Next event?" answers:"Games | Movie | Trivia" hours:24 multiple:false` to publish a native Discord poll in the current channel. Staff need Manage Messages; the bot needs Send Messages and Send Polls. Questions allow 300 characters, with 2–10 distinct choices of up to 55 characters each. Voting lasts 1–768 hours and continues while OpenDesk is offline. Discord handles votes and expiration; OpenDesk does not store voter records. Re-run `npm run register` after updating to register the new command. Native poll constraints follow the [Discord API documentation](https://docs.discord.com/developers/resources/poll).

OpenDesk is a free, open-source, self-hosted Discord server bot. Its current feature suites cover moderation, role management, persistent staff warnings, server utilities, private support tickets, and a per-server coin economy. It requires no SaaS account, paid tier, database server, or third-party runtime package.

This is an early prototype. Automated tests cover command authorization, native AutoMod configuration, embed publishing, persistent warnings, economy and XP records, ticket workflows, and Gateway reconnect/event handling. It has not yet been exercised against a live Discord server. Native AutoMod rules provide message blocking once explicitly enabled. Join burst detection reports alerts; automatic join-raid response and music are still planned. See [the feature roadmap](ROADMAP.md) for the larger all-in-one scope.

## What it stores

OpenDesk stores ticket state in `data/tickets.json`, staff warning records in `data/moderation.json`, per-server coin balances and reward cooldowns in `data/economy.json`, and per-server XP in `data/levels.json`. Warning records contain guild, target, and staff user IDs, a reason, and a timestamp. Leveling uses message events but stores only guild/user IDs, XP, and award timestamps; message content is never persisted or logged. Welcome messages use member join events when enabled. Keep all data files private and back them up together. Ticket conversations remain in Discord and follow your server's retention settings.

## Requirements

- Node.js 22.9 or newer, or Node.js 24
- A Discord application/bot added to the target server
- Node.js's built-in WebSocket client (Node.js 22.9+)
- A public HTTPS URL that forwards `POST /interactions` to this process (for example, your own reverse proxy)
- The bot's `Manage Channels`, `Manage Roles`, `Manage Nicknames`, `Manage Messages`, `Ban Members`, `Kick Members`, and `Moderate Members` permissions for the enabled suites; the bot also needs to remain in the server

The app handles slash commands over Discord's HTTP interaction endpoint. It opens a Gateway connection only when member events or leveling are enabled. Configure the public HTTPS interaction URL in the Discord Developer Portal. Do not expose the local HTTP listener directly to the internet; terminate HTTPS at a trusted reverse proxy and restrict the forwarded route to this service.

For process monitoring, `GET /healthz` returns plain-text `ok`. It confirms only that the HTTP process is responding; it does not check Discord API connectivity or ticket-store health. On `SIGINT` or `SIGTERM`, OpenDesk stops accepting new requests and drains acknowledged ticket work. If work remains after 30 seconds, it logs the pending count and marks the process for a non-zero exit; configure your process manager with a stop grace period of at least 30 seconds.

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

   `register` adds or updates all ten command suites for the configured test server using individual upserts. It makes a Discord API change, so verify the IDs and bot credentials before running it. Re-run it when upgrading to receive new commands.
4. Configure the Discord application's **Interactions Endpoint URL** to your HTTPS proxy URL ending in `/interactions`. Discord will send a signed ping while validating it; OpenDesk verifies Ed25519 request signatures and answers that ping.
5. For XP, set `DISCORD_LEVELING_ENABLED=true` and enable **Message Content Intent** in the Developer Portal. Discord may require approval for privileged intents at larger bot scales. XP awards 15 points no more than once per member each minute. Set `DISCORD_ENABLE_MEMBER_EVENTS=true` for welcome messages or join burst reports; enable **Server Members Intent**, configure `DISCORD_WELCOME_CHANNEL_ID` for welcomes, and set `DISCORD_RAID_JOIN_THRESHOLD` above zero for reports. Burst reports do not trigger automatic moderation. Set `DISCORD_GATEWAY_ENABLED=true` only if you want the Gateway with other intents disabled.
6. In the test server, verify `/utility ping`, `/utility server`, `/ticket create`, `/ticket close`, `/level`, `/leaderboard levels`, and `/leaderboard coins`. Use a disposable test member to check moderation and role commands. Confirm unauthorized members are rejected and the bot's role position permits each operation.

The start and register scripts load `.env` with Node's built-in env-file support, so no dotenv package is needed. In production, a process manager or secret store is preferable to a plaintext `.env` file. On PowerShell, you can instead set values for the current session with `$env:NAME = 'value'`.

## Commands

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

- `/ticket create` — create one active private ticket per member. Repeated requests return the existing open channel.
- `/ticket close` — close the ticket in the current ticket channel, or choose a ticket channel with the optional `channel` field. The owner, configured support role, or a server administrator may close it. The owner retains read access but cannot send more messages; the optional channel field also lets the owner retry a partially completed close from another channel.

The bot keeps no transcript. Deleting a ticket channel manually does not delete its small state record; remove that record while the bot is stopped if you need to clean up stale entries. Never edit the JSON file while the bot is running, and run only one OpenDesk process against a given store file.

## Security notes

- Interaction requests must have a valid Ed25519 signature and a timestamp within five minutes.
- Raw interaction bodies and tokens are not logged. Errors are logged with bounded message text; review proxy/process logs too.
- The interaction endpoint is unauthenticated at the HTTP layer by design; signature verification is mandatory. Keep the public route HTTPS-only and use rate limiting at the proxy.
- The bot token is a secret. Rotate it in the Developer Portal if exposed.
- The `Server Members` and `Message Content` intents are privileged Discord intents. OpenDesk requests member events only if `DISCORD_ENABLE_MEMBER_EVENTS=true`; it requests message content when `DISCORD_LEVELING_ENABLED=true` or `DISCORD_ENABLE_MESSAGE_CONTENT=true`. The message content itself is not stored or logged.
- This project is not affiliated with or endorsed by Discord.

## Development

There are no third-party runtime dependencies. Run `npm test` and `npm run check` before proposing changes. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
