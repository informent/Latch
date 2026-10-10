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

Run `npm run register` after upgrading. Stop the bot and back up all stores together. Reasons live in the existing `tickets.json`; no additional store is introduced. Private command confirmations suppress mentions. Run one bot process per store set.

Existing CI does not exercise new info/reason/move workflows. Live Discord validation remains outstanding. Panels, per-option policies, reopen, transcripts, guest management and full competitor parity remain unfinished.
