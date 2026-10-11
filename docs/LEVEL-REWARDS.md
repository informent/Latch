# Earned level role rewards

Every reward feature is free and MIT-licensed. No subscription, license key or premium gate applies. See the [complete command reference](../COMMANDS.md) for every command and option.

## Configure milestones

Create permission-free unmanaged roles below Latch and the configuring staff member. Run `npm run register` after upgrading. Rewards start paused.

```text
/levelreward add role:LevelOne level:1
/levelreward add role:LevelFive level:5
/levelreward list
/levelreward enable
/levelreward preview user:Member
/levelreward reconcile user:Member
/levelreward info
```

`add` creates or updates a rule for a role. At most 20 unique role rules are stored, with levels 1-1000. Multiple roles can share a level. Rewards accumulate: a level-five member is eligible for both milestones above. Eligibility uses committed XP; level N starts at N squared times 100 XP.

All commands require Manage Server in the interaction. Mutations and explicit reconciliation additionally fetch current staff membership and require both Manage Server and Manage Roles, or Administrator/server ownership. Staff must have completed screening and cannot be timed out. Non-owner staff must be above the role and reconciliation target. The bot needs Manage Roles and must be above every role and recipient. Everyone, managed roles and roles with nonzero server permission bits are rejected. Owner/bot recipients are excluded.

`remove role:ROLE_ID` removes a rule, including a deleted role reference. It does not remove roles from members. `/levelreward disable` pauses processing without changing XP, rules, pending records or member roles. `/levelreward enable` validates every configured role. Pausing XP with `/levelconfig disable` does not pause processing of rewards earned from existing XP; pause rewards separately when needed.

Previews do not query or modify member roles. They show eligibility from XP/configuration and saved retry state. Assignment checks current guild, staff/bot/recipient identities, role snapshots, screening and hierarchy, then confirms earned roles by reading the member again. If a member has a role already, it is skipped.

## Background delivery and recovery

New committed XP awards queue eligible members. XP and reward intent are separate file commits. A background scan recovers a crash or queue failure between them by scanning 25 existing XP accounts every 15 seconds. A tick attempts at most one pending member, with at most 20 role grants. Only the configured guild is scanned. No Server Members Intent is needed for REST-based reconciliation; earning new message XP still needs the environment setting and Message Content Intent described in [leveling operations](LEVELING.md).

At the limit of 50,000 XP accounts, one full scan takes about 8 hours 20 minutes. Assignment queues can take longer: one member per tick processes at most four members per minute. Use `/levelreward reconcile` for an immediate staff-requested attempt on a selected member.

Rules carry a configuration revision. Completed members are revisited after a revision or higher level. If staff manually remove an earned role, it remains removed until a new level/configuration revision or explicit reconciliation. No continuous membership polling is performed for completed records.

The member intent is saved before any grant. Retries use delays starting at 15 seconds, doubling up to 15 minutes. Repeated message awards preserve an existing retry deadline. Missing/departed members, screening, changed permissions, deleted roles and hierarchy changes leave pending retries; repair the condition or remove/pause the rule. This release does not expire pending members.

Lost REST replies can occur after a successful grant. A retry reads current roles before granting, avoiding a repeated addition when the role already exists. Failed completion saves leave the original pending intent for replay. There is no permanent exactly-once guarantee or transaction spanning Discord and local files. External role edits can race a preflight snapshot; no Discord-side configuration lock exists.

## Storage and upgrades

`LEVEL_REWARD_STORE_PATH` defaults to `./data/level-rewards.json`. Version 1 contains guild ID, enabled state, revision, role/level rules and member IDs with checked level/revision, pending state, attempts and retry time. It stores no message content, interaction tokens or credentials. Limits are 20 rules, 50,000 member records and 32 MiB. Invalid schemas, duplicate IDs, wrong guilds and corrupt records are refused without rewriting the original file.

Back up all twelve stores together with the bot stopped, including both levels.json and level-rewards.json. Existing XP format is unchanged in this release. Docker and system service templates specify the new persistent path; the offline doctor checks it. Run one process per store set. Stop/drain background processing before restoring a compatible complete backup.

## Verification boundary

Automated tests cover temporary files, simulated Discord calls, signed local HTTP, the wired Gateway callback, restart/failure recovery and permissions. Live Discord delivery, real server role configuration and hosting remain unverified. Exclusive/highest-only policies, automatic role removal, rank cards and voice XP remain unfinished.
