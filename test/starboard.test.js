'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const { StarboardStore } = require('../src/starboard-store'),
  { StarboardService, STAR } = require('../src/starboard-service');
const { createInteractionHandler } = require('../src/interactions'),
  { loadConfig } = require('../src/config');
const { directory, ids, interaction } = require('./feature-fixtures');
async function fixture(t) {
  const root = await directory(t),
    file = path.join(root, 'starboard.json'),
    store = new StarboardStore(file, ids.guild);
  await store.load();
  const source = ids.channel,
    destination = ids.menu,
    message = {
      id: ids.message,
      channel_id: source,
      author: { id: ids.actor },
      type: 0,
    };
  const channels = new Map(
    [source, destination].map((id) => [
      id,
      {
        id,
        guild_id: ids.guild,
        type: 0,
        nsfw: false,
        permission_overwrites: [],
      },
    ]),
  );
  const voters = [{ id: ids.owner }, { id: ids.user }].sort((a, b) =>
      BigInt(a.id) < BigInt(b.id) ? -1 : 1,
    ),
    posts = new Map(),
    calls = [];
  const discord = {
    request: async (method, route) => {
      calls.push([method, route]);
      if (route === `/guilds/${ids.guild}/roles`)
        return [{ id: ids.guild, permissions: '1024' }];
      if (channels.has(route.split('/')[2]) && route.split('/').length === 3)
        return structuredClone(channels.get(route.split('/')[2]));
      if (route.includes('/reactions/')) {
        const u = new URL('https://example.org' + route);
        return voters
          .filter(
            (v) =>
              !u.searchParams.get('after') ||
              BigInt(v.id) > BigInt(u.searchParams.get('after')),
          )
          .slice(0, 100);
      }
      if (route === `/channels/${source}/messages/${ids.message}`)
        return structuredClone(message);
      const id = route.split('/').at(-1);
      if (posts.has(id)) return structuredClone(posts.get(id));
      throw new Error('Not found');
    },
    createMessage: async (channel, body) => {
      calls.push(['create', body]);
      const p = {
        ...body,
        id: ids.lobby,
        channel_id: channel,
        author: { id: ids.bot },
      };
      posts.set(p.id, p);
      return structuredClone(p);
    },
    editMessage: async (channel, id, body) => {
      calls.push(['edit', body]);
      Object.assign(posts.get(id), body);
    },
    getChannelMessages: async () =>
      [...posts.values()].map((p) => structuredClone(p)),
    deleteChannelMessage: async (channel, id) => {
      calls.push(['delete', id]);
      posts.delete(id);
    },
    editOriginalResponse: async (a, b, body) => calls.push(['response', body]),
  };
  const config = {
    guildId: ids.guild,
    applicationId: ids.bot,
    starboardEnabled: true,
  };
  const service = new StarboardService({
    config,
    store,
    discord,
    botUserId: ids.bot,
  });
  const configure = () =>
    service.configure({ source, destination, threshold: 2 });
  return {
    root,
    file,
    store,
    service,
    discord,
    config,
    source,
    destination,
    message,
    channels,
    voters,
    posts,
    calls,
    configure,
  };
}
test('starboard configuration persists and snapshots cannot mutate stored state', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const copy = f.store.snapshot();
  copy.settings.threshold = 40;
  const reload = new StarboardStore(f.file, ids.guild);
  await reload.load();
  assert.equal(reload.snapshot().settings.threshold, 2);
});
for (const extra of [
  { type: 2 },
  { nsfw: true },
  { guild_id: '99999' },
  {
    permission_overwrites: [
      { id: ids.guild, type: 0, allow: '0', deny: '1024' },
    ],
  },
])
  test(`starboard refuses unsafe channel ${JSON.stringify(extra)}`, async (t) => {
    const f = await fixture(t);
    Object.assign(f.channels.get(f.source), extra);
    await assert.rejects(f.configure());
    assert.equal(f.store.snapshot().settings, null);
  });
for (const threshold of [0, 1, 51, 2.5, '2'])
  test(`starboard rejects threshold ${threshold}`, async (t) => {
    const f = await fixture(t);
    await assert.rejects(
      f.service.configure({
        source: f.source,
        destination: f.destination,
        threshold,
      }),
    );
  });
