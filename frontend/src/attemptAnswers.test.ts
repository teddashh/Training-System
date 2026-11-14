import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { sameAnswers } from './attemptAnswers.ts';

test('stored answers compare verbatim without depending on object key order', () => {
  assert.equal(sameAnswers({ '1': ' 1e', '2': [1, 0] }, { '2': [1, 0], '1': ' 1e' }), true);
  assert.equal(sameAnswers({ '1': ' 1e' }, { '1': '1e' }), false);
  assert.equal(sameAnswers({ '1': [1, 0] }, { '1': [0, 1] }), false);
  assert.equal(sameAnswers({ '1': 0 }, {}), false);
  assert.equal(sameAnswers({ '1': 0 }, { '1': '0' }), false);
});
