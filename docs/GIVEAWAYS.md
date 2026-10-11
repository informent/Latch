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

Community jobs share `COMMUNITY_STORE_PATH` (default `./data/community.json`) with reminders. Successful mutations now write version 2; version 1 loads without modification. Existing legacy giveaways without saved requirements retain their original entry/draw behavior. Use `/giveaway requirements clear` on an active legacy job to adopt current membership checks without role/level gates.

Back up all twelve stores together while the bot is stopped. Older releases reject community version 2; restore a compatible complete backup to roll back. No additional store is introduced. Selection state stores remaining, eligible and previous-winner exclusion IDs plus a start time; no interaction tokens or member message content are captured.

Limits remain 20 active giveaways per server, 10,000 entrants per giveaway, 1-20 winners, 200 prize characters, 1-43,200 minutes, 5,000 total retained community jobs and 32 MiB. Completed/cancelled records are pruned seven days after delivery. Run one process per store. Failed writes preserve committed entries, requirements and selection progress; readers see the previous committed state until atomic replacement succeeds.

## Verification boundary

Tests cover temporary files, simulated Discord membership/API calls, signed local HTTP, current requirements, selection bounds, restart checkpoints, corrupt schemas, migration failures and lost result replies. Live Discord permissions, rate limits, transport and real prize distribution remain unverified. Host/description/image editing and additional eligibility policies remain planned.
