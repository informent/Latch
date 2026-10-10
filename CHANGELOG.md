# Changelog

## 0.2.0 - 2026-10-09

- Added personal channel reminders with durable deadlines, private listing, owner-only cancellation, delivery retries, and bounded retention.
- Added staff giveaways with durable Enter/Leave buttons, one entry per human member, scheduled or early endings, cancellation, and saved cryptographic draws without replacement.
- Added a shared community scheduler with restart recovery, atomic writes, rollback, quotas, retry backoff, and graceful shutdown.
- Extended signed HTTP interaction handling to support giveaway buttons and disabled mentions in public giveaway announcements.
- Included the earlier native AutoMod filters, custom embeds, native polls, games, and economy persistence correction in the current source version.
- Expanded regression coverage, setup instructions, and the free all-in-one feature roadmap.

This remains a source-only prototype. Live Discord validation, music, full antinuke, role menus, and complete competitor parity are still outstanding. Reminders use at-least-once delivery; initial giveaway publication can leave an extra message after an ambiguous network result or crash. See the README for operating limits.
