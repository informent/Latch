# Ticket guests

Support staff can invite up to 20 current human members to an open ticket. Guests need completed membership screening. The owner and bot cannot be guests; members with the configured support role already have staff access.

```text
/ticket guest add user:@member
/ticket guest list
/ticket guest remove user:@member
```

Each command accepts an optional ticket channel; it defaults to the current channel. Replies are private and do not send mention notifications. Guest status does not authorize ticket management, ticket metadata inspection or closure. Owners cannot invite guests themselves.

## Access and recovery

Adding grants View Channel, Send Messages and Read Message History through a member overwrite. Other permission bits and other overwrites are preserved. The bot verifies the complete overwrite set after every write. Saved guest lists include intended grants: a failed or ambiguous Discord request can leave a saved guest without confirmed access. Inspect permissions and retry the same add command to finish. Lists are not an effective-permissions audit.

Removing strips those three allow bits and denies them, then forgets the guest only after readback and durable persistence succeed. It can remove a saved guest who has left the server. Unsaved manual overwrites are never removed by this command. Prior chat permission settings are not restored; guest management owns these three bits while preserving other bits.

Closing persists the closing state, makes the owner read-only, denies all saved guests those three permissions, verifies channel name and every overwrite, then clears the guest list and marks the ticket closed. Failures leave a retryable closing record, including saved guests. Retry close after inspecting the channel. Reopening restores owner access and does not reinvite guests; staff can add them again explicitly.

Discord administrators bypass channel overwrites, and existing roles or manual permissions can provide independent staff access. These commands do not revoke server administration privileges or remove roles. See Discord's [permission hierarchy](https://docs.discord.com/developers/topics/permissions#permission-hierarchy) and [channel permission endpoint](https://docs.discord.com/developers/resources/channel#edit-channel-permissions).

## Upgrade

Version 0.30.0 reads ticket store formats 1 and 2. Loading old data does not rewrite it. The next successful ticket mutation writes format 2 with optional bounded guest IDs. Old releases cannot read that format. Before upgrading, stop the bot and back up configuration and all twelve stores together. Rollback needs a complete compatible backup, not a mixture of versions. Register updated commands after upgrading.

Guest IDs are private ticket data. They are covered by checksummed backups and are never conversation transcripts. Automated tests and isolated runtime checks simulate Discord; live guest access and close/reopen checks remain required before stable release.
