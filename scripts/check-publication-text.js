'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = process.argv.slice(2);
if (!files.length) {
  files.push('README.md', 'COMMANDS.md', 'CHANGELOG.md', 'ROADMAP.md', 'AGENTS.md');
  for (const directory of ['docs', 'src', 'scripts', 'test']) {
    files.push(...fs.readdirSync(path.join(root, directory)).filter((file) => /\.(?:md|js)$/.test(file)).map((file) => `${directory}/${file}`));
  }
}
let failed = false;
for (const file of files) {
  const lines = fs.readFileSync(path.resolve(root, file), 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes(String.fromCharCode(0x2014))) { console.error(`${file}:${index + 1}: prohibited em dash`); failed = true; }
  });
}
if (failed) process.exitCode = 1;
else console.log(`Publication text checked: ${files.length} files contain no em dashes.`);
