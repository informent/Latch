# Audited coin administration

Coins are server game points, not money or redeemable credit. These staff controls are free and MIT licensed. They operate on the configured guild's local economy store and do not change Discord roles or permissions.

| Command | Purpose |
| --- | --- |
| `/economyadmin grant user:... amount:100 reason:...` | Add game coins to a current human member |
| `/economyadmin remove user:... amount:50 reason:...` | Remove coins if the member has enough |
| `/economyadmin set user:... amount:0 reason:...` | Set a member balance to an exact amount |
| `/economyadmin history user:... page:1` | Privately list five staff adjustments per page; member filter is optional |
| `/economyadmin receipt id:...` | Privately inspect the original before/after balances, actor, amount, timestamp and full reason |

## Authorization and limits

Every command requires Manage Server or Administrator in the invoking interaction. Before reading private history or changing coins, OpenDesk fetches the current guild, role definitions and actor membership. Current Manage Server, Administrator or guild ownership is required. Bot actors, incomplete screening and currently timed-out staff are refused. Role definitions and member IDs must match the configured guild.

Adjustment targets must be current human members who completed screening. This is a game economy permission policy, so role position is not an additional restriction. Authorized staff may adjust their own balance; their identity and reason are recorded like every other adjustment. History can inspect retained records for departed members without requiring current target membership.

Grant/remove amounts are whole numbers from 1 to 1000000000. Set accepts 0 to 1000000000. Removing cannot overdraw; granting cannot exceed the existing global balance ceiling. Every adjustment requires 1-400 nonblank reason characters. Normal reward cooldowns, professions, inventory, shop catalog and receipts are preserved. Set means an exact replacement balance and can reduce a large balance; inspect the member first.

## Persistence, receipts and retries

Balance and audit receipt commit in one serialized atomic economy write. Failed saves expose neither a new balance nor a new receipt. Stored records include interaction ID, guild, staff actor, target, action, supplied amount, reason, before/after balances and timestamp. Confirmation and history are private and suppress mention pings. Logs include the action without receipt reasons or raw transport errors.

The original interaction ID is the receipt ID. An exact retry of that retained ID returns the prior result without applying it twice, even after restart. Reusing an ID with a different actor, member, action, amount or reason is refused. This is not a global exactly-once promise: a newly submitted slash command has a new interaction ID and represents a new adjustment. If a response is lost, inspect history or the receipt before submitting another command. Original receipt balances are historical values, not the current balance after later transactions.

At most 50000 audit adjustments are retained, within the existing 32 MiB total economy-file cap. Entries older than seven days are pruned when a new adjustment is made. No background audit pruning or permanent audit retention is promised. Duplicate protection ends once a record is pruned. History is paginated five entries at a time; receipt lookup returns the full saved reason.

## Upgrade and rollback

Version 0.23.0 reads economy formats 1, 2 and 3. Successful economy writes use version 3 with the additional adjustments ledger, including ordinary reward or shop writes. Loading alone leaves older source bytes unchanged. Back up all twelve stores together before upgrading, using the [backup tool](BACKUPS.md) while the bot is stopped. Run `npm run register` for the five new commands.

Older releases reject economy version 3. Rolling back requires a compatible complete backup and the older release; do not remove fields manually or mix economy data from one snapshot with other stores from another. This ledger is ordinary trusted local JSON and cannot prove that an administrator has not edited the files. Keep data and backups private.

Automated tests cover duplicate/restart handling, conflicting requests, failed saves, format migration, corrupt ledger rejection, authorization revocation, screening, timed-out staff, inventory/cooldown preservation, history paging, signed HTTP requests and format 3 backup verification. Live Discord validation and full competitor parity remain unfinished.
