# Changelog

## 0.18.0 - 2026-10-10

- Added a complete generated COMMANDS.md reference for all 159 command paths across 23 suites, including options, choices, bounds, channel restrictions and default permissions. Linked it from README and added a CI freshness check.
- Added eight free role reward commands: add, remove, list, info, enable, disable, preview and reconcile. Rewards start paused and accumulate without removing existing roles.
- Added up to 20 configurable permission-free unmanaged milestones at levels 1-1000, current staff/bot permission checks, role/member hierarchy validation, screened human recipients and role assignment read-back.
- Added guild-bound atomic reward storage, durable per-member intent/completion records, exponential retries, idempotent recovery after lost REST replies and failed settlement writes.
- Added existing-XP scans of 25 accounts and one pending assignment per 15-second tick, coalesced scheduling and shutdown draining. The scan recovers a crash between the separate XP and reward commits.
- Added reward store configuration, offline doctor inspection and persistent Docker/service paths. Corrected the leveling guide's XP store environment variable to LEVEL_STORE_PATH.
- Added 59 tests, including signed HTTP commands, the wired Gateway, ambiguous success, corrupt records, current permission changes, scan limits, shutdown and complete command-reference validation. All 355 tests pass locally: 91.88% lines, 83.57% branches, 86.59% functions.

Back up all twelve stores together before upgrading. Existing XP schema is unchanged; level-rewards.json is a new version 1 store. Removing/pausing rewards preserves member roles. Scans/retries are bounded and can take time on large servers. No external role-edit lock or cross-process file lock exists. Live Discord validation, exclusive reward policies, rank cards, voice XP and complete competitor parity remain unfinished.

## 0.17.0 - 2026-10-10

- Added eight Manage Server leveling commands: show, tune, reset, ignore, unignore, ignored, enable and disable. Catalog now declares 151 paths across 22 suites.
- Added persistent per-guild awards of 1-100 XP, 15-3600 second cooldowns, pause/resume and up to 100 ignored exact channel IDs with paginated private listings.
- Added live guild/channel validation on ignore; deleted channel references can be removed without fetching them.
- Reworked XP/settings writes into isolated queued snapshots that become visible only after atomic replacement. Failed writes preserve committed state and leave the queue usable.
- Added durable latest-message duplicate suppression, strict IDs/schema/timestamps, 32 MiB file bounds and fresh human Gateway message checks. Message content remains unpersisted.
- Added 35 regression tests, including signed HTTP settings changes, the wired Gateway and recovery after a lost reply. All 296 tests pass locally: 91.21% lines, 82.46% branches and 85.91% functions.

Successful writes migrate levels.json from version 1 to version 2. Back up all eleven stores before upgrading; older releases reject the new leveling file, so rollback requires a compatible complete backup. Reset clears ignored channels and resumes server awards while preserving XP and last-award cooldowns. The environment XP setting still gates awards. The replay guard retains only the most recently awarded message per account. Live Discord validation, rewards, rank cards, voice XP and full competitor parity remain unfinished.

## 0.16.0 - 2026-10-10

- Added persistent ticket panels with eight staff commands, unpublished drafts and up to five topic/category buttons. Catalog now declares 143 paths across 21 suites.
- Added guild-bound atomic panel storage, durable publication retries, missing-message recovery, copied/stale-button rejection, current screened-human checks and private ticket links.
- Panel tickets retain their selected topic as a reason and route to the chosen validated category. Duplicate clicks reuse the owner's active ticket.
- Added staff-only ticket reopening with owner/channel locks, duplicate-active protection, durable reopening intent, owner overwrite preservation, permission read-back and retry recovery after REST or disk failure.
- Rejected the everyone role as a support role before startup/channel creation to prevent accidental ticket visibility exposure.
- Added panel store configuration, doctor inspection, backup guidance, Docker/service paths and shutdown draining.
- Added 40 tests, including the complete signed HTTP support workflow. All 261 tests pass locally with 91.06% line coverage.

Back up all eleven stores before upgrading. Older releases reject the reopening state; rollback requires a compatible complete backup. Panel retries use Discord nonce protection but do not provide permanent exactly-once publication. Live Discord validation, transcripts, intake forms and complete competitor parity remain unfinished.

## 0.15.0 - 2026-10-10

