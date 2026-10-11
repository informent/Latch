# Role and nickname delegation

`/roles grant`, `/roles revoke`, `/roles nickname` and `/roles clear-nickname` first validate the signed interaction permission. They then fetch current guild ownership, roles and actor/target/bot membership before sending a change to Discord. Manage Roles is required for role assignment/removal, and Manage Nicknames for nickname changes. Administrator satisfies these permission requirements.

## Hierarchy and protected targets

The target member must be strictly below both the bot and the staff actor. The server owner bypasses the actor hierarchy check, but bot checks remain. Equal positions are refused conservatively. Administrator does not bypass role position requirements. Missing, malformed or unavailable role/member snapshots prevent delegation.

The bot cannot be used to change the invoking member, the guild owner or Latch itself. These are conservative Latch policies; use Discord's own administration interface for those targets. Timed-out non-owner actors are refused, even if their raw roles still carry management permissions.

For grant/revoke, the selected role must be unmanaged, distinct from everyone, and strictly below the bot and non-owner actor. Unknown managed status is refused. Granting a role also checks that every guild permission bit in it is held by the actor. Administrator or server ownership bypasses that grant-bit subset check, while hierarchy still applies. Revoke does not require holding every permission of the role being removed.

These checks protect the boundary between staff permissions and the bot's wider access. Discord remains the final enforcement layer. Role edits can race the final REST call after lookup, so this is not an atomic permission transaction. Channel overwrites are not included in the grant-bit subset calculation; these member-management permissions are checked at guild level.

## Role inspection

`/utility role role:...` privately shows the configured server role's name, ID, position, integration management, mentionable/hoist status, raw permission bits and highlighted management permissions. It suppresses mentions and does not change any data. Any server member can use it. Re-register commands after upgrading.

Role metadata is not an effective-access calculation: other assigned roles, ownership and channel overwrites also affect member permissions. Position alone does not establish whether a particular delegated change is permitted. Inspection does not enumerate role members or expose channel contents.

No new persistent store is needed. Existing role fixtures were updated to provide the required live lookup data, but CI does not cover every new denial branch or role inspection. Live Discord behavior remains unverified. Durable delegation audit records, configurable policies and complete competitor parity remain unfinished.
