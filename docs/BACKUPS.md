# Backup and recovery

Latch backup tooling is free, offline and built into the source release. It copies the configured data stores, validates their formats and verifies SHA256 checksums. It does not export Discord messages/channels/roles, collect credentials or call Discord. Files remain plaintext and can contain private text, IDs and economy records; store the backup somewhere private.

## Create a snapshot

1. Stop the bot and wait for shutdown to finish. Stop other processes that write these stores too.
2. Run doctor to inspect configuration and source stores: `npm run doctor`.
3. Create a new backup directory whose parent already exists:

```powershell
npm run backup -- create ../Latch-backup-2026-10-10
npm run backup -- verify ../Latch-backup-2026-10-10
```

Creation loads the configured store paths from .env. A destination must be new and must not contain the source stores. An existing file or directory is refused. No source file is modified. Copied files must be regular bounded files; symbolic file entries are rejected. Copied store schemas are validated using the same registry as doctor. Original source hashes are checked again after copying to detect changes and newly appearing/disappearing stores.

These checks cannot prove a consistent snapshot of a running bot. A store could change after the final check or change and change back. Stop all writers first. There is no live process lock, encryption or cryptographic signature.

A failed creation can leave an incomplete destination. Do not restore it. Correct the cause and choose a new destination. Successful creation returns JSON with ok, guild ID, source Latch version, present count and missing store keys. Missing source stores are recorded explicitly rather than replaced with empty files.

## Included stores

The backup uses fixed portable filenames even when your configured source paths have different names.

| Configuration key | Backup filename |
| --- | --- |
| TICKET_STORE_PATH | tickets.json |
| MODERATION_STORE_PATH | moderation.json |
| ECONOMY_STORE_PATH | economy.json |
| LEVEL_STORE_PATH | levels.json |
| COMMUNITY_STORE_PATH | community.json |
| VOICE_STORE_PATH | voice.json |
| ROLE_MENU_STORE_PATH | role-menus.json |
| TEMPLATE_STORE_PATH | templates.json |
| RESPONDER_STORE_PATH | responders.json |
| TIMER_STORE_PATH | timers.json |
| TICKET_PANEL_STORE_PATH | ticket-panels.json |
| LEVEL_REWARD_STORE_PATH | level-rewards.json |

manifest.json records the format version, source Latch version, guild ID, UTC creation timestamp and thirteen entries with logical store key, fixed filename, presence, byte length and SHA256. Absolute source paths, configuration and tokens are excluded. Preserve .env securely through your own configuration backup process.

## Verify a snapshot

`npm run backup -- verify <directory>` needs no valid Discord configuration or token. It makes no network calls and writes no files. It checks the exact manifest structure, all thirteen entries, expected filenames, sizes/checksums and each present store's schema. Unexpected files, path substitutions, missing required files and unexpected files for entries marked missing are rejected. Files and the manifest are checked for detectable changes while verification runs.

Verification proves compatibility with the version performing verification and agreement with the manifest. SHA256 is not proof of origin: someone who can replace both data and manifest can generate matching checksums. Use a trusted backup location. A backup from a newer format may fail verification on an older release.

## Restore deliberately

The tool does not automatically overwrite active stores.

1. Stop the bot and every other writer. Preserve the current stores as a separate complete backup before replacing anything.
2. Verify the chosen snapshot using a compatible Latch version. Check the reported guild ID against your configured DISCORD_GUILD_ID. A default verification does not know your intended guild; exported verifyBackup supports an explicit expected guild for integration.
3. Prepare an empty recovery data directory. Copy each present backup file to the matching configured store path using the table above. Keep all files from one snapshot together. For entries marked missing, leave the corresponding recovered store absent. Do not mix a missing backup entry with an old destination file.
4. Keep the existing configuration and credential files separate. Adjust configured data paths if using a new recovery directory. Never copy manifest.json into a data-store path.
5. Run doctor against the recovery paths before starting. Preserve the previous configuration and data so you can return to them if recovery fails.
6. Start one bot process and inspect pending work before relying on live operation.

Restoring local files does not recreate deleted Discord objects or retract already delivered messages. Old community/timer/reward intents may retry, and expired reminders may deliver after startup. Stop and inspect a snapshot before restoring if replaying pending work would be unwanted. Live Discord recovery validation remains unfinished.

## Verification evidence

Automated tests cover all thirteen stores, exact bytes, missing stores, existing-destination refusal, corrupt schemas, manifest validation, checksums, source changes, extra/missing files, file types, manifest changes, command arguments and shared doctor inventory. Starboard reads guild-bound formats 1 and 2 and writes format 2 on its next successful mutation. Keep a compatible pre-upgrade backup for rollback. Re-register commands after upgrading. Complete legacy twelve-store backups remain verifiable; starboard is reported as absent. Older versions cannot verify the new thirteen-store manifest.

Starboard receipts: `STARBOARD_STORE_PATH`, portable filename `starboard.json`, reads formats 1 and 2 and writes format 2, guild-bound configuration and up to 500 highlight receipts.
