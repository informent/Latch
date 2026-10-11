'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CommunityStore } = require('../src/community-store');
const { CommunityService, giveawayMessage } = require('../src/community-service');
const { defaultPresentation, validPresentation, validMediaUrl } = require('../src/giveaway-presentation');
const { createInteractionHandler } = require('../src/interactions');
const { commands } = require('../src/commands');
const { createBackup, verifyBackup, storeDefinitions } = require('../scripts/backup');
const { ids, epoch, directory, fakeDiscord, interaction } = require('./feature-fixtures');

const media = 'https://cdn.example.org/prize.png?size=1024';
const thumbnail = 'https://cdn.example.org/thumb.png';
async function fixture(t, create = true) {
  const root = await directory(t), f = fakeDiscord(); let clock = epoch;
  const config = { guildId: ids.guild, applicationId: ids.bot, communityStorePath: path.join(root, 'community.json') };
  const store = new CommunityStore(config.communityStorePath, { pick: () => 0 });
  const now = () => new Date(clock); const logs = [];
  const community = new CommunityService({ config, store, ...f, now, logger: (...args) => logs.push(args) });
  t.after(() => community.stop());
  const handler = createInteractionHandler({ config, community, ...f, now, logger: (...args) => logs.push(args) });
  const input = { id: ids.menu, channelId: ids.channel, userId: ids.actor, text: 'Community prize', minutes: 30, winnerCount: 1 };
  if (create) await community.createGiveaway(input);
  async function run(action, values = {}, subaction, permissions = '8192', guild = ids.guild) {
    const payload = interaction('giveaway', action, values, permissions); payload.guild_id = guild;
    if (subaction) payload.data.options[0].options = [{ name: subaction, options: payload.data.options[0].options }];
    const result = await handler(payload); assert.equal(result.immediate.data.flags, 64);
    if (!result.work) return result.immediate.data;
    await result.work(); const reply = f.calls.filter(([kind]) => kind === 'response').at(-1)[3];
    assert.deepEqual(reply.allowed_mentions, { parse: [] }); assert.ok(reply.content.length < 1900); return reply;
  }
  return { ...f, root, config, store, community, input, run, now, logs, advance: (ms = 15000) => { clock += ms; } };
}

test('create publishes and persists complete giveaway details from the command', async (t) => {
  const f = await fixture(t, false);
  assert.match((await f.run('create', { prize: 'Tickets', minutes: 60, winners: 2, description: '@everyone Event details', host: ids.user, image: media, thumbnail })).content, /is open/);
  const job = f.store.get(ids.menu);
  assert.deepEqual(job.presentation, { hostId: ids.user, description: '@everyone Event details', image: media, thumbnail });
  assert.equal(job.userId, ids.actor); assert.equal(job.winnerCount, 2);
  const sent = f.calls.find(([kind]) => kind === 'message')[2];
  assert.ok(sent.embeds[0].description.includes(`<@${ids.user}>`)); assert.ok(sent.embeds[0].description.includes('@everyone Event details'));
  assert.deepEqual(sent.embeds[0].image, { url: media }); assert.deepEqual(sent.embeds[0].thumbnail, { url: thumbnail });
  assert.deepEqual(sent.allowed_mentions, { parse: [] });
  const reload = new CommunityStore(f.config.communityStorePath); await reload.load(); assert.deepEqual(reload.get(ids.menu), job);
  assert.equal(JSON.parse(await fs.readFile(f.config.communityStorePath, 'utf8')).version, 3);
});

for (const [field, value, option] of [['description', 'More details', 'description'], ['image', media, 'url'], ['thumbnail', thumbnail, 'url'], ['host', ids.user, 'host']]) {
  test(`editing ${field} refreshes the saved message and preserves entrants and requirements`, async (t) => {
    const f = await fixture(t); const job = f.store.get(ids.menu);
    await f.community.enter({ id: ids.menu, channelId: ids.channel, messageId: job.messageId, userId: ids.user });
    assert.match((await f.run('edit', { id: ids.menu, [option]: value }, field)).content, /updated/);
    const updated = f.store.get(ids.menu); assert.equal(updated.presentation[field === 'host' ? 'hostId' : field], value);
    assert.equal(updated.userId, ids.actor); assert.deepEqual(updated.entrants, [ids.user]); assert.deepEqual(updated.requirements, job.requirements);
    assert.equal(updated.retryAt, null); assert.equal(f.calls.filter(([kind]) => kind === 'message').length, 1);
    const saved = f.messages.get(job.messageId); assert.deepEqual(saved.embeds, giveawayMessage(updated).embeds);
  });
}

