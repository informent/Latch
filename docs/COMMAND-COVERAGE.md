# Command coverage

Goal: independently implement the publicly documented capabilities of Bleed and Greed, plus OpenDesk additions, as free MIT-licensed source. **Full parity has not been achieved.** This is a partial inventory checked on 2026-10-10, not a complete competitor command count.

OpenDesk currently uses slash commands. Competitor prefix commands, aliases, argument syntax, permission policies, and nested settings are separate requirements. A similar slash command is not proof of identical behavior. No placeholders count as implemented commands. Source implementation also does not establish live Discord validation.

## Sources and inventory limits

- [Bleed command directory](https://bleed.bot/commands): the public frontend requires JavaScript; its complete command data was not obtained.
- [Bleed documentation index](https://docs.bleed.bot/llms.txt): accessible index; individual documentation pages below were read directly.
- [Greed introduction](https://greed.sh/docs/introduction/) and [moderation](https://www.greed.sh/docs/moderation/): publicly indexed documentation was available through search. Direct requests returned HTTP 403, so freshness and completeness remain unverified.
- [Greed command directory](https://greed.sh/commands): HTTP 403. A help export or accessible official command list is required before asserting complete coverage.

Only command names and independently authored implementation notes are recorded here. Source links establish where requirements came from; they do not imply endorsement or affiliation.

## Core behaviors present, with different syntax or scope

| Documented command | OpenDesk | Remaining difference |
| --- | --- | --- |
| ban, kick, timeout, untimeout | `/moderation` actions | Slash syntax; no competitor-specific message customization |
| unban | `/moderation unban user-id` | Slash syntax; requires Ban Members |
| warn | `/moderation warn` | Persistent warning only; no strike punishment policy |
| ping, help | `/utility ping`, `/utility help` | Slash syntax |
| balance, daily, work | `/economy` actions | OpenDesk reward amounts and cooldowns |
| transfer | `/economy pay` | Different name and syntax |
| leaderboards | `/leaderboard coins`, `/leaderboard levels` | Only OpenDesk coin/XP records |
| giveaway start | `/giveaway create` | Current channel; limited options |
| giveaway end, list | `/giveaway end`, `/giveaway list` | OpenDesk IDs instead of message links |
| giveaway cancel | `/giveaway cancel` | Ends entries without drawing; competitor deletion behavior differs |
| tickets close | `/ticket close` | Basic private tickets; no panels or per-option claim policies |
| tickets list | `/ticket list` | Staff see all active tickets; others see only their own; ten per page |
| tickets stats | `/ticket stats` | Staff-only lifetime counts; no time-window or per-staff workload reporting |
| tickets claim, unclaim | `/ticket claim`, `/ticket unclaim` | Configured support role or administrator; owner cannot claim own ticket; any support staff may unclaim |
| tickets rename | `/ticket rename` | Open OpenDesk tickets only; staff-only; no arbitrary text-channel rename |
| giveaway edit prize, duration, winners | `/giveaway edit` subcommands | Staff Manage Messages; edits before deadline only; lifetime limited to 30 days |
| giveaway reroll | `/giveaway reroll` | Finished giveaways only; excludes immediately previous winners; same interaction ID reuses saved result |
| voicemaster setup | `/voice setup` | Configures existing lobby/category; no generated lobby or interface panel |
| voicemaster rename, limit | `/voice rename`, `/voice limit` | Owner must be in their managed room; slash syntax |
| voicemaster lock, unlock, ghost, unghost | `/voice` actions | Everyone overwrite controls; member/role overrides and administrators may retain access |
| voicemaster permit | `/voice permit` | Member access only; no role targets |
| voicemaster claim, transfer | `/voice claim`, `/voice transfer` | One owned room per member; current presence required; no automatic role assignment |
| Button role assignment/removal | `/rolemenu` and member buttons | Explicit Get/Remove actions; permission-free unmanaged roles only; no emoji/toggle policies |
| Join roles | `/autorole add`, `/autorole remove`, `/autorole list`, `/autorole apply` | Human joins only; permission-free roles; pending screening and failed joins require staff apply |

Sources: [Greed introduction](https://greed.sh/docs/introduction/), [Greed moderation](https://www.greed.sh/docs/moderation/), [Bleed giveaways](https://docs.bleed.bot/miscellaneous/giveaway), [Bleed tickets](https://docs.bleed.bot/configuration/tickets/commands), [Bleed moderation](https://docs.bleed.bot/security/moderation).

## Documented commands still missing

These are concrete gaps from the sources above; the list will expand as further official pages are inventoried.

- Moderation: setup, setupmute, jail, tempban, softban, hardban, bind staff, bind staff list, strike add/remove/clear, toggle-strikes. Also missing strike limits, expiry and punishment configuration.
- Giveaways: edit host, description, thumbnail, image, requiredroles, minlevel, maxlevel.
- Tickets: resend, panel, form, options, blacklist, profiles, profile, delete, reopen, move, transcript, allow, allow list, deny, reason, trainee, trainee grant/revoke/list. Existing list/stats/claim/rename commands still lack competitor-specific policies and reporting options.
- [VoiceMaster](https://docs.bleed.bot/configuration/voicemaster): default settings, generated setup channels/interface buttons, role, music, bitrate/region controls and role-based access. Core room lifecycle is implemented, but live operation and parity remain unverified. See [voice guide](VOICE.md).
- Music: play, queue, skip, volume, loop. No audio transport or provider integration exists yet.
- Last.fm: fm, recent, topartists, who-knows. No Last.fm integration exists yet.
- Economy: beg, professions. No profession progression exists yet.
- Prefix support: configurable prefix, prefix set, cmds alias, command aliases and competitor command syntax.

## Suites awaiting a detailed inventory

Recurring messages now have eight `/timer` paths with durable deadlines, private previews and bounded scheduled attempts. Activity thresholds, embed integration and advanced scheduling remain absent. See the [timer guide](TIMERS.md).

Autoresponders now have eight `/responder` paths with persistent, disabled-by-default channel rules and exact case-insensitive matching. Regex, substring matching, embed replies, variables and broader competitor policies remain absent. See the [responder guide](RESPONDERS.md).

Saved embeds now have seven `/template` command paths with durable storage, private previews and staff publication; see the [template guide](TEMPLATES.md). This is partial embed functionality: scripting, variables and webhook branding remain absent.

Antinuke, antiraid, reaction/booster/vanity roles, additional button-role policies, starboard, level rewards, bump reminders, reaction triggers, logging, counters, webhook utilities, Spotify, social notifications, Fortnite, roleplay, image manipulation, and the remaining information/fun commands. Native AutoMod and join-burst alerts cover portions of filtering and reporting only. The current button/autorole suite is restricted to permission-free roles and lacks full competitor policies; see [role-menu guide](ROLE-MENUS.md).

## OpenDesk additions already implemented

Persistent public-channel reminders with private list/cancel, signed interaction handling, native Discord polls, offline configuration diagnostics, permission-based invite generation, token-file configuration, deployment examples, bounded REST retries, and reconnect recovery. `/utility user` and `/utility avatar` provide server member details and Discord CDN avatars. These additions do not offset missing competitor commands when evaluating parity.

## Completion requirements

1. Obtain complete official command inventories and record dated sources.
2. Map every command, subcommand, alias, setting and permission rule separately.
3. Implement persistent behavior and recovery for each applicable command.
4. Verify authorization, failure behavior, restart recovery, and live Discord operation.
5. Report exact remaining gaps; claim parity only when none remain.
