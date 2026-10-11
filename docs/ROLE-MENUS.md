# Role menus and autoroles

These free features use stored configuration and Discord's native role endpoints. Self-service menu buttons work through the signed HTTP interaction endpoint without Gateway events. Autoroles require `DISCORD_ENABLE_MEMBER_EVENTS=true`, Gateway access, and the Server Members intent enabled in the Developer Portal. Re-register commands after upgrading.

Live role-menu and autorole workflows remain unverified. Existing CI does not exercise these new workflows.

## Eligibility and permissions

The bot needs Manage Roles, plus Send Messages and Embed Links to publish a menu and Read Message History to verify existing messages. The configuring member needs Manage Roles. Roles must be unmanaged, distinct from everyone, have **zero permission bits**, and be strictly below the bot's highest role. Staff selecting or publishing roles must also outrank them; the guild owner bypasses the staff hierarchy check. Equal-position roles are refused conservatively.

Eligibility is checked from current Discord role/member information before assignments and menu publication. A role that acquires permissions, becomes managed or moves above the bot is refused. This is a restriction to cosmetic and organizational roles, not a general permission-role editor. Administrators can change roles while an API request is in flight; checks and assignments are separate Discord operations, so a concurrent change can still race the checks.

## Build a menu

1. In a normal server text channel, run `/rolemenu create title:"Choose your interests"`.
2. Save the returned menu ID. Run `/rolemenu add id:... role:... label:"Gaming"` for each eligible role.
3. Run `/rolemenu publish id:...`.
4. Members use separate Get and Remove buttons. Actions are explicit and idempotent rather than toggles, so repeating the same request cannot invert a role unexpectedly.

| Command | Behavior |
| --- | --- |
| `/rolemenu create` | Save a draft in the invoking text channel |
| `/rolemenu add` | Add a role and button label |
| `/rolemenu remove` | Remove a role from the menu; existing member roles remain unchanged |
| `/rolemenu list` | Privately list menu IDs, states and pending updates |
| `/rolemenu info` | Inspect one menu's channel, roles and delivery status |
| `/rolemenu publish` | Enable and publish/update a menu; re-enable a disabled menu |
| `/rolemenu disable` | Immediately reject its button actions and remove controls when delivery succeeds |
| `/rolemenu delete` | Immediately reject buttons, delete the bound public message, then remove configuration |

All management commands require Manage Roles. Up to 20 menus and 10 roles per menu are stored. Each role has two buttons, with at most 20 buttons across four action rows. Labels allow 60 characters; titles allow 200. Menus are independent and do not enforce one-choice groups or mutually exclusive roles.

Buttons require the configured guild, saved menu/channel/message IDs and a role still present in an enabled menu. Bots and members with pending membership screening are refused. Stale copied messages are not accepted. Replies are private and suppress mentions.

## Publication and recovery

Configuration changes save before public message updates. Publication, edits, disable and delete retry after restart with backoff from 15 seconds to 15 minutes. One ready menu is processed per scheduler pass. Updates verify the channel's guild/type and the message's bot author. A missing enabled-menu message is recreated; disabled/deleted messages are not recreated. Disabled and deleting menus reject buttons even while the public display is awaiting cleanup.

Only the saved message binding accepts role requests. Initial publication uses a Discord nonce to reduce duplicates. A crash after message creation but before saving its ID, or a retry outside Discord's nonce window, can leave an extra message. Such copies cannot assign roles because they are not bound; remove confirmed orphan messages manually. Repeated role PUT/DELETE actions are safe, but network failures are not automatically replayed within a command. Members can retry their explicit button action.

## Join roles

- `/autorole add role:...`: configure up to five eligible roles, after enabling member events.
- `/autorole remove role:...`: stop assigning that role; existing members keep it.
- `/autorole list`: show configured roles and event status.
- `/autorole apply user:...`: staff reconcile configured roles for one human member who has completed screening. Existing roles are skipped, so it is safe to repeat after a partial failure.

New human joins receive eligible configured roles once. Bots and pending-screening joins are skipped. Screening completion is not automatically retried, old members are not backfilled, and failed join assignments do not have a persistent retry job. Use apply after screening or failures. Changing the autorole list affects future joins; it does not revoke roles from existing members. Duplicate join deliveries skip roles already present. One invalid configured role can stop a join/apply batch after earlier roles succeeded; remove it and run apply again.

## Data and operating limits

`data/role-menus.json` stores a guild ID, menu IDs/channel/message bindings, titles, labels, configured role IDs, state and publication retry metadata, plus the join-role list. No interaction tokens, message content history or bot credential are stored. The strict guild-bound schema has a 1 MiB size limit and uses private atomic writes. Include this seventh store in backups and use one process per store set. `ROLE_MENU_STORE_PATH` can change its location; doctor and deployment templates include it.

Reaction roles, emoji configuration, toggle buttons, mutually exclusive selections, booster/vanity roles, custom permission-role policies and persistent join retries remain unfinished. See [command coverage](COMMAND-COVERAGE.md).

References: [Discord button components](https://docs.discord.com/developers/components/reference#button), [guild role endpoints](https://docs.discord.com/developers/resources/guild#add-guild-member-role), [Bleed button-role documentation](https://docs.bleed.bot/configuration/roles/button).

## Browse every saved entry

`/rolemenu list` shows five entries per page, ordered by numeric ID. Use `/rolemenu list page:2` for the next page. Responses show totals, page counts, full titles and pending publication status. Empty lists show page 1/1; unavailable pages return the valid range. Re-register commands after upgrading to expose the optional page argument.
