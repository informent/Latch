'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { playersFrom, shuffled, makeTeams, makeBracket, renderTeams, renderBracket } = require('../src/game-night');
const { createInteractionHandler } = require('../src/interactions');
const { interaction, ids } = require('./feature-fixtures');

test('team draws cover each player once, balance odd groups and isolate inputs', () => {
  for (let count = 2; count <= 32; count++) {
    const names = Array.from({ length: count }, (_, i) => `Player ${i}`);
    for (let teams = 2; teams <= Math.min(count, 8); teams++) {
      const result = makeTeams(names.join(','), teams, () => 0);
      assert.deepEqual(result.flat().sort(), [...names].sort());
      assert.ok(Math.max(...result.map(x => x.length)) - Math.min(...result.map(x => x.length)) <= 1);
    }
    const result = shuffled(names, maximum => maximum - 1); result.pop(); assert.equal(names.length, count);
  }
});
test('invalid names, duplicate normalization, group counts and random sources are rejected', () => {
  for (const names of [null, '', 'one', 'a,,b', 'A,a', 'Ａ,A', 'a,b\nc', 'a,' + 'b'.repeat(33), Array.from({ length: 33 }, (_, i) => `p${i}`).join(','), 'x'.repeat(1001)]) assert.throws(() => playersFrom(names));
  for (const count of [0, 1, 3, 9, 2.5, '2']) assert.throws(() => makeTeams('a,b', count));
  for (const draw of [() => -1, () => 99, () => 0.5]) assert.throws(() => shuffled(['a', 'b'], draw));
});
test('brackets give the exact number of byes and never omit or duplicate players', () => {
  for (let count = 2; count <= 32; count++) {
    const names = Array.from({ length: count }, (_, i) => `p${i}`);
    const bracket = makeBracket(names.join(','), () => 0);
    assert.deepEqual(bracket.matches.flatMap(x => x.players).sort(), names.sort());
    assert.equal(bracket.matches.filter(x => x.bye).length, bracket.size - count);
    assert.equal(bracket.matches.length, bracket.size / 2);
    assert.equal(bracket.rounds, Math.log2(bracket.size));
    assert.ok(renderBracket(bracket).length <= 4096);
  }
});
test('rendering suppresses mentions and escapes player-controlled Markdown', () => {
  const teams = makeTeams('@everyone,**owner**,<@12345>', 2, () => 0);
  assert.doesNotMatch(renderTeams(teams), /@everyone|<@12345>/);
  assert.match(renderTeams(teams), /\\\*\\\*owner/);
  assert.match(renderBracket(makeBracket('one,two,three', () => 0)), /bye/);
});
test('game-night slash commands return private results without network access or persistence', async () => {
  const handler = createInteractionHandler({ config: { guildId: ids.guild } });
  for (const action of ['teams', 'bracket']) {
    const result = await handler(interaction('fun', action, { players: 'one,two,three' }, '0'));
    assert.equal(result.immediate.data.flags, 64); assert.deepEqual(result.immediate.data.allowed_mentions, { parse: [] }); assert.equal(result.work, undefined);
    const invalid = await handler(interaction('fun', action, { players: 'one,one' }, '0'));
    assert.match(invalid.immediate.data.content, /different name/);
  }
});