test('media URLs allow bounded HTTPS CDN paths and reject invalid or unsafe forms', () => {
  for (const url of [media, 'https://cdn.example.org/file%20name.png', 'HTTPS://EXAMPLE.ORG:443/image.png']) assert.equal(validMediaUrl(url), true, url);
  for (const url of [null, 7, '', 'http://example.org/image.png', 'javascript:alert(1)', 'file:///tmp/file', 'attachment://image.png', 'https://user:secret@example.org/image', 'https://example.org/image#x', 'https://example.org/image#', 'https://example.org:8443/image', 'https://127.0.0.1/image', 'https://[::1]/image', 'https://localhost/image', 'https://x.localhost/image', 'https://example..org/image', 'https://-bad.example.org/image', 'https://example.org/white space', 'https://example.org/\nimage', 'https://example.org\\image', 'https://example.org/' + 'x'.repeat(1024)]) assert.equal(validMediaUrl(url), false, String(url));
});

test('invalid description and image edits preserve committed disk and public state', async (t) => {
  const f = await fixture(t); const before = await fs.readFile(f.config.communityStorePath, 'utf8'); const job = f.store.get(ids.menu); const edits = f.calls.length;
  for (const [field, value] of [['description', 'x'.repeat(1501)], ['description', {}], ['description', ''], ['description', '   '], ['image', 'http://example.org/x'], ['thumbnail', 'https://user:secret@example.org/x'], ['host', 'bad'], ['clear', 'prize']]) await assert.rejects(f.community.editGiveaway(ids.menu, field, value));
  assert.deepEqual(f.store.get(ids.menu), job); assert.equal(await fs.readFile(f.config.communityStorePath, 'utf8'), before); assert.equal(f.calls.length, edits);
});

test('invalid creation details never save or publish a giveaway', async (t) => {
  const f = await fixture(t, false);
  for (const details of [{ description: 'x'.repeat(1501) }, { image: 'http://example.org/x' }, { thumbnail: 'https://example.org/x#secret' }, { hostId: ids.bot }, { hostId: ids.role }]) await assert.rejects(f.community.createGiveaway({ ...f.input, ...details }));
  assert.equal(f.store.get(ids.menu), null); assert.deepEqual(f.calls, []); await assert.rejects(fs.stat(f.config.communityStorePath), { code: 'ENOENT' });
});

test('host attribution requires current human identity and hides lookup errors', async (t) => {
  const f = await fixture(t); const before = f.store.get(ids.menu);
  for (const host of [ids.bot, ids.role]) await assert.rejects(f.community.editGiveaway(ids.menu, 'host', host));
  f.discord.getGuildMember = async () => ({ user: { id: ids.owner } }); await assert.rejects(f.community.editGiveaway(ids.menu, 'host', ids.user));
  f.discord.getGuildMember = async () => { throw new Error('private-remote-token'); };
  const reply = await f.run('edit', { id: ids.menu, host: ids.user }, 'host'); assert.match(reply.content, /current human/);
  assert.doesNotMatch(JSON.stringify({ reply, logs: f.logs }), /private-remote-token/); assert.deepEqual(f.store.get(ids.menu), before);
});

test('clear resets one selected field or all presentation while preserving the giveaway', async (t) => {
  const f = await fixture(t);
  const full = { hostId: ids.user, description: 'Details', image: media, thumbnail };
  for (const field of ['host', 'description', 'image', 'thumbnail', 'all']) {
    for (const [key, value] of Object.entries(full)) await f.community.editGiveaway(ids.menu, key === 'hostId' ? 'host' : key, value);
    const before = f.store.get(ids.menu); await f.run('edit', { id: ids.menu, field }, 'clear');
    const key = field === 'host' ? 'hostId' : field;
    assert.deepEqual(f.store.get(ids.menu).presentation, field === 'all' ? defaultPresentation(ids.actor) : { ...full, [key]: defaultPresentation(ids.actor)[key] });
    const { presentation: _, ...remaining } = f.store.get(ids.menu); const { presentation: __, ...previous } = before; assert.deepEqual(remaining, previous);
  }
});

