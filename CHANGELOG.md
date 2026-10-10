# Changelog

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
