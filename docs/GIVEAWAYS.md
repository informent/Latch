# Giveaway operations

Giveaways and all eligibility features are free and MIT-licensed. The host supplies and distributes prizes. See the [complete command reference](../COMMANDS.md) for every command and option. Run `npm run register` after upgrading.

## Create and configure

Staff need Manage Messages. The bot needs Send Messages and Embed Links in the chosen channel. New giveaways require current human membership and completed screening for entry and winner selection.

```text
/giveaway create prize:"Community prize" minutes:60 winners:2
/giveaway requirements role-add id:GIVEAWAY_ID role:Member
/giveaway requirements levels id:GIVEAWAY_ID min:2 max:10
/giveaway eligibility id:GIVEAWAY_ID user:Member
/giveaway entrants id:GIVEAWAY_ID page:1
/giveaway info id:GIVEAWAY_ID
```

Up to five required role IDs can be stored. A member must hold all of them; everyone is refused. A requirement role can contain permissions or be managed because the bot only checks possession and never grants it. Roles are validated against the current configured guild on addition. `/giveaway requirements role-remove` takes an ID, so deleted references can be removed.

Level bounds are inclusive integers 0-1000; omit max for no upper bound. Latch's committed XP determines level N at N squared times 100 XP. XP may remain readable while message awards are disabled. `/giveaway requirements clear` removes role and level gates while retaining membership/screening checks.

Requirements can change only while a giveaway is draft/open and before its deadline. Existing entries are preserved and rechecked against the final saved requirements during selection. Members can leave while entry remains open even if they no longer qualify. Preview makes no entry/winner changes and reports current eligibility. Entrant lists are private, mention-suppressed and paginated at 20 per page (up to 500 pages).

## Customize and review

Giveaway creation accepts optional `description`, `host`, `image` and `thumbnail` arguments, so the initial message can include all details:

```text
/giveaway create prize:"Concert tickets" minutes:60 winners:2 description:"Two tickets for Saturday" host:Member image:https://example.org/prize.png
/giveaway edit host id:GIVEAWAY_ID host:Member
/giveaway edit description id:GIVEAWAY_ID description:"Updated event details"
/giveaway edit image id:GIVEAWAY_ID url:https://example.org/prize.png
/giveaway edit thumbnail id:GIVEAWAY_ID url:https://example.org/thumb.png
/giveaway preview id:GIVEAWAY_ID
/giveaway edit clear id:GIVEAWAY_ID field:image
/giveaway edit clear id:GIVEAWAY_ID field:all
```

