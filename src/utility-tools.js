'use strict';

const EPOCH = 1420070400000n;
const MAX_ID = (1n << 64n) - 1n;
const TIMESTAMP_STYLES = Object.freeze(['t', 'T', 'd', 'D', 'f', 'F', 'R']);

function validId(value) { return typeof value === 'string' && /^[1-9]\d{4,19}$/.test(value) && BigInt(value) <= MAX_ID; }
function decodeSnowflake(value) {
  if (!validId(value)) throw new Error('Enter a decimal Discord ID between 5 and 20 digits.');
  const id = BigInt(value), milliseconds = Number((id >> 22n) + EPOCH);
  return { id: value, milliseconds, seconds: Math.floor(milliseconds / 1000), iso: new Date(milliseconds).toISOString(), worker: Number((id >> 17n) & 31n), process: Number((id >> 12n) & 31n), increment: Number(id & 4095n) };
}

function timestamp(value, style = 'F', now = new Date()) {
  if (!TIMESTAMP_STYLES.includes(style)) throw new Error('Choose a supported timestamp style.');
  if (value !== undefined && (typeof value !== 'string' || !/^\d{1,12}$/.test(value))) throw new Error('Enter Unix seconds as a whole number, not milliseconds.');
  const seconds = value === undefined ? Math.floor(now.getTime() / 1000) : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 253402300799) throw new Error('Timestamp must be between 1970 and the end of year 9999.');
  return { seconds, iso: new Date(seconds * 1000).toISOString(), markup: `<t:${seconds}:${style}>` };
}

function inspectColor(value) {
  if (typeof value !== 'string' || !/^#?(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(value)) throw new Error('Enter a three or six digit hex color, such as #4a90d9.');
  let hex = value.replace(/^#/, '').toUpperCase();
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const decimal = parseInt(hex, 16);
  return { hex: `#${hex}`, decimal, red: decimal >> 16, green: (decimal >> 8) & 255, blue: decimal & 255 };
}

// A bounded arithmetic grammar. User input is never evaluated as JavaScript.
function calculate(expression) {
  if (typeof expression !== 'string' || expression.length < 1 || expression.length > 200) throw new Error('Use an arithmetic expression of 1 to 200 characters.');
  const tokens = [], pattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?|([()+\-*/%^]))/y;
  let offset = 0;
  while (offset < expression.length) {
    if (!expression.slice(offset).trim()) break;
    pattern.lastIndex = offset;
    const match = pattern.exec(expression);
    if (!match) throw new Error('Use numbers, parentheses and + - * / % ^ only.');
    tokens.push(match[3] || Number(match[1] + (match[2] || '')));
    if (tokens.length > 100) throw new Error('Expression is too complex.');
    offset = pattern.lastIndex;
  }
  let cursor = 0, depth = 0;
  const finite = (value) => { if (!Number.isFinite(value) || Math.abs(value) > 1e100) throw new Error('The result is undefined or outside the supported numeric range.'); return value; };
  function atom() {
    const token = tokens[cursor++];
    if (typeof token === 'number') return finite(token);
    if (token !== '(') throw new Error('Expected a number or an opening parenthesis.');
    if (++depth > 16) throw new Error('Limit parentheses to 16 levels.');
    const value = sum();
    if (tokens[cursor++] !== ')') throw new Error('Close every opening parenthesis.');
    depth--;
    return value;
  }
  function power() { const left = atom(); if (tokens[cursor] !== '^') return left; cursor++; return finite(left ** unary()); }
  function unary() { if (tokens[cursor] === '+' || tokens[cursor] === '-') { const sign = tokens[cursor++]; return (sign === '-' ? -1 : 1) * unary(); } return power(); }
  function product() {
    let value = unary();
    while (['*', '/', '%'].includes(tokens[cursor])) {
      const operation = tokens[cursor++], right = unary();
      value = finite(operation === '*' ? value * right : operation === '/' ? value / right : value % right);
    }
    return value;
  }
  function sum() { let value = product(); while (tokens[cursor] === '+' || tokens[cursor] === '-') { const operation = tokens[cursor++], right = product(); value = finite(operation === '+' ? value + right : value - right); } return value; }
  const value = finite(sum());
  if (cursor !== tokens.length) throw new Error('Check the operators and parentheses in your expression.');
  return Object.is(value, -0) ? 0 : value;
}

module.exports = { validId, decodeSnowflake, timestamp, inspectColor, calculate, TIMESTAMP_STYLES };