test('starboard requires opt-in and separate source/destination', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.service.configure({
      source: f.source,
      destination: f.source,
      threshold: 2,
    }),
  );
  f.config.starboardEnabled = false;
  await assert.rejects(f.configure());
});
test('starboard publishes links with nonce and mention/embed suppression, updates without duplication', async (t) => {
  const f = await fixture(t);
  await f.configure();
  assert.match(await f.service.sync(f.source, ids.message), /synchronized/);
  const p = [...f.posts.values()][0];
  assert.match(p.content, /discord.com\/channels/);
  assert.equal(p.flags, 4);
  assert.equal(p.enforce_nonce, true);
  assert.deepEqual(p.allowed_mentions, { parse: [] });
  await f.service.sync(f.source, ids.message);
  assert.equal(f.calls.filter((c) => c[0] === 'create').length, 1);
  assert.equal(f.calls.filter((c) => c[0] === 'edit').length, 1);
  const reload = new StarboardStore(f.file, ids.guild);
  await reload.load();
  assert.equal(reload.snapshot().entries[0].post, ids.lobby);
});
test('starboard excludes bots and self-stars and ignores burst stars', async (t) => {
  const f = await fixture(t);
  await f.configure();
  f.voters.splice(0, 2, { id: ids.actor }, { id: ids.bot, bot: true });
  assert.match(
    await f.service.sync(f.source, ids.message),
    /Below threshold: 0/,
  );
  assert.equal(f.posts.size, 0);
  assert.ok(
    f.calls
      .filter((c) => c[1]?.includes?.('/reactions/'))
      .every((c) => c[1].includes('type=0')),
  );
});
test('starboard paginates voters and refuses duplicate or stalled pages', async (t) => {
  const f = await fixture(t);
  await f.configure();
  f.voters.splice(
    0,
    2,
    ...Array.from({ length: 101 }, (_, i) => ({ id: String(100000 + i) })),
  );
  assert.equal(await f.service.count(f.source, ids.message, ids.actor), 101);
  f.voters[1].id = f.voters[0].id;
  await assert.rejects(
    f.service.count(f.source, ids.message, ids.actor),
    /cursor/,
  );
});
test('starboard never publishes an incomplete 1000-user scan', async (t) => {
  const f = await fixture(t);
  await f.configure();
  f.voters.splice(
    0,
    2,
    ...Array.from({ length: 1000 }, (_, i) => ({ id: String(100000 + i) })),
  );
  await assert.rejects(f.service.sync(f.source, ids.message), /1000/);
  assert.equal(f.posts.size, 0);
});
test('starboard pause ignores sync and configuration resumes', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.pause();
  assert.match(await f.service.sync(f.source, ids.message), /paused/);
  await f.configure();
  assert.match(await f.service.sync(f.source, ids.message), /synchronized/);
});
test('starboard persists pending publication before send and recovers an existing receipt', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const original = f.discord.createMessage;
  f.discord.createMessage = async (...args) => {
    await original(...args);
    throw new Error('Lost response');
  };
  await assert.rejects(f.service.sync(f.source, ids.message));
  assert.equal(f.store.snapshot().entries[0].status, 'pending');
  const reloaded = new StarboardStore(f.file, ids.guild);
  await reloaded.load();
  const service = new StarboardService({
    config: f.config,
    store: reloaded,
    discord: f.discord,
    botUserId: ids.bot,
  });
  await service.sync(f.source, ids.message);
  assert.equal(reloaded.snapshot().entries[0].status, 'posted');
  assert.equal(f.calls.filter((c) => c[0] === 'create').length, 1);
});
test('starboard ambiguous pending receipt never blindly republishes', async (t) => {
  const f = await fixture(t);
  await f.configure();
  f.discord.createMessage = async () => {
    throw new Error('Unavailable');
  };
  await assert.rejects(f.service.sync(f.source, ids.message));
  await assert.rejects(f.service.sync(f.source, ids.message), /Pending/);
  assert.equal(f.posts.size, 0);
});
test('starboard rejects destination migration with tracked receipts', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  f.channels.set(ids.role, { ...f.channels.get(f.destination), id: ids.role });
  await assert.rejects(
    f.service.configure({
      destination: ids.role,
      source: f.source,
      threshold: 3,
    }),
    /Destination/,
  );
});
test('starboard refuses webhook/bot/system source messages', async (t) => {
  const f = await fixture(t);
  await f.configure();
  for (const extra of [
    { author: { id: ids.actor, bot: true } },
    { webhook_id: ids.bot },
    { type: 6 },
  ]) {
    const original = structuredClone(f.message);
    Object.assign(f.message, extra);
    await assert.rejects(f.service.sync(f.source, ids.message));
    for (const key of Object.keys(f.message)) delete f.message[key];
    Object.assign(f.message, original);
  }
  assert.equal(f.posts.size, 0);
});
test('starboard rechecks source privacy after reaction scan', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const original = f.discord.request;
  f.discord.request = async (...args) => {
    const value = await original(...args);
    if (args[1].includes('/reactions/'))
      f.channels.get(f.source).permission_overwrites = [
        { id: ids.guild, type: 0, allow: '0', deny: '1024' },
      ];
    return value;
  };
  await assert.rejects(f.service.sync(f.source, ids.message), /Private/);
  assert.equal(f.posts.size, 0);
});
test('starboard verifies bot ownership before editing or deleting highlights', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  f.posts.get(ids.lobby).author.id = ids.owner;
  await assert.rejects(f.service.sync(f.source, ids.message), /ownership/);
  await assert.rejects(f.service.remove(f.source, ids.message), /ownership/);
});
test('starboard source deletion retires highlight and prevents republishing', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  await f.service.dispatch('MESSAGE_DELETE', {
    guild_id: ids.guild,
    channel_id: f.source,
    id: ids.message,
  });
  assert.equal(f.posts.size, 0);
  assert.equal(f.store.snapshot().entries[0].status, 'deleted');
  assert.match(await f.service.sync(f.source, ids.message), /retired/);
});
test('starboard reacts to normal star changes, ignores foreign guilds and other emoji', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const d = {
    guild_id: ids.guild,
    channel_id: f.source,
    message_id: ids.message,
    emoji: { id: null, name: STAR },
  };
  await f.service.dispatch('MESSAGE_REACTION_ADD', {
    ...d,
    guild_id: ids.owner,
  });
  await f.service.dispatch('MESSAGE_REACTION_ADD', {
    ...d,
    emoji: { name: 'other' },
  });
  assert.equal(f.posts.size, 0);
  await f.service.dispatch('MESSAGE_REACTION_ADD', d);
  assert.equal(f.posts.size, 1);
});
test('starboard serializes duplicate events into one publication', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await Promise.all([
    f.service.sync(f.source, ids.message),
    f.service.sync(f.source, ids.message),
  ]);
  assert.equal(f.calls.filter((c) => c[0] === 'create').length, 1);
});
for (const edit of [
  (s) => (s.version = 3),
  (s) => (s.guildId = ids.owner),
  (s) => (s.extra = true),
  (s) => (s.entries = [{}]),
])
  test('starboard rejects invalid store without modifying it', async (t) => {
    const f = await fixture(t);
    const s = f.store.snapshot();
    edit(s);
    const bytes = JSON.stringify(s);
    await fs.writeFile(f.file, bytes);
    await assert.rejects(f.store.load(), /invalid/);
    assert.equal(await fs.readFile(f.file, 'utf8'), bytes);
  });
