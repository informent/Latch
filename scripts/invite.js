'use strict';

const features = Object.freeze({
  community: (1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 49n),
  tickets: (1n << 4n) | (1n << 28n),
  moderation: (1n << 1n) | (1n << 2n) | (1n << 4n) | (1n << 13n) | (1n << 16n) | (1n << 40n),
  roles: (1n << 27n) | (1n << 28n),
  automod: 1n << 5n
});

function installLink(applicationId, selected = ['community', 'tickets']) {
  if (typeof applicationId !== 'string' || !/^\d{5,25}$/.test(applicationId)) throw new Error('Set DISCORD_APPLICATION_ID to your application ID.');
  if (!selected.length || selected.some((name) => !Object.hasOwn(features, name))) throw new Error('Choose features from: community,tickets,moderation,roles,automod (or all).');
  const permissions = selected.reduce((bits, name) => bits | features[name], 0n);
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({ client_id: applicationId, scope: 'bot applications.commands', permissions: String(permissions), integration_type: '0' }).toString();
  return { url: url.toString(), permissions: String(permissions), features: [...new Set(selected)] };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error('Usage: npm run invite -- [community,tickets|all]');
  const selected = args[0] === 'all' ? Object.keys(features) : args[0] ? args[0].split(',').map((name) => name.trim()) : undefined;
  const result = installLink(process.env.DISCORD_APPLICATION_ID?.trim(), selected);
  console.log(`Features: ${result.features.join(', ')}\nRequested permissions: ${result.permissions}\n${result.url}`);
  console.log('Open this link to install the bot. Review permissions and role position in Discord. This command does not open a browser or make an API call.');
}

if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { installLink, features };
