'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInteractionHandler } = require('../src/interactions');
const { calculate, inspectColor, decodeSnowflake, timestamp, validId, TIMESTAMP_STYLES } = require('../src/utility-tools');
const { INFORMATION_ACTIONS } = require('../src/information-interactions');
const { commands } = require('../src/commands');

const guildId = '100000000000000001', actor = '100000000000000002', target = '100000000000000003', assetId = '100000000000000004';
const hash = 'a'.repeat(32), animated = `a_${hash}`;
function fixture(overrides = {}) {
  const calls = [], replies = [], logs = [];
  const guild = { id: guildId, name: '@everyone **Test**', icon: hash, banner: animated, premium_tier: 2, premium_subscription_count: 9, ...overrides.guild };
  const member = { user: { id: actor, username: 'Member' }, banner: animated, ...overrides.member };
  const account = { id: actor, banner: hash, ...overrides.account };
  const items = overrides.items ?? [{ id: assetId, name: 'Asset', position: 2, type: 2, format_type: 1, available: true }];
  const discord = {
    getGuild: async (id) => { calls.push(['guild', id]); if (overrides.fail) throw new Error('PRIVATE-TOKEN'); return guild; },
    getGuildMember: async (id, user) => { calls.push(['member', id, user]); if (overrides.fail) throw new Error('PRIVATE-TOKEN'); return member; },
    request: async (method, route) => { calls.push([method, route]); if (overrides.fail) throw new Error('PRIVATE-TOKEN'); return route.startsWith('/users/') ? account : /\/(roles|emojis|stickers)$/.test(route) ? items : overrides.item ?? items[0]; },
    editOriginalResponse: async (app, token, payload) => { assert.equal(token, 'interaction-token'); if (overrides.failResponse) throw new Error('PRIVATE-TOKEN'); replies.push(payload); }
  };
  const handler = createInteractionHandler({ config: { guildId, applicationId: '100000000000000005' }, discord, logger: (event, data) => logs.push([event, data]), now: () => new Date('2026-10-11T12:00:00Z') });
  const payload = (action, values = {}) => ({ type: 2, guild_id: guildId, channel_id: '100000000000000006', token: 'interaction-token', member: { user: { id: actor }, permissions: '0' }, data: { name: 'utility', options: [{ name: action, options: Object.entries(values).map(([name, value]) => ({ name, value })) }] } });
  async function run(action, values = {}) {
    const result = await handler(payload(action, values));
    assert.equal(result.immediate.data.flags, 64);
    if (result.work) await result.work();
    const reply = result.work ? replies.at(-1) : result.immediate.data;
    if (reply) assert.deepEqual(reply.allowed_mentions, { parse: [] });
    return reply;
  }
  return { run, payload, handler, calls, replies, logs };
}