test('preview shows saved details privately without creating messages or usable buttons', async (t) => {
  const f = await fixture(t); await f.community.editGiveaway(ids.menu, 'description', 'Saved details');
  const before = f.store.get(ids.menu); const count = f.calls.length;
  const reply = await f.run('preview', { id: ids.menu });
  assert.match(reply.content, /Private preview/); assert.deepEqual(reply.embeds, giveawayMessage(before).embeds); assert.equal(reply.components, undefined);
  assert.deepEqual(f.store.get(ids.menu), before); assert.ok(f.calls.slice(count).every(([kind]) => kind === 'response'));
  reply.embeds[0].description = 'mutated'; assert.notEqual(f.community.previewGiveaway(ids.menu).embeds[0].description, 'mutated');
});

test('preview cannot expose another guild, missing job or reminder', async (t) => {
  const f = await fixture(t);
  await f.store.create({ ...f.input, id: ids.role, kind: 'reminder', guildId: ids.guild }, f.now());
  await f.store.create({ ...f.input, id: ids.owner, kind: 'giveaway', guildId: ids.owner }, f.now());
  for (const id of [ids.bot, ids.role, ids.owner]) await assert.rejects(Promise.resolve().then(() => f.community.previewGiveaway(id)));
  assert.deepEqual((await f.run('preview', { id: ids.bot })).embeds, []);
});

for (const action of ['preview', 'edit', 'list']) test(`${action} enforces staff access and guild before service work`, async (t) => {
  const f = await fixture(t); f.community.previewGiveaway = f.community.editGiveaway = f.community.list = () => { throw new Error('Must not access'); };
  const before = f.calls.length;
  assert.match((await f.run(action, { id: ids.menu, image: media }, action === 'edit' ? 'image' : undefined, '0')).content, /Manage Messages/);
  assert.match((await f.run(action, { id: ids.menu }, action === 'edit' ? 'host' : undefined, '8', ids.owner)).content, /not available/);
  assert.equal(f.calls.length, before);
});

test('presentation updates survive failed refresh, restart and scheduler retry without reposting', async (t) => {
  const f = await fixture(t); const edit = f.discord.editMessage; f.discord.editMessage = async () => { throw new Error('network-secret'); };
  const reply = await f.run('edit', { id: ids.menu, description: 'Persisted while offline' }, 'description'); assert.match(reply.content, /retry/);
  const job = f.store.get(ids.menu); assert.equal(job.presentation.description, 'Persisted while offline'); assert.equal(job.attempts, 1); assert.ok(job.retryAt);
  const reload = new CommunityStore(f.config.communityStorePath); await reload.load();
  const resumed = new CommunityService({ config: f.config, store: reload, discord: f.discord, now: f.now }); t.after(() => resumed.stop());
  f.discord.editMessage = edit; const count = f.calls.length; await resumed.tick(); assert.equal(f.calls.length, count);
  f.advance(); await resumed.tick(); assert.equal(reload.get(ids.menu).retryAt, null); assert.equal(reload.get(ids.menu).messageId, job.messageId);
  assert.ok(f.messages.get(job.messageId).embeds[0].description.includes('Persisted while offline')); assert.equal(f.calls.filter(([kind]) => kind === 'message').length, 1);
  assert.doesNotMatch(JSON.stringify({ reply, logs: f.logs }), /network-secret/);
});

test('failed atomic replacement preserves presentation and version and permits later recovery', async (t) => {
  const f = await fixture(t); const before = await fs.readFile(f.config.communityStorePath, 'utf8'); const job = f.store.get(ids.menu);
  const rename = fs.rename; t.mock.method(fs, 'rename', async () => { throw new Error('write failed'); });
  await assert.rejects(f.community.editGiveaway(ids.menu, 'image', media));
  assert.equal(await fs.readFile(f.config.communityStorePath, 'utf8'), before); assert.deepEqual(f.store.get(ids.menu), job); assert.ok(!(await fs.readdir(f.root)).some(name => name.endsWith('.tmp')));
  t.mock.restoreAll(); assert.equal(fs.rename, rename); await f.community.editGiveaway(ids.menu, 'image', media); assert.equal(f.store.get(ids.menu).presentation.image, media);
});