- Added eight AutoMod command paths: info, presets, exempt-role/unexempt-role, exempt-channel/unexempt-channel, allow-words and block-message. Catalog now declares 134 paths across 20 suites.
- Added disabled-by-default native preset wordsets and private rule/filter/action/exemption inspection.
- Added serialized exemption updates, live guild target validation, 20-role/50-channel limits, duplicate no-ops and removal of deleted target references. Everyone-role exemptions are refused.
- Allowed-word replacement preserves other trigger metadata. Block explanations preserve other rule actions; configuration preserves enable state.
- Strengthened rule ownership checks to require exact rule ID, guild ID, bot creator and OpenDesk prefix before inspection or mutation.
- Added 26 tests. All 221 pass locally with 90.21% line coverage. Added native AutoMod operating documentation.

Rules reside in Discord and need no new store or migration. Staff and bot require Manage Server. Other clients can race configuration changes; no external edit lock exists. Live filtering behavior and full competitor parity remain unfinished.

## 0.14.0 - 2026-10-10

- Added 11 shop commands: create/update, enable/disable, list/info, buy, inventory, gift, use and history. Catalog now declares 126 paths across 20 suites.
- Staff Manage Server checks protect catalog changes. New items start disabled; catalog and inventory listings are paginated, and all confirmations remain private with mentions suppressed.
- Added atomic coin purchases, limited/unlimited stock, inventory caps, human/screened gift recipients, consumables and durable duplicate-request receipts. Coins, items and receipts commit in one file replacement.
- Added strict bounded economy version 2 storage with version 1 migration preserving existing balances, cooldowns and professions. Failed migration leaves the original file intact.
- Added 31 tests, including signed HTTP purchase retries after lost response delivery, restart recovery, concurrency, authorization and invalid-store rejection. All 195 tests pass locally with 89.90% line coverage.
- Updated roadmap and economy coverage statements to reflect dedicated regression tests.

Virtual items have no Discord role or permission effects. Receipt history is pruned after seven days during new transactions. Back up version 1 stores before upgrading; older releases refuse version 2. Live Discord validation and complete competitor parity remain unfinished.

## 0.13.0 - 2026-10-10

- Expanded the regression suite from 87 to 164 tests across new stores, automation, authorization, role menus, ticket workflows, economy progression, interactions and temporary voice recovery.
- Fixed profession status failing on its default user selection and saved templates retaining caller-owned mutable input.
- Serialized responder dispatch so concurrent channels cannot bypass the global send guard. Logger failures no longer escape delivery handling.
- Ticket and economy mutations now use isolated snapshots, validate queued updates and commit in-memory state only after atomic file replacement succeeds. Ticket storage is bounded to 50000 records and 32 MiB.
- Voice transfers reject missing or mismatched member identities; room creation and access changes also verify returned member identity.
- Added enforced test coverage floors: 85% lines, 75% branches and 80% functions. Local coverage is 89.33% lines, 79.67% branches and 83.90% functions.

These tests use local files and simulated Discord responses. Live Discord validation remains outstanding. The catalog remains 115 command paths across 19 suites; full competitor parity remains unfinished. See [verification evidence](docs/VERIFICATION.md).

## 0.12.0 - 2026-10-10

- Added economy beg, profile and profession list/choose/status, bringing the catalog to 115 command paths across 19 suites.
- Beg rewards 0-25 coins with a durable 15-minute cooldown. Three free professions share work-based ranks and bounded 5-25 coin work bonuses.
- Profession changes have a durable 24-hour cooldown, reset progression and preserve reward cooldowns. Same-profession selection preserves progression.
- Added strict optional account metadata, immutable loaded profession state, copied leaderboard snapshots, reward bounds and economy operating documentation.

Existing CI does not exercise the new economy workflows. Live Discord validation remains outstanding. Older bot versions reject accounts containing the new optional fields; rollback needs a compatible complete backup. Full competitor parity remains unfinished.

## 0.11.0 - 2026-10-10

- Added ticket info, reason and move commands. Owners can inspect their own stored ticket metadata; support staff can save reasons and move open tickets.
- Moves validate configured guild/channel/category types, retain explicit channel overwrites and verify destination and overwrites after the API update. Missing everyone visibility protection is refused.
- Added backward-compatible reason metadata in the existing ticket store and ticket operating documentation. Catalog now declares 110 command paths across 19 suites.

Existing CI does not exercise the new ticket workflows. Live Discord validation remains outstanding. Concurrent manual permission changes can race moves; failed confirmation requires staff inspection. Complete competitor parity remains unfinished.

## 0.10.0 - 2026-10-10

