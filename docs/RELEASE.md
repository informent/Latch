# Release readiness

Latch v0.29.1 is a release candidate. It is available as free MIT-licensed source and a Linux container build, for one configured guild per process. It requires Node 22.9+ or Node 24; there are no third-party runtime packages or paid command gates. The complete [command reference](../COMMANDS.md) covers the registered implementation. Full competitor parity remains unfinished.

## Automated release checks

The GitHub CI matrix runs the full regression suite, coverage floors, syntax checks, publication-text checks and generated-command freshness on both Windows and Linux with Node 22 and 24. A separate job builds the production Dockerfile and executes isolated smoke checks inside the node-user image with no external network, read-only root filesystem, dropped capabilities and no new privileges.

Run locally:

```powershell
npm run release:verify -- --json --output release-evidence/verification.json
```

The verification command runs every gate in order and stops on failure. Its JSON report records test counts, command inventory, runtime checks and a SHA256 fingerprint of public source bytes. CI retains a separate report for each operating system and Node version. Reports never certify live Discord validation or stable readiness. Use a new output filename for each run; existing evidence is never overwritten. Git ignores the default evidence directory and every default JSON data store.

The source fingerprint covers the public verification inputs and detects changes during the run. Different line endings can produce different fingerprints across checkouts. Verify the downloaded ZIP separately against SHA256SUMS to establish the exact release artifact.

The smoke test starts the real HTTP/runtime code in a temporary directory using a simulated Discord adapter. It checks health, unsigned rejection, signed ping/command handling, immediate calculator and deferred server artwork responses, private responses, duplicate protection, scheduler shutdown, twelve-store snapshot inventory, backup verification recovery of a saved economy receipt, signed giveaway creation/edit/preview/reset, and recovery of saved giveaway details. It never reads your .env or uses your Discord credential. Temporary files are removed after shutdown. Output includes package version, Node version, platform and checks completed.

Docker CI proves execution of the isolated workflow inside the built image. It does not prove a real bot login, Discord Gateway connection, external network permissions, production Compose volumes or actual Discord interactions.

## Get and install the candidate

Download the source ZIP and SHA256SUMS from the [v0.29.1 release](https://github.com/informent/Latch/releases/tag/v0.29.1). Compare the ZIP hash before extracting; then run commands from the extracted Latch directory.

```powershell
Get-FileHash ./Latch-v0.29.1-source.zip -Algorithm SHA256
npm run setup
# Follow the guided setup prompts.
npm run doctor
npm run invite -- all
npm run register
npm start
```

Setup preserves existing configuration. The bot needs a private test guild and Discord application, public HTTPS /interactions routing, matching public key and locally stored bot credential. Give the bot the permissions and role position needed by the features you enable. Configure matching privileged intents in the Developer Portal. Keep one writer per store set. See [operations](OPERATIONS.md), [backup/recovery](BACKUPS.md) and the [migration changelog](../CHANGELOG.md).

## Stable-release gate

The development checkout currently has no local .env or authorized live Discord test configuration. Until live proof is recorded, published artifacts remain prereleases and do not claim production readiness. Automated adapter tests are useful evidence but cannot replace this step.

| Required live check | Evidence to record without secrets |
| --- | --- |
| Login, membership and command registration | Source SHA/version, Node version, private guild and command registration result |
| Public HTTPS routing | Discord endpoint validation, valid signed command and invalid-signature rejection |
| Ticket lifecycle | Private creation, staff/member denial cases, closure/reopen and restart recovery |
| Member moderation and role hierarchy | Allowed action and refusal against owner, bot or higher-role target |
| Menus, panels and rewards | Current membership/screening guards, private routing, permissions and successful role readback |
| Economy and shop | Atomic adjustment/receipt, duplicate request, balances, stock/inventory and restart persistence |
| Community delivery | Reminder/giveaway/timer publication, edit/end actions, reply-loss recovery and pending-job inspection |
| Poll management | Actual poll creation, provisional/finalized counts, bounded voters and early end readback |
| Host and shutdown | One process, HTTPS/proxy settings, data permissions, process-manager shutdown grace and restart |
| Recovery | Stopped-process snapshot, verification and isolated recovery without mixing snapshots |

Use a disposable private guild for disruptive checks. Never put bot tokens, interaction tokens, private message text or complete store files in GitHub issues or release evidence. Record any failed check and its fix; rerun the affected workflow against the exact release source. Container/Compose deployment needs separate live-host evidence if it will be recommended as production-tested.

## Promotion

A stable release requires the live checks above, resolved critical failures, and exact-commit automated CI/artifact verification. Pin the source commit and verify downloaded ZIP bytes against SHA256SUMS. Keep release notes honest about supported scope, migrations and remaining features. Re-register after command changes. Economy format 3 and community format 3 require compatible complete backups for rollback.

No live account/server access is bundled or automatically provisioned by the candidate. Further feature development can continue while these release checks are completed.

## Online preflight from the current main branch

After configuring .env locally, run `npm run doctor:live -- --json` before live acceptance testing. This command is available on main in v0.29.1. It makes authenticated GET requests only, checks identity, membership, guild permission masks, configured support role and channels, and compares registered command definitions with the local version. It never registers commands or changes Discord objects. Output omits credentials, IDs, response bodies and remote error text. A nonzero exit code means a required check failed. Warnings explain permissions and behavior that still need live validation.

Guild permission masks do not include channel overwrites or target role hierarchy. A successful preflight does not prove HTTPS signatures, Gateway events, actual command execution or production persistence. Keep using the stable release checklist above. Command registration reads use the official [Get Guild Application Commands endpoint](https://docs.discord.com/developers/interactions/application-commands#get-guild-application-commands).

The 0.29.0 command expansion requires re-running `npm run register` after upgrading. Run `npm run doctor:live -- --json` afterward to compare registered definitions. The next successful community mutation writes format 3. Back up all twelve stores while stopped before upgrading; older releases require a compatible complete backup for rollback.
