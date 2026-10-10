# Coins and professions

OpenDesk coins are per-guild game points, not money, redeemable credit or a payment system. All features are free. Existing `/economy balance`, `daily`, `work`, `pay` and `/leaderboard coins` remain available.

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

There are no job fees, purchases, premium roles or subscriptions. Professions do not assign Discord roles, affect Discord permissions or simulate real employment. Shops, inventory, richer occupation mechanics and complete competitor-specific profession policies remain unfinished.

## Data and recovery

The existing `economy.json` remains version 1 and accepts legacy accounts without profession/beg metadata. New optional fields are a begging timestamp and a strict profession object containing name, completed work count and last-change time. The profile's derived rank is not persisted. Older bot versions cannot read accounts containing these fields; stop the bot and restore a compatible complete store backup when rolling back.

Run `npm run register` after upgrading. Run one bot process per store set, keep all store files private and back up all stores together while stopped. Private replies suppress mentions. The machine clock controls cooldowns; clock changes can affect readiness. Saved timestamps prevent ordinary concurrent claims from bypassing cooldowns, but this is not a permanent interaction receipt ledger. A successful save followed by a lost response can leave a granted reward without confirmation; inspect your profile before retrying.

Existing CI does not exercise new beg/profile/profession workflows. Live Discord validation remains unverified. Full competitor parity remains unfinished.
