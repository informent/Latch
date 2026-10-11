# Installing and operating OpenDesk

OpenDesk is free MIT-licensed source software. The current application serves one configured Discord guild per process. Use separate applications, configurations, and data directories for separate deployments. Run exactly one process against each store set. This is an early release; live Discord validation remains outstanding.

## Local installation

1. Download or clone the repository into a folder you own. Install Node 22.9+ or Node 24.
2. Run `npm run setup`. It creates a blank `.env` and data directory while preserving an existing `.env`.
3. Edit `.env` locally with your Discord application ID, public key, guild ID, and bot credential. A token can instead be loaded from `DISCORD_BOT_TOKEN_FILE`; leave `DISCORD_BOT_TOKEN` empty when using a file. Do not put secrets in command arguments or Git.
4. Run `npm run doctor` for offline, read-only configuration and store inspection. `npm run doctor -- --json` returns a report for automation. A failure sets exit code 1. Warnings describe remaining manual steps. No files are repaired or changed, and no Discord requests are made. Filesystem access is advisory; it cannot guarantee a later atomic write will succeed.
5. Run `npm run invite` for community and ticket permissions, or `npm run invite -- all` for all implemented feature areas. You can choose `community,tickets,moderation,roles,automod,voice` individually. The command prints a Discord installation link without opening a browser. Review the requested permissions and bot role position. Selecting permissions does not disable command suites.
6. Run `npm run register` to add/update commands in the configured guild. This makes Discord API changes. Set the Discord application's Interactions Endpoint URL to your public HTTPS `/interactions` endpoint.
7. Run `npm start` under a process manager that restarts failures and allows at least 45 seconds for shutdown.

No npm package installation is required: OpenDesk currently uses only built-in Node modules. Doctor output excludes credential values and raw store contents. It cannot establish guild membership, channel permissions, privileged intent approval, HTTPS routing, or live-server correctness.

## Docker Compose

The repository includes a Linux container template. Docker is not installed in the current development environment, so the container and Compose workflow have not been exercised here.

1. Create `.env` as above. Create `.secrets/discord_bot_token.txt` containing only the bot token. Leave the `.env` token value blank; the Compose service always loads its token from the mounted secret file. Restrict access to both files.
2. Run `docker compose build --pull` to build from the maintained Node 24 base image. The Docker build context is an allowlist of source, scripts, package metadata, and license; local environment files, secrets, and runtime data are excluded.
3. Run `docker compose run --rm opendesk node scripts/doctor.js`, then `docker compose run --rm opendesk node scripts/register-commands.js` after reviewing setup. Ensure the normal bot service is stopped when running an additional process that uses these volumes. Doctor and registration do not start the bot scheduler.
4. Run `docker compose up -d`. The host port binds only to `127.0.0.1:3000`. Place an HTTPS reverse proxy on the same host and forward `/interactions` to that port. The example Caddyfile limits the public route to interactions. It needs a real domain and DNS configuration. If Caddy runs in another container, loopback targets that container; configure a shared internal network and the OpenDesk service name instead.
5. Inspect process status with `docker compose ps` and logs with `docker compose logs --tail=100 opendesk`. Do not paste private configuration or data into support issues.

The container runs as the Node user, with a read-only root filesystem, dropped Linux capabilities, a persistent data volume, bounded logs, and a 45-second stop grace period. `/healthz` reports HTTP liveness only. The base image tag is maintained rather than digest-pinned; record the built image digest for rollback and rebuild deliberately to adopt updates. Environment variables are visible to Docker administrators; the token secret file is still sensitive host data. See [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/) and [Node container guidance](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md).

## Linux service template

`deploy/opendesk.service.example` is an alternative to Compose. Create a dedicated `opendesk` user/group, place the source under `/opt/opendesk`, and use a restricted `/etc/opendesk/opendesk.env`. Confirm the absolute Node executable path in `ExecStart` matches your installation; Node must be 22.9+ or 24. Install the unit under `/etc/systemd/system/opendesk.service`, reload systemd, and enable/start it. The state directory is `/var/lib/opendesk`, owned by the service user. Configure HTTPS separately. The template is not a verified service installation on this Windows workstation.

## Updates, backups, and rollback

- Before updating, stop the bot and copy **all twelve** JSON stores together into a private backup, including `voice.json`, `role-menus.json`, `templates.json`, `responders.json`, `timers.json`, `ticket-panels.json` and `level-rewards.json`. Back up secret/configuration files separately. Keep source commit IDs or image digests with backups. Ticket channels and conversations remain in Discord and are not included in the JSON stores.
- For Compose, stop with `docker compose stop opendesk`. The named volume persists. Find its actual name with `docker volume ls`; it usually includes the Compose project prefix. With the bot stopped, use an administrative backup container or your Docker volume backup tooling to copy the complete volume. Treat archives as private server data.
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
