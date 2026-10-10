# Leveling operations

XP and every configuration command are free and MIT-licensed. OpenDesk serves one configured guild per process.

## Enable message awards

Set `DISCORD_LEVELING_ENABLED=true` and enable Message Content Intent in the Discord Developer Portal. Restart after environment changes. `/levelconfig enable` resumes the guild setting but cannot override a disabled environment setting. `/levelconfig show` reports both gates.

Only fresh, non-empty human guild messages (ordinary messages and replies) qualify. Bots, webhooks, system messages, invalid IDs, missing/invalid timestamps, events older than five minutes and events more than five seconds in the future are skipped. No received message text is written to the XP store or logs.

## Staff commands

Manage Server or Administrator is required. Responses are private and mentions are suppressed.

| Command | Behavior |
| --- | --- |
| `/levelconfig show` | Show XP, cooldown, server pause state, environment status and ignored count |
| `/levelconfig tune xp:15 cooldown:60` | Set whole-number XP (1-100) and cooldown seconds (15-3600) |
| `/levelconfig disable` | Pause awards; preserve XP and cooldown timestamps |
| `/levelconfig enable` | Resume server awards if environment XP is enabled |
| `/levelconfig ignore channel:CHANNEL_ID` | Ignore a current guild text, announcement, thread, forum or media channel; store at most 100 IDs |
| `/levelconfig unignore channel:CHANNEL_ID` | Remove an ID, including a deleted channel reference |
| `/levelconfig ignored page:1` | List 20 IDs per page; pages 1-5 cover the limit |
| `/levelconfig reset` | Restore 15 XP/60 seconds, clear all ignored IDs and enable server awards; preserve XP and last-award cooldowns |

Copy channel IDs using Discord Developer Mode. Ignoring is exact: ignoring a parent, forum or announcement channel does not automatically ignore its threads. Add each thread ID separately. This release has no category inheritance.

Tuning applies to the next evaluated event and measures the new cooldown against the existing last-award timestamp. Level N starts at N squared times 100 XP. `/level` and `/leaderboard levels` still work while awards are paused.

## Persistence and recovery

`DISCORD_LEVEL_STORE_PATH` defaults to `./data/levels.json`. Version 2 stores account XP, last-award time, optionally the most recently awarded message ID, and per-guild settings. Awards/configuration are serialized, written to a private temporary file and atomically renamed. Readers see the last committed state until replacement succeeds. A failed write does not spend the cooldown or expose an unsaved setting. Concurrent setting changes and awards follow queue order.

The latest-message ID prevents an immediate replay even after a cooldown or restart. It is a bounded guard, not a complete message history: replaying an older ID after a different message has earned XP can qualify if fresh and outside cooldown. No cross-process write lock exists; run only one process against a store.

Version 1 loads without modification and migrates on the next successful configuration or XP write. Back up all eleven stores together before upgrading. Older OpenDesk versions reject version 2; stop the service and restore a compatible complete backup to roll back. Never edit a running store. Strict schema checks refuse duplicate accounts/settings/channels, unsupported fields/versions, numeric IDs, invalid timestamps and oversized files. Limits are 50,000 accounts, 1,000 guild setting records and 32 MiB.

## Verification boundary

Tests exercise temporary files, simulated Discord calls, signed local HTTP and the runtime Gateway callback. Live Discord permissions, transport, rate limits and hosting remain unverified. Level rewards, rank cards and voice XP are planned.