test('starboard command gates staff permissions and responds privately', async (t) => {
  const f = await fixture(t);
  const handler = createInteractionHandler({
    config: f.config,
    starboard: f.service,
    discord: f.discord,
  });
  const denied = await handler(interaction('starboard', 'configure', {}, '0'));
  assert.match(denied.immediate.data.content, /Manage Server/);
  const allowed = await handler(
    interaction(
      'starboard',
      'configure',
      { source: f.source, destination: f.destination, threshold: 2 },
      '32',
    ),
  );
  assert.equal(allowed.immediate.data.flags, 64);
  await allowed.work();
  assert.match(f.calls.at(-1)[1].content, /configured/);
  assert.deepEqual(f.calls.at(-1)[1].allowed_mentions, { parse: [] });
});
test('starboard configuration requests reaction intent without Message Content', () => {
  const env = {
    DISCORD_APPLICATION_ID: ids.bot,
    DISCORD_GUILD_ID: ids.guild,
    DISCORD_PUBLIC_KEY: 'a'.repeat(64),
    DISCORD_BOT_TOKEN: 'fake',
    DISCORD_STARBOARD_ENABLED: 'true',
  };
  const c = loadConfig(env);
  assert.equal(c.gatewayEnabled, true);
  assert.equal(c.gatewayIntents & 1024, 1024);
  assert.equal(c.gatewayIntents & 32768, 0);
  assert.throws(() => loadConfig({ ...env, DISCORD_GATEWAY_ENABLED: 'false' }));
});

