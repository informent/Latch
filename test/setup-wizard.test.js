'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PassThrough, Writable } = require('node:stream');
const { parseEnv } = require('node:util');
const { runSetup, saveEnv, readEnv, main } = require('../scripts/setup');
const { createPrompter } = require('../scripts/setup-prompt');
const { loadConfig } = require('../src/config');
const { commands } = require('../src/commands');
const valid = 'DISCORD_APPLICATION_ID=100001\nDISCORD_PUBLIC_KEY=' + 'a'.repeat(64) + '\nDISCORD_GUILD_ID=100002\nDISCORD_BOT_TOKEN=fixture-token\n';

async function fixture(t, original = null, answers = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesk-setup-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('opendesk-setup-')); await fs.rm(root, { recursive: true, force: true }); });
  await fs.copyFile(path.resolve(__dirname, '../.env.example'), path.join(root, '.env.example'));
  if (original !== null) await fs.writeFile(path.join(root, '.env'), original);
  const lines = [], asked = [], calls = [];
  const ui = { say(text) { lines.push(text); }, async ask(label, options) { asked.push({ label, options }); assert.ok(answers.length, `Unexpected question: ${label}`); const next = answers.shift(); if (next instanceof Error) throw next; return next; } };
  const options = { root, ui, inherited: {}, inspect: async (env) => { loadConfig(env); return { ok: true, checks: [] }; }, apiFactory: () => ({ async request(method, route, body) { calls.push({ method, route, body }); return method === 'GET' ? { id: '100002' } : body; } }) };
  return { root, options, ui, lines, asked, calls, read: () => fs.readFile(path.join(root, '.env'), 'utf8') };
}

