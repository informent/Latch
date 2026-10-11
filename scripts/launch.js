'use strict';
const [major, minor] = process.versions.node.split('.').map(Number);
if (!(major > 22 || major === 22 && minor >= 9)) {
  console.error('OpenDesk needs Node 22.9+ or Node 24. Install Node from https://nodejs.org/en/download and reopen this window.');
  process.exitCode = 1;
} else {
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const action = process.argv[2];
  const args = action === 'setup' ? ['scripts/setup.js', '--guided'] : action === 'start' ? ['--env-file-if-exists=.env', 'src/server.js'] : null;
  if (!args) { console.error('Choose setup or start.'); process.exitCode = 1; }
  else {
    const result = spawnSync(process.execPath, args, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    if (result.error) console.error('Could not start OpenDesk. Check the extracted folder and Node installation.');
    process.exitCode = result.status ?? 1;
  }
}
