# Installing and operating Latch

Latch is free MIT-licensed source software. The current application serves one configured Discord guild per process. Use separate applications, configurations, and data directories for separate deployments. Run exactly one process against each store set. This is an early release; live Discord validation remains outstanding.

## Local installation

Start with the [beginner setup guide](GETTING-STARTED.md). `npm run setup` opens a guided terminal wizard with hidden token entry, existing-setting preservation, local checks and optional command registration. Windows also includes setup/start launchers. Use `--plain` for an unattended blank template.

A token can be loaded from `DISCORD_BOT_TOKEN_FILE`; leave `DISCORD_BOT_TOKEN` empty when using a file. Do not put secrets in command arguments or Git. Run `npm run doctor` for offline inspection or `npm run doctor:live` for GET-only Discord preflight. Both support `--json` and set exit code 1 on failed required checks.

For production, run `npm start` under a process manager that restarts failures and allows at least 45 seconds for shutdown. Configure a permanent HTTPS endpoint ending in `/interactions`. No npm package installation is required. Doctor checks do not establish actual command execution, channel access or production-host readiness.

## Docker Compose

The repository includes a Linux container template. CI builds the production Dockerfile and runs isolated runtime/backup checks as the node user with a read-only root and no external network. Docker is not installed on the local Windows development machine. This CI proof does not establish live Discord login, external routing, persistent Compose-volume operation or production-host readiness; see the [release gate](RELEASE.md).

1. Create `.env` as above. Create `.secrets/discord_bot_token.txt` containing only the bot token. Leave the `.env` token value blank; the Compose service always loads its token from the mounted secret file. Restrict access to both files.
2. Run `docker compose build --pull` to build from the maintained Node 24 base image. The Docker build context is an allowlist of source, scripts, package metadata, and license; local environment files, secrets, and runtime data are excluded.
3. Run `docker compose run --rm latch node scripts/doctor.js`, then `docker compose run --rm latch node scripts/register-commands.js` after reviewing setup. Ensure the normal bot service is stopped when running an additional process that uses these volumes. Doctor and registration do not start the bot scheduler.
4. Run `docker compose up -d`. The host port binds only to `127.0.0.1:3000`. Place an HTTPS reverse proxy on the same host and forward `/interactions` to that port. The example Caddyfile limits the public route to interactions. It needs a real domain and DNS configuration. If Caddy runs in another container, loopback targets that container; configure a shared internal network and the Latch service name instead.
5. Inspect process status with `docker compose ps` and logs with `docker compose logs --tail=100 latch`. Do not paste private configuration or data into support issues.

The container runs as the Node user, with a read-only root filesystem, dropped Linux capabilities, a persistent data volume, bounded logs, and a 45-second stop grace period. `/healthz` reports HTTP liveness only. The base image tag is maintained rather than digest-pinned; record the built image digest for rollback and rebuild deliberately to adopt updates. Environment variables are visible to Docker administrators; the token secret file is still sensitive host data. See [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/) and [Node container guidance](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md).

## Linux service template

`deploy/latch.service.example` is an alternative to Compose. Create a dedicated `opendesk` user/group, place the source under `/opt/opendesk`, and use a restricted `/etc/opendesk/opendesk.env`. Confirm the absolute Node executable path in `ExecStart` matches your installation; Node must be 22.9+ or 24. Install the unit under `/etc/systemd/system/opendesk.service`, reload systemd, and enable/start it. The state directory is `/var/lib/opendesk`, owned by the service user. Configure HTTPS separately. The template is not a verified service installation on this Windows workstation.

## Updates, backups, and rollback

- Before updating, stop the bot and copy **all twelve** JSON stores together into a private backup, including `voice.json`, `role-menus.json`, `templates.json`, `responders.json`, `timers.json`, `ticket-panels.json` and `level-rewards.json`. Back up secret/configuration files separately. Keep source commit IDs or image digests with backups. Ticket channels and conversations remain in Discord and are not included in the JSON stores.
- For Compose, stop with `docker compose stop latch`. The named volume persists. Find its actual name with `docker volume ls`; it usually includes the Compose project prefix. With the bot stopped, use an administrative backup container or your Docker volume backup tooling to copy the complete volume. Treat archives as private server data.
- Never use `docker compose down -v` for a routine update: it deletes the data volume. Rebuild deliberately, then start one instance. Run doctor and register new commands as needed.
- Check the changelog before rolling back. Restore a compatible source/image version and the matching complete store backup while the bot is stopped. Verify permissions and resume only one instance. There is no automatic downgrade or migration guarantee.
- Giveaways save their selected winners before updating Discord. Reminder delivery is at least once; an interrupted delivery can duplicate outside Discord's short nonce window. Review pending job IDs after permissions or connectivity failures.