test('serialized concurrent edits merge all fields and readers see the committed presentation', async (t) => {
  const f = await fixture(t); let arrive, release;
  const entered = new Promise(resolve => { arrive = resolve; }); const gate = new Promise(resolve => { release = resolve; });
  const rename = fs.rename; t.mock.method(fs, 'rename', async (...args) => { arrive(); await gate; return rename(...args); }); t.after(() => release());
  const first = f.community.editGiveaway(ids.menu, 'description', 'One'); await entered;
  assert.equal(f.store.get(ids.menu).presentation.description, '');
  const second = f.community.editGiveaway(ids.menu, 'image', media); release(); await Promise.all([first, second]);
  assert.equal(f.store.get(ids.menu).presentation.description, 'One'); assert.equal(f.store.get(ids.menu).presentation.image, media);
});

test('failed initial publication retains configured details and publishes once after recovery', async (t) => {
  const f = await fixture(t, false); const create = f.discord.createMessage;
  f.discord.createMessage = async () => { throw new Error('offline'); };
  const draft = await f.community.createGiveaway({ ...f.input, description: 'Ready', image: media }); assert.equal(draft.state, 'draft'); assert.ok(draft.retryAt);
  await f.community.editGiveaway(ids.menu, 'thumbnail', thumbnail); assert.equal(f.store.get(ids.menu).state, 'draft');
  f.discord.createMessage = create; f.advance(); await f.community.tick(); const job = f.store.get(ids.menu); assert.equal(job.state, 'open');
  assert.equal(job.presentation.description, 'Ready'); assert.equal(job.presentation.thumbnail, thumbnail); assert.equal(f.calls.filter(([kind]) => kind === 'message').length, 1);
});

test('host attribution does not grant staff access or change entry and winner behavior', async (t) => {
  const f = await fixture(t); await f.community.editGiveaway(ids.menu, 'host', ids.user);
  const payload = interaction('giveaway', 'end', { id: ids.menu }, '0'); payload.member.user.id = ids.user;
  const handler = createInteractionHandler({ config: f.config, community: f.community, discord: f.discord });
  assert.match((await handler(payload)).immediate.data.content, /Manage Messages/);
  await f.community.enter({ id: ids.menu, channelId: ids.channel, messageId: f.store.get(ids.menu).messageId, userId: ids.user });
  const finished = await f.community.endGiveaway(ids.menu); assert.equal(finished.state, 'finished'); assert.deepEqual(finished.winners, [ids.user]); assert.equal(finished.presentation.hostId, ids.user);
  await assert.rejects(f.community.editGiveaway(ids.menu, 'description', 'Closed'));
  const preview = f.community.previewGiveaway(ids.menu); assert.match(preview.embeds[0].title, /ended/); assert.ok(preview.embeds[0].description.includes(`<@${ids.user}>`));
});

test('expired, cancelled and selecting giveaways refuse presentation changes', async (t) => {
  const f = await fixture(t); f.advance(30 * 60000);
  await assert.rejects(f.community.editGiveaway(ids.menu, 'host', ids.user)); await assert.rejects(f.community.editGiveaway(ids.menu, 'description', 'Late'));
  await f.store.beginSelection({ id: ids.menu, guildId: ids.guild }, f.now()); await assert.rejects(f.community.editGiveaway(ids.menu, 'image', media));
  await f.community.cancelGiveaway(ids.menu); await assert.rejects(f.community.editGiveaway(ids.menu, 'clear', 'all'));
});

