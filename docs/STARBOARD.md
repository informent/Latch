# Starboard

Latch can highlight public message links when they collect enough normal star reactions. The feature is free, self-hosted and disabled by default. It does not copy message text, embeds or attachments, and does not require the privileged Message Content intent.

## Setup

1. Set `DISCORD_STARBOARD_ENABLED=true` in your private `.env`. Keep Gateway enabled; Latch automatically requests Guild Message Reactions. Restart after changing this setting.
2. Run `npm run register` to register the new commands. Run `npm run doctor` and `npm run doctor:live` to inspect configuration and Discord access.
3. Give the bot View Channel and Read Message History in source channels, plus Send Messages in the destination. Staff need Manage Server to configure the feature.
4. Configure separate source and destination text channels that are non-NSFW and visible to everyone:

```text
/starboard configure destination:HIGHLIGHTS source:GENERAL threshold:3
/starboard status
/starboard sync channel:GENERAL message:MESSAGE_ID
/starboard list state:pending page:1
/starboard recover message:SOURCE_MESSAGE_ID post:EXISTING_HIGHLIGHT_ID
/starboard retire message:SOURCE_MESSAGE_ID
/starboard source-remove channel:GENERAL
/starboard prune channel:GENERAL limit:25
/starboard pause
```

Repeat configure to add up to 20 source channels in the same destination. It also updates the shared threshold and resumes a paused board. The threshold accepts 2 to 50 eligible normal stars. Bots and the message author are excluded; burst stars are not counted. Source messages must be ordinary human messages, without a webhook author.

The bot rechecks current source and destination visibility before posting. Private channels, threads, announcement channels and NSFW channels are rejected. Destination posts suppress mentions and link previews. Permissions can change after a check; links remain subject to Discord access controls. Reactions are scanned through REST, up to ten pages of 100 users and a 45-second collection budget. Scans that hit the bound fail rather than publishing partial counts.

## Highlight lifecycle

A source message gets one saved publication receipt. Further reactions update that highlight instead of creating another. Once highlighted, it remains on the board if its count drops below the initial threshold; its displayed count is updated. The board keeps up to 500 tracked records, including retired records. Destination changes are refused once tracked records exist. Automatic retention cleanup, rich quotes and multiple boards remain unimplemented.

The Gateway handles reaction changes, reaction clearing, single source deletion and bulk source deletion. A source deletion event removes the verified bot-owned highlight and retires its record. Events missed during downtime are not replayed. A background worker checks up to five existing highlights every minute, rotating through tracked records after restart. It does not discover never-highlighted messages whose reactions occurred entirely while the bot was offline; use sync on those messages. A confirmed missing source found during reconciliation retires its highlight. Permission failures, unknown channels and ambiguous errors preserve receipts for inspection. Pausing stops publishing and refreshes while retaining saved highlights; source deletion events and already-started deletions still attempt cleanup.

Publication intent is saved before the message is sent, with an enforced nonce. If the response is lost, the record stays pending. A later sync or background pass looks through the newest 100 destination messages for one matching bot-owned receipt. It never blindly resends an ambiguous operation. If the receipt cannot be found or there are multiple matches, status shows pending source IDs for staff inspection. Use recover with the exact existing highlight ID to attach an older receipt after bot ownership, destination and source marker are verified. This works while paused and sends no new post. A pending receipt without a verifiable post remains pending. Discord nonce deduplication only covers recent messages, so it is not treated as permanent proof.

## Staff recovery and cleanup

All starboard commands require Manage Server and respond privately. List returns ten records per page, ordered by source message ID, with state, source channel and destination post ID. Filter by pending, posted, deleting or deleted; the default is all.

Retire verifies the saved bot-owned post and persists deletion intent before contacting Discord. If the response is lost, the record remains deleting. Retry retire or let the worker resume it after restart. Only Discord's Unknown Message error confirms absence; an access failure does not erase the receipt. A completed deletion retains a tombstone that prevents automatic republishing. Recover a pending publication before attempting retirement.

Source-remove stops monitoring a source and preserves its highlights and receipts. Removing the final source pauses the board. Prune removes only completed deletion records from sources that have already been removed, with a limit from 1 to 100 and an optional source filter. Pending, posted and deleting receipts are retained. Pruning frees capacity and forgets those tombstones: explicitly adding that source again allows qualifying messages to be highlighted again. Configure resumes the board.

Only one Latch process should write the store. Concurrent operations in this process are serialized and limited to 100 queued operations. API failures are reported privately or logged without message content or credentials. Manual edits of receipt markers prevent later ownership verification.

## Backups and upgrade

The guild-bound `starboard.json` store reads formats 1 and 2 and writes format 2 on the next successful mutation. It defaults to `./data/starboard.json`; override with `STARBOARD_STORE_PATH`. Format 2 adds deletion recovery and receipts from removed sources. Its settings and receipt records are saved atomically. Startup refuses malformed or foreign-guild data. It is included in doctor checks and all thirteen-store backups. Stop the bot and take a complete backup before upgrading; use a compatible pre-upgrade backup for rollback. Custom private copies belong outside the checkout.

New versions verify complete older twelve-store backups and report starboard as absent. Older Latch versions do not understand thirteen-store manifests: use a backup created by the matching older version when rolling back. Restoring a backup does not restore Discord messages or guarantee that pending publications are safe to resend.

## Validation

Automated tests cover persistence, migrations, public-channel checks, ownership, author/bot exclusion, pagination, bounds, duplicate events, lost responses, restart reconciliation, command permissions and backup compatibility. Signed runtime smoke tests cover configure, sync, duplicate protection, status, backup recovery, explicit recovery, history, durable retirement, source removal and pruning. Live Discord reaction delivery, permission behavior and recovery acceptance remain pending.

[Discord reaction and message API](https://docs.discord.com/developers/resources/message) and [Gateway events](https://docs.discord.com/developers/events/gateway-events).