test('starboard background reconciliation updates saved highlights after restart', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  const reload = new StarboardStore(f.file, ids.guild);
  await reload.load();
  const service = new StarboardService({
    config: f.config,
    store: reload,
    discord: f.discord,
    botUserId: ids.bot,
  });
  f.voters.pop();
  service.start();
  assert.ok(service.timer);
  await service.reconcile();
  assert.equal(reload.snapshot().entries[0].count, 1);
  await service.stop();
  assert.equal(service.timer, null);
});
test('starboard queue rejects excess work without blocking its accepted operations', async (t) => {
  const f = await fixture(t);
  let release;
  const gate = new Promise((r) => (release = r));
  const jobs = Array.from({ length: 100 }, () =>
    f.service.serialize(() => gate),
  );
  await assert.rejects(
    f.service.serialize(() => {}),
    /full/,
  );
  release();
  await Promise.all(jobs);
  assert.equal(f.service.scheduled, 0);
});
test('starboard corrupt pending records and over-capacity sources cannot be persisted', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await assert.rejects(
    f.store.mutate(
      (s) =>
        (s.settings.sources = Array.from({ length: 21 }, (_, n) =>
          String(100000 + n),
        )),
    ),
  );
  await assert.rejects(
    f.store.mutate(
      (s) =>
        (s.entries = [
          {
            id: ids.message,
            channel: f.source,
            author: ids.actor,
            count: 2,
            nonce: 'a'.repeat(24),
            status: 'pending',
            post: ids.lobby,
          },
        ]),
    ),
  );
  assert.equal(f.store.snapshot().entries.length, 0);
});

test('starboard capacity refuses publication before sending a new Discord post', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.store.mutate((s) => {
    s.entries = Array.from({ length: 500 }, (_, n) => ({
      id: String(BigInt(ids.message) + BigInt(n) + 1n),
      channel: f.source,
      author: ids.actor,
      count: 2,
      nonce: n.toString(16).padStart(24, '0'),
      post: String(BigInt(ids.lobby) + BigInt(n)),
      status: 'posted',
    }));
  });
  await assert.rejects(f.service.sync(f.source, ids.message), /capacity/);
  assert.equal(f.posts.size, 0);
  assert.equal(f.store.snapshot().entries.length, 500);
});
test('starboard validates unique receipt IDs and nonces without committing corruption', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  for (const extra of [
    { id: ids.role },
    { id: ids.role, nonce: 'f'.repeat(24) },
  ])
    await assert.rejects(
      f.store.mutate((s) => s.entries.push({ ...s.entries[0], ...extra })),
    );
  assert.equal(f.store.snapshot().entries.length, 1);
});

const gone = () =>
  Object.assign(new Error('Discord API request failed (404).'), {
    statusCode: 404,
    discordCode: 10008,
  });
