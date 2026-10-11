# Ticket management

OpenDesk creates private ordinary text channels with an everyone View Channel deny, owner chat access, explicit bot management access and optional configured support-role access. One active ticket per owner is allowed. Conversation messages remain in Discord; the JSON store contains ticket metadata, not transcripts.

## Information and reasons

`/ticket info channel:...` privately shows the owner, state, handler, creation/closure times and saved reason. It defaults to the invoking channel. Only that ticket's owner or support staff can inspect it; closed records can also be inspected. Information comes from the store and does not prove that the Discord channel still exists or has the expected permissions.

`/ticket reason reason:... channel:...` saves a nonempty reason of up to 400 characters on an open ticket. Only the configured support role or Administrator may set it. Reasons are visible to the ticket owner and support staff through info, so do not use them for confidential internal staff notes. Replacing a reason overwrites the old value without keeping a history. Previously saved ticket records without a reason remain supported. Older bot versions cannot read records containing this new optional field; restore a matching backup when rolling back.

## Category moves

`/ticket move category:... channel:...` moves an open stored ticket as support staff. Both the source text channel and destination category must exist in the configured guild. Moving to the existing category returns without changing it.

The channel must retain an explicit everyone View Channel deny without a conflicting allow. The move submits the current complete channel permission-overwrite snapshot alongside the destination parent, then reads back the channel to verify both the destination and exact overwrites. Category overwrites are not copied. Discord requires bot Manage Channels and, when submitting overwrites, Manage Roles. See [Discord channel modification](https://docs.discord.com/developers/resources/channel#modify-channel).

An everyone deny alone does not prove complete privacy: other role/member allows and Administrator can still grant access. This operation preserves existing explicit policy instead of evaluating every member's effective access. Review any manually added overwrites yourself.

Bot operations on the same ticket use a channel lock. Manual Discord edits and other applications can still race the read/update/read-back sequence. A move can succeed even when confirmation fails; inspect the destination and permission overwrites before retrying. No automatic move retry or rollback exists. Deleted categories, category capacity, missing permissions and API errors can prevent the action.

## Existing controls and operating limits

`create`, `close`, `list`, `stats`, `claim`, `unclaim` and `rename` retain their existing policies. Members list their own active tickets; support staff list all. Stats, assignment and rename require support staff. The owner or support staff may close. Closing enters durable `closing` state before revoking owner write access and renaming the channel; retry close after failure to finish it. Closing leaves channel history readable and does not delete the channel. It does not manage arbitrary guest/member or role overwrites manually added in Discord.

Run `npm run register` after upgrading. Stop the bot and back up all stores together. Reasons and reopening state live in the existing `tickets.json`; persistent panels add `ticket-panels.json` to the complete backup set. Private command confirmations suppress mentions. Run one bot process per store set.

Dedicated regression tests cover info/reason/move and the panel-to-create-to-close-to-reopen flow. Live Discord validation remains outstanding. Intake forms, advanced per-option policies, transcripts, guest management and full competitor parity remain unfinished.


## Staff reopening

`/ticket reopen channel:...` requires the support role or Administrator; ticket ownership alone does not authorize it. The channel must be a stored closed/reopening ticket in the configured guild with explicit everyone View Channel denial. Its owner must still be a current human member who completed screening. Another active ticket for that owner blocks reopening.

Reopening serializes with creation under the owner lock and with other operations under the channel lock. It saves `reopening` intent before restoring owner chat access, preserves other owner permission bits, renames the channel and reads back guild/type/name, everyone denial and owner chat bits. Only successful confirmation commits the open status, clearing the previous close timestamp and handler assignment. The creation time and reason remain unchanged; this is not a historical event log.

A failure can leave the channel partially restored while its saved state remains `reopening`. Inspect permissions and retry reopen as staff to finish. Close is refused until reopening completes. Earlier releases reject the new transient status; stop the bot and restore a compatible complete backup before rolling back. Other clients can race permission updates; read-back checks do not establish every member's effective access. Administrator and other manually added allows can still grant visibility.

## Self-service panels

See the [panel guide](TICKET-PANELS.md) for persistent topic buttons and category routing. Staff create drafts before publication; member clicks receive private links to their ticket. Panel topics are saved as ticket reasons. The configured support role applies to every topic. Setting it to the everyone role is rejected before startup or channel creation.

## Confirmed closing and renaming

Version 0.19.1 validates the stored channel ID, configured guild, text-channel type, unique bounded overwrites and explicit everyone View Channel denial before closing. Invalid privacy protection must be repaired by staff first; OpenDesk does not silently rewrite everyone permissions. Closing preserves unrelated owner permission bits and explicitly allows View Channel/Read Message History while denying Send Messages.

After saving closing intent, OpenDesk applies the owner overwrite, renames the channel and fetches it again. Only the expected name and complete unchanged overwrite set (apart from the intended owner edit) permit committing closed status. A failed update, ignored write, changed overwrite, readback outage or failed final save leaves closing intent. Retry `/ticket close` as the owner or staff after inspection, including after restarting. The ticket continues to block duplicate creation until closing finishes. Already closed records return their saved result and do not repair later Discord edits automatically.

Staff renaming also requires private channel validation and confirms the new name and unchanged overwrites. A failed confirmation can leave the channel renamed; inspect it before retrying. Permission snapshots verify explicit overwrites at one moment, not effective access for every member. Administrator, inherited roles, manually added guests, threads and external permission changes require staff review. Live Discord validation remains outstanding.
