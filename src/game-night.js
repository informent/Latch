'use strict';
const { randomInt } = require('node:crypto');

function playersFrom(value) {
  if (typeof value !== 'string' || value.length > 1000) throw new Error('Enter 2 to 32 comma-separated player names.');
  const players = value.split(',').map(name => name.trim());
  if (players.length < 2 || players.length > 32 || players.some(name => !name || name.length > 32 || /[\x00-\x1f\x7f]/.test(name))) throw new Error('Use 2 to 32 names, each 1 to 32 characters.');
  if (new Set(players.map(name => name.normalize('NFKC').toLowerCase())).size !== players.length) throw new Error('Use a different name for each player.');
  return players;
}
function shuffled(players, draw = randomInt) {
  const result = [...players];
  for (let index = result.length - 1; index > 0; index--) {
    const chosen = draw(index + 1);
    if (!Number.isInteger(chosen) || chosen < 0 || chosen > index) throw new Error('Invalid random draw.');
    [result[index], result[chosen]] = [result[chosen], result[index]];
  }
  return result;
}
function makeTeams(value, count = 2, draw = randomInt) {
  const players = playersFrom(value);
  if (!Number.isInteger(count) || count < 2 || count > 8 || count > players.length) throw new Error('Choose 2 to 8 teams, with at least one player per team.');
  const teams = Array.from({ length: count }, () => []);
  shuffled(players, draw).forEach((player, index) => teams[index % count].push(player));
  return teams;
}
function makeBracket(value, draw = randomInt) {
  const players = shuffled(playersFrom(value), draw);
  const size = 2 ** Math.ceil(Math.log2(players.length));
  const byes = size - players.length;
  const matches = [];
  for (let i = 0; i < byes; i++) matches.push({ players: [players.shift()], bye: true });
  while (players.length) matches.push({ players: players.splice(0, 2), bye: false });
  return { size, rounds: Math.log2(size), matches };
}
function displayName(value) { return value.replace(/@/g, '\uff20').replace(/[\\`*_~|<>\[\]()]/g, '\\$&'); }
function renderTeams(teams) { return '**Game night teams**\n' + teams.map((team, i) => `**Team ${i + 1}**: ${team.map(displayName).join(', ')}`).join('\n') + '\nRandom groups, balanced by player count. Skill ratings are not used.'; }
function renderBracket(bracket) { return `**Single-elimination opening round**\n${bracket.matches.map((match, i) => `Match ${i + 1}: ${match.players.map(displayName).join(' vs ')}${match.bye ? ' (bye)' : ''}`).join('\n')}\n${bracket.rounds} rounds total. Byes advance automatically; record later rounds yourself. No scores are stored.`; }
module.exports = { playersFrom, shuffled, makeTeams, makeBracket, renderTeams, renderBracket };
