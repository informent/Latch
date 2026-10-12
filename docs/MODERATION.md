# Member moderation checks

Ban, kick, timeout and timeout removal first check the signed interaction permission, then fetch current guild ownership, roles and actor/target/bot membership. These lookups happen after the private deferred acknowledgement. Missing, malformed or unavailable data prevents the action.

The target must be below the bot's highest role and, unless the actor owns the server, below the actor's highest role. Equal role positions are rejected conservatively. Administrator permits the action but does not bypass the actor hierarchy check. The server owner bypasses only that actor check: bot permission and hierarchy requirements remain.

Actors cannot target themselves, the server owner or Latch. Timeout actions also reject bots and members whose guild roles grant Administrator. Current actor and bot guild permissions must include the action permission or Administrator. Permission removal after interaction creation can therefore block a queued action. Bans through this path require a current server member; use unban with a user ID to remove an existing ban.

These checks follow Discord's [permission hierarchy](https://docs.discord.com/developers/topics/permissions#permission-hierarchy) and [member modification rules](https://docs.discord.com/developers/resources/guild#modify-guild-member). Discord remains the final enforcement layer. Role changes can race the REST action after the snapshot, so these lookups are not an atomic permission transaction.

Unban, warning records, purge and slowmode retain their existing permission checks. The guard also protects [role/nickname delegation](MEMBER-MANAGEMENT.md). Temporary bans, jail, antinuke and full competitor parity remain unfinished. Strike record actions are documented below. Member and role lookup data is not persisted. Private failures explain known policy denials; unknown API errors use a generic message.

The moderation tests cover role hierarchy, permissions, persistence and strike lifecycle. Live Discord operation remains unverified.

## Warning and strike records

Latch keeps staff warnings and strikes in `data/moderation.json`. These record commands require the Discord **Moderate Members** permission.

Warnings and strikes are separate records. Use `/moderation warn` and `/moderation warnings` for one-off staff notes. `/moderation clear-warnings` deletes a member's warning records.

Use the strike commands to track repeat incidents:

- `/moderation strike-add` records a reason and returns a unique case ID. Set `days` to expire the strike after 1 to 365 days; omit it for a strike with no expiry.
- `/moderation strike-list` shows active strikes. Set `include-history` to include expired and removed records. Each record includes its case ID, reason, staff member and relevant timestamps.
- `/moderation strike-remove` removes one active strike by its full case ID and records the staff member, time and reason for removal.
- `/moderation strike-clear` removes all active strikes for a member and records why. Existing history remains available with `include-history`.

Expired strikes stop counting as active when their expiry time passes. The scheduler does not need to run for expiry. Latch does not automatically timeout, ban or otherwise punish a member based on strike count. Staff decide what action to take.

Strike additions, removals and clears are serialized and written through a temporary file before replacing the store. The store validates records at startup and refuses to overwrite malformed data. It supports warning-only version 1 files and writes version 2 on the next successful mutation, preserving all warning records.

Back up `data/moderation.json` with the other Latch stores before upgrades. Strike history includes guild, target and staff IDs, reasons, creation and expiry times, and removal actor, time and reason. Keep the file private and follow your server's retention policy.

The record limit is 10,000 strikes. If it is reached, stop the bot, make and verify a backup, then archive old history according to your retention policy before restarting. The bot does not silently discard audit records.

This is a staff record system, not an enforcement policy engine. It does not import other bots' cases, configure automatic strike thresholds, or capture Discord's unrelated moderation actions. Live Discord permission and acceptance checks remain necessary before production use.
