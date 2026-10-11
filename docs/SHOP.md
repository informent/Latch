# Server shop and inventory

All shop features are free MIT-licensed source. Items are virtual collectibles or consumables bought with earned server coins. They do not assign roles, change permissions, deliver physical goods or use real money. No external provider is needed.

## Staff setup

Staff need Manage Server or Administrator for `create`, `update`, `enable` and `disable`. Other commands are available to human server members.

```text
/shop create item:cookie title:Cookie price:10 stock:100 description:A virtual treat
/shop info item:cookie
/shop enable item:cookie
/shop list
```

Item IDs use lowercase letters, digits and hyphens, up to 32 characters, and remain stable. A guild can have up to 100 items. Titles have up to 80 characters and descriptions up to 300. Unit prices are 1-1000000 coins. Stock is an absolute available quantity from 0 to 1000000, or -1 for unlimited. Creating an item always leaves it disabled for review.

`update` replaces the title, description, price and available stock while preserving enable state. Omitted description becomes empty; omitted stock becomes unlimited. Updating stock sets the new total rather than adding units. Changes affect subsequent purchases, including requests waiting in the transaction queue. Existing owned quantities and receipts remain intact.

`disable` removes an item from ordinary browsing and stops purchases. Staff can still inspect disabled items. Owners can still gift or consume previously bought units. Item IDs are retained so inventories and historical references stay readable; there is no hard deletion command.

## Member commands

| Command | Behavior |
| --- | --- |
| `/shop list page` | Available items, prices and stock; staff also see disabled items |
| `/shop info item` | Description, unit price, stock and enable state |
| `/shop buy item quantity` | Debit coins and add inventory; default quantity 1 |
| `/shop inventory page` | Your owned items and quantities |
| `/shop gift item user quantity` | Transfer owned units to another current human member who completed screening |
| `/shop use item quantity` | Permanently consume owned units; provides no additional reward or Discord effect |
| `/shop history page` | Your latest 20 outgoing/incoming shop receipts |

Quantities per operation are 1-100. Inventory is capped at 100 distinct items and 10000 units per item. Gifts preserve both members' balances and never replenish shop stock. Consumed units also do not replenish stock. Replies are private and suppress mentions. Listings have ten entries per page.

## Atomicity and retries

A purchase saves the coin debit, available stock, inventory quantity and receipt in one atomic file replacement. Gifts save both inventories and their receipt together. Transactions run in a serialized queue, preventing overspending and stock overselling. Failed persistence keeps the previous in-memory state.

The Discord interaction ID identifies each buy/gift/use receipt. Repeating a retained request returns the original result without applying it again. Reusing the ID for a different transaction is rejected. Receipts are kept for seven days and pruned during subsequent new shop transactions, with a maximum of 50000 retained entries. This is bounded retry protection, not an indefinite audit ledger. Clock changes affect retention. Older requests whose receipts have been pruned are not deduplicated.

If a transaction commits but its Discord response fails, inspect `/shop history` and `/shop inventory` before submitting a new command. A newly submitted slash command has a new ID and is a new transaction. Member/role changes can race the final gift membership check.

## Storage, upgrade and rollback

The existing `economy.json` contains the entire shop together with accounts. Versions 1 and 2 load without changes; successful writes in v0.23.0 migrate to version 3, including ordinary claims, transfers and shop operations. Balances, cooldowns, professions, catalog, inventory and receipts are preserved. Migration failures keep the original file intact.

Version 3 validates accounts, catalog items, inventory references, shop receipts and the additional staff adjustment ledger. Files are capped at 32 MiB. Run one bot process per store set. Stop the bot and back up all twelve stores before upgrading. Earlier releases cannot read version 3; rollback requires a compatible complete backup and discards later transactions. Never manually change the version field to downgrade. See the [administration guide](ECONOMY-ADMIN.md).

Run `npm run register` after upgrading to register the new suite. Shop configuration needs no new environment variables or data path. Automated tests cover migration, concurrency, rollback, retries, permission checks and signed HTTP requests. Live Discord operation remains unverified.
