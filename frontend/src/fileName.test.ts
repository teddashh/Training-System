import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileNameFrom } from './fileName.ts';

test('a download takes the name the server suggests and never a path', () => {
  const fallback = 'session-7-sign-in.pdf';
  assert.equal(fileNameFrom(null, fallback), fallback);
  assert.equal(fileNameFrom('attachment', fallback), fallback);
  assert.equal(fileNameFrom('attachment; filename="Forklift refresher - Session 1 - sign-in.pdf"', fallback), 'Forklift refresher - Session 1 - sign-in.pdf');
  // The extended form wins over the ASCII fallback and keeps other scripts.
  assert.equal(fileNameFrom(`attachment; filename="Session 1 - sign-in.pdf"; filename*=UTF-8''%E5%A0%86%E9%AB%98%E6%A9%9F%20-%20Session%201%20-%20sign-in.pdf`, fallback), '堆高機 - Session 1 - sign-in.pdf');
  assert.equal(fileNameFrom(`attachment; filename*=UTF-8''%E0%A4%A; filename="plain.xlsx"`, fallback), 'plain.xlsx');
  assert.equal(fileNameFrom('attachment; filename="..\\\\..\\\\a/b:c.pdf"', fallback), '.. .. a b c.pdf');
  assert.equal(fileNameFrom('attachment; filename=""', fallback), fallback);
});
