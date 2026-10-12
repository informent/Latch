[Complete Latch command reference](../COMMANDS.md): every registered command and option, generated and checked in CI.

# Command coverage

Goal: independently implement the publicly documented capabilities of Bleed and Greed, plus Latch additions, as free MIT-licensed source. **Full parity has not been achieved.** This is a partial inventory checked on 2026-10-11, not a complete competitor command count.

Latch currently uses slash commands. Competitor prefix commands, aliases, argument syntax, permission policies, and nested settings are separate requirements. A similar slash command is not proof of identical behavior. No placeholders count as implemented commands. Source implementation also does not establish live Discord validation.

## Sources and inventory limits

- [Bleed command directory](https://bleed.bot/commands): the public frontend requires JavaScript; its complete command data was not obtained.
- [Bleed documentation index](https://docs.bleed.bot/llms.txt): accessible index; individual documentation pages below were read directly.
- [Current Greed utility documentation](https://greed.best/docs/miscellaneous/utility): accessible on 2026-10-11. It outlines profile, expression and utility categories. Its interactive [command directory](https://greed.best/commands) has not been fully inventoried, so exact command parity is still unverified.
- [Older Greed introduction](https://greed.sh/docs/introduction/) and [moderation](https://www.greed.sh/docs/moderation/): publicly indexed documentation was available through search. Direct requests returned HTTP 403, so freshness and completeness remain unverified.
- [Greed command directory](https://greed.sh/commands): HTTP 403. A help export or accessible official command list is required before asserting complete coverage.

Only command names and independently authored implementation notes are recorded here. Source links establish where requirements came from; they do not imply endorsement or affiliation.

## Core behaviors present, with different syntax or scope

| Documented command | Latch | Remaining difference |
| --- | --- | --- |
| ban, kick, timeout, untimeout | `/moderation` actions | Slash syntax; no competitor-specific message customization |
| unban | `/moderation unban user-id` | Slash syntax; requires Ban Members |
| warn | `/moderation warn` | Persistent warning only; no strike punishment policy |
| Role inspection | `/utility role` | Private metadata and raw permission bits; does not calculate effective channel/member access |
| Role/nickname delegation | `/roles` actions | Live actor/bot hierarchy and grant-permission checks; conservative equal-position and protected-target rules |
| ping, help | `/utility ping`, `/utility help` | Slash syntax |
| balance, daily, work, beg, professions | `/economy` actions and profession subcommands | Latch reward amounts/cooldowns, equal-rate professions and work-based ranks; competitor mechanics remain different |
| transfer | `/economy pay` | Different name and syntax |
| level role rewards | `/levelreward add`, `remove`, `list`, `info`, `enable`, `disable`, `preview`, `reconcile` | Accumulating permission-free milestones, durable retries and existing-XP backfill; no role removal or exclusive policy |
| leveling settings | `/levelconfig show`, `tune`, `reset`, `ignore`, `unignore`, `ignored`, `enable`, `disable` | Free per-guild settings, exact channel ignores and pause/resume; rewards/rank cards/voice XP remain unfinished |
| leaderboards | `/leaderboard coins`, `/leaderboard levels` | Only Latch coin/XP records |
| giveaway start | `/giveaway create` | Current channel; optional description, host and media; Latch limits |
| giveaway end, list | `/giveaway end`, `/giveaway list` | Latch IDs; optional retained history lasts seven days after delivery |
| giveaway cancel | `/giveaway cancel` | Ends entries without drawing; competitor deletion behavior differs |
| tickets close | `/ticket close` | Private tickets with persistent category panels and staff reopening; per-option claim policies remain missing |
| tickets list | `/ticket list` | State/history, owner, handler and assignment filters for staff; members browse only their own active/closed records; ten per page |
| tickets stats | `/ticket stats` | Staff-only lifetime counts; no time-window or per-staff workload reporting |
| tickets claim, unclaim | `/ticket claim`, `/ticket unclaim` | Configured support role or administrator; owner cannot claim own ticket; any support staff may unclaim |
| tickets move, reason | `/ticket move`, `/ticket reason` | Open stored tickets only; staff checks; explicit overwrite preservation/read-back; reason visible to owner and support |
| ticket information | `/ticket info` | Stored metadata only; owner or support staff; recent-message exports through `/ticket transcript` |
| ticket transcripts | `/ticket transcript` | Private text/JSON snapshots of up to 1000 messages with history cursors, gzip and current requester/bot read checks; automatic archives and retention remain unfinished |
| tickets guests | `/ticket guest add`, `/ticket guest remove`, `/ticket guest list` | Staff-only, 20 screened human guests, persistent intent and permission verification; closure revokes, reopening does not reinvite |
| tickets rename | `/ticket rename` | Open Latch tickets only; staff-only; no arbitrary text-channel rename |
| giveaway edit prize, duration, winners, host, description, image, thumbnail | `/giveaway edit` subcommands | Staff Manage Messages; edits before deadline; human host attribution and bounded HTTPS media; lifetime limited to 30 days |
| giveaway reroll | `/giveaway reroll` | Finished giveaways only; excludes immediately previous winners; same interaction ID reuses saved result |
| voicemaster setup | `/voice setup` | Configures existing lobby/category; no generated lobby or interface panel |
| voicemaster rename, limit | `/voice rename`, `/voice limit` | Owner must be in their managed room; slash syntax |
| voicemaster lock, unlock, ghost, unghost | `/voice` actions | Everyone overwrite controls; member/role overrides and administrators may retain access |
| voicemaster permit | `/voice permit` | Member access only; no role targets |
| voicemaster claim, transfer | `/voice claim`, `/voice transfer` | One owned room per member; current presence required; no automatic role assignment |
| Button role assignment/removal | `/rolemenu` and member buttons | Explicit Get/Remove actions; permission-free unmanaged roles only; no emoji/toggle policies |
| Join roles | `/autorole add`, `/autorole remove`, `/autorole list`, `/autorole apply` | Human joins only; permission-free roles; pending screening and failed joins require staff apply |

Sources: [Greed introduction](https://greed.sh/docs/introduction/), [Greed moderation](https://www.greed.sh/docs/moderation/), [Bleed giveaways](https://docs.bleed.bot/miscellaneous/giveaway), [Bleed tickets](https://docs.bleed.bot/configuration/tickets/commands), [Bleed moderation](https://docs.bleed.bot/security/moderation).

## Latch information utilities added in 0.26.0

Thirteen additional command paths provide member banners, server artwork, boost status, paginated roles/emojis/stickers, individual expression inspection, snowflake decoding, timestamps, hex colors and bounded arithmetic. See the [utility guide](UTILITIES.md). These are working read-only tools; they do not implement competitor expression creation/deletion, channel monitoring, message history or AI features.

## Documented commands still missing

These are concrete gaps from the sources above; the list will expand as further official pages are inventoried.

- Moderation: setup, setupmute, jail, tempban, softban, hardban, bind staff, bind staff list, strike add/remove/clear, toggle-strikes. Also missing strike limits, expiry and punishment configuration.
- Giveaways: exact competitor syntax and aliases remain different. Publicly documented host/description/media edits and role/level gates now have independent Latch implementations. Cancellation retains the message; retained history is limited to seven days after delivery.
- Tickets: resend, form, advanced options, blacklist, profiles, profile, delete, transcript, allow, allow list, deny, trainee, trainee grant/revoke/list. Existing list/stats/claim/rename commands still lack competitor-specific policies and reporting options.
- [VoiceMaster](https://docs.bleed.bot/configuration/voicemaster): default settings, generated setup channels/interface buttons, role, music, bitrate/region controls and role-based access. Core room lifecycle is implemented, but live operation and parity remain unverified. See [voice guide](VOICE.md).
- Music: play, queue, skip, volume, loop. No audio transport or provider integration exists yet.
- Last.fm: fm, recent, topartists, who-knows. No Last.fm integration exists yet.
- Economy: begging and professions now exist with Latch-specific rewards, cooldowns and work progression. Competitor-specific profession policies and broader economy mechanics remain unverified. See the [economy guide](ECONOMY.md).
- Prefix support: configurable prefix, prefix set, cmds alias, command aliases and competitor command syntax.

## Suites awaiting a detailed inventory

Ticket panels now have eight `/ticketpanel` paths, durable publication retries, saved server/channel/message bindings and up to five topic/category buttons. `/ticket reopen` supports staff recovery with persisted intent and permission read-back checks. Intake forms, full-history transcripts and competitor-specific panel policies remain missing; see the [panel guide](TICKET-PANELS.md).

Native AutoMod now adds preset wordsets, private rule inspection, role/channel exemptions, allowed-word replacement and custom blocking explanations. It manages only rules created by this bot with the Latch prefix. See the [AutoMod guide](AUTOMOD.md).

The new `/shop` suite adds 11 paths for staff catalog management, purchases, inventories, gifts, consumption and private receipts. These virtual items have no Discord role or permission effects. See the [shop guide](SHOP.md); this is independently implemented functionality and does not establish competitor shop parity.

Recurring messages now have ten `/timer` paths with durable deadlines, private previews and bounded scheduled attempts. Moving channels disables a timer for review; rescheduling changes only the next attempt. Activity thresholds, embed integration and calendar scheduling remain absent. See the [timer guide](TIMERS.md).

Autoresponders now have eight `/responder` paths with persistent, disabled-by-default channel rules and exact case-insensitive matching. Regex, substring matching, embed replies, variables and broader competitor policies remain absent. See the [responder guide](RESPONDERS.md).

Saved embeds now have nine `/template` command paths with durable storage, cloning, renaming, private previews and staff publication; see the [template guide](TEMPLATES.md). This is partial embed functionality: scripting, variables and webhook branding remain absent.

Antinuke, antiraid, reaction/booster/vanity roles, additional button-role policies, starboard, broader level reward policies, bump reminders, reaction triggers, logging, counters, webhook utilities, Spotify, social notifications, Fortnite, roleplay, image manipulation, and the remaining information/fun commands. Native AutoMod and join-burst alerts cover portions of filtering and reporting only. The current button/autorole suite is restricted to permission-free roles and lacks full competitor policies; see [role-menu guide](ROLE-MENUS.md).

## Latch additions already implemented

Persistent public-channel reminders with private list/info/cancel, owner-only text editing and rescheduling, signed interaction handling, native Discord polls, offline configuration diagnostics, permission-based invite generation, token-file configuration, deployment examples, bounded REST retries, and reconnect recovery. `/utility user` and `/utility avatar` provide server member details and Discord CDN avatars. These additions do not offset missing competitor commands when evaluating parity.

## Completion requirements

1. Obtain complete official command inventories and record dated sources.
2. Map every command, subcommand, alias, setting and permission rule separately.
3. Implement persistent behavior and recovery for each applicable command.
4. Verify authorization, failure behavior, restart recovery, and live Discord operation.
5. Report exact remaining gaps; claim parity only when none remain.

Giveaways add six paths for role/level requirements, clearing requirements, current eligibility previews and private entrant pages. New giveaways use durable batched selection with current member checks and final candidate rechecks. Older giveaways retain their original behavior until requirements are configured; see [giveaway operations](GIVEAWAYS.md).

## Giveaway presentation added in 0.29.0

Six additional paths add host/description/image/thumbnail editing, presentation resets and private saved-embed previews. Creation accepts optional presentation settings, and list now supports five-entry pages with complete prizes and retained history. The [Bleed giveaway guide](https://docs.bleed.bot/miscellaneous/giveaway) was checked again on 2026-10-11 for these documented capabilities. This implements the named behaviors with Latch syntax and limits; it does not prove full competitor parity or live Discord operation.
