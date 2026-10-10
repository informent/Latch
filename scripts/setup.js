'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  try {
    await fs.copyFile(path.join(root, '.env.example'), path.join(root, '.env'), fs.constants.COPYFILE_EXCL);
    console.log('Created .env with blank credentials.');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log('An existing .env was preserved.');
  }
  await fs.mkdir(path.join(root, 'data'), { recursive: true, mode: 0o700 });
  console.log('Next: fill in .env locally, run npm run doctor, then npm run invite.');
  console.log('Register commands with npm run register, configure HTTPS /interactions, then npm start.');
}

if (require.main === module) main().catch(() => { console.error('Setup could not create the local configuration or data folder. Check folder access.'); process.exitCode = 1; });

module.exports = { main };