test('retirement refuses empty successful responses as deletion evidence', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  const request = f.discord.request;
  f.discord.request = async (...a) =>
    a[1] === `/channels/${f.destination}/messages/${ids.lobby}`
      ? null
      : request(...a);
  await assert.rejects(f.service.retire(ids.message), /ownership/);
  assert.equal(f.store.snapshot().entries[0].status, 'posted');
  assert.equal(f.posts.size, 1);
});
test('bulk deletion continues after one inaccessible highlight without exposing errors', async (t) => {
  const f = await fixture(t),
    seen = [],
    logs = [];
  f.service.remove = async (channel, id) => {
    assert.equal(channel, f.source);
    seen.push(id);
    if (id === ids.message) throw new Error('private response');
  };
  f.service.logger = (...a) => logs.push(a);
  await f.service.dispatch('MESSAGE_DELETE_BULK', {
    guild_id: ids.guild,
    channel_id: f.source,
    ids: [ids.message, ids.role],
  });
  assert.deepEqual(seen, [ids.message, ids.role]);
  assert.deepEqual(logs, [['starboard_sync_failed', {}]]);
});
test('starboard reads format 1 without rewriting and upgrades on the next mutation', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  const legacy = f.store.snapshot();
  legacy.version = 1;
  const raw = JSON.stringify(legacy);
  await fs.writeFile(f.file, raw);
  const reloaded = new StarboardStore(f.file, ids.guild);
  await reloaded.load();
  assert.equal(await fs.readFile(f.file, 'utf8'), raw);
  await reloaded.mutate((s) => {
    s.settings.enabled = false;
  });
  assert.equal(JSON.parse(await fs.readFile(f.file, 'utf8')).version, 2);
});
test('source removal preserves highlights, pauses the last source and resumes when reconfigured', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  await f.service.removeSource(f.source);
  assert.deepEqual(f.store.snapshot().settings.sources, []);
  assert.equal(f.store.snapshot().settings.enabled, false);
  assert.equal(f.posts.size, 1);
  assert.deepEqual(await f.service.removeSource(f.source), { changed: false });
  await f.configure();
  assert.equal(f.store.snapshot().settings.enabled, true);
  assert.equal(f.store.snapshot().entries.length, 1);
});
test('explicit receipt recovery works beyond the recent history window and while paused', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const create = f.discord.createMessage;
  f.discord.createMessage = async (...a) => {
    await create(...a);
    throw new Error('lost');
  };
  await assert.rejects(f.service.sync(f.source, ids.message));
  await f.service.pause();
  f.discord.getChannelMessages = async () => [];
  await f.service.recover(ids.message, ids.lobby);
  assert.equal(f.store.snapshot().entries[0].status, 'posted');
  assert.equal(f.calls.filter((c) => c[0] === 'create').length, 1);
});
test('recovery rejects foreign posts, wrong IDs, wrong markers and nonpending records', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  await assert.rejects(f.service.recover(ids.message, ids.lobby), /pending/);
  await f.store.mutate((s) => {
    s.entries[0].status = 'pending';
    s.entries[0].post = null;
  });
  const post = f.posts.get(ids.lobby),
    original = structuredClone(post);
  for (const change of [
    { id: ids.role },
    { author: { id: ids.actor } },
    { content: 'wrong marker' },
    { channel_id: ids.role },
  ]) {
    Object.assign(post, original, change);
    await assert.rejects(
      f.service.recover(ids.message, ids.lobby),
      /ownership/,
    );
  }
  assert.equal(f.store.snapshot().entries[0].status, 'pending');
});
test('retirement saves deletion intent before Discord and resumes after a lost response', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  f.discord.deleteChannelMessage = async (c, id) => {
    assert.equal(f.store.snapshot().entries[0].status, 'deleting');
    f.posts.delete(id);
    throw new Error('lost response');
  };
  await assert.rejects(f.service.retire(ids.message));
  const reload = new StarboardStore(f.file, ids.guild);
  await reload.load();
  assert.equal(reload.snapshot().entries[0].status, 'deleting');
  const request = f.discord.request;
  f.discord.request = async (...a) => {
    if (a[1] === `/channels/${f.destination}/messages/${ids.lobby}`)
      throw gone();
    return request(...a);
  };
  const service = new StarboardService({
    config: f.config,
    store: reload,
    discord: f.discord,
    botUserId: ids.bot,
  });
  await service.retire(ids.message);
  assert.equal(reload.snapshot().entries[0].status, 'deleted');
});
for (const error of [
  Object.assign(new Error('forbidden'), { statusCode: 403 }),
  Object.assign(new Error('not found'), { statusCode: 404 }),
  Object.assign(new Error('channel missing'), {
    statusCode: 404,
    discordCode: 10003,
  }),
])
  test(`retirement keeps receipts for unconfirmed missing posts ${error.message}`, async (t) => {
    const f = await fixture(t);
    await f.configure();
    await f.service.sync(f.source, ids.message);
    const request = f.discord.request;
    f.discord.request = async (...a) => {
      if (a[1] === `/channels/${f.destination}/messages/${ids.lobby}`)
        throw error;
      return request(...a);
    };
    await assert.rejects(f.service.retire(ids.message));
    assert.equal(f.store.snapshot().entries[0].status, 'posted');
    assert.equal(f.posts.size, 1);
  });
