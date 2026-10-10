# Changelog

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
