# Saved embed templates

Run `npm run register` after upgrading. All seven `/template` commands require Manage Messages or Administrator, checked again in the signed interaction handler.

- `create name title description color`: save a new template without publishing it.
- `update name title description color`: replace an existing template. Omitting color resets it to `5865f2`.
- `list`: privately list template names.
- `info name`: privately inspect title, body length and color.
- `preview name`: view the full embed privately.
- `send name`: publish the saved embed in the current server text or announcement channel.
- `delete name`: remove the saved template. Published messages remain in Discord.

Names use lowercase letters, numbers, underscores and hyphens, beginning with a letter or number. Maximum 32 characters. Titles accept 256 characters, bodies 4000, and colors six hexadecimal digits with an optional leading `#`. Whitespace-only titles and bodies are rejected. There are at most 50 templates per configured guild.

`TEMPLATE_STORE_PATH` defaults to `./data/templates.json`. The versioned store is guild-bound, capped at 1 MiB and validated before loading. Writes are serialized and use an exclusive temporary file and rename before updating in-memory state. Invalid existing data stops startup instead of being overwritten. Back up this eighth store with the others while the bot is stopped. Run one bot process per store set.

Templates store the text supplied by staff. They do not store tokens or incoming message content. They do not evaluate scripts or expand variables. Both previews and public sends suppress mentions. Published messages are independent copies: updating or deleting a template does not edit them.

Public sends validate the target channel's guild and type. Discord still enforces bot channel access, Send Messages and Embed Links permissions. Sending uses the interaction ID as an enforced nonce for Discord's recent-message deduplication window; this is not a durable delivery ledger. There is no automatic publication retry. An ambiguous network error can leave a published message even when the private confirmation fails, so inspect the channel before sending again.

Live Discord behavior and the new template workflows have not been validated. Existing CI covers earlier behavior and source syntax. Automatic responders are a separate [opt-in suite](RESPONDERS.md). Recurring messages are a separate [timer suite](TIMERS.md). Template integration, scripting and webhook-based branding remain future work.
