# Member moderation checks

Ban, kick, timeout and timeout removal first check the signed interaction permission, then fetch current guild ownership, roles and actor/target/bot membership. These lookups happen after the private deferred acknowledgement. Missing, malformed or unavailable data prevents the action.

The target must be below the bot's highest role and, unless the actor owns the server, below the actor's highest role. Equal role positions are rejected conservatively. Administrator permits the action but does not bypass the actor hierarchy check. The server owner bypasses only that actor check: bot permission and hierarchy requirements remain.

Actors cannot target themselves, the server owner or OpenDesk. Timeout actions also reject bots and members whose guild roles grant Administrator. Current actor and bot guild permissions must include the action permission or Administrator. Permission removal after interaction creation can therefore block a queued action. Bans through this path require a current server member; use unban with a user ID to remove an existing ban.

These checks follow Discord's [permission hierarchy](https://docs.discord.com/developers/topics/permissions#permission-hierarchy) and [member modification rules](https://docs.discord.com/developers/resources/guild#modify-guild-member). Discord remains the final enforcement layer. Role changes can race the REST action after the snapshot, so these lookups are not an atomic permission transaction.

Unban, warning records, purge and slowmode retain their existing permission checks. The guard also protects [role/nickname delegation](MEMBER-MANAGEMENT.md). Temporary bans, jail, strikes, antinuke and full competitor parity remain unfinished. Member and role lookup data is not persisted. Private failures explain known policy denials; unknown API errors use a generic message.

Existing moderation CI fixtures supply the live lookup responses, but they do not cover every new rejection branch. Live Discord operation remains unverified.
