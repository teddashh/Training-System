import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectNextSteps, type OwnAssignment } from './nextSteps.ts';
import type { Course, Exam } from './types';
const now = Date.parse('2026-11-12T12:00:00Z');
const iso = (hours: number) => new Date(now + hours * 3600000).toISOString();
const exam = (id: number, extra = {}) => ({id, title: `Quiz ${id}`, available_to_me: true, active_attempt_id: null, last_result: null, attempts_remaining: 2, starts_at: null, ends_at: null, next_attempt_at: null, ...extra}) as Exam;
const course = (id: number, extra = {}) => ({id, title: `Course ${id}`, delivery_mode: 'self_paced', published: true, can_learn: true, progress: null, progress_known: true, enrollment: null, assessments: [], sessions: [],
  venue: 'online', server_time: iso(0), release_at: null, requires_approval: false, can_manage: false, description: '', category: '', cover: '', duration_minutes: 30, blocks: [], package: null, enrolled_count: 0, ...extra}) as Course;
const assignment = (kind: 'course' | 'exam', target_id: number, due_at: string | null, extra = {}) => ({kind, target_id, user_id: 7, title: `Assignment ${target_id}`, due_at, available: true, status: 'not_started', ...extra}) as OwnAssignment;

test('next steps preserves representatives while sorting deduplicated targets by urgency', () => {
  const e = exam(10, {active_attempt_id: 'active'}), quiz = exam(11);
  const s = {id: 1, title: 'Session', starts_at: iso(1), ends_at: iso(2), cancelled: false};
  const c = course(1, {delivery_mode: 'scheduled', enrollment: {status: 'approved', session: s}, assessments: [e, quiz]});
  const inProgress = course(3, {progress: 40, enrollment: {status: 'approved'}});
  const rows = selectNextSteps([c, course(2), inProgress, course(4, {enrollment: {status: 'approved'}, assessments: [quiz]})], [e, quiz, exam(99)],
    [assignment('exam', 10, iso(-3)), assignment('course', 1, iso(-2)), assignment('course', 2, iso(-1))], 7, now);
  assert.deepEqual(rows.map(r => r.key), ['exam:10', 'course:2', 'course:1', 'course:3', 'exam:11']);
  assert.equal(rows[0].action, 'Resume'); assert.equal(rows[2].action, 'View session'); assert.equal(rows[1].badge, 'Overdue');
  assert.equal(rows.some(r => r.key === 'exam:99'), false);
});
test('assignments exclude other people, completed, cancelled and unavailable rows; due dates sort with undated last', () => {
  const courses = [1,2,3,4,5,6,7].map(id => course(id));
  const rows = selectNextSteps(courses, [], [assignment('course',1,null),assignment('course',2,iso(3)),assignment('course',3,iso(-1)),
    assignment('course',4,null,{user_id:8}),assignment('course',5,null,{status:'completed'}),assignment('course',6,null,{status:'cancelled'}),assignment('course',7,null,{available:false})],7,now);
  assert.deepEqual(rows.map(r=>r.key), ['course:3','course:2','course:1']);
});
test('pending, cancelled, running and ended reservations have distinct actions', () => {
  const c = (id:number, status:string, start:number, end:number, cancelled=false) => course(id,{delivery_mode:'scheduled',enrollment:{status,session:{id,starts_at:iso(start),ends_at:iso(end),cancelled}}});
  const rows = selectNextSteps([c(1,'pending',2,3),c(2,'approved',1,2,true),c(3,'approved',-1,1),c(4,'approved',-3,-2)],[],[],7,now);
  assert.deepEqual(rows.map(r=>r.action), ['Start learning','Choose another session','View session']);
  assert.equal(rows[1].badge,'Session cancelled'); assert.equal(rows[2].badge,'Pending approval');
});
test('unknown progress and closed, upcoming, completed or waiting assessments are not actionable', () => {
  const assessments = [exam(1,{starts_at:iso(1)}),exam(2,{ends_at:iso(-1)}),exam(3,{attempts_remaining:0}),exam(4,{next_attempt_at:iso(1)}),exam(5,{last_result:{passed:false}})];
  const rows = selectNextSteps([course(1,{enrollment:{status:'approved'},progress:20,progress_known:false,assessments})],assessments,[],7,now);
  assert.deepEqual(rows.map(r=>r.action), ['Retake']);
});
test('selection retains total beyond the five displayed rows and ignores pending participation assessments', () => {
  const courses = Array.from({length:7},(_,i)=>course(i,{progress:10,enrollment:{status:'approved'}}));
  courses.push(course(50,{enrollment:{status:'pending'},assessments:[exam(50)]}));
  assert.equal(selectNextSteps(courses,[],[],7,now).length,7);
});

