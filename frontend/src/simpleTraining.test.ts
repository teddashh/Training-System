import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accepted, appendLines, formErrors, gated, movableSessions, notifiedCount, released, newSession, nextMail, rosterSignature, skipped, sortTrainings,
  trainingPayload, updateSession, validateTraining, type SessionDraft, type TrainingOverview,
} from './simpleTraining.ts';
import type { Course } from './types';

const now = new Date(2026, 10, 12, 10, 0);
const draft = (extra: Partial<SessionDraft> = {}): SessionDraft => ({ ...newSession(), ...extra });

test('later sessions follow the first place and seats until edited themselves', () => {
  let sessions = [draft(), draft(), draft()];
  sessions = updateSession(sessions, 0, { location: 'Room 12', capacity: '20' });
  assert.deepEqual(sessions.map(s => [s.location, s.capacity]), [['Room 12', '20'], ['Room 12', '20'], ['Room 12', '20']]);
  sessions = updateSession(sessions, 1, { location: 'Hall B' });
  sessions = updateSession(sessions, 0, { location: 'Room 14', capacity: '25' });
  assert.deepEqual(sessions.map(s => [s.location, s.capacity]), [['Room 14', '25'], ['Hall B', '25'], ['Room 14', '25']]);
  assert.equal(newSession(sessions[0]).location, 'Room 14');
  assert.equal(newSession(sessions[0]).start, '');
});

test('validation names each field like the server and skips blocks without a date', () => {
  const ok = { date: '2026-11-20', start: '09:00', end: '10:30', location: 'Room 12', capacity: '30' };
  assert.deepEqual(validateTraining('Forklift refresher', [draft(ok), draft()], now), {});
  assert.deepEqual(validateTraining(' ', [draft(), draft({ date: '2026-11-10', start: '11:00', end: '10:00', location: '', capacity: '0' })], now), {
    title: 'Enter a title.', 'sessions[0].date': 'Choose a date.', 'sessions[1].date': 'Choose today or later.',
    'sessions[1].ends_at': 'End after the start.', 'sessions[1].location': 'Enter a place.', 'sessions[1].capacity': 'Enter 1–10,000 seats.',
  });
  assert.equal(validateTraining('T', [draft({ ...ok, date: '2026-11-12', start: '09:30' })], now)['sessions[0].starts_at'], 'Choose a later time.');
  // A later block with people or a time but no date is a mistake to name, never a block to drop silently.
  assert.deepEqual(validateTraining('T', [draft(ok), draft({ roster: { text: 'alex@example.com', people: [], groups: [] } })], now), { 'sessions[1].date': 'Choose a date.' });
  assert.deepEqual(validateTraining('T', [draft(ok), draft({ start: '13:00' })], now), { 'sessions[1].date': 'Choose a date.' });
});

test('the payload creates dated sessions only and indexes rosters by created session', () => {
  const sessions = [
    draft({ date: '2026-11-20', start: '09:00', end: '10:00', location: ' Room 12 ', capacity: '30', roster: { text: ' alex@example.com \n', people: [], groups: [] } }),
    draft({ location: 'Room 12' }),
    draft({ date: '2026-11-21', start: '13:00', end: '14:00', location: 'Room 12', capacity: '12', roster: { text: '', people: [34], groups: [7] } }),
  ];
  const payload = trainingPayload({ requestId: 'r', title: ' Forklift ', description: '', cover: 'scene-x', sessions, exam: null });
  assert.equal(payload.sessions.length, 2);
  assert.equal(payload.sessions[0].starts_at, new Date('2026-11-20T09:00').toISOString());
  assert.deepEqual(payload.sessions.map(s => [s.location, s.capacity]), [['Room 12', 30], ['Room 12', 12]]);
  assert.deepEqual(payload.rosters, [{ session: 0, text: 'alex@example.com', people: [], groups: [] }, { session: 1, text: '', people: [34], groups: [7] }]);
  assert.equal('exam' in payload, false);
  assert.equal(payload.title, 'Forklift');
  assert.equal(trainingPayload({ requestId: 'r', title: 'T', description: '', cover: '', sessions, exam: 15 }).exam, 15);
});

