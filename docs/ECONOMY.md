# Coins and professions

Latch coins are per-guild game points, not money, redeemable credit or a payment system. All features are free. Existing `/economy balance`, `daily`, `work`, `pay` and `/leaderboard coins` remain available.

## Rewards and profiles

- `daily`: 100 coins every 24 hours.
- `work`: randomly 25-100 coins every hour, plus an optional profession bonus.
- `beg`: randomly 0-25 coins every 15 minutes. A zero result still consumes the cooldown.
- `profile user`: privately show a member's recorded balance, profession/rank and reward readiness; defaults to yourself. A missing account displays zero coins and no profession without writing an account.

Claims save the reward, balance and timestamp in one serialized atomic write. Failed persistence rolls back the in-memory transaction. Cooldowns survive restart and are independent; reward claims are rejected for bot authors. The existing maximum account count and balance limits still apply. Bounded reward generation uses Node cryptographic randomness; no external service is required.

`pay` transfers 1-1000000 coins between different users without creating coins, and requires enough balance. Transfers preserve progression and cooldowns. Coin leaderboards return copied account snapshots so callers cannot modify stored profession state.

## Professions

`/economy profession list` explains available professions. `/economy profession choose name` selects developer, artist or builder. `/economy profession status` privately shows your profile and reward readiness.

The three professions are cosmetic choices with identical earning rules. Initial selection is free and starts at rank 1. Changing profession is allowed once per 24 hours, resets work progression and preserves daily/work/beg cooldowns. Selecting the same profession is a no-op that preserves rank and the existing change deadline.

Each successful work claim adds one completed work count for the selected profession. Rank is `min(5, 1 + floor(completedWorks / 10))`. A work reward uses the rank **before** that claim to add `rank * 5` coins, then advances progress. Rank increases at 10, 20, 30 and 40 completed work claims, reaching a maximum bonus of 25 coins. A threshold claim can show the new rank while its reward includes the previous rank's bonus. Work counts cap at 1000. Daily and beg do not advance profession progress or receive bonuses.

There are no job fees, purchases, premium roles or subscriptions. Professions do not assign Discord roles, affect Discord permissions or simulate real employment. Server shops and inventory are available through /shop; see the [shop guide](SHOP.md). Richer occupation mechanics and complete competitor-specific profession policies remain unfinished.

## Data and recovery

The existing `economy.json` accepts account format 1 and shop format 2 without modifying their files on load. Successful writes in v0.23.0 migrate to format 3, preserving coins, cooldowns, professions, catalog, inventory and receipts while adding the staff adjustment ledger. Earlier releases reject format 3; rollback requires a compatible complete backup. New profession/beg account fields also require compatible releases. Stop the bot and back up all twelve stores together before upgrades or rollback.

Run `npm run register` after upgrading. Run one bot process per store set, keep all store files private and back up all stores together while stopped. Private replies suppress mentions. The machine clock controls cooldowns; clock changes can affect readiness. Saved timestamps prevent ordinary concurrent claims from bypassing cooldowns, but this is not a permanent interaction receipt ledger. A successful save followed by a lost response can leave a granted reward without confirmation; inspect your profile before retrying.

Dedicated tests cover beg/profile/profession workflows, shops and legacy migration; CI runs these tests. Live Discord validation remains unverified. Full competitor parity remains unfinished.

## Staff balance controls

Version 0.23.0 adds audited grant/remove/set, paginated history and full receipt lookup. Successful economy writes now use format 3, while load accepts formats 1 and 2. See the [administration guide](ECONOMY-ADMIN.md) for permissions, atomic saves, duplicate handling and required backup/rollback steps.
