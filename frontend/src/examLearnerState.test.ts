import assert from 'node:assert/strict';
import { test } from 'node:test';
import { examLearnerState, guestLearnerExam, isRetake, retryWaiting } from './examLearnerState.ts';
import type { Exam, Guest } from './types';

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

const pending = { ...failed, has_passed: false, attempts_remaining: 1, next_round_at: null, next_attempt_at: null,
  last_result: { id: 'pending', status: 'pending_review', score: null, passed: null } };
test('a pending result with attempts left is a retake in To do', () => {
  assert.deepEqual(examLearnerState(pending, now), {state: 'retake', group: 'To do'});
  assert.equal(isRetake(pending, now), true);
  assert.deepEqual(examLearnerState({...pending, attempts_remaining: 0, next_round_at: new Date(now - 1).toISOString()}, now),
    {state: 'retake', group: 'To do'});
});
test('a pending result with no attempts or new round awaits grading', () => {
  for (const round_awaiting_grading of [false, true])
    assert.deepEqual(examLearnerState({...pending, attempts_remaining: 0, round_awaiting_grading}, now),
      {state: 'grading', group: 'To do'});
});
test('pending results respect either waiting period and become a retake at its end', () => {
  const next = new Date(now + 60000).toISOString();
  for (const value of [{next_attempt_at: next}, {next_round_at: next}, {next_attempt_at: new Date(now - 1).toISOString(), next_round_at: next}]) {
    assert.deepEqual(examLearnerState({...pending, ...value}, now), {state: 'waiting', group: 'To do'});
    assert.equal(isRetake({...pending, ...value}, now), true);
    assert.equal(examLearnerState({...pending, ...value}, now + 60000).state, 'retake');
  }
});
test('a previous pass stays completed with no active attempt', () => {
  for (const value of [{}, {next_attempt_at: new Date(now + 60000).toISOString()}]) {
    assert.deepEqual(examLearnerState({...pending, ...value, has_passed: true}, now), {state: 'completed', group: 'Completed'});
    assert.equal(isRetake({...pending, ...value, has_passed: true}, now), false);
  }
});
test('an active attempt takes precedence over a previous pass, wait and exam window', () => {
  for (const passed of [
    {has_passed: true},
    {has_passed: false, last_result: {id: 'passed', status: 'graded', passed: true, score: 100}},
  ]) {
    const exam = {...pending, ...passed, active_attempt_id: 'active', attempts_remaining: 0,
      next_attempt_at: new Date(now + 60000).toISOString(), ends_at: new Date(now - 1).toISOString()};
    assert.deepEqual(examLearnerState(exam, now), {state: 'active', group: 'To do'});
    assert.equal(isRetake(exam, now), false);
    assert.equal(retryWaiting(exam, now), false);
    assert.deepEqual(examLearnerState({...exam, active_attempt_id: null, ends_at: null}, now),
      {state: 'completed', group: 'Completed'});
    assert.equal(isRetake({...exam, active_attempt_id: null, ends_at: null}, now), false);
  }
});
test('a pending retake still respects the exam window and active attempts', () => {
  assert.equal(examLearnerState({...pending, starts_at: new Date(now + 1).toISOString()}, now).state, 'upcoming');
  assert.equal(examLearnerState({...pending, ends_at: new Date(now).toISOString()}, now).state, 'closed');
  assert.equal(examLearnerState({...pending, active_attempt_id: 'active'}, now).state, 'active');
});

test('guest retry wait requires a remaining attempt', () => {
  const next_attempt_at = new Date(now + 60000).toISOString();
  assert.equal(retryWaiting({next_attempt_at, remaining: 0}, now), false);
  assert.equal(retryWaiting({next_attempt_at, remaining: 1}, now), true);
  assert.equal(retryWaiting({next_attempt_at, attempts_remaining: 0, next_round_at: next_attempt_at}, now), true);
});
test('a guest round waits and renews only while the invitation has attempts left', () => {
  const next = new Date(now + 60000).toISOString();
  const guest = {...pending, last_result: {id: 'failed', status: 'graded', passed: false, score: 0},
    exam_id: 1, recipient: 'Learner', expires_at: next, remaining: 0, invitation_remaining: 1,
    next_round_at: next, next_attempt_at: next} as Guest;
  const available = guestLearnerExam(guest);
  assert.equal(examLearnerState(available, now).state, 'waiting');
  assert.equal(retryWaiting(available, now), true);
  assert.equal(examLearnerState(available, now + 60000).state, 'retake');
  const exhausted = guestLearnerExam({...guest, invitation_remaining: 0});
  assert.equal(examLearnerState(exhausted, now).state, 'completed');
  assert.equal(retryWaiting(exhausted, now), false);
  const active = guestLearnerExam({...guest, has_passed: true, active_attempt_id: 'active', invitation_remaining: 0});
  assert.deepEqual(examLearnerState(active, now), {state: 'active', group: 'To do'});
  assert.equal(isRetake(active, now), false);
  assert.equal(retryWaiting(active, now), false);
});
