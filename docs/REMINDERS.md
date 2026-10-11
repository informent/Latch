# Reminders

Reminders are free, self-hosted and saved in the existing community store. Delivery posts publicly in the channel where the reminder was created. Use a private channel for private content. Command acknowledgments, lists, details and edits are private and suppress mentions.

| Command | Purpose |
| --- | --- |
| `/reminder create minutes:20 text:...` | Save a reminder for this channel; requires Send Messages here |
| `/reminder list` | Privately list up to ten pending reminders you own |
| `/reminder info id:...` | Inspect your saved text, state, channel, due time, attempts and retry time |
| `/reminder edit id:... text:...` | Replace your future reminder text |
| `/reminder reschedule id:... minutes:30` | Move your future reminder to 30 minutes after the operation runs |
| `/reminder cancel id:...` | Cancel your pending reminder |

## Limits and ownership

Use 1-43200 whole minutes (up to 30 days) and 1-500 characters of nonblank text. At most ten pending reminders per member and 5000 total community jobs are retained. Only the owner may inspect or edit a reminder, including administrators. IDs are scoped to the configured guild and reminder kind; a giveaway ID cannot be used here. Edited jobs retain the original channel, owner, identity and creation time.

Editing and rescheduling require scheduled state, a future due time and no delivery attempts or retry timestamp. Due, sent, cancelled or retrying reminders are locked against edits. Retry status means Discord may already have received a message even if the response or final save failed; changing text during that uncertainty would make retries ambiguous. Use info to inspect the job and cancel where appropriate. Cancellation cannot retract a message already sent.

## Persistence and delivery

Create, edit, reschedule, cancel and scheduler work serialize in one service queue. Time is evaluated when the queued edit executes. Updated state is atomically saved before confirmation. Failed saves preserve the original file and committed reads; retry the command after fixing storage. Concurrent text/time edits preserve both fields; edits queued behind delivery cannot alter its result.

The scheduler checks approximately every 15 seconds; downtime, rate limits and retries can delay delivery. Delivery allows a mention only for the owner; everyone, role and other user mentions in the text do not ping. Channel visibility still determines who can read it. Nonce-based retry protection is bounded by Discord behavior and does not promise exactly-once delivery indefinitely. External permission changes can prevent publication.

Completed and cancelled records are retained for seven days before scheduler pruning. Info can inspect those retained records; list shows pending jobs. There is no permanent reminder history, channel-moving command, recurring personal reminder or cross-guild scheduling.

## Upgrade and verification

Run `npm run register` after upgrading to v0.20.0. Stop the bot and back up all twelve stores together. This feature uses community format version 2 from v0.19.0 and introduces no new schema. Older releases without these commands cannot manage the new actions, and releases before v0.19.0 reject version 2 stores.

Automated tests cover owner/guild/kind boundaries, validation, failed saves, restart persistence, private responses, updated delivery times/text, in-flight delivery and signed HTTP requests. Live Discord validation remains unfinished.
