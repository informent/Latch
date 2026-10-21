'use strict';
const { validItem } = require('./template-store');
function exportTemplate(item) {
  if (!validItem(item)) throw new Error('Invalid template.');
  return { version: 1, kind: 'latch-template', template: structuredClone(item) };
}
function importTemplate(json, name) {
  if (typeof json !== 'string' || json.length > 6000) throw new Error('Paste a Latch template JSON document up to 6000 characters.');
  let input; try { input = JSON.parse(json); } catch { throw new Error('Invalid JSON.'); }
  if (!input || Object.keys(input).sort().join(',') !== 'kind,template,version' || input.kind !== 'latch-template' || input.version !== 1 || !validItem(input.template)) throw new Error('Unsupported template document.');
  const item = { ...input.template, name };
  if (!validItem(item)) throw new Error('Invalid template name.');
  return item;
}
module.exports = { exportTemplate, importTemplate };
