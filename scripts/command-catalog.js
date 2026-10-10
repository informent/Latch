'use strict';

const { commands } = require('../src/commands');

function leaves(command, path = []) {
  const current = [...path, command.name];
  const children = (command.options || []).filter((option) => option.type === 1 || option.type === 2);
  return children.length ? children.flatMap((child) => leaves(child, current)) : [{ command: `/${current.join(' ')}`, description: command.description }];
}

const catalog = commands.flatMap((command) => leaves(command));
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ suites: commands.length, commands: catalog }, null, 2)}\n`);
else process.stdout.write(`${catalog.map((entry) => `${entry.command}: ${entry.description}`).join('\n')}\n\n${catalog.length} registered command paths across ${commands.length} suites. This counts declarations, not verified competitor parity.\n`);
