# Latch feature roadmap

Goal: a free, open-source community bot spanning the feature areas advertised by [Bleed](https://bleed.bot/commands) and [Greed](https://greed.sh/docs/introduction/), with transparent configuration, durable data, and documented operating limits. This is a feature-area comparison, not a claim of command-for-command parity. Inventory reviewed October 11, 2026.

All Latch features are intended to be available without subscriptions or premium gates. Self-hosting still needs a machine and network access. External providers can require their own credentials, impose limits, or charge fees; integrations must document those conditions.

| Area | Current implementation | Remaining work |
| --- | --- | --- |
| Moderation | Ban/unban, kick, timeout/removal, purge, slowmode, staff warnings; live actor/bot hierarchy checks for member moderation | Cases, strikes/expiry, appeals, configurable audit channel, delegation audit records and configurable policies |
| AutoMod | Native keyword, spam, mention and preset filters; rule inspection, enable/disable/remove, role/channel exemptions, allowed words and block explanations | Regex validation, advanced action policies and management UI |
| Server security | Join burst detection; native mention-raid filter | Account-age policies, antinuke audit attribution, action budgets, restoration plans |
| Tickets | Private channels, durable ownership/assignment, filtered queues and closed history, stats/info, saved reasons, rename, permission-preserving moves and retryable closure, staff reopening, retryable guest access with close-time revocation, paged text/JSON history exports with cursors and gzip and persistent category-button panels | Per-option policies/intake forms, automatic archival, attachments and configurable retention |
| Roles | Staff roles/nicknames with live delegation checks, persistent self-service button menus, permission-free join roles and staff reconciliation | Live validation, reaction/toggle policies, mutually exclusive menus, booster/vanity roles, persistent join retries |
| Leveling | Persistent XP, configurable cooldowns/awards, pause/resume, ignored channels, durable latest-message replay guard, leaderboard and permission-free milestone roles with retries/backfill | Rank cards, voice XP, reward policies and broader duplicate history |
| Economy | Durable balances, daily/work/beg, transfers, profiles, professions, leaderboard, staff-managed shops, stock, inventories, gifts, shop receipt history and audited staff grant/remove/set with private history | Seasonal events, richer profession mechanics, item effects and role rewards |
| Embeds | Custom announcements, persistent templates with clone/rename, private previews and staff publication | Variables, scripting, editing previously published copies, webhook branding |
| Welcome | Optional member welcome messages and permission-free join roles | Goodbye, templates and configurable greetings |
| Games | Coin flips, dice and eight ball | Tic-tac-toe, trivia, word games, multiplayer state |
| Giveaways | Durable entry/leave buttons, scheduled and staff-triggered endings, saved draws/rerolls, prize/duration/winner editing, host/description/media editing, private preview, field resets and paginated history, role/level requirements, current membership checks, resumable selection, cancellation and delivery retries | Additional eligibility policies and live validation |
| Community | Native polls with private results/voter pages and confirmed early ending; durable personal reminders with owner-only details, editing and rescheduling; opt-in exact-match autoresponders; persistent recurring channel messages | Starboard, counters, richer responder/timer policies, bump reminders |
| VoiceMaster | Optional temporary rooms, ownership/transfer/claim, rename/limit, access controls and delayed cleanup | Live validation, default settings, generated interface, role grants, bitrate/region and audio |
| Music and TTS | Planned | Voice transport, queue, source adapters, volume/loop, effects, licensed provider support |
| Last.fm and Spotify | Planned | Linking, listening stats, artist searches, leaderboards, metadata adapters |
| Social feeds | Planned | Provider-specific YouTube/Twitch and other feed adapters, deduplication, rate limits |
| Search and utilities | Help, ping, server/member information, avatars/artwork, calculator, timestamps, text tools and persistent timers | Image/search adapters and translation |
| Deleted/edited message tools | Planned, privacy policy undecided | Explicit retention settings and access controls before any message capture |
| Deployment | Windows/Linux Node 22/24 CI, hardened-image isolated runtime checks, signed interactions, durable scheduler, offline setup doctor, install links, container/service templates, twelve-store checksummed backup creation/verification and operations guide | Live Discord and Compose/service host validation, per-server administration |

## Delivery order

1. Make core moderation, persistence, Gateway lifecycle, and native AutoMod reliable.
2. Add server settings, role menus, reminders, giveaways, community tools, and multiplayer games.
3. Add configurable security workflows with bounded actions and recovery evidence.
4. Add voice rooms, music/TTS, and integrations with provider-specific credentials and limits.
5. Verify the installed bot in a private live Discord server before declaring production readiness.

## Verification boundary

The expanded automated suite covers voice, role menus, templates, responders, timers, shops, economy and ticket workflows, including persistence, authorization and failure recovery. Local coverage is measured and CI enforces coverage floors on Node 22 and 24. These tests simulate Discord responses; live-server proof remains unfinished. Published implementation does not establish production readiness. Music, full antinuke, and complete competitor parity remain unfinished.

Starboard now includes public link highlights, staff configuration and bounded receipt recovery. Rich quotes, multiple boards, source removal, retention controls and live Discord acceptance remain unfinished.