- Extended live actor/bot permission and hierarchy checks to role grants/removals and nickname updates. Blocks protected/self targets, managed/everyone roles and equal or higher role positions.
- Non-admin staff cannot grant roles containing guild permissions they do not hold. Timed-out non-owner actors are refused before delegation.
- Added private role metadata inspection with /utility role, highlighted management permissions and raw permission bits. Catalog now declares 107 command paths across 19 suites.
- Updated existing role fixtures for live lookup responses, member-management documentation and command coverage.

Existing CI does not cover every new rejection branch or the new role-inspection workflow. Live Discord validation remains outstanding. Role changes can race a final REST action. Complete competitor parity remains unfinished.

## 0.9.1 - 2026-10-10

- Added live actor and bot permission/hierarchy checks before ban, kick, timeout and timeout removal. Protects the server owner, invoking member and OpenDesk itself.
- Rejects equal role positions, missing/invalid role snapshots, and administrator/bot timeout targets. Server ownership bypasses the actor hierarchy check only.
- Updated existing moderation fixtures for the required live lookup shape and added source syntax checks. Command count remains 106 across 19 suites.

Existing CI does not exercise every new rejection branch. Live Discord validation remains outstanding. Role/nickname delegation and complete competitor parity remain unfinished.

## 0.9.0 - 2026-10-10

- Added eight recurring-message commands: create, update, list, info, preview, enable, disable and delete. Manage Server checks apply to every command.
- Added disabled-by-default schedules, private previews, mention suppression, live target-channel validation and a bounded scheduler without Gateway requirements.
- Added guild-bound atomic storage, durable deadlines and attempt results, no missed-interval replay, offline inspection, tenth-store deployment paths and shutdown draining.
- Catalog now declares 106 command paths across 19 suites. Updated help, backup guidance and feature coverage.

Existing CI does not exercise the new timer workflows. Live Discord validation remains outstanding. Claims advance schedules before delivery; failures can skip an occurrence. Activity thresholds, embed integration, advanced scheduling and full competitor parity remain unfinished.

## 0.8.0 - 2026-10-10

- Added eight autoresponder commands: create, update, list, info, preview, enable, disable and delete. Staff Manage Server checks apply to every command.
- Added opt-in Gateway message automation, disabled-by-default channel rules, exact normalized matching, mention suppression and bot/webhook/reply/stale-event exclusions.
- Added guild-bound atomic storage, durable per-rule cooldown claims and last-message deduplication, in-memory channel/global rate guards, offline inspection and ninth-store deployment paths.
- Catalog now declares 98 command paths across 18 suites. Updated backup and feature coverage documentation.

Existing CI does not exercise the new responder workflows. Live Discord validation remains outstanding. Durable claims can suppress delivery after an outage; no automatic retry or history backfill exists. Recurring timers, advanced responder policies and full competitor parity remain unfinished.

## 0.7.0 - 2026-10-10

- Added seven saved embed template commands: create, update, list, info, preview, send and delete.
- Added bounded guild-bound atomic storage, Manage Messages checks, private previews, mention suppression and channel validation before publishing.
- Added offline store inspection and deployment paths. Catalog now declares 90 command paths across 17 suites.

Existing CI does not exercise the new template workflows. Live Discord validation remains outstanding. Automatic responders, timers and full competitor parity remain unfinished.

## 0.6.0 - 2026-10-10

- Added eight persistent role-menu commands and separate Get/Remove buttons with signed message/guild/channel binding and live role eligibility checks.
- Added autorole add/remove/list/apply. New human joins can receive up to five permission-free roles; staff can reconcile a screened member after a failure or skipped join.
- Restricted automated roles to unmanaged roles with zero permission bits below the bot and configuring staff. Menu disable/delete/removal reject stale controls before public updates finish.
- Added durable publication/update/delete retries, strict guild-bound role-menu storage, offline inspection, deployment paths and shutdown draining. Catalog now declares 83 command paths across 16 suites.
- Removed em dashes from public README text and added a publication-text gate for documentation, profile drafts and release notes.

Existing CI does not exercise new role automation workflows. Live Discord validation remains outstanding. Pending-screening joins and failed autorole assignments require staff apply; no persistent join retry/backfill exists yet. Full competitor parity remains unfinished.

## 0.5.0 - 2026-10-10

