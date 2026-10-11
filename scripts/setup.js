'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseEnv } = require('node:util');
const { loadConfig } = require('../src/config');
const { inspectSetup } = require('./doctor');
const { installLink, features } = require('./invite');
const { registerCommands } = require('./register-commands');
const { DiscordApi } = require('../src/discord-api');
const { createPrompter } = require('./setup-prompt');

const ROOT = path.resolve(__dirname, '..');
const questions = [
  ['DISCORD_APPLICATION_ID', 'Application ID', /^\d{5,25}$/, 'Developer Portal > your app > General Information > Application ID. Copy the number.'],
  ['DISCORD_PUBLIC_KEY', 'Public key', /^[0-9a-fA-F]{64}$/, 'Same General Information page > Public Key. Copy all 64 letters and numbers.'],
  ['DISCORD_GUILD_ID', 'Server ID', /^\d{5,25}$/, 'Discord > User Settings > Advanced > Developer Mode. Right-click your test server icon > Copy Server ID.'],
  ['DISCORD_BOT_TOKEN', 'Bot token (hidden)', /^[A-Za-z0-9_.-]{1,4096}$/, 'Developer Portal > your app > Bot > Token. Use your saved token, or Reset Token if needed. Paste it here; it will not appear on screen.']
];

async function readEnv(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('Use a regular .env file smaller than 64 KiB. Linked files are not edited.');
    return await fs.readFile(file, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function saveEnv(root, original, text) {
  if (Buffer.byteLength(text, 'utf8') > 65536) throw new Error('The completed .env would exceed 64 KiB. Shorten the existing file before rerunning setup.');
  if (text === original) return false;
  const destination = path.join(root, '.env');
  const temporary = path.join(root, `.env.${randomUUID()}.tmp`);
  try {
    const file = await fs.open(temporary, 'wx', 0o600);
    try { await file.writeFile(text, 'utf8'); await file.sync(); } finally { await file.close(); }
    if (await readEnv(destination) !== original) throw new Error('The .env file changed during setup. Run setup again to use the latest settings.');
    if (original === null) await fs.link(temporary, destination);
    else await fs.rename(temporary, destination);
  } finally { await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
  return true;
}

async function choice(ui, label, allowed, fallback) {
  while (true) {
    const answer = (await ui.ask(label)).trim().toLowerCase() || fallback;
    if (allowed.includes(answer)) return answer;
    ui.say(`Choose ${allowed.join(' or ')}.`);
  }
}

function nextSteps(ui, config) {
  ui.say('\nNext: make the bot reachable by Discord');
  ui.say('1. Start Latch: npm start (or double-click Latch-Start.cmd on Windows).');
  ui.say(`2. Forward a public HTTPS URL to local port ${config.port}. The beginner guide has a temporary tunnel example.`);
  ui.say('3. Developer Portal > General Information > Interactions Endpoint URL: paste your HTTPS URL followed by /interactions. Save it while Latch is running.');
  ui.say('4. Try /utility ping in your server. Keep the bot running to receive commands.');
  ui.say('Help: docs/GETTING-STARTED.md | All commands: COMMANDS.md');
}

async function runSetup({ root = ROOT, ui, plain = false, inherited = process.env, inspect = inspectSetup, apiFactory = (token) => new DiscordApi(token) } = {}) {
  const original = await readEnv(path.join(root, '.env'));
  const template = original ?? await fs.readFile(path.join(root, '.env.example'), 'utf8');
  if (plain) {
    await saveEnv(root, original, template);
    ui.say(original === null ? 'Created .env. Fill in the four required Discord values, then run npm run doctor.' : 'Existing .env preserved.');
    ui.say('For the guided setup, run npm run setup in a terminal. Help: docs/GETTING-STARTED.md');
    return { ok: true, configured: false };
  }
  let values;
  try { values = parseEnv(template); } catch { throw new Error('Could not read .env. Check its KEY=value format; your file was preserved.'); }
  const updates = {};
  const fresh = !questions.some(([key]) => values[key]?.trim()) && !Object.entries(values).some(([key, value]) => /^(?:DISCORD_.*_ENABLED|DISCORD_ENABLE_.*)$/.test(key) && value.trim().toLowerCase() === 'true');
  ui.say('\nLatch setup\nYou need a Discord application and a test server you manage.\nCreate or open your app: https://discord.com/developers/applications\nSettings stay in this folder. Press Ctrl+C to stop.\n');
  ui.say('Step 1 of 3: Discord settings');
  for (const [key, label, valid, help] of questions) {
    if (key === 'DISCORD_BOT_TOKEN' && values.DISCORD_BOT_TOKEN_FILE?.trim()) { ui.say('Bot token: using your existing token file.'); continue; }
    if (valid.test(values[key]?.trim() || '')) { ui.say(`${label}: already configured.`); continue; }
    ui.say(`\n${help}`);
    while (true) {
      const answer = (await ui.ask(`${label}: `, { secret: key === 'DISCORD_BOT_TOKEN' })).trim();
      if (valid.test(answer)) { updates[key] = answer; break; }
      ui.say(key === 'DISCORD_PUBLIC_KEY' ? 'Copy the full 64-character public key from General Information.' : key === 'DISCORD_BOT_TOKEN' ? 'Paste only the bot token, without quotes, spaces or the word Bot.' : 'Use Copy ID and paste the number, without a link or a name.');
    }
  }
  ui.say('\nStep 2 of 3: Features');
  if (fresh) {
    ui.say('1. Essentials (recommended): all slash commands; optional event features stay off.');
    ui.say('2. Community extras: enable XP, automatic replies, member events and temporary voice.');
    const preset = await choice(ui, 'Choose 1 or 2 [1]: ', ['1', '2'], '1');
    if (preset === '2') for (const key of ['DISCORD_GATEWAY_ENABLED', 'DISCORD_LEVELING_ENABLED', 'DISCORD_RESPONDERS_ENABLED', 'DISCORD_ENABLE_MEMBER_EVENTS', 'DISCORD_VOICE_ENABLED']) updates[key] = 'true';
  } else ui.say('Your existing feature settings are preserved.');
  const text = Object.keys(updates).length ? `${template}${template.endsWith('\n') ? '' : '\n'}\n# Guided setup values override earlier blank entries.\n${Object.entries(updates).map(([key, value]) => `${key}=${value}`).join('\n')}\n` : template;
  values = parseEnv(text);
  const conflicts = Object.keys(values).filter((key) => inherited[key] !== undefined && inherited[key] !== values[key]);
  if (conflicts.length) throw new Error('Terminal environment variables conflict with .env. Use a fresh terminal without Latch variable overrides, then rerun setup. No settings were saved.');
  const effective = { ...inherited, ...values };
  let config;
  try { config = loadConfig(effective); }
  catch { throw new Error('Some existing settings are invalid. Run npm run doctor to see which setting needs attention. No settings were saved.'); }
  if (config.memberEventsEnabled || config.levelingEnabled || config.respondersEnabled) ui.say(`Before starting: enable ${[config.memberEventsEnabled ? 'Server Members Intent' : '', config.levelingEnabled || config.respondersEnabled ? 'Message Content Intent' : ''].filter(Boolean).join(' and ')} on the Bot page. Feature guides explain per-server configuration.`);
  await saveEnv(root, original, text);
  ui.say('\nSettings saved. Checking configuration and data access...');
  const report = await inspect(effective);
  for (const check of report.checks.filter((check) => check.status === 'fail')) ui.say(`Needs attention: ${check.name}. ${check.detail}`);
  if (!report.ok) { ui.say('Settings are saved. Fix the reported issue and rerun npm run setup.'); return { ok: false, configured: true }; }
  ui.say('Local checks passed.');
  ui.say('\nStep 3 of 3: Add Latch to your test server');
  ui.say(installLink(config.applicationId, Object.keys(features).filter((name) => name !== 'voice' || config.voiceEnabled)).url);
  ui.say('Open that link, choose your test server, and review the permissions. Place the bot role above roles it needs to manage.');
  let registered = false;
  let registrationFailed = false;
  if (['y', 'yes'].includes(await choice(ui, 'After installing: add/update slash commands in this server now? [y/N]: ', ['y', 'yes', 'n', 'no'], 'n'))) {
    try {
      const api = apiFactory(config.botToken);
      const guild = await api.request('GET', `/guilds/${config.guildId}`);
      if (guild?.id !== config.guildId) throw new Error();
      await registerCommands(config, api);
      registered = true;
      ui.say('Slash commands registered.');
    } catch { registrationFailed = true; ui.say('Could not finish registration. Your settings are saved. Check the token, server ID and installation, then run npm run register. Partial registrations can be retried.'); }
  } else ui.say('When the bot is installed, run npm run register to add its slash commands.');
  nextSteps(ui, config);
  return { ok: !registrationFailed, configured: true, registered };
}

async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || args.some((arg) => !['--plain', '--guided', '--help'].includes(arg))) throw new Error('Usage: npm run setup -- [--plain|--guided|--help]');
  if (args.includes('--help')) { console.log('npm run setup: guided setup in a terminal. --plain: create a blank .env without prompts. --guided: require a terminal. Existing settings are preserved.'); return; }
  process.chdir(ROOT);
  const plain = args.includes('--plain') || !args.includes('--guided') && (!process.stdin.isTTY || !process.stdout.isTTY);
  const ui = plain ? { say: console.log } : createPrompter();
  try { const result = await runSetup({ ui, plain }); if (!result.ok) process.exitCode = 1; }
  finally { ui.close?.(); }
}

if (require.main === module) main().catch((error) => { console.error(error.code ? 'Setup could not access its files. Extract Latch into a folder you own and try again.' : error.message); process.exitCode = 1; });
module.exports = { runSetup, main, readEnv, saveEnv };