test('guided setup validates four values, hides token prompt and produces a loadable file', async (t) => {
  const f = await fixture(t, null, ['bad-id', '100001', 'bad-key', 'a'.repeat(64), 'server', '100002', 'Bot secret', 'fixture-secret-token', 'invalid', '', '']);
  const result = await runSetup(f.options), config = loadConfig(parseEnv(await f.read()));
  assert.equal(result.configured, true); assert.equal(config.gatewayEnabled, false); assert.equal(config.botToken, 'fixture-secret-token');
  assert.ok(f.asked.filter((question) => question.label.startsWith('Bot token')).every((question) => question.options.secret));
  assert.ok(!f.lines.join('\n').includes('fixture-secret-token')); assert.equal(f.calls.length, 0);
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(f.root, '.env'))).mode & 0o777, 0o600);
});
test('community preset enables matching features and explains privileged intents', async (t) => {
  const f = await fixture(t, null, ['100001', 'a'.repeat(64), '100002', 'fixture-token', '2', 'n']);
  await runSetup(f.options); const config = loadConfig(parseEnv(await f.read()));
  assert.ok(config.gatewayEnabled && config.levelingEnabled && config.voiceEnabled && config.respondersEnabled && config.memberEventsEnabled);
  assert.ok(f.lines.some((line) => line.includes('Server Members Intent') && line.includes('Message Content Intent')));
});
test('rerunning setup preserves complete configuration bytes and custom settings', async (t) => {
  const original = valid.replaceAll('\n', '\r\n') + '# Keep this note\r\nPORT=4555\r\nCUSTOM_SETTING="hello world"\r\n';
  const f = await fixture(t, original, ['n']); await runSetup(f.options);
  assert.equal(await f.read(), original); assert.equal(f.asked.length, 1); assert.ok(f.lines.some((line) => line.includes('4555')));
});
test('partially completed setup fills only missing fields and preserves existing features', async (t) => {
  const original = valid.replace('DISCORD_GUILD_ID=100002', 'DISCORD_GUILD_ID=') + 'DISCORD_LEVELING_ENABLED=true\n';
  const f = await fixture(t, original, ['100002', 'n']); await runSetup(f.options);
  assert.ok((await f.read()).startsWith(original)); assert.equal(loadConfig(parseEnv(await f.read())).levelingEnabled, true);
  assert.equal(f.asked.length, 2);
});
test('cancellation leaves no new configuration or changes to an existing file', async (t) => {
  for (const original of [null, 'DISCORD_APPLICATION_ID=100001\n']) {
    const f = await fixture(t, original, [new Error('cancelled')]); await assert.rejects(runSetup(f.options), /cancelled/);
    assert.equal(await readEnv(path.join(f.root, '.env')), original); assert.deepEqual((await fs.readdir(f.root)).filter((name) => name.endsWith('.tmp')), []);
  }
});
test('plain setup preserves existing files and creates blank templates without asking questions', async (t) => {
  const f = await fixture(t); await runSetup({ ...f.options, plain: true }); const first = await f.read();
  await runSetup({ ...f.options, plain: true }); assert.equal(await f.read(), first); assert.equal(f.asked.length, 0);
});
test('stale configuration snapshots cannot replace edits made while setup was running', async (t) => {
  const f = await fixture(t, valid); await fs.writeFile(path.join(f.root, '.env'), valid + '# edited\n');
  await assert.rejects(saveEnv(f.root, valid, valid + '# wizard\n'), /changed during setup/);
  assert.equal(await f.read(), valid + '# edited\n'); assert.ok(!(await fs.readdir(f.root)).some((name) => name.endsWith('.tmp')));
});
test('environment conflicts and invalid existing settings fail before saving', async (t) => {
  const f = await fixture(t, valid);
  await assert.rejects(runSetup({ ...f.options, inherited: { DISCORD_GUILD_ID: '999999' } }), /conflict/); assert.equal(await f.read(), valid);
  const invalid = await fixture(t, valid + 'PORT=not-a-port\n'); await assert.rejects(runSetup(invalid.options), /existing settings are invalid/);
});
test('existing token files are kept without requesting or printing a token', async (t) => {
  const f = await fixture(t, null, ['n']); const tokenFile = path.join(f.root, 'token.txt'); await fs.writeFile(tokenFile, 'fixture-from-file');
  await fs.writeFile(path.join(f.root, '.env'), valid.replace('DISCORD_BOT_TOKEN=fixture-token', `DISCORD_BOT_TOKEN_FILE=${tokenFile}`));
  await runSetup(f.options); assert.equal(f.asked.length, 1); assert.ok(!f.lines.join('\n').includes('fixture-from-file'));
});
test('registration is explicit and uses only the configured guild and real declarations', async (t) => {
  const f = await fixture(t, valid, ['yes']); const result = await runSetup(f.options);
  assert.equal(result.registered, true); assert.equal(f.calls.length, commands.length + 1);
  assert.deepEqual(f.calls.slice(1).map((call) => call.body), commands);
  assert.ok(f.calls.slice(1).every((call) => call.route === '/applications/100001/guilds/100002/commands' && call.method === 'POST'));
});
test('registration failures preserve saved configuration and redact upstream errors', async (t) => {
  const f = await fixture(t, valid, ['y']); const result = await runSetup({ ...f.options, apiFactory: () => ({ async request() { throw new Error('fixture-token'); } }) });
  assert.equal(result.registered, false); assert.equal(await f.read(), valid); assert.ok(!f.lines.join('\n').includes('fixture-token'));
});
test('failed local checks stop registration and point to the affected check', async (t) => {
  const f = await fixture(t, valid); const result = await runSetup({ ...f.options, inspect: async () => ({ ok: false, checks: [{ status: 'fail', name: 'Ticket store', detail: 'Restore a backup.' }] }) });
  assert.equal(result.ok, false); assert.equal(f.calls.length, 0); assert.ok(f.lines.some((line) => line.includes('Ticket store')));
});
test('non-regular and oversized configuration files are refused', async (t) => {
  const f = await fixture(t); await fs.mkdir(path.join(f.root, '.env')); await assert.rejects(runSetup(f.options), /regular/);
  const other = await fixture(t, 'x'.repeat(65537)); await assert.rejects(runSetup(other.options), /64 KiB/);
});
test('unsupported setup flags fail before accessing configuration', async () => {
  await assert.rejects(main(['--force']), /Usage/); await assert.rejects(main(['--guided', '--plain']), /Usage/);
});

function terminal() {
  const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {};
  let text = ''; const output = new Writable({ write(chunk, encoding, callback) { text += chunk.toString(); callback(); } }); output.isTTY = true;
  return { input, output, text: () => text };
}
test('terminal prompt suppresses pasted secrets and resumes visible output', async () => {
  const io = terminal(), ui = createPrompter(io.input, io.output);
  try {
    const pending = ui.ask('Token: ', { secret: true }); io.input.write('sensitive-fixture\r'); assert.equal(await pending, 'sensitive-fixture');
    ui.say('Saved'); const next = ui.ask('Continue: '); io.input.write('yes\r'); assert.equal(await next, 'yes');
    assert.ok(!io.text().includes('sensitive-fixture')); assert.ok(io.text().includes('Saved')); assert.ok(io.text().includes('yes'));
  } finally { ui.close(); }
});
test('terminal cancellation and EOF reject pending questions cleanly', async () => {
  for (const eof of [false, true]) {
    const io = terminal(), ui = createPrompter(io.input, io.output);
    const pending = assert.rejects(ui.ask('Token: ', { secret: true }), /cancelled/);
    if (eof) io.input.end(); else io.input.write('\x03');
    await pending; ui.close();
  }
  assert.throws(() => createPrompter({}, {}), /terminal/);
});
