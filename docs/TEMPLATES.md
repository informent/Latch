# Saved embed templates

Run `npm run register` after upgrading. All nine `/template` commands require Manage Messages or Administrator, checked again in the signed interaction handler.

- `create name title description color`: save a new template without publishing it.
- `update name title description color`: replace an existing template. Omitting color resets it to `5865f2`.
- `clone name destination`: copy a saved embed under an unused name. The original remains independent.
- `rename name destination`: change a saved name without changing the embed or publishing anything.
- `list`: privately list template names.
- `info name`: privately inspect title, body length and color.
- `preview name`: view the full embed privately.
- `send name`: publish the saved embed in the current server text or announcement channel.
- `delete name`: remove the saved template. Published messages remain in Discord.

Names use lowercase letters, numbers, underscores and hyphens, beginning with a letter or number. Maximum 32 characters. Titles accept 256 characters, bodies 4000, and colors six hexadecimal digits with an optional leading `#`. Whitespace-only titles and bodies are rejected. There are at most 50 templates per configured guild.

`TEMPLATE_STORE_PATH` defaults to `./data/templates.json`. The versioned store is guild-bound, capped at 1 MiB and validated before loading. Writes are serialized and use an exclusive temporary file and rename before updating in-memory state. Invalid existing data stops startup instead of being overwritten. Back up all twelve stores together while the bot is stopped; follow the [backup guide](BACKUPS.md). Run one bot process per store set.

Templates store the text supplied by staff. They do not store tokens or incoming message content. They do not evaluate scripts or expand variables. Both previews and public sends suppress mentions. Published messages are independent copies: updating or deleting a template does not edit them.

Public sends validate the target channel's guild and type. Discord still enforces bot channel access, Send Messages and Embed Links permissions. Sending uses the interaction ID as an enforced nonce for Discord's recent-message deduplication window; this is not a durable delivery ledger. There is no automatic publication retry. An ambiguous network error can leave a published message even when the private confirmation fails, so inspect the channel before sending again.

CI exercises template storage, permissions, private interactions, clone/rename persistence, name collisions, capacity and failed-write recovery. Live Discord behavior remains unverified. Automatic responders are a separate [opt-in suite](RESPONDERS.md). Recurring messages are a separate [timer suite](TIMERS.md). Template integration, scripting and webhook-based branding remain future work.

Clone and rename require an existing source and a different, unused destination name. Both names use the same validation rules. Neither operation overwrites another template. A clone needs an available slot; rename also works at the 50-template limit. Changes are serialized with other writes, and failed persistence leaves the previous in-memory state intact. Already published messages are unchanged. Other staff must use the new name after a rename.