Descriptions allow up to 1500 characters, leaving room for prize, requirements and results within [Discord embed limits](https://docs.discord.com/developers/resources/message#embed-limits). Images and thumbnails accept HTTPS URLs up to 1024 characters on DNS hostnames, with no user credentials, fragment, custom port or IP host. URL syntax is checked locally; the bot never fetches these URLs. Discord renders the media, so the URL must remain accessible and point to supported content. Local validation does not prove an image will load, and signed CDN URLs can expire.

The default displayed host is the creator. Assigning another host checks current human membership in the configured server. Host attribution is informational: staff still need Manage Messages, and the original creator ID remains stored. The host can enter under the same eligibility rules as any other member. Host departure after assignment does not change the record or transfer permissions.

Edits require a draft/open giveaway before its deadline. They preserve entries, winner count, prize, deadline and requirements unless you explicitly edit those existing fields. Presentation is saved before the public message is refreshed. Network failures leave a retry deadline that the scheduler resumes after restart. Draft publication failures preserve the complete appearance for the next attempt.

`clear` accepts `description`, `image`, `thumbnail`, `host` or `all`. Clearing the host returns attribution to the original creator. Clearing all resets only these presentation settings. An empty description is removed with clear rather than an empty edit.

Preview responds privately with the saved embed and no entry buttons. It never publishes a channel message, registers an entry, selects winners or changes disk state. When an update is pending, the saved preview can differ from the public message. `/giveaway info` reports host, description length, media presence and pending updates without truncating long URLs into its metadata reply.

## Browse active and recent giveaways

```text
/giveaway list
/giveaway list page:2
/giveaway list scope:all page:1
```

Lists are private and show five complete prizes and exact IDs per page, newest first. Page counts, total records, state and pending message updates remain visible. Omitted scope shows active jobs, including undelivered results/cancellations. `all` includes retained completed/cancelled jobs from this server. Completed records are pruned seven days after delivery while the scheduler runs; this is recent history rather than a permanent audit archive.

## Entry and selection

Each member has one entry, bound to the saved guild/channel/message IDs. Copied or stale message buttons cannot register entries. New entries check current member identity, screening, bot status, roles and level before the durable write.

At deadline or `/giveaway end`, selection intent is saved and entry closes immediately. The scheduler processes at most one selecting giveaway per 15-second pass and at most 25 member lookups per attempt, including final winner checks. Validated batch progress is saved atomically; restart continues from the saved remaining list. A transient Discord failure pauses selection and saves a retry deadline; a 404 member response excludes a departed entrant. Successful prefix checks are preserved if a later lookup fails.

After every entrant is reviewed, cryptographic randomness chooses candidates uniformly without replacement from the eligible pool. Proposed winners are rechecked against current membership/requirements before the final draw is committed. Newly ineligible candidates are removed and replacements are selected on a later pass. Winners are saved before message publication. A failed publication retries the saved result without redrawing.

Member state can still change after the final check. There is no Discord-wide atomic membership snapshot or external edit lock. Once a draw is committed, delivery retries preserve it even if a member later leaves. Pending selection messages remove entry buttons; failures to refresh the message do not reopen entry.

At 10,000 entrants, a full review needs at least 400 passes (about 100 minutes), plus final checks and any retries. Other selecting giveaways may wait behind it. Staff may request another bounded `/giveaway end` attempt, but the bot never claims to check the entire server instantly.

## Reroll and cancellation

`/giveaway reroll` requires a published finished result, excludes its immediately previous winners and repeats current eligibility checks. Request IDs are saved before selection begins. Replaying the latest request resumes/reuses its saved selection/result; older superseded requests are rejected. No remaining replacement pool preserves the current result and reports failure. If replacement entrants exist but are all ineligible, the published replacement result contains no winners.

`/giveaway cancel` can cancel an open/draft/selecting job. It clears selection progress, preserves entry records and keeps public message updates pending until delivery succeeds. No additional member checks are performed for a cancelled job.

## Storage, migration and limits

Community jobs share `COMMUNITY_STORE_PATH` (default `./data/community.json`) with reminders. Successful mutations now write version 3; versions 1 and 2 load without modification. Existing legacy giveaways without saved requirements retain their original entry/draw behavior. Use `/giveaway requirements clear` on an active legacy job to adopt current membership checks without role/level gates.

Back up all twelve stores together while the bot is stopped. Releases before 0.29.0 reject community version 3; restore a compatible complete backup to roll back. No additional store is introduced. Selection state stores remaining, eligible and previous-winner exclusion IDs plus a start time; no interaction tokens or member message content are captured.

Limits remain 20 active giveaways per server, 10,000 entrants per giveaway, 1-20 winners, 200 prize characters, 1-43,200 minutes, 5,000 total retained community jobs and 32 MiB. Completed/cancelled records are pruned seven days after delivery. Run one process per store. Failed writes preserve committed entries, requirements, presentation and selection progress; readers see the previous committed state until atomic replacement succeeds.

## Verification boundary

Tests cover temporary files, simulated Discord membership/API calls, signed local HTTP, current requirements, selection bounds, restart checkpoints, corrupt schemas, migration failures and lost result replies. Live Discord permissions, rate limits, transport and real prize distribution remain unverified. Host/description/image editing is implemented with the limits below. Additional eligibility policies remain planned.