const reservation = (id: number, start: number, end: number, cancelled = false) => course(id, {
  delivery_mode: 'scheduled', enrollment: {status: 'approved', session: {id, title: `Slot ${id}`, starts_at: iso(start), ends_at: iso(end), cancelled}},
});
test('unpublished training never appears in personal next steps, including for managers', () => {
  const hidden = { ...reservation(1, 1, 2), published: false, can_manage: true };
  assert.deepEqual(selectNextSteps([hidden], [], [assignment('course', 1, null)], 7, now), []);
});
test('overdue assignments sort oldest first before later reserved sessions', () => {
  const rows = selectNextSteps([reservation(1, 120, 121), reservation(2, 216, 217)], [exam(3), exam(4)],
    [assignment('exam', 3, iso(-1)), assignment('exam', 4, iso(-24))], 7, now);
  assert.deepEqual(rows.map(r => r.key), ['exam:4', 'exam:3', 'course:1', 'course:2']);
  assert.equal(rows[0].action, 'Take assessment');
  assert.equal(rows[0].caption, 'Assigned to you');
});
test('dated sessions and assignments interleave chronologically, before undated work and progress', () => {
  const rows = selectNextSteps([reservation(1, 24, 25), reservation(2, 216, 217), course(3, {enrollment: {status: 'approved'}, progress: 30, assessments: [exam(7)]})],
    [exam(4), exam(5), exam(6)], [assignment('exam', 4, iso(168)), assignment('exam', 5, null), assignment('exam', 6, iso(2))], 7, now);
  assert.deepEqual(rows.map(r => r.key), ['exam:6', 'course:1', 'exam:4', 'course:2', 'exam:5', 'course:3', 'exam:7']);
});
test('active attempts, running and cancelled sessions precede overdue work without changing representatives', () => {
  const rows = selectNextSteps([reservation(1, -1, 1), reservation(2, 48, 49, true)], [exam(3), exam(4, {active_attempt_id: 'active'})],
    [assignment('course', 1, iso(-96)), assignment('course', 2, iso(-72)), assignment('exam', 3, iso(-24)), assignment('exam', 4, iso(-120))], 7, now);
  assert.deepEqual(rows.map(r => r.key), ['exam:4', 'course:1', 'course:2', 'exam:3']);
  assert.deepEqual(rows.map(r => r.action), ['Resume', 'Start learning', 'Choose another session', 'Take assessment']);
});
test('a quiz that opened when the session ended comes before later sessions and undated work', () => {
  const ended = course(1, {delivery_mode: 'scheduled', title: 'Hot work briefing', assessments: [exam(9)],
    enrollment: {status: 'approved', session: {id: 1, title: 'Slot 1', starts_at: iso(-26), ends_at: iso(-24), cancelled: false}}});
  const rows = selectNextSteps([reservation(2, 24, 25), ended, course(3, {enrollment: {status: 'approved'}, progress: 30})],
    [exam(5), exam(9)], [assignment('exam', 5, null)], 7, now);
  assert.deepEqual(rows.map(r => r.key), ['exam:9', 'course:2', 'exam:5', 'course:3']);
  assert.equal(rows[0].course?.title, 'Hot work briefing');
  assert.equal(rows[0].since, iso(-24));
});