for (const [expression, expected] of [
  ['2 + 3 * 4', 14], ['(2 + 3) * 4', 20], ['2^3^2', 512], ['-2^2', -4], ['(-2)^2', 4], ['2^-2', .25],
  ['10 % 3', 1], ['10 / 4', 2.5], ['.5 + 1.5', 2], ['1e3 + 2E-1', 1000.2], ['--2', 2], ['+2', 2], ['-0', 0], [' 8 - 3 - 1 ', 4], ['0^0', 1]
]) test(`calculator evaluates bounded arithmetic: ${expression}`, () => assert.equal(calculate(expression), expected));
for (const expression of ['', ' ', '2(3)', '1 2', '(2', '2)', '2+', '2**3', 'Math.random()', 'process.env.SECRET', '1;2', '1/0', '0%0', '1e101', '1e100*2', '(-2)^.5', '('.repeat(17) + '1' + ')'.repeat(17), '1+'.repeat(60) + '1', '1'.repeat(201), null]) {
  test(`calculator rejects invalid or unbounded input: ${String(expression).slice(0, 35)}`, () => assert.throws(() => calculate(expression)));
}
test('color inspection expands shorthand and preserves exact channels', () => {
  assert.deepEqual(inspectColor('#abc'), { hex: '#AABBCC', decimal: 0xaabbcc, red: 170, green: 187, blue: 204 });
  assert.equal(inspectColor('000000').decimal, 0); assert.equal(inspectColor('#FFFFFF').decimal, 16777215);
  for (const input of ['#abcd', '0xffffff', ' #abc', '#zzzzzz', 123, null]) assert.throws(() => inspectColor(input));
});
test('snowflakes retain all 64 bits and decode time and lower bit fields', () => {
  const milliseconds = 1791720000123n, id = (((milliseconds - 1420070400000n) << 22n) | (7n << 17n) | (9n << 12n) | 123n).toString();
  const result = decodeSnowflake(id);
  assert.equal(result.milliseconds, Number(milliseconds)); assert.equal(result.worker, 7); assert.equal(result.process, 9); assert.equal(result.increment, 123);
  assert.equal(decodeSnowflake('18446744073709551615').increment, 4095);
  for (const bad of ['18446744073709551616', '0', '-12345', '012345', '../12345', '1e18', 12345]) { assert.equal(validId(bad), false); assert.throws(() => decodeSnowflake(bad)); }
});
test('timestamp styles produce copyable markup without timezone assumptions', () => {
  for (const style of TIMESTAMP_STYLES) assert.equal(timestamp('0', style).markup, `<t:0:${style}>`);
  assert.equal(timestamp(undefined, undefined, new Date('2026-10-11T12:00:00Z')).seconds, 1791720000);
  assert.equal(timestamp('253402300799').iso, '9999-12-31T23:59:59.000Z');
  for (const value of ['-1', '1.2', '1e3', '1791720000000', '253402300800', 0]) assert.throws(() => timestamp(value));
  assert.throws(() => timestamp('1', 'q')); assert.throws(() => timestamp(undefined, 'F', new Date(NaN)));
});
test('all thirteen new utility commands have registered handlers within Discord option limits', () => {
  const utility = commands.find((item) => item.name === 'utility');
  assert.equal(utility.options.length, 19);
  for (const action of INFORMATION_ACTIONS) assert.ok(utility.options.some((option) => option.name === action));
});
test('local tools respond privately without Discord API reads', async () => {
  const f = fixture();
  assert.match((await f.run('calculate', { expression: '2^8' })).content, /256/);
  assert.equal((await f.run('color', { hex: '#123' })).embeds[0].color, 0x112233);
  assert.match((await f.run('snowflake', { id: actor })).content, /does not prove/);
  assert.match((await f.run('timestamp')).content, /1791720000/);
  for (const [action, values] of [['calculate', { expression: 'process.exit()' }], ['color', { hex: 'oops' }], ['snowflake', { id: '../../secret' }], ['timestamp', { style: 'bad' }]]) {
    const reply = await f.run(action, values); assert.equal(reply.flags, 64); assert.ok(reply.content);
  }
  assert.equal(f.calls.length, 0);
});
test('foreign guild requests are rejected before information reads', async () => {
  const f = fixture(), request = f.payload('servericon'); request.guild_id = target;
  assert.match((await f.handler(request)).immediate.data.content, /not available/); assert.equal(f.calls.length, 0);
});
test('banner prefers the server profile and supports explicit global profile lookup', async () => {
  const f = fixture();
  const server = await f.run('banner'); assert.match(server.embeds[0].image.url, new RegExp(`/guilds/${guildId}/users/${actor}/banners/.*\\.gif`));
  assert.equal(f.calls.length, 1);
  const global = await f.run('banner', { profile: 'global' }); assert.match(global.embeds[0].image.url, new RegExp(`/banners/${actor}/.*\\.png`));
  assert.deepEqual(f.calls.at(-1), ['GET', `/users/${actor}`]);
});
test('banner targets a selected current member and falls back from missing server banner', async () => {
  const f = fixture({ member: { user: { id: target, username: '@everyone' }, banner: null }, account: { id: target } });
  const reply = await f.run('banner', { user: target }); assert.equal(reply.embeds[0].footer.text, 'Global profile');
  assert.ok(!reply.embeds[0].title.includes('@')); assert.deepEqual(f.calls[0], ['member', guildId, target]);
});
test('missing banner is a normal response and does not invent an image', async () => {
  const f = fixture({ member: { banner: null }, account: { banner: null } });
  assert.match((await f.run('banner')).content, /no banner/);
});
for (const overrides of [{ member: { user: { id: target } } }, { member: { banner: 'https://host.invalid/secret' } }, { member: { banner: null }, account: { id: target } }]) {
  test('banner rejects mismatched identity and malformed CDN hashes', async () => assert.match((await fixture(overrides).run('banner')).content, /Could not load/));
}
test('invalid asset IDs, member IDs, profiles and pages cause no API reads', async () => {
  const f = fixture();
  for (const [action, options] of [['banner', { user: '../member' }], ['banner', { profile: 'bad' }], ['emoji', { id: '../asset' }], ['sticker', { id: '0' }], ['roles', { page: 0 }], ['emojis', { page: 1.5 }], ['stickers', { page: 1001 }]]) await f.run(action, options);
  assert.equal(f.calls.length, 0);
});
test('server artwork and boost details use only the configured guild', async () => {
  const f = fixture();
  assert.match((await f.run('servericon')).embeds[0].image.url, new RegExp(`/icons/${guildId}/`));
  assert.match((await f.run('serverbanner')).embeds[0].image.url, /\.gif\?size=1024$/);
  assert.match((await f.run('boosts')).content, /Boost level: 2\nCurrent boosts: 9/);
  assert.ok(f.calls.every((call) => call[1] === guildId));
});
test('missing artwork and unavailable boost values are reported accurately', async () => {
  const f = fixture({ guild: { icon: null, banner: null, premium_tier: 99, premium_subscription_count: -1 } });
  assert.match((await f.run('servericon')).content, /no icon/); assert.match((await f.run('serverbanner')).content, /no banner/);
  assert.match((await f.run('boosts')).content, /Boost level: unavailable\nCurrent boosts: unavailable/);
});
test('foreign guild responses and invalid artwork hashes are rejected', async () => {
  assert.match((await fixture({ guild: { id: target } }).run('servericon')).content, /Could not load/);
  assert.match((await fixture({ guild: { icon: '../bad' } }).run('servericon')).content, /Could not load/);
});
test('roles are ordered and paginated without mutating the API collection', async () => {
  const items = Array.from({ length: 31 }, (_, i) => ({ id: (BigInt(assetId) + BigInt(i)).toString(), name: `Role ${i}`, position: i }));
  const f = fixture({ items }), first = await f.run('roles'), last = await f.run('roles', { page: 3 });
  assert.match(first.embeds[0].description, /^Role 30/); assert.equal(first.embeds[0].description.split('\n').length, 15);
  assert.equal(last.embeds[0].description.split('\n').length, 1); assert.equal(last.embeds[0].footer.text, 'Page 3/3 | 31 total'); assert.equal(items[0].position, 0);
  assert.match((await f.run('roles', { page: 4 })).content, /1 to 3/);
});
for (const action of ['roles', 'emojis', 'stickers']) test(`${action} handles empty inventories privately`, async () => {
  const reply = await fixture({ items: [] }).run(action); assert.equal(reply.embeds[0].footer.text, 'Page 1/1 | 0 total'); assert.match(reply.embeds[0].description, /None configured/);
});
test('expression lists escape names and remain below embed size limits', async () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ id: (BigInt(assetId) + BigInt(i)).toString(), name: '@everyone **[bad](url)**'.repeat(4), animated: i % 2 === 0, type: 2, format_type: i % 4 + 1 }));
  const f = fixture({ items });
  for (const action of ['emojis', 'stickers']) { const description = (await f.run(action)).embeds[0].description; assert.ok(description.length < 4096); assert.ok(!description.includes('@everyone')); }
});
for (const items of [null, {}, [{ id: assetId, name: 'Bad', position: -1 }], [{ id: assetId, name: 'A', position: 1 }, { id: assetId, name: 'B', position: 2 }], [{ id: assetId, name: 'A', position: 1, guild_id: target }]]) {
  test('malformed role inventory is refused without disclosing raw payloads', async () => {
    const f = fixture({ items: items === null ? 'PRIVATE-TOKEN' : items }); assert.match((await f.run('roles')).content, /Could not load/);
  });
}
test('emoji inspection uses the supported WebP CDN format and never exposes creator details', async () => {
  const f = fixture({ item: { id: assetId, name: 'Wave', animated: true, available: false, user: { email: 'PRIVATE-TOKEN' } } });
  const reply = await f.run('emoji', { id: assetId }); assert.match(reply.embeds[0].image.url, /\.webp\?size=128&animated=true$/); assert.match(reply.embeds[0].description, /Available: no/); assert.ok(!JSON.stringify(reply).includes('PRIVATE-TOKEN'));
});
for (const [format, prefix, suffix] of [[1, 'https://cdn.discordapp.com', 'png'], [2, 'https://cdn.discordapp.com', 'png'], [3, 'https://cdn.discordapp.com', 'json'], [4, 'https://media.discordapp.net', 'gif']]) {
  test(`sticker format ${format} uses its documented asset host and representation`, async () => {
    const f = fixture({ item: { id: assetId, name: 'Sticker', type: 2, format_type: format, guild_id: guildId } });
    const embed = (await f.run('sticker', { id: assetId })).embeds[0]; assert.ok(embed.description.includes(`${prefix}/stickers/${assetId}.${suffix}`)); assert.equal(Boolean(embed.image), format !== 3);
  });
}
for (const item of [{ id: target, name: 'Wrong' }, { id: assetId, name: 'Wrong', type: 1, format_type: 1 }, { id: assetId, name: 'Wrong', type: 2, format_type: 5 }, { id: assetId, name: 'Wrong', type: 2, format_type: 1, guild_id: target }]) {
  test('sticker inspection rejects mismatched assets and unsupported formats', async () => assert.match((await fixture({ item }).run('sticker', { id: assetId })).content, /Could not load/));
}
test('emoji inspection verifies the returned asset ID', async () => assert.match((await fixture({ item: { id: target, name: 'Wrong' } }).run('emoji', { id: assetId })).content, /Could not load/));
for (const action of ['banner', 'servericon', 'serverbanner', 'boosts', 'roles', 'emojis', 'emoji', 'stickers', 'sticker']) {
  test(`${action} handles API failure without leaking tokens or exception text`, async () => {
    const f = fixture({ fail: true }); const reply = await f.run(action, { id: assetId }); assert.match(reply.content, /Could not load/);
    assert.ok(!JSON.stringify([reply, f.logs]).includes('PRIVATE-TOKEN')); assert.ok(f.calls.every(([method]) => ['GET', 'guild', 'member'].includes(method)));
  });
}
test('expired response webhook is contained without a secondary rejection', async () => {
  const f = fixture({ failResponse: true }); await f.run('servericon'); assert.equal(f.logs.length, 1);
});

test('utility help exposes the new tools within Discord message limits', async () => {
  const reply = await fixture().run('help'); assert.match(reply.content, /ID decoding, timestamps, colors and arithmetic/); assert.ok(reply.content.length <= 2000);
});