test('maximum description, prize, IDs, requirements and winners fit Discord embed limits', async (t) => {
  const f = await fixture(t); const job = f.store.get(ids.menu);
  job.text = 'p'.repeat(200); job.presentation = { hostId: '9'.repeat(25), description: 'd'.repeat(1500), image: media, thumbnail };
  job.requirements = { roles: Array.from({ length: 5 }, (_, i) => String(9000000000000000000000000n + BigInt(i))), minLevel: 1000, maxLevel: 1000 };
  job.winners = Array.from({ length: 20 }, (_, i) => String(8000000000000000000000000n + BigInt(i))); job.entrants = [...job.winners]; job.state = 'finished';
  const embed = giveawayMessage(job).embeds[0]; assert.ok(embed.description.length <= 4096); assert.ok(embed.title.length + embed.description.length + embed.footer.text.length <= 6000);
  assert.ok(embed.description.includes('d'.repeat(1500))); assert.ok(embed.description.includes(job.winners.at(-1)));
});

for (const version of [1, 2]) test(`community version ${version} loads without rewrite and migrates on successful edit`, async (t) => {
  const f = await fixture(t); const legacy = f.store.get(ids.menu); delete legacy.presentation; if (version === 1) delete legacy.requirements;
  const raw = JSON.stringify({ version, jobs: [legacy] }); await fs.writeFile(f.config.communityStorePath, raw); await f.store.load(); assert.equal(await fs.readFile(f.config.communityStorePath, 'utf8'), raw);
  const rename = fs.rename; t.mock.method(fs, 'rename', async () => { throw new Error('failure'); });
  await assert.rejects(f.community.editGiveaway(ids.menu, 'description', 'Migrated')); assert.equal(await fs.readFile(f.config.communityStorePath, 'utf8'), raw); assert.equal(f.store.get(ids.menu).presentation, undefined);
  t.mock.restoreAll(); assert.equal(fs.rename, rename); await f.community.editGiveaway(ids.menu, 'description', 'Migrated');
  const migrated = JSON.parse(await fs.readFile(f.config.communityStorePath, 'utf8')); assert.equal(migrated.version, 3); assert.equal(migrated.jobs[0].presentation.description, 'Migrated');
  assert.equal(Object.hasOwn(migrated.jobs[0], 'requirements'), version === 2);
});

test('strict store validation preserves corrupt presentation records and unsupported versions', async (t) => {
  const f = await fixture(t); const job = f.store.get(ids.menu);
  const invalid = [null, [], {}, { ...job.presentation, extra: true }, { ...job.presentation, hostId: 123 }, { ...job.presentation, description: 'x'.repeat(1501) }, { ...job.presentation, image: 'http://example.org/x' }, { ...job.presentation, thumbnail: 'file:///tmp/x' }];
  for (const presentation of invalid) {
    const raw = JSON.stringify({ version: 3, jobs: [{ ...job, presentation }] }); await fs.writeFile(f.config.communityStorePath, raw);
    await assert.rejects(new CommunityStore(f.config.communityStorePath).load()); assert.equal(await fs.readFile(f.config.communityStorePath, 'utf8'), raw);
  }
  for (const version of [0, 1, 2, 4]) { const raw = JSON.stringify({ version, jobs: [job] }); await fs.writeFile(f.config.communityStorePath, raw); await assert.rejects(new CommunityStore(f.config.communityStorePath).load()); assert.equal(await fs.readFile(f.config.communityStorePath, 'utf8'), raw); }
  assert.equal(validPresentation(defaultPresentation(ids.actor)), true); assert.equal(validPresentation(null), false);
});

test('reminder records cannot carry giveaway presentation fields', async (t) => {
  const f = await fixture(t); await assert.rejects(f.store.create({ ...f.input, id: ids.role, kind: 'reminder', guildId: ids.guild, presentation: defaultPresentation(ids.actor) }, f.now()));
  const reminder = await f.store.create({ ...f.input, id: ids.role, kind: 'reminder', guildId: ids.guild }, f.now());
  await fs.writeFile(f.config.communityStorePath, JSON.stringify({ version: 3, jobs: [{ ...reminder, presentation: defaultPresentation(ids.actor) }] }));
  await assert.rejects(new CommunityStore(f.config.communityStorePath).load());
});

