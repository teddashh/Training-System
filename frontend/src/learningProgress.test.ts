import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learningProgress } from './learningProgress.ts';
import type { Course, Exam } from './types';
import type { OwnAssignment } from './nextSteps';
const c = (id: number, rest = {}) => ({id, enrollment: null, progress: null, ...rest}) as Course;
const e = (id: number, rest = {}) => ({id, available_to_me: true, last_result: null, active_attempt_id: null, ...rest}) as Exam;
const a = (id: number, rest = {}) => ({user_id: 1, kind: 'course', target_id: id, status: 'open', ...rest}) as OwnAssignment;
test('empty and management-only items do not create progress', () => {
  assert.deepEqual(learningProgress([c(1)], [e(1, {available_to_me: false})], [], 1), {done: 0, total: 0});
});
test('deduplicates enrolled and assigned courses and available exams', () => {
  assert.deepEqual(learningProgress([c(1, {enrollment: {status: 'approved', completed_at: '2026-01-01'}}), c(2, {enrollment: {status: 'pending'}})], [e(1, {last_result: {passed: true}}), e(1, {last_result: {passed: true}}), e(2, {last_result: {passed: false}})], [a(1), a(1)], 1), {done: 2, total: 4});
});
test('counts unavailable assigned items but excludes other people and cancelled assignments', () => {
  assert.deepEqual(learningProgress([], [], [a(1, {status: 'completed'}), a(2, {available: false}), a(3, {user_id: 2}), a(4, {status: 'cancelled'})], 1), {done: 1, total: 2});
});
test('only completed courses and passed exams are done', () => {
  assert.deepEqual(learningProgress([c(1, {progress: 100, enrollment: {status: 'approved'}}), c(2, {progress: 50, enrollment: {status: 'approved'}}), c(3, {enrollment: {status: 'removed'}})], [e(1, {last_result: {passed: null}})], [], 1), {done: 1, total: 3});
});

test('completed personal targets produce a complete total', () => {
  assert.deepEqual(learningProgress([c(1, {enrollment: {status: 'approved', completed_at: '2026-01-01'}})], [e(2, {last_result: {passed: true}})], [a(1)], 1), {done: 2, total: 2});
});
test('an exam that is only open to everyone is not counted', () => {
  assert.deepEqual(learningProgress([c(1)], [e(1), e(2), e(3)], [], 1), {done: 0, total: 0});
});
test('assigned, course-linked and started exams are counted once', () => {
  const course = c(1, {enrollment: {status: 'approved'}, assessments: [{id: 2, available_to_me: true}]});
  assert.deepEqual(learningProgress([course], [e(1), e(2), e(3, {active_attempt_id: 'x'}), e(4, {last_result: {passed: true}}), e(5)],
    [a(1, {kind: 'exam'})], 1), {done: 1, total: 5});
});
