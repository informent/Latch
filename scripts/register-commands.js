'use strict';

const { loadConfig } = require('../src/config');
const { DiscordApi } = require('../src/discord-api');
const { commands } = require('../src/commands');

async function registerCommands(config, api) {
  const registered = [];
  for (const command of commands) {
    registered.push(await api.request('POST', `/applications/${config.applicationId}/guilds/${config.guildId}/commands`, command));
  }
  return registered;
}

async function main() {
  const config = loadConfig();
  const api = new DiscordApi(config.botToken);
  await registerCommands(config, api);
  console.log(`Added or updated ${commands.map((command) => `/${command.name}`).join(', ')} for the configured test server.`);
}

if (require.main === module) main().catch((error) => { console.error(`Command registration failed: ${error.message}`); process.exitCode = 1; });

module.exports = { commands, registerCommands };
