# OpenDesk feature roadmap

Goal: a free, open-source community bot spanning the feature areas advertised by [Bleed](https://bleed.bot/commands) and [Greed](https://greed.sh/docs/introduction/), with transparent configuration, durable data, and documented operating limits. This is a feature-area comparison, not a claim of command-for-command parity. Inventory reviewed October 9, 2026.

All OpenDesk features are intended to be available without subscriptions or premium gates. Self-hosting still needs a machine and network access. External providers can require their own credentials, impose limits, or charge fees; integrations must document those conditions.

| Area | Current implementation | Remaining work |
| --- | --- | --- |
| Moderation | Ban, kick, timeout/removal, purge, slowmode, staff warnings | Unban, cases, strikes/expiry, appeals, configurable audit channel, actor hierarchy checks |
| AutoMod | Native keyword, spam and mention filters; enable/disable/remove | Presets, exclusions through commands, regex validation, management UI |
| Server security | Join burst detection; native mention-raid filter | Account-age policies, antinuke audit attribution, action budgets, restoration plans |
| Tickets | Private channels, durable ownership and retryable closure | Panels, categories, assignment, reopen, configurable retention |
| Roles | Staff role assignment/removal and nickname changes | Autoroles, reaction/button roles, booster roles, menus |
| Leveling | Persistent XP, cooldowns and leaderboard | Rewards, ignored channels, tuning, rank cards, voice XP |
| Economy | Durable balances, daily/work, transfers and leaderboard | Shops, professions, inventory, seasonal events, staff controls |
| Embeds | Custom announcements in the invoking channel | Saved templates, variables, preview/edit workflow |
| Welcome | Optional member welcome messages | Goodbye, templates, autoroles, configurable greetings |
| Games | Coin flips, dice and eight ball | Tic-tac-toe, trivia, word games, multiplayer state |
| Giveaways | Durable entry/leave buttons, scheduled and staff-triggered endings, saved cryptographic draws, cancellation, delivery retries | Role eligibility, departure checks, rerolls |
| Community | Native polls; durable personal channel reminders with list/cancel | Starboard, counters, autoresponders, bump reminders |
| VoiceMaster | Planned | Temporary rooms, ownership, permissions, cleanup |
| Music and TTS | Planned | Voice transport, queue, source adapters, volume/loop, effects, licensed provider support |
| Last.fm and Spotify | Planned | Linking, listening stats, artist searches, leaderboards, metadata adapters |
| Social feeds | Planned | Provider-specific YouTube/Twitch and other feed adapters, deduplication, rate limits |
| Search and utilities | Help, ping, server information | User/avatar info, image/search adapters, timers and translation |
| Deleted/edited message tools | Planned, privacy policy undecided | Explicit retention settings and access controls before any message capture |
| Deployment | Node 22/24 CI, self-hosted source, signed interactions, durable community scheduler | Container/service instructions, setup validation, per-server settings |

## Delivery order

1. Make core moderation, persistence, Gateway lifecycle, and native AutoMod reliable.
2. Add server settings, role menus, reminders, giveaways, community tools, and multiplayer games.
3. Add configurable security workflows with bounded actions and recovery evidence.
4. Add voice rooms, music/TTS, and integrations with provider-specific credentials and limits.
5. Verify the installed bot in a private live Discord server before declaring production readiness.

## Verification boundary

Implemented features have local automated tests and GitHub CI coverage. There is currently no live-server proof. A feature advances from planned to implemented only when its code, permission checks, persistence where needed, documentation, and regression tests are published. Music, full antinuke, and complete competitor parity remain unfinished.
