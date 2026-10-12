'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { version } = require('../package.json');
const { commands } = require('../src/commands');
const { catalog } = require('./command-catalog');

const ROOT = path.resolve(__dirname, '..');
const TEST_ARGS = ['--test-reporter=tap', '--experimental-test-coverage', '--test-coverage-lines=85', '--test-coverage-branches=75', '--test-coverage-functions=80', 'test/run.js'];
const REQUIRED_SMOKE = ['runtime-startup', 'health', 'unsigned-rejection', 'signed-ping', 'signed-command', 'duplicate-protection', 'private-response', 'scheduler-shutdown', 'thirteen-store-backup', 'backup-verification', 'economy-recovery', 'signed-calculator', 'signed-server-artwork', 'signed-giveaway-create', 'signed-giveaway-edit', 'signed-giveaway-preview', 'signed-giveaway-clear', 'community-recovery', 'signed-ticket-create', 'signed-ticket-guest-add', 'signed-ticket-guest-list', 'signed-ticket-guest-remove', 'signed-ticket-close', 'ticket-guest-recovery', 'ticket-closure-recovery', 'signed-ticket-transcript-text', 'signed-ticket-transcript-json', 'signed-ticket-transcript-paged-gzip', 'signed-ticket-transcript-continuation', 'compressed-transcript-unpack', 'signed-ticket-queue-history', 'signed-automod-keywords-create', 'signed-automod-policy', 'signed-automod-keywords-edit', 'signed-automod-rename', 'signed-automod-mentions-create', 'signed-automod-mentions-edit', 'signed-automod-info', 'signed-starboard-configure', 'signed-starboard-sync', 'starboard-duplicate-protection', 'signed-starboard-status', 'starboard-backup-recovery', 'signed-starboard-recover', 'signed-starboard-history', 'starboard-deletion-recovery', 'signed-starboard-retire', 'signed-starboard-source-remove', 'signed-starboard-prune'];

function executeNode(args, { spawn = spawnSync, environment = process.env, root = ROOT } = {}) {
  const env = Object.fromEntries(Object.entries(environment).filter(([name]) => !/^(?:STARBOARD_|DISCORD_|TICKET_|MODERATION_|ECONOMY_|LEVEL_|COMMUNITY_|VOICE_|ROLE_MENU_|TEMPLATE_|RESPONDER_|TIMER_)/.test(name)));
  const result = spawn(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  return { status: result.status, stdout: result.stdout || '' };
}

async function publicFiles(root = ROOT) {
  const files = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('Public source contains a linked file.');
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile()) files.push(relative);
    }
  }
  for (const directory of ['src', 'scripts', 'test', 'docs', '.github']) await walk(directory);
  for (const file of ['package.json', 'LICENSE', 'README.md', 'COMMANDS.md', 'CHANGELOG.md', 'ROADMAP.md', 'AGENTS.md', 'Dockerfile', '.dockerignore', '.gitignore', 'Latch-Setup.cmd', 'Latch-Start.cmd']) {
    const stat = await fs.lstat(path.join(root, file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Public source contains an invalid file.');
    files.push(file);
  }
  return files.sort();
}

async function sourceDigest(files, root = ROOT) {
  const hash = createHash('sha256');
  for (const file of files) {
    const data = await fs.readFile(path.join(root, file));
    hash.update(file).update('\0').update(String(data.length)).update('\0').update(data);
  }
  return hash.digest('hex');
}

function testSummary(output) {
  const get = (name) => Number(output.match(new RegExp(`^# ${name} (\\d+)\\s*$`, 'm'))?.[1] ?? NaN);
  const result = { total: get('tests'), passed: get('pass'), failed: get('fail'), cancelled: get('cancelled'), skipped: get('skipped'), todo: get('todo') };
  return Object.values(result).every(Number.isSafeInteger) && result.total > 0 && result.passed === result.total && result.failed === 0 && result.cancelled === 0 && result.skipped === 0 && result.todo === 0 ? result : null;
}

async function verifyRelease({ root = ROOT, execute = (args) => executeNode(args, { root }) } = {}) {
  const files = await publicFiles(root);
  const report = { version, node: process.versions.node, platform: process.platform, sourceSha256: await sourceDigest(files, root), publicFiles: files.length, commandPaths: catalog.length, commandRoots: commands.length, tests: null, runtimeChecks: [], checks: [], ok: false, liveDiscordValidated: false, stableReady: false };
  async function check(name, args, inspect = () => true) {
    let result;
    try { result = await execute(args); } catch { result = { status: null, stdout: '' }; }
    let passed = result?.status === 0;
    if (passed) { try { passed = inspect(result.stdout) === true; } catch { passed = false; } }
    report.checks.push({ name, passed });
    return passed;
  }
  if (!await check('Automated tests and coverage floors', TEST_ARGS, (output) => { report.tests = testSummary(output); return report.tests !== null; })) return report;
  const scripts = files.filter(file => /^(?:src|scripts|test)\/.*\.js$/.test(file));
  let syntaxPassed = true, failedFile;
  for (const file of scripts) {
    try { if ((await execute(['--check', file]))?.status !== 0) { syntaxPassed = false; failedFile = file; break; } } catch { syntaxPassed = false; failedFile = file; break; }
  }
  report.checks.push({ name: 'JavaScript syntax', passed: syntaxPassed, ...(failedFile ? { file: failedFile } : {}) });
  if (!syntaxPassed) return report;
  if (!await check('Generated command reference', ['scripts/command-catalog.js', '--check'])) return report;
  if (!await check('Publication text', ['scripts/check-publication-text.js'])) return report;
  if (!await check('Isolated signed runtime and backup recovery', ['scripts/release-smoke.js'], (output) => {
    const smoke = JSON.parse(output);
    if (smoke.ok !== true || smoke.version !== version || !Array.isArray(smoke.checks) || !REQUIRED_SMOKE.every(name => smoke.checks.includes(name)) || new Set(smoke.checks).size !== smoke.checks.length || smoke.checks.some(value => typeof value !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value))) return false;
    report.runtimeChecks = smoke.checks; return true;
  })) return report;
  // Detect source edits during verification rather than certifying mixed files.
  report.ok = report.sourceSha256 === await sourceDigest(await publicFiles(root), root);
  report.checks.push({ name: 'Source unchanged during verification', passed: report.ok });
  return report;
}

async function main(args = process.argv.slice(2), verify = verifyRelease) {
  let json = false, output;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json' && !json) json = true;
    else if (args[i] === '--output' && !output && args[i + 1] && path.extname(args[i + 1]).toLowerCase() === '.json') output = path.resolve(args[++i]);
    else throw new Error('Usage: npm run release:verify -- [--json] [--output report.json]');
  }
  const report = await verify();
  const text = JSON.stringify(report, null, 2) + '\n';
  if (output) { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
  if (json) console.log(text.trimEnd());
  else {
    console.log(`Latch ${report.version}: automated release verification`);
    for (const check of report.checks) console.log(`[${check.passed ? 'PASS' : 'FAIL'}] ${check.name}${check.file ? ` (${check.file})` : ''}`);
    console.log('Live Discord acceptance remains a separate stable-release requirement. See docs/RELEASE.md.');
  }
  if (!report.ok) process.exitCode = 1;
  return report;
}

if (require.main === module) main().catch(() => { console.error('Release verification could not finish. Use supported arguments and a new JSON output file, then inspect local test/file access.'); process.exitCode = 1; });
module.exports = { verifyRelease, main, publicFiles, sourceDigest, testSummary, TEST_ARGS, REQUIRED_SMOKE, executeNode };
