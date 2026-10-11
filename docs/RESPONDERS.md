# Automatic responders

Responders are free, optional message automation for one configured guild. They match complete message text, ignoring case and surrounding whitespace. They do not use regex, substring matching, scripts, variables or external providers.

## Enable the feature

1. Set `DISCORD_RESPONDERS_ENABLED=true` in the environment. Leave `DISCORD_GATEWAY_ENABLED` blank or set it to `true`. Setting it to `false` is rejected while responders are enabled.
2. Enable the privileged **Message Content** intent for your application in the Discord Developer Portal, including approval where Discord requires it. Latch requests Guild Messages and Message Content intents automatically when responders are enabled.
3. Give the bot View Channel and Send Messages in each destination text channel. The community installation link includes these permissions; channel overwrites can still deny them.
4. Restart the bot and run `npm run register` after upgrading. Existing slash commands still need the HTTPS interaction endpoint.

Discord documents [Gateway message events](https://docs.discord.com/developers/events/gateway-events#message-create) and [message creation and mention controls](https://docs.discord.com/developers/resources/message#create-message). Offline doctor output cannot prove intent approval, active event delivery or live channel access.

## Staff commands

All eight commands require Manage Server or Administrator. Latch checks the permission in each signed interaction, independently of command visibility.

- `/responder create name trigger reply cooldown`: save a disabled rule for the current server text channel.
- `/responder update name trigger reply cooldown`: replace the rule text and cooldown in its assigned channel, then disable it for review. Omitting cooldown resets it to 30 seconds. The channel cannot be moved through update.
- `/responder list`: privately list states, channels and environment status.
- `/responder info name`: privately inspect the normalized trigger, state and cooldown.
- `/responder preview name`: privately preview the reply without sending a public message.
- `/responder enable name`: enable a reviewed rule; the environment feature must also be enabled.
- `/responder disable name`: prevent future claims for the rule.
- `/responder delete name`: remove configuration. Previously posted messages remain in Discord.

Names are 1-32 lowercase letters, numbers, underscores or hyphens, starting with a letter or number. Triggers are 1-200 characters after normalization; replies are nonempty and at most 1800 characters. Cooldowns are 15-3600 seconds, shared across all users of that rule. Up to 50 rules may be stored. Duplicate normalized triggers in the same channel are rejected, including disabled rules. Only ordinary server text channels are supported, not threads, forums, announcements or DMs.

## Event and delivery limits

Only new default-type messages from human authors are eligible. Bots, webhooks, replies, system messages and events older than two minutes are ignored. Edits do not trigger replies. The configured guild and channel must match. Mention parsing is empty for every public reply and private preview; supplied mention strings cannot ping members or roles.

Before a REST delivery attempt, an atomic store claim saves the attempt timestamp and triggering message ID. A rule's cooldown survives restart, and its most recently claimed message ID cannot be claimed again. Claims re-check the current enable state, channel and trigger so a queued configuration change can prevent an unclaimed response.

There is also a five-second per-channel guard and a two-second process-wide guard. These guards are in memory and reset on restart. Matching events suppressed by any guard are dropped, not scheduled for later. A disable, update or delete cannot cancel a response that has already been claimed and is in flight.

The triggering message ID is used as an enforced Discord nonce, which deduplicates recent messages within Discord's supported window. This does not provide a permanent delivery ledger. Only the latest message ID is retained per rule. Replayed older events may be eligible again after cooldown if they are still within the freshness window.

There is no automatic retry or history backfill. A crash after claiming but before sending, or a failed REST call, consumes the cooldown and can produce no reply. A network error can also mean Discord accepted the message without a successful local acknowledgement. Logs contain the configured rule name and a generic failure event, never incoming message text or credentials.

## Storage and operation

`RESPONDER_STORE_PATH` defaults to `./data/responders.json`. This ninth store contains configured triggers/replies, channel IDs, enable states, cooldowns and last-attempt metadata. Incoming message content, authors and interaction tokens are not stored. The JSON format is versioned, guild-bound, capped at 1 MiB and validated before loading. Invalid existing data stops startup instead of being overwritten. Atomic writes use an exclusive temporary file and rename before committing in-memory state.

Run one process per store set. Stop the bot and back up all twelve stores together using the [backup and recovery guide](BACKUPS.md). `npm run doctor` inspects responder data without modifying it. Setting the environment feature to false leaves configuration intact and stops response processing; staff can still inspect, create, update, disable or delete rules.

CI runs responder store, interaction and automatic-response regression tests. These use simulated Discord responses. Live Discord behavior remains unverified. Recurring messages are a separate [timer suite](TIMERS.md). Rich matching policies, embed replies and full competitor parity remain unfinished.
