'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { commands } = require('../src/commands');

function leaves(command, prefix = []) {
  const current = [...prefix, command.name];
  const children = (command.options || []).filter((option) => option.type === 1 || option.type === 2);
  return children.length ? children.flatMap((child) => leaves(child, current)) : [{ command: `/${current.join(' ')}`, description: command.description, options: command.options || [] }];
}

const catalog = commands.flatMap((command) => leaves(command));
const TYPES = { 3: 'text', 4: 'integer', 5: 'boolean', 6: 'user', 7: 'channel', 8: 'role', 9: 'mentionable', 10: 'number', 11: 'attachment' };
const PERMISSIONS = { '32': 'Manage Server', '8192': 'Manage Messages', '268435456': 'Manage Roles' };
const escape = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('`', '\\`');

function markdown() {
  const lines = [
    '# OpenDesk command reference', '',
    `All ${catalog.length} registered command paths across ${commands.length} slash command roots are listed below. Every OpenDesk feature is free and MIT-licensed.`, '',
    'Generated from `src/commands.js` with `npm run commands:write`. CI runs `npm run commands:check` to reject an outdated reference. These are implemented OpenDesk declarations, not a claim of full Bleed/Greed parity.', '',
    'Required options must be supplied. Optional values use the handler default when omitted. Default permissions control Discord visibility; runtime checks also enforce guild, identity, current permissions, hierarchy and feature configuration. Administrators can adjust command visibility in Discord, but runtime checks still apply. Commands require a configured server and are not DM commands.', '',
    'Start with `/utility help`. See [README](README.md), [operations](docs/OPERATIONS.md) and [feature coverage](docs/COMMAND-COVERAGE.md) for setup and operating limits.', '',
    '## Suites', '',
    ...commands.map((command) => `- [/${command.name}](#${command.name}): ${escape(command.description)}`), ''
  ];
  for (const root of commands) {
    const permission = root.default_member_permissions;
    lines.push(`## ${root.name}`, '', escape(root.description), '', `Default command visibility: ${permission === undefined ? 'all members; individual staff actions require runtime permission checks' : `${PERMISSIONS[permission] || 'permission bitfield'} (${permission})`}.`, '');
    for (const entry of leaves(root)) {
      lines.push(`### ${entry.command}`, '', escape(entry.description), '');
      if (!entry.options.length) { lines.push('Options: none.', ''); continue; }
      lines.push('| Option | Type | Required | Description and constraints |', '| --- | --- | --- | --- |');
      for (const option of entry.options) {
        const constraints = [option.description];
        for (const [key, label] of [['min_value', 'Minimum'], ['max_value', 'Maximum'], ['min_length', 'Minimum text length'], ['max_length', 'Maximum text length']]) {
          if (option[key] !== undefined) constraints.push(`${label}: ${option[key]}`);
        }
        if (option.choices) constraints.push(`Choices: ${option.choices.map((choice) => `${choice.name} = ${choice.value}`).join(', ')}`);
        if (option.channel_types) constraints.push(`Allowed Discord channel type IDs: ${option.channel_types.join(', ')}`);
        lines.push(`| ${escape(option.name)} | ${TYPES[option.type] || option.type} | ${option.required ? 'yes' : 'no'} | ${escape(constraints.join('; '))} |`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function main(args = process.argv.slice(2)) {
  if (args.length > 1 || args.some((arg) => !['--json', '--markdown', '--write', '--check'].includes(arg))) throw new Error('Usage: npm run commands -- [--json|--markdown|--write|--check]');
  const reference = path.resolve(__dirname, '..', 'COMMANDS.md');
  if (args.includes('--write')) { fs.writeFileSync(reference, markdown(), 'utf8'); console.log(`Wrote COMMANDS.md: ${catalog.length} command paths.`); }
  else if (args.includes('--check')) {
    if (!fs.existsSync(reference) || fs.readFileSync(reference, 'utf8').replaceAll('\r\n', '\n') !== markdown()) throw new Error('COMMANDS.md is outdated. Run npm run commands:write and commit it.');
    console.log(`COMMANDS.md matches all ${catalog.length} command paths.`);
  } else if (args.includes('--markdown')) process.stdout.write(markdown());
  else if (args.includes('--json')) process.stdout.write(`${JSON.stringify({ suites: commands.length, commands: catalog }, null, 2)}\n`);
  else process.stdout.write(`${catalog.map((entry) => `${entry.command}: ${entry.description}`).join('\n')}\n\n${catalog.length} registered command paths across ${commands.length} suites. This counts declarations, not verified competitor parity.\n`);
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { leaves, catalog, markdown, main };