- Added an optional temporary voice suite with 14 command paths: setup, status, disable, rename, limit, lock, unlock, ghost, unghost, claim, info, permit, reject and transfer.
- Added a strict, guild-bound persistent voice store, one room per owner, up to 50 rooms, serialized operations, creation cooldowns and delayed empty-room cleanup.
- Gateway voice observations update before asynchronous dispatch work. Cleanup pauses without a current connection/snapshot and validates stored channels before deletion. One cleanup attempt per pass rotates across rooms, with confirmed 404 recovery.
- Added voice opt-in configuration, Gateway intent 128, invite permissions, offline store inspection, persistent deployment paths and shutdown draining.
- Added detailed voice operation and recovery documentation; updated the roadmap and partial competitor inventory. Catalog now declares 71 command paths across 14 suites.

Existing CI does not exercise new voice workflows. Live voice lifecycle, audio playback and full competitor parity remain unverified or unfinished. Permission changes and ownership saves are separate operations; read the voice guide before enabling this prerelease.

## 0.4.0 - 2026-10-10

- Added ticket list, stats, claim, unclaim and rename, with private responses and support-team authorization. Listing is paginated and ordinary members see only their own tickets. Assignments persist with rollback on failed saves and channel locks for concurrent claims.
- Added giveaway edit prize, duration and winners. Edits save before updating the public message, with durable refresh retries after restart. Duration is measured from now, within a maximum total lifetime of 30 days.
- Added giveaway reroll. Replacement winners exclude the immediately previous winners; fewer replacements may be selected if the remaining pool is small. Results persist before delivery, and duplicate interaction IDs reuse the saved draw.
- Increased registered command paths from 48 to 57. Updated the coverage inventory with explicit differences from competitor behavior.

Back up stores before upgrading. New claim and reroll records remain readable by this version but older releases may reject them. Existing CI does not establish coverage for each new command or live Discord operation. Complete competitor parity remains unfinished.

## 0.3.2 - 2026-10-10

- Added permission-checked unban by user ID with an audit reason.
- Added private member-information and avatar commands using server membership and Discord CDN URLs.
- Added a command catalog generated from registration declarations and a dated, partial competitor coverage inventory with explicit gaps and source limitations.

Complete competitor parity and live Discord validation remain unfinished.

## 0.3.1 - 2026-10-10

- Gateway reconnects after transient network/service closures, rejects insecure WebSocket URLs, ignores stale socket messages, and prevents a pending discovery request from reopening after shutdown.
- Gateway shutdown drains accepted event work; socket send/close failures enter bounded reconnect handling.
- REST requests honor valid Discord 429 retry delays with at most two retries inside a shared 12-second request budget. Observed bot-global cooldowns delay later bot-authenticated requests; interaction webhooks remain separate.
- Transport and malformed-response errors exclude packet contents, response bodies, and credentials. Ambiguous network failures and other HTTP failures do not automatically repeat writes.

Live outage recovery and complete per-bucket rate-limit management remain unverified/unfinished. Existing CI coverage does not exercise every new failure path.

## 0.3.0 - 2026-10-10

- Added non-destructive local setup, an offline configuration/store doctor with JSON output, and feature-based Discord installation links.
- Added bot-token file loading for deployment secret mounts, conflicting credential-source rejection, and safer store-path configuration.
- Added Docker Compose, a restricted container build context, HTTPS proxy and Linux service examples, and an operations guide for backups/upgrades/support.
- Clarified the free upstream product commitment, MIT license, one-guild deployment model, and remaining readiness limits.

Docker and Linux service execution remain unverified on the current Windows development host. The configuration doctor is read-only and cannot validate live Discord operation.

## 0.2.0 - 2026-10-09

- Added personal channel reminders with durable deadlines, private listing, owner-only cancellation, delivery retries, and bounded retention.
- Added staff giveaways with durable Enter/Leave buttons, one entry per human member, scheduled or early endings, cancellation, and saved cryptographic draws without replacement.
- Added a shared community scheduler with restart recovery, atomic writes, rollback, quotas, retry backoff, and graceful shutdown.
- Extended signed HTTP interaction handling to support giveaway buttons and disabled mentions in public giveaway announcements.
- Included the earlier native AutoMod filters, custom embeds, native polls, games, and economy persistence correction in the current source version.
- Expanded regression coverage, setup instructions, and the free all-in-one feature roadmap.

This remains a source-only prototype. Live Discord validation, music, full antinuke, role menus, and complete competitor parity are still outstanding. Reminders use at-least-once delivery; initial giveaway publication can leave an extra message after an ambiguous network result or crash. See the README for operating limits.
