'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { storeDefinitions, openStore } = require('../src/store-registry');
const { loadConfig } = require('../src/config');
const { version } = require('../package.json');
const MAX_BYTES = 32 * 1024 * 1024;
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
const exact = (object, keys) => object && !Array.isArray(object) && Object.keys(object).sort().join(',') === keys.split(',').sort().join(',');
async function readFile(file, limit = MAX_BYTES) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error('Expected a bounded regular file.');
  const data = await fs.readFile(file);
  if (data.length > limit) throw new Error('File exceeds its size limit.');
  return data;
}
async function optionalFile(file) {
  try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function verifyBackup(directory, expectedGuildId) {
  const root = path.resolve(directory), stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Backup must be a regular directory.');
  const manifestFile = path.join(root, 'manifest.json'), manifestData = await readFile(manifestFile, 65536);
  const manifest = JSON.parse(manifestData.toString('utf8'));
  if (!exact(manifest, 'version,opendeskVersion,guildId,createdAt,stores') || manifest.version !== 1 || !/^\d+\.\d+\.\d+$/.test(manifest.opendeskVersion)
    || typeof manifest.guildId !== 'string' || !/^\d{5,25}$/.test(manifest.guildId) || expectedGuildId !== undefined && manifest.guildId !== expectedGuildId
    || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) || new Date(manifest.createdAt).toISOString() !== manifest.createdAt
    || !Array.isArray(manifest.stores) || ![storeDefinitions.length, storeDefinitions.length - 1].includes(manifest.stores.length)) throw new Error('Invalid backup manifest or guild mismatch.');
  const expectedFiles = new Set(['manifest.json']);
  for (const definition of storeDefinitions) {
    const entries = manifest.stores.filter((record) => record.key === definition.key), record = entries[0];
    if (definition.key === 'starboardStorePath' && entries.length === 0 && manifest.stores.length === storeDefinitions.length - 1) continue;
    if (entries.length !== 1 || !exact(record, 'key,file,present,bytes,sha256') || record.file !== definition.file || typeof record.present !== 'boolean'
      || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > MAX_BYTES
      || (record.present ? typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256) : record.sha256 !== null || record.bytes !== 0)) throw new Error('Invalid backup store entry.');
    const file = path.join(root, definition.file);
    if (!record.present) {
      if (await optionalFile(file) !== null) throw new Error('Unexpected file for a missing store.');
      continue;
    }
    expectedFiles.add(definition.file); const data = await readFile(file);
    if (data.length !== record.bytes || digest(data) !== record.sha256) throw new Error(`Checksum mismatch: ${definition.name}.`);
    await openStore(definition, file, manifest.guildId).load();
    if (digest(await readFile(file)) !== record.sha256) throw new Error('Backup changed during verification.');
  }
  const files = await fs.readdir(root);
  if (files.length !== expectedFiles.size || files.some((file) => !expectedFiles.has(file))) throw new Error('Backup contains unexpected files.');
  if (digest(await readFile(manifestFile, 65536)) !== digest(manifestData)) throw new Error('Manifest changed during verification.');
  return { ok: true, guildId: manifest.guildId, opendeskVersion: manifest.opendeskVersion, present: manifest.stores.filter((record) => record.present).length, missing: [...manifest.stores.filter((record) => !record.present).map((record) => record.key), ...(!manifest.stores.some(record => record.key === 'starboardStorePath') ? ['starboardStorePath'] : [])] };
}
async function createBackup(config, directory, { now = () => new Date() } = {}) {
  const root = path.resolve(directory), sourceFiles = storeDefinitions.map((definition) => path.resolve(config[definition.key]));
  if (new Set(sourceFiles.map((file) => file.toLowerCase())).size !== sourceFiles.length || sourceFiles.some((file) => file === root || file.startsWith(root + path.sep))) throw new Error('Backup destination must not contain source stores.');
  // Reserve the directory exclusively. An incomplete backup deliberately remains
  // after failure so another command cannot mistake it for a verified snapshot.
  await fs.mkdir(root, { mode: 0o700 });
  const manifest = { version: 1, opendeskVersion: version, guildId: config.guildId, createdAt: now().toISOString(), stores: [] };
  for (const definition of storeDefinitions) {
    const data = await optionalFile(config[definition.key]);
    const record = { key: definition.key, file: definition.file, present: data !== null, bytes: data?.length ?? 0, sha256: data === null ? null : digest(data) };
    manifest.stores.push(record);
    if (data !== null) {
      const file = path.join(root, definition.file); await fs.writeFile(file, data, { flag: 'wx', mode: 0o600 });
      await openStore(definition, file, config.guildId).load();
    }
  }
  for (let i = 0; i < storeDefinitions.length; i++) {
    const data = await optionalFile(config[storeDefinitions[i].key]), record = manifest.stores[i];
    if ((data !== null) !== record.present || data !== null && digest(data) !== record.sha256) throw new Error('Source stores changed during backup. Stop the bot and create a new backup.');
  }
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return verifyBackup(root, config.guildId);
}
async function main(args = process.argv.slice(2)) {
  const action = args[0], directory = args[1];
  if (!['create', 'verify'].includes(action) || typeof directory !== 'string' || !directory.trim() || args.length !== 2) throw new Error('Usage: npm run backup -- create <new-directory> | verify <backup-directory>');
  if (action === 'create') console.log('Stop the bot before backup creation. Filesystem checks cannot prove a consistent snapshot of a running process.');
  const result = action === 'create' ? await createBackup(loadConfig(), directory) : await verifyBackup(directory);
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) main().catch(() => { console.error('Backup operation failed. Check arguments, stop the bot before creating backups, and verify store access/formats. Existing data and backups are never overwritten. An incomplete destination must not be used for restore.'); process.exitCode = 1; });
module.exports = { createBackup, verifyBackup, main, storeDefinitions };
