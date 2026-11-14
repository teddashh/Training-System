import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextSessionDelay } from './sessionBoundary.ts';
import type { Course } from './types';

const course = (start: number, end: number) => ({enrollment: {session: {starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString()}}}) as Course;
test('next session boundary schedules start, then end, and ignores past boundaries', () => {
  assert.equal(nextSessionDelay([course(1000, 2000), course(1500, 3000)], 500), 501);
  assert.equal(nextSessionDelay([course(1000, 2000)], 1000), 1001);
  assert.equal(nextSessionDelay([course(1000, 2000)], 2000), null);
});
test('long waits are capped and invalid dates are ignored', () => {
  assert.equal(nextSessionDelay([course(3000000000, 4000000000)], 0), 2147483647);
  assert.equal(nextSessionDelay([{enrollment: {session: {starts_at: 'invalid', ends_at: 'invalid'}}} as Course], 0), null);
});