Ticket panels have a separate guild-bound store at `TICKET_PANEL_STORE_PATH` (default `./data/ticket-panels.json`). Configuration rejects overlapping store paths and an everyone support role. Include the new file in backups; Docker and service templates specify its persistent path. Inspect panel retry state after startup, and retry `/ticket reopen` for any ticket left in `reopening` after a failed operation.

## Connection recovery

Gateway sessions reconnect with capped backoff after transient network/service closures and resume when the session remains valid. Fatal Discord authentication or intent failures stop reconnecting; correct the configuration and restart. Shutdown prevents unfinished Gateway discovery from opening a new socket, ignores messages from superseded sockets, and waits for accepted event handlers alongside interaction work.

Discord REST calls use a 12-second total budget. A valid 429 response can be retried up to twice after its reported delay; longer delays fail safely so scheduled jobs can use their durable retry policy. Observed bot-global cooldowns also delay later bot-authenticated calls. Interaction webhook calls remain outside that bot-global cooldown. There is not yet a complete shared rate-limit bucket tracker. Network failures and other HTTP errors do not automatically retry potentially completed writes. Transport errors contain no response payloads or credentials. See the [Discord rate-limit reference](https://docs.discord.com/developers/topics/rate-limits) and [Gateway reference](https://docs.discord.com/developers/events/gateway).

## Support and product readiness

Report the source version/commit, Node version, affected command, whether doctor passes, and sanitized failure event names. Include no credentials, interaction tokens, private reminder text, entrant lists, or store files. Full competitor parity, music, comprehensive antinuke, and multi-guild administration remain on the roadmap. Deployment templates and offline diagnostics improve delivery quality; they do not establish production readiness without live Discord and host validation.

Level rewards add a twelfth guild-bound store at `LEVEL_REWARD_STORE_PATH` (default `./data/level-rewards.json`). Keep rules and pending/completed member records in the same stopped-process backup as XP. Rewards start paused; see [reward operations](LEVEL-REWARDS.md). The [command reference](../COMMANDS.md) is checked in CI with `npm run commands:check`; regenerate it after editing declarations with `npm run commands:write`.

Version 0.19.0 writes community.json version 2 on the next successful community mutation. Version 1 loads without modification. Back up all twelve stores with the service stopped; older releases reject version 2, so rollback needs a compatible complete backup. Pending giveaway selection survives restart. Check `/giveaway info` for remaining checks and retry state; use [giveaway operations](GIVEAWAYS.md) for requirements and migration details.

## Verified backup snapshots

Use `npm run backup -- create <new-directory>` after stopping the bot. It includes all twelve configured stores, records missing files explicitly, validates copied schemas and creates a SHA256 manifest. Use `npm run backup -- verify <directory>` before restoration; verification needs no Discord credentials and performs no network calls. Existing backups are never overwritten. See the [complete backup guide](BACKUPS.md) for consistency limits, custom paths, incomplete snapshots and recovery.

## Upgrade from OpenDesk

Latch is the new name for OpenDesk. Use the same Discord application, .env and complete store set. Windows launchers are now Latch-Setup.cmd and Latch-Start.cmd. Existing owned AutoMod rules with the OpenDesk prefix remain manageable; new rules use Latch. Backup manifest format 1 retains the opendeskVersion field for compatibility.

The Compose template keeps the legacy project name opendesk and volume key opendesk-data while renaming the service to latch. Stop the old service before starting the new one. If you previously used a custom Compose project name, set COMPOSE_PROJECT_NAME to that same value so Docker uses the existing volume. Never start both services against the same stores or use down -v during a rename. Existing Linux account and state paths remain valid; stop an old installed unit before installing a replacement from deploy/latch.service.example.
