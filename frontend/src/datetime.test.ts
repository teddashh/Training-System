import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate, formatDateTime, formatTimeRange } from './datetime.ts';
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
