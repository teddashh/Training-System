import assert from 'node:assert/strict';
import { test } from 'node:test';
import { examLearnerState } from './examLearnerState.ts';
import type { Exam } from './types';

const now = Date.parse('2026-11-13T12:00:00Z');
const failed = { active_attempt_id: null, last_result: { passed: false }, attempts_remaining: 0,
  starts_at: null, ends_at: null, next_round_at: new Date(now + 60000).toISOString(),
  next_attempt_at: new Date(now + 60000).toISOString() } as Exam;
test('two failures with a renewable round remain in To do while waiting', () => {
  assert.deepEqual(examLearnerState(failed, now), { state: 'waiting', group: 'To do' });
  assert.deepEqual(examLearnerState(failed, now + 60000), { state: 'retake', group: 'To do' });
});
test('grading and nonrenewable exhausted attempts do not offer a retry', () => {
  assert.equal(examLearnerState({ ...failed, next_round_at: null }, now).state, 'completed');
  assert.equal(examLearnerState({ ...failed, next_round_at: null, round_awaiting_grading: true }, now).state, 'grading');
});
test('a longer interval between starts still applies after the round wait ends', () => {
  assert.equal(examLearnerState({ ...failed, attempts_remaining: 2, next_attempt_at: new Date(now + 120000).toISOString() }, now + 60000).state, 'waiting');
});
