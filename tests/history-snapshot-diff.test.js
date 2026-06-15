const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const DataService = require('../data-service.js');

test('compareHistoryRows compares structured values independent of key order', () => {
  const base = [{ id: 'A', value: { first: 1, second: 2 } }];
  const current = [{ id: 'A', value: { second: 2, first: 1 } }];

  const result = DataService.compareHistoryRows(base, current, ['id'], ['value']);

  assert.equal(result.rows[0]._change, 'unchanged');
  assert.equal(result.summary.totalChanges, 0);
});

test('HistoryPage normalizes ink display order and commits loaded selection atomically', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'history.jsx'),
    'utf8',
  );

  assert.match(source, /\.sort\(\(\[a\], \[b\]\) => String\(a\)\.localeCompare\(String\(b\)\)\)/);
  assert.match(source, /setSnapshot\(migrateData\(raw\)\);\s*setSelected\(name\);/);
});
