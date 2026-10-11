'use strict';
const readline = require('node:readline/promises');
const { Writable } = require('node:stream');

function createPrompter(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) throw new Error('Guided setup needs a terminal. Open a terminal in the OpenDesk folder and run npm run setup.');
  let hidden = false;
  const sink = new Writable({ write(chunk, encoding, callback) { if (!hidden) output.write(chunk); callback(); } });
  Object.defineProperty(sink, 'columns', { get: () => output.columns || 80 });
  const rl = readline.createInterface({ input, output: sink, terminal: true, historySize: 0, crlfDelay: Infinity });
  const controller = new AbortController();
  rl.on('SIGINT', () => { controller.abort(); rl.close(); });
  rl.on('close', () => controller.abort());
  return {
    say: (text) => output.write(`${text}\n`),
    async ask(label, { secret = false } = {}) {
      output.write(label);
      hidden = secret;
      try { return await rl.question('', { signal: controller.signal }); }
      catch { throw new Error('Setup cancelled. Run npm run setup when you are ready to continue.'); }
      finally { hidden = false; if (secret) output.write('\n'); }
    },
    close() { rl.close(); sink.end(); }
  };
}
module.exports = { createPrompter };
