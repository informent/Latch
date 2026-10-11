# Native polls

OpenDesk uses Discord native polls. Voting and vote records stay in Discord; OpenDesk does not store poll or voter history. The existing `/poll` command creates a poll with 2-10 choices, a question up to 300 characters, answers up to 55 characters, duration 1-768 hours and optional multiple selection.

## Staff management

| Command | Purpose |
| --- | --- |
| `/pollmanage info message:...` | Privately show the poll question, actual answer IDs, expiry, selection mode and available vote counts |
| `/pollmanage voters message:... answer:...` | Privately fetch up to 25 voters for one answer |
| `/pollmanage voters message:... answer:... after:...` | Fetch the next page using the prior page's user-ID cursor |
| `/pollmanage end message:...` | End an OpenDesk poll early and confirm the result through a message fetch |

All management commands require Manage Messages (or Administrator) in the invoking interaction. They operate only in the current server text channel. Enable Discord Developer Mode and copy the poll message ID, then invoke the command in that same channel. No destination channel selector is accepted. The fetched channel ID, configured guild, text type, message ID, message channel and author must match. Only polls authored by this bot can be managed through these commands.

## Results and voter pages

Discord can omit results. Info labels missing counts unavailable and each answer count unknown; it does not treat missing results as zero votes. Available results are provisional until Discord marks them finalized. A missing answer within a valid counts array means zero votes. Multiple-choice counts are votes per answer and must not be summed as unique participants. Answer IDs come from Discord and need not start at one or be sequential.

Voter pages fetch at most 25 users. A full page includes the largest returned user ID as the next cursor. A shorter page ends that page set; an empty page can occur even after a full final page. Votes can change while paging an open poll, so pages are not a consistent historical snapshot. Responses are private and suppress all mention pings. Voter IDs are displayed transiently and are not persisted or logged by this feature.

## Ending and retries

Ending sends Discord's expire request and then fetches the message. Success requires matching message identity and either an elapsed expiry or finalized results. A poll can be ended while final counting is still pending. Already elapsed or finalized polls avoid another expire request. Concurrent management operations for the same channel/message serialize within the running bot process; locks are released even after failures.

If an update or response fails, inspect the poll and retry. Discord may have ended it before OpenDesk received an error; a fresh fetch lets a retry recognize that state. There is no cross-process lock or local poll state, so run one process for a configured bot. Other apps' polls, poll editing after publication, voting on behalf of members and durable poll history are not supported.

## Upgrade and verification

Run `npm run register` after upgrading to v0.21.0. No new store or schema migration is added. Automated tests cover authorization, identity/guild/channel boundaries, actual answer IDs, unavailable/provisional/finalized counts, cursor validation, bounded pages, concurrent ending, ignored writes, response loss, readback rejection and signed HTTP runtime integration. Live Discord validation remains unfinished.

API behavior and result-counting rules follow the [official Discord poll documentation](https://docs.discord.com/developers/resources/poll).