test('version 3 giveaway details are included in verified backups and restored previews', async (t) => {
  const f = await fixture(t); await f.community.editGiveaway(ids.menu, 'description', 'Backup details'); await f.community.editGiveaway(ids.menu, 'image', media);
  for (const definition of storeDefinitions) f.config[definition.key] ??= path.join(f.root, definition.file);
  const destination = path.join(f.root, 'backup'); await createBackup(f.config, destination, { now: f.now }); const result = await verifyBackup(destination, ids.guild); assert.equal(result.present, 1);
  const restored = new CommunityStore(path.join(destination, 'community.json')); await restored.load();
  assert.deepEqual(restored.get(ids.menu).presentation, f.store.get(ids.menu).presentation);
  assert.deepEqual(giveawayMessage(restored.get(ids.menu)), giveawayMessage(f.store.get(ids.menu)));
});

test('giveaway list pages expose every full prize with exact IDs and no mutation', async (t) => {
  const f = await fixture(t, false);
  for (let i = 0; i < 20; i++) await f.store.create({ ...f.input, id: String(9000000000000000000000000n + BigInt(i)), text: 'x'.repeat(200), kind: 'giveaway', guildId: ids.guild }, f.now());
  const before = f.store.list(ids.guild); const seen = [];
  for (let page = 1; page <= 4; page++) {
    const reply = await f.run('list', { page }); assert.match(reply.content, new RegExp(`20 \\| Page ${page}/4`));
    const rows = reply.content.split('\n').slice(1); assert.equal(rows.length, 5);
    for (const row of rows) { assert.ok(row.includes('x'.repeat(200))); seen.push(row.split(':')[0]); }
  }
  assert.deepEqual(seen, before.map(job => job.id).reverse()); assert.deepEqual(f.store.list(ids.guild), before); assert.ok(f.calls.every(([kind]) => kind === 'response'));
});

test('list defaults to active and retained scope includes completed and cancelled jobs only from this guild', async (t) => {
  const f = await fixture(t); await f.community.cancelGiveaway(ids.menu);
  await f.store.create({ ...f.input, id: ids.owner, guildId: ids.owner, kind: 'giveaway' }, f.now());
  assert.match((await f.run('list')).content, /Active giveaways: 0/);
  const all = await f.run('list', { scope: 'all' }); assert.match(all.content, /Retained giveaways: 1/); assert.match(all.content, /cancelled/); assert.ok(!all.content.includes(ids.owner));
  for (const page of [0, -1, 1.1, '1', 2, Infinity]) assert.equal((await f.run('list', { page })).content, 'Choose a page from 1 to 1.');
  assert.match((await f.run('list', { scope: 'unexpected' })).content, /Could not complete/);
});

test('retained list sorts newest first and respects partial pages and retention pruning', async (t) => {
  const f = await fixture(t, false);
  for (let i = 0; i < 6; i++) {
    const id = String(BigInt(ids.menu) + BigInt(i)); await f.store.create({ ...f.input, id, guildId: ids.guild, kind: 'giveaway' }, f.now());
    await f.store.cancel({ id, guildId: ids.guild, kind: 'giveaway' }, f.now()); f.advance(1000);
  }
  const reply = await f.run('list', { scope: 'all' }); assert.ok(reply.content.split('\n')[1].startsWith(String(BigInt(ids.menu) + 5n)));
  assert.equal((await f.run('list', { scope: 'all', page: 2 })).content.split('\n').length, 2);
  f.advance(8 * 86400000); await f.community.tick(); assert.match((await f.run('list', { scope: 'all' })).content, /Retained giveaways: 0/);
});

test('giveaway command definitions expose all customization, preview, reset and history options', () => {
  const giveaway = commands.find(command => command.name === 'giveaway'); const edit = giveaway.options.find(option => option.name === 'edit');
  for (const name of ['host', 'description', 'image', 'thumbnail', 'clear']) assert.ok(edit.options.some(option => option.name === name));
  const create = giveaway.options.find(option => option.name === 'create'); for (const name of ['host', 'description', 'image', 'thumbnail']) assert.ok(create.options.some(option => option.name === name));
  const clear = edit.options.find(option => option.name === 'clear').options.find(option => option.name === 'field'); assert.deepEqual(clear.choices.map(choice => choice.value), ['description', 'image', 'thumbnail', 'host', 'all']);
  const list = giveaway.options.find(option => option.name === 'list'); assert.equal(list.options.find(option => option.name === 'page').max_value, 1000);
  assert.equal(giveaway.options.find(option => option.name === 'preview').options[0].required, true);
});