test('server messages land at the form field they belong to', () => {
  const sessions = [draft({ date: '2026-11-20' }), draft(), draft({ date: '2026-11-21', roster: { text: 'x', people: [], groups: [] } })];
  assert.deepEqual(formErrors({ 'sessions[1].ends_at': ['End later.'], 'rosters[0].text': ['Too long.'], exam: ['Choose a valid quiz.'], detail: 'Retry.', title: 'Bad.' }, sessions), {
    'sessions[2].ends_at': 'End later.', 'people[2]': 'Too long.', exam: 'Choose a valid quiz.', general: 'Retry.', title: 'Bad.',
  });
  assert.deepEqual(formErrors(['x'], sessions), {});
});

test('check results and file lines share one representation', () => {
  const report = { counts: {}, rows: [{ input: 'a', outcome: 'added' }, { input: 'b', outcome: 'not_found' }, { input: 'a', outcome: 'duplicate' }] };
  assert.equal(accepted(report), 1);
  assert.deepEqual(skipped(report).map(row => row.outcome), ['not_found', 'duplicate']);
  assert.equal(appendLines('alex@example.com\n', [' 10492 ', '', 'sam@example.com']), 'alex@example.com\n10492\nsam@example.com');
  assert.equal(appendLines('', ['10492']), '10492');
  assert.equal(appendLines('Alex@Example.com\n10492', ['alex@example.com', 'sam@example.com', '10492', 'sam@example.com']), 'Alex@Example.com\n10492\nsam@example.com');
  assert.equal(rosterSignature({ text: ' a ', people: [2, 1], groups: [] }), rosterSignature({ text: 'a', people: [1, 2], groups: [] }));
});

test('trainings with upcoming sessions come first, soonest first, then the newest', () => {
  const at = (days: number) => new Date(now.getTime() + days * 86400000).toISOString();
  const course = (id: number, starts: number[], created: number) => ({ id, created_at: at(created), sessions: starts.map((d, i) => ({ id: i, starts_at: at(d), cancelled: false })) }) as unknown as Course;
  const sorted = sortTrainings([course(1, [], -1), course(2, [5], -9), course(3, [-2], -3), course(4, [2, 9], -8), course(5, [], -2)], now.getTime());
  assert.deepEqual(sorted.map(c => c.id), [4, 2, 1, 5, 3]);
});

test('the next mail and the sessions a person can move to', () => {
  const at = (hours: number) => new Date(now.getTime() + hours * 3600000).toISOString();
  const overview = { sessions: [
    { title: 'A', emails: [{ kind: 'session_tomorrow', state: 'produced', scheduled_at: at(-1) }, { kind: 'quiz_ready', state: 'scheduled', scheduled_at: at(30) }] },
    { title: 'B', emails: [{ kind: 'session_tomorrow', state: 'scheduled', scheduled_at: at(5) }, { kind: 'quiz_ready', state: 'disabled', scheduled_at: at(2) }] },
  ] } as unknown as TrainingOverview;
  const next = nextMail(overview, now.getTime());
  assert.equal(next.kind, 'session_tomorrow');
  assert.equal(next.session.title, 'B');
  assert.deepEqual(movableSessions([{ id: 1, cancelled: false, ends_at: at(-1) }, { id: 2, cancelled: true, ends_at: at(3) }, { id: 3, cancelled: false, ends_at: at(3) }], now.getTime()).map(s => s.id), [3]);
});

test('gated quizzes, notified counts and released courses follow the contract', () => {
  assert.equal(gated({}), true);
  assert.equal(gated({ gated: true }), true);
  assert.equal(gated({ gated: false }), false);
  assert.equal(notifiedCount([{ counts: {}, rows: [], notified: 3 }, null, { counts: {}, rows: [] }]), 3);
  const later = new Date(now.getTime() + 3600000).toISOString();
  assert.equal(released({ published: true, release_at: null }, now.getTime()), true);
  assert.equal(released({ published: true, release_at: later }, now.getTime()), false);
  assert.equal(released({ published: false, release_at: null }, now.getTime()), false);
});
