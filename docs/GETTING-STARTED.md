# Set up your bot

You need a computer that can stay on, Node 24, a Discord application, and a test server you manage. No npm package installation or database is required.

## 1. Open the setup wizard

Download the source ZIP from [Releases](https://github.com/informent/Latch/releases) and extract it first. Install [Node 24](https://nodejs.org/en/download), then reopen your terminal.

On Windows, double-click **Latch-Setup.cmd** in the extracted folder. On Windows, Linux or macOS, open a terminal in that folder and run:

```sh
npm run setup
```

The wizard asks for four values. Create or open an application in the [Discord Developer Portal](https://discord.com/developers/applications).

| Value | Where to find it |
| --- | --- |
| Application ID | Your application > General Information |
| Public key | The same General Information page |
| Server ID | Enable Developer Mode in Discord User Settings > Advanced, then right-click your test server and choose Copy Server ID |
| Bot token | Your application > Bot. Use your saved token or generate one with Reset Token |

The token stays hidden while you paste it. Resetting a token invalidates the previous one. Keep the generated `.env` file private. Discord's [app setup guide](https://docs.discord.com/developers/quick-start/getting-started) and [ID guide](https://support-dev.discord.com/hc/en-us/articles/360028717192-Where-can-I-find-my-Application-Team-Server-ID) show these settings.

Choose **Essentials** for the simplest first run. It registers all slash command groups; event features such as automatic XP and temporary voice rooms remain off. **Community extras** enables those event features, automatic responders and member events. For that preset, enable Server Members Intent and Message Content Intent on the Bot page before starting. Each feature still needs its own configuration, such as a voice lobby or a responder rule.

Existing valid values and custom settings are kept. Rerunning setup asks only for missing or invalid required values. To change an already valid setting, edit `.env` while the bot is stopped, then run `npm run doctor`. Token files configured with `DISCORD_BOT_TOKEN_FILE` are supported.

For scripts or containers, `npm run setup -- --plain` creates a blank template without prompts. Redirected input/output also selects this mode. Use `--guided` to require a real terminal.

## 2. Install the bot and register commands

Setup checks the local configuration, then prints your installation link. Open it, select the test server and review its permissions. Enable Guild Install in the application's Installation settings if necessary. Place the bot role above any roles it needs to assign or moderate.

After installing, answer **y** when setup offers to add/update slash commands. This publishes command definitions to the configured server. If you skip that step, run `npm run register` after installation. You can safely rerun registration after a partial failure.

## 3. Start the bot and connect Discord

Double-click **Latch-Start.cmd** on Windows, or run:

```sh
npm start
```

Keep this process open. Discord also needs an HTTPS address that forwards to the bot's local port, normally 3000.

For a temporary test, install `cloudflared` from its [official downloads page](https://developers.cloudflare.com/tunnel/downloads/) and open a second terminal:

```sh
cloudflared tunnel --url http://127.0.0.1:3000
```

Copy the HTTPS address it prints. In the Discord Developer Portal, open General Information and set **Interactions Endpoint URL** to that address plus `/interactions`, for example `https://example.trycloudflare.com/interactions`. Save while both processes are running, then try `/utility ping` in your test server.

[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) are temporary test URLs, require no account or domain, and change when restarted. Update the Discord endpoint each time. They expose the local bot service publicly; signature verification still protects interactions. For a permanent installation, follow the [operations guide](OPERATIONS.md) to use a stable HTTPS address and a service manager.

## When something goes wrong

| What you see | What to do |
| --- | --- |
| Node is missing or too old | Install Node 24 and reopen the terminal or launcher. |
| Setup shows no questions | Run it in a terminal, or use the Windows setup launcher. `--plain` deliberately has no questions. |
| A setting conflicts with the terminal | Open a terminal without previously exported Latch environment variables. Node gives those variables precedence over `.env`. |
| Registration fails | Confirm the token and Server ID, install the bot in that server, then rerun `npm run register`. |
| Discord refuses the endpoint URL | Keep the bot and HTTPS proxy running. Check `/interactions` and the matching application public key. |
| Commands are missing | Rerun `npm run register`, then reopen Discord. Check that you installed the correct application. |
| A command says it lacks permission | Check the bot's server role, channel permissions and position above the target role. |
| Optional events do not work | Check the `.env` feature flag and the corresponding Bot-page intent, then restart. |

`npm run doctor` checks local settings and stores. `npm run doctor:live` reads Discord configuration without changing it. Neither replaces trying the commands in a private server. See [all commands](../COMMANDS.md) and the [release validation checklist](RELEASE.md).
