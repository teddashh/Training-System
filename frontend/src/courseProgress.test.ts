import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { courseProgressLabels } from './courseProgress.ts';

test('a personal course card calls a course started only for measured progress between 0 and 100', () => {
  const cases: [Parameters<typeof courseProgressLabels>[0], string, string][] = [
    [{ progress: 0 }, 'Not started', 'Open'],
    [{ progress: 1 }, 'In progress', 'Continue'],
    [{ progress: 99, progress_known: true }, 'In progress', 'Continue'],
    [{ progress: 100 }, 'Not started', 'Open'],
    [{ progress: null }, 'Not started', 'Open'],
    [{ progress: 50, progress_known: false }, 'Not started', 'Open'],
    [{ progress: null, progress_known: false }, 'Not started', 'Open'],
  ];
  for (const [course, status, action] of cases)
    assert.deepEqual(courseProgressLabels(course), { status, action }, JSON.stringify(course));
});
