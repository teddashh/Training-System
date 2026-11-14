import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audiencePadding, gradePayload, roundedPercent} from './reportLogic.ts';
test('grades require an explicit score and preserve decimal precision and feedback', () => {
  assert.throws(() => gradePayload({'1': {points: '', feedback: 'Good'}}));
  assert.deepEqual(gradePayload({'1': {points: '4.2', feedback: 'Good'}, '2': {points: '0', feedback: ''}}), {'1': {points: 4.2, feedback: 'Good'}, '2': {points: 0, feedback: ''}});
});
test('audience padding leaves a complete single-segment ring', () => {
  assert.equal(audiencePadding(1, 0), 0); assert.equal(audiencePadding(0, 1), 0); assert.equal(audiencePadding(1, 1), 5);
});
test('percentage precision is one decimal', () => { assert.equal(roundedPercent(66.666), 66.7); });
