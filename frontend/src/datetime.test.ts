import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate, formatDateTime, formatTimeRange, toLocalDateTime, localDateTimeToIso } from './datetime.ts';
test('schedule formats omit seconds in each supported locale and include a changed end date only once', () => {
  const start = '2026-11-12T09:30:57', same = '2026-11-12T11:15:59', next = '2026-11-13T11:15:59';
  for(const locale of ['en','zh-TW','es']) {
    assert.ok(!formatDateTime(start,locale).includes(':57'));
    assert.ok(!formatTimeRange(start,same,locale).includes(':59'));
    assert.ok(!formatTimeRange(start,same,locale).includes(formatDate(same,locale)));
    assert.ok(formatTimeRange(start,next,locale).includes(formatDate(next,locale)));
    assert.ok(formatDateTime(start,locale,{zone:true,weekday:true}));
  }
});

test('local editor values use the instant offset across both New York DST changes', () => {
  const old = process.env.TZ; process.env.TZ = 'America/New_York';
  try {
    for (const [instant, expected] of [
      ['2026-03-08T06:59:00Z', '2026-03-08T01:59'], ['2026-03-08T07:00:00Z', '2026-03-08T03:00'],
      ['2026-11-01T05:59:00Z', '2026-11-01T01:59'], ['2026-11-01T06:00:00Z', '2026-11-01T01:00'],
    ]) assert.equal(toLocalDateTime(instant), expected);
    assert.equal(localDateTimeToIso('2026-11-01T01:00', '2026-11-01T06:00:00Z'), '2026-11-01T06:00:00Z');
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
