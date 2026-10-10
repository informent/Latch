# Recurring channel messages

Eight `/timer` commands manage recurring text messages. Manage Server or Administrator is required, checked in every signed interaction. This suite does not need Gateway or Message Content access. Keep the HTTP interaction endpoint configured and run one bot process per store set.

## Commands

- `create name minutes text`: save a disabled timer for the current ordinary server text channel.
- `update name minutes text`: replace text and interval in the assigned channel, then disable the timer for review. It does not move the timer to another channel.
- `list`: privately list timers, channels, intervals and last results.
- `info name`: privately show state, next attempt, last attempt and result.
- `preview name`: privately preview the text without posting it publicly.
- `enable name`: schedule the first attempt after one complete interval. Enabling an already enabled timer preserves its deadline.
- `disable name`: stop future attempts while retaining configuration.
- `delete name`: remove configuration. Previously posted messages remain in Discord.

Run `npm run register` after upgrading. Names are 1-32 lowercase letters, numbers, underscores or hyphens, beginning with a letter or number. Text must be nonempty and at most 1800 characters. Intervals range from 5 to 43200 minutes (30 days). At most 25 timers may be stored. Threads, forums, announcements and DMs are not supported. Public sends and private previews suppress mentions. Scripts, variables, embeds and cron expressions are not supported.

## Scheduling and delivery

The scheduler runs every 15 seconds, processing at most one due timer per pass. It prioritizes the earliest deadline, then name. This limits nominal attempts to four per minute; REST latency and other work can delay them further. Multiple simultaneously due timers are spread across passes. Timing is approximate, not an exact wall-clock guarantee.

A durable claim records the attempt timestamp and nonce and advances the next attempt by one interval from the claim time **before** calling Discord. Restarting preserves enabled timers and their deadlines. An overdue timer receives one attempt, then schedules its next interval from the current time; missed intervals are not replayed. Each recurring interval gets a new nonce. Discord's enforced nonce supports recent-message deduplication, not a permanent delivery guarantee.

The scheduler validates the channel's guild and ordinary text type on each attempt. Discord enforces View Channel and Send Messages permissions. A successful REST acknowledgement records `sent`; an error records `failed`. If the process crashes or saving the result fails, the last result can remain `pending`, meaning delivery is uncertain. Inspect the channel in that case. No interaction tokens or incoming message content are stored.

Failed attempts consume that occurrence. There is no immediate retry, backfill or guarantee of exactly one delivered message. The next scheduled interval is independent and can attempt delivery again. A network error can mean Discord accepted a message without a successful acknowledgement. Repeated failures require staff to inspect channel permissions and disable or repair the timer.

Configuration changes and timer delivery are serialized through the same service queue. A disable, update or delete waits for an already running delivery and cannot retract a message. Shutdown stops scheduling and drains tracked timer work within the server's existing shutdown window; the process manager should allow at least 45 seconds.

## Storage and backups

`TIMER_STORE_PATH` defaults to `./data/timers.json`, the tenth store. It holds configured names, channel IDs, text, intervals, enabled states, deadlines and attempt/result/nonce metadata. The schema is versioned, guild-bound and capped at 1 MiB. Existing invalid data stops startup instead of being overwritten. Writes use an exclusive temporary file and rename before updating in-memory state. Stop the bot and back up all ten stores together. `npm run doctor` inspects the timer store without changing it.

Existing CI does not exercise these new timer workflows. Live Discord operation remains unverified. Activity thresholds, embed templates, richer scheduling and full competitor parity remain unfinished.
