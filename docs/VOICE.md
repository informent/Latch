# Temporary voice channels

This is an optional, free suite. It manages channels through Discord's REST API and observes voice membership through the Gateway. It does not connect to audio, record conversations, stream music, or require Message Content / Server Members privileged intents for voice alone. Its lifecycle has not been validated against a live Discord server, and existing CI does not exercise the new voice workflows.

## Enable and configure

1. Set `DISCORD_VOICE_ENABLED=true` in your private `.env`. Leave `DISCORD_GATEWAY_ENABLED` blank or set it to true, then restart. Voice adds the `GUILD_VOICE_STATES` intent (`128`).
2. Use `npm run invite -- community,voice` to obtain an installation link with View Channel, Connect, Move Members, Manage Channels and Manage Roles. Review guild permissions and category overrides; Latch does not request Administrator.
3. Re-register commands with `npm run register`.
4. Create a normal voice channel to serve as the lobby and a category for temporary rooms. Use `/voice setup lobby:... category:...` as a member with Manage Server. Setup stores existing channel IDs rather than creating or editing a lobby/category.
5. Check `/voice status`. After a current server voice snapshot arrives, join the lobby to create your room and move into it.

Category permission overwrites are copied when creating a room, with explicit owner and bot access. Category changes do not automatically synchronize existing rooms. Review role overrides when using a restricted category. The bot needs enough permissions to create, edit, move members and delete rooms.

## Commands

| Command | Who can use it | Behavior |
| --- | --- | --- |
| `/voice setup` | Manage Server | Set existing lobby and destination category |
| `/voice disable` | Manage Server | Stop new room creation; managed rooms still expire when empty |
| `/voice status` | Server members | Configuration, managed count and snapshot readiness |
| `/voice rename name:...` | Owner in their room | Name of 1–100 characters |
| `/voice limit members:...` | Owner in their room | 0 means unlimited; maximum 99 |
| `/voice lock`, `/voice unlock` | Owner in their room | Deny/allow Connect on the everyone overwrite |
| `/voice ghost`, `/voice unghost` | Owner in their room | Deny/allow View Channel on the everyone overwrite |
| `/voice permit user:...` | Owner in their room | Explicit View Channel and Connect for a server member |
| `/voice reject user:...` | Owner in their room | Explicit denial of View Channel and Connect for another member |
| `/voice claim` | Human member in a room | Claim if the previous owner is absent and the member owns no other room |
| `/voice transfer user:...` | Owner in their room | Transfer to a human currently in the same room who owns no other room |
| `/voice info` | Owner in their room | Room ID, owner, connected count and limit |

Replies are private and suppress mentions. Ownership persists across restarts and is checked again for each management operation. Owners get no Manage Channels permission through this suite. Claim/transfer grant the new owner explicit access; existing explicit access is retained, including the previous owner's. Use reject if that access should be removed. Permission updates and ownership persistence are separate operations; a failed command can have applied access changes before failing to save ownership. Check info and retry after correcting permissions or storage.

Lock/ghost affect the everyone overwrite; other role/member overrides and Administrator can still grant access. Permit/reject do not move or disconnect existing occupants. Reject prevents future access for ordinary members, subject to Discord permission rules. It cannot restrict administrators. Unlock/unghost explicitly allow their respective bits and do not restore an earlier category policy. Other permission bits are preserved.

## Lifecycle and persistence

- At most 50 managed rooms and one owned room per member. New creation attempts have an in-memory 30-second cooldown, which resets on restart. Joining the lobby while owning a room moves the owner to that room.
- `data/voice.json` stores the configured guild, lobby/category IDs, channel IDs, owners and creation timestamps. It never stores audio, voice session IDs, credentials or interaction tokens. The file has strict schema validation and a 1 MiB limit; writes use private temporary files and atomic rename. Include it in backups with all other stores.
- Current occupancy remains in memory. Empty-room cleanup waits at least 30 seconds and checks every 15 seconds. It attempts at most one room per pass, validates guild and channel type, and touches only recorded temporary rooms. Busy queues or failed API calls delay cleanup.
- Initial cleanup waits for `GUILD_CREATE` with voice states. Fresh READY events discard stale occupancy. A changed/disconnected Gateway socket pauses cleanup until a fresh snapshot or completed resume makes it current. Observation happens before asynchronous event work so pending REST operations do not delay received voice membership updates.
- Failed cleanup retries on later passes. A confirmed HTTP 404 removes the stale record. Manually deleting a tracked channel also clears its record when its event is processed. If a lobby/category is deleted, new creation is disabled; setup is required again.
- Channel creation is saved before moving the owner. A failed move leaves a tracked empty room for cleanup. A failed store save attempts deletion of the just-created channel. A crash or ambiguous REST response during creation can leave an untracked orphan; review the configured category and delete confirmed orphans manually. Never remove arbitrary rooms just because their names look similar.
- Discord offers no atomic occupancy-check-and-delete operation. A member joining during an in-flight deletion request can still encounter a deletion. The observation check and grace period reduce this race; they do not eliminate it.

Default channel settings, interface buttons, bitrate/region controls, temporary role assignment, music mode and audio playback remain unfinished. Slash syntax also differs from competitor prefix commands. See [command coverage](COMMAND-COVERAGE.md).

References: [Discord voice-state events](https://docs.discord.com/developers/events/gateway-events#voice-state-update), [moving guild members](https://docs.discord.com/developers/resources/guild#modify-guild-member), [channel permission overwrites](https://docs.discord.com/developers/resources/channel#edit-channel-permissions).
