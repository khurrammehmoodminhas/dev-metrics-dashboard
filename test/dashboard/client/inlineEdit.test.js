import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInlineEditorConfig, normalizeInlineEditValue } from '../../../src/dashboard/client/inlineEdit.js';

test('buildInlineEditorConfig uses a select for status fields', () => {
  const ticket = { status: 'In Progress' };
  const config = buildInlineEditorConfig('status', ticket, ['To Do', 'In Progress', 'Done']);

  assert.equal(config.type, 'select');
  assert.deepEqual(config.options, ['To Do', 'In Progress', 'Done']);
  assert.equal(config.value, 'In Progress');
});

test('normalizeInlineEditValue coerces numeric fields and preserves blanks as null', () => {
  assert.equal(normalizeInlineEditValue('sp', '3'), 3);
  assert.equal(normalizeInlineEditValue('ap', ''), null);
  assert.equal(normalizeInlineEditValue('summary', 'Updated title'), 'Updated title');
});