test('offline source deletion retires the verified highlight but access errors preserve it', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  const request = f.discord.request;
  let error = Object.assign(new Error('forbidden'), { statusCode: 403 });
  f.discord.request = async (...a) => {
    if (a[1] === `/channels/${f.source}/messages/${ids.message}`) throw error;
    return request(...a);
  };
  await assert.rejects(f.service.sync(f.source, ids.message));
  assert.equal(f.posts.size, 1);
  error = gone();
  assert.match(await f.service.sync(f.source, ids.message), /Missing source/);
  assert.equal(f.posts.size, 0);
  assert.match(await f.service.sync(f.source, ids.message), /retired/);
});
test('background deletion retries run while the board is paused', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  const remove = f.discord.deleteChannelMessage;
  f.discord.deleteChannelMessage = async () => {
    throw new Error('offline');
  };
  await assert.rejects(f.service.retire(ids.message));
  await f.service.pause();
  f.discord.deleteChannelMessage = remove;
  f.service.start();
  await f.service.reconcile();
  await f.service.stop();
  assert.equal(f.store.snapshot().entries[0].status, 'deleted');
});
test('prune frees only completed deletions from removed sources and leaves pending work', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  assert.deepEqual(await f.service.prune(), { removed: 0 });
  await f.service.retire(ids.message);
  assert.deepEqual(await f.service.prune(), { removed: 0 });
  await f.service.removeSource(f.source);
  assert.deepEqual(await f.service.prune({ channel: f.source, limit: 1 }), {
    removed: 1,
  });
  assert.equal(f.store.snapshot().entries.length, 0);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  await f.store.mutate((s) => {
    s.entries[0].status = 'pending';
    s.entries[0].post = null;
  });
  await f.service.removeSource(f.source);
  assert.deepEqual(await f.service.prune(), { removed: 0 });
});
test('history filters paginate stable source IDs with complete receipt IDs', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.store.mutate((s) => {
    s.entries = Array.from({ length: 21 }, (_, n) => ({
      id: String(BigInt(ids.message) + BigInt(n)),
      channel: f.source,
      author: ids.actor,
      count: 2,
      nonce: n.toString(16).padStart(24, '0'),
      post: String(BigInt(ids.lobby) + BigInt(n)),
      status: n === 20 ? 'deleting' : 'posted',
    })).reverse();
  });
  const page = f.service.list({ page: 2 });
  assert.equal(page.total, 21);
  assert.equal(page.pages, 3);
  assert.equal(page.entries.length, 10);
  assert.equal(page.entries[0].id, String(BigInt(ids.message) + 10n));
  assert.equal(f.service.list({ state: 'deleting' }).total, 1);
  assert.throws(() => f.service.list({ page: 4 }));
  assert.throws(() => f.service.list({ state: 'invalid' }));
});
test('bulk source deletion cleans verified tracked highlights and rejects oversized events', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  await f.service.dispatch('MESSAGE_DELETE_BULK', {
    guild_id: ids.guild,
    channel_id: f.source,
    ids: Array(101).fill(ids.message),
  });
  assert.equal(f.posts.size, 1);
  await f.service.dispatch('MESSAGE_DELETE_BULK', {
    guild_id: ids.guild,
    channel_id: f.source,
    ids: [ids.message, ids.message],
  });
  assert.equal(f.posts.size, 0);
});
for (const action of ['source-remove', 'list', 'recover', 'retire', 'prune'])
  test(`starboard ${action} enforces staff permissions`, async (t) => {
    const f = await fixture(t);
    const h = createInteractionHandler({
      config: f.config,
      starboard: f.service,
      discord: f.discord,
    });
    const result = await h(interaction('starboard', action, {}, '0'));
    assert.match(result.immediate.data.content, /Manage Server/);
    assert.equal(f.calls.length, 0);
  });
test('history and operation replies stay private and suppress mentions', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.sync(f.source, ids.message);
  const h = createInteractionHandler({
    config: f.config,
    starboard: f.service,
    discord: f.discord,
  });
  for (const [action, values, expected] of [
    ['list', {}, /history: 1/],
    ['retire', { message: ids.message }, /retired/],
    ['source-remove', { channel: f.source }, /Source removed/],
    ['prune', {}, /Forgot 1/],
  ]) {
    const r = await h(interaction('starboard', action, values, '32'));
    assert.equal(r.immediate.data.flags, 64);
    await r.work();
    assert.match(f.calls.at(-1)[1].content, expected);
    assert.deepEqual(f.calls.at(-1)[1].allowed_mentions, { parse: [] });
  }
});
