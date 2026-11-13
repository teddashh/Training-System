import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSessionCalendar, foldCalendarLine, downloadCalendar } from './calendar.ts';
const session = {id: 4, revision: 3, title: '午後課程', starts_at: '2026-11-12T09:30:00-05:00', ends_at: '2026-11-12T11:00:00-05:00', location: 'Room A;B, C\\D\nNext floor'};
const options = {organization: 'Training System', host: 'training.example.test:8443', url: 'https://training.example.test:8443/training/courses?course=2&action=register', now: new Date('2026-11-11T00:00:00Z')};
test('calendar uses UTC, stable identity, revision, escaped text and CRLF', () => {
  const result = buildSessionCalendar({title:'Synthetic, course'},session,7,options);
  assert.ok(result.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(result.includes('UID:training-session-4-7@training.example.test:8443\r\n'));
  for(const line of ['DTSTAMP:20261111T000000Z','DTSTART:20261112T143000Z','DTEND:20261112T160000Z','SEQUENCE:3','METHOD:PUBLISH']) assert.ok(result.includes(line+'\r\n'));
  assert.ok(result.includes('LOCATION:Room A\\;B\\, C\\\\D\\nNext floor'));
  assert.ok(!result.replaceAll('\r\n','').includes('\n'));
  assert.ok(!result.includes('Join meeting'));
});
test('UTF-8 folding counts continuation whitespace and never splits a character', () => {
  const text = 'SUMMARY:' + '繁體中文😀'.repeat(40);
  const folded = foldCalendarLine(text);
  assert.equal(folded.replaceAll('\r\n ',''),text);
  for(const line of folded.split('\r\n')) assert.ok(new TextEncoder().encode(line).length<=75);
});
test('meeting URL is included only from the supplied session; equal titles do not repeat', () => {
  const result = buildSessionCalendar({title:session.title},{...session,meeting_url:'https://meeting.example.test/room'},7,options).replaceAll('\r\n ','');
  assert.ok(result.includes(`SUMMARY:${session.title}\r\n`));
  assert.ok(result.includes(`DESCRIPTION:Join meeting: https://meeting.example.test/room\\n\\nTraining details: ${options.url}`));
  assert.ok(result.includes(`URL:${options.url}\r\n`));
});

test('calendar keeps URI delimiters raw and localizes readable training details', () => {
  const url = options.url + '&room=a,b;c';
  const plain = buildSessionCalendar({title: 'Synthetic'}, session, 7, {...options, url, trainingDetails: '訓練詳情'}).replaceAll('\r\n ', '');
  assert.ok(plain.includes(`URL:${url}\r\n`));
  assert.ok(plain.includes(`DESCRIPTION:訓練詳情: ${url.replace(',', '\\,').replace(';', '\\;')}\r\n`));
  const meeting = buildSessionCalendar({title: 'Synthetic'}, {...session, meeting_url: 'https://meeting.example.test/room'}, 7,
    {...options, trainingDetails: '訓練詳情', joinMeeting: '加入會議'}).replaceAll('\r\n ', '');
  assert.ok(meeting.includes(`DESCRIPTION:加入會議: https://meeting.example.test/room\\n\\n訓練詳情: ${options.url}`));
});
test('calendar download keeps its object URL alive for sixty seconds', context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const revoked = context.mock.method(URL, 'revokeObjectURL', () => {});
  context.mock.method(URL, 'createObjectURL', () => 'blob:synthetic-calendar');
  let clicked = false, removed = false;
  const link = {href: '', download: '', click: () => {clicked = true;}, remove: () => {removed = true;}};
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable: true, value: {createElement: () => link, body: {append: () => {}}}});
  try {
    downloadCalendar('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    assert.equal(link.download, 'training-session.ics');
    assert.ok(clicked && removed);
    context.mock.timers.tick(59_999);
    assert.equal(revoked.mock.callCount(), 0);
    context.mock.timers.tick(1);
    assert.equal(revoked.mock.callCount(), 1);
    assert.deepEqual(revoked.mock.calls[0].arguments, ['blob:synthetic-calendar']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
