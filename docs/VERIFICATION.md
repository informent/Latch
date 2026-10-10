# Verification

## Version 0.13.0

The local Node test runner passes 164 tests with no failures. Before this release, the same runner passed 87 tests with 66.33% line coverage. The expanded suite reports 89.33% lines, 79.67% branches and 83.90% functions. Coverage describes files loaded by the suite; setup, doctor and invite scripts are not part of this measurement.

`npm test` now requires at least 85% lines, 75% branches and 80% functions. GitHub CI runs the same command on Node 22 and 24, followed by syntax and publication text checks.

## Regression evidence

| Area | Behaviors exercised |
| --- | --- |
| Templates and stores | Restart round trips, guild binding, corrupt/oversize input, unsupported versions, failed atomic writes, input and snapshot isolation |
| Responders | Exact matching, stale/future events, bot/webhook/reply exclusion, durable cooldowns, concurrent global guard, suppressed mentions and failed sends |
| Timers | Persisted deadlines, disabled state, claimed attempts, failed sends, coalesced ticks, no outage catch-up and shutdown draining |
| Authorization | Current actor/bot permissions, owner/self/bot protection, member and role hierarchy, managed roles, timeout restrictions and grant privilege limits |
| Role menus | Publish/retry/restart, missing message recovery, stale component bindings, idempotent role toggles, screening and autorole reconciliation |
| Tickets | Owner/staff privacy, reasons, category/overwrite validation, failed move confirmation, committed reads and existing close/recovery workflows |
| Economy | Concurrent reward claims, cooldown restart/boundaries, profession rank/bonus/change rules, invalid records/rewards and committed transfer reads |
| Voice | Snapshot/reconnect state, creation/reuse, owner controls, transfer/claim, empty grace, occupied/missing rooms, persistence failure cleanup and stopping |
| Interactions | Staff permission denial, template/responder/timer management, profession list/choose/status, profiles/beg and private confirmations |

Failing tests reproduced template input aliasing, concurrent responder guard bypass, uncommitted ticket reads, profession status failure and incomplete voice transfer member responses before fixes were applied. An additional transfer test confirms economy readers keep the previous committed balances during file replacement.

## Practical limits

The suite uses temporary local files, a local HTTP server where applicable and simulated Discord API/Gateway responses. It does not prove live Discord delivery, real permission configuration, platform rate-limit behavior or production hosting. This checkout has no Discord configuration and no available Docker executable. No live server validation was performed for this release.

Coverage is not complete: main interaction routes and some Gateway/recovery branches still have untested paths. Full Bleed/Greed command parity remains unfinished. The actual OpenDesk catalog has 115 command paths across 19 slash command roots.

## Repeat the checks

```powershell
npm test
npm run check
npm run check:roles
npm run check:automation
npm run publication-check
npm run commands -- --json
```

Back up all stores before upgrading. Existing version 1 record formats are retained. Ticket records with numeric IDs, unknown fields, invalid dates or excessive size are now rejected instead of being modified. Older releases can reject optional fields introduced in previous versions; roll back with a compatible complete backup.
