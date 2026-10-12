'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { MAX_UPLOAD_BYTES } = require('../src/discord-api');
const { MAX_SOURCE_BYTES } = require('../src/ticket-transcript');

async function unpack(input, output) {
  if (typeof input !== 'string' || typeof output !== 'string' || !/\.(?:txt|json)\.gz$/i.test(input) || path.extname(output).toLowerCase() !== path.extname(input.slice(0, -3)).toLowerCase()) throw new Error('Choose a gzip transcript and matching new text or JSON output.');
  const stat = await fs.stat(input);
  if (!stat.isFile() || stat.size > MAX_UPLOAD_BYTES) throw new Error('Compressed transcript exceeds its size limit.');
  const compressed = await fs.readFile(input);
  if (compressed.length > MAX_UPLOAD_BYTES) throw new Error('Compressed transcript exceeds its size limit.');
  const data = gunzipSync(compressed, { maxOutputLength: MAX_SOURCE_BYTES });
  if (!data.length) throw new Error('Empty transcript.');
  if (path.extname(output).toLowerCase() === '.json') {
    const snapshot = JSON.parse(data.toString('utf8'));
    if (snapshot?.version !== 2 || snapshot.scope !== 'bounded-history-snapshot' || !Array.isArray(snapshot.messages)) throw new Error('Unsupported transcript snapshot.');
  } else if (!data.toString('utf8').startsWith('Latch ticket transcript\n')) throw new Error('Unsupported transcript text.');
  await fs.writeFile(output, data, { flag: 'wx', mode: 0o600 });
  return { bytes: data.length };
}
async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args.some(arg => arg.startsWith('--'))) throw new Error('Usage: npm run transcript:unpack -- input.txt.gz new-output.txt');
  const result = await unpack(...args);
  console.log(`Unpacked transcript: ${result.bytes} bytes.`);
  return result;
}
if (require.main === module) main().catch(() => { console.error('Transcript unpack failed. Use a valid gzip export up to 2 MiB, a matching new .txt/.json output and an existing writable directory. Existing files are never replaced.'); process.exitCode = 1; });
module.exports = { unpack, main };
