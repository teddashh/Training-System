import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedLocales, resolveLocale } from './localeResolution.ts';

test('session order determines the fallback for absent or disallowed saved languages', () => {
  const allowed = allowedLocales(['es', 'en', 'es', 'unknown']);
  assert.deepEqual(allowed, ['es', 'en']);
  assert.equal(resolveLocale('zh-TW', allowed), 'es');
  assert.equal(resolveLocale(null, allowed), 'es');
  assert.equal(resolveLocale('en', allowed), 'en');
});
test('single-language restrictions and malformed sessions remain usable', () => {
  assert.equal(resolveLocale('es', allowedLocales(['en'])), 'en');
  assert.deepEqual(allowedLocales([]), ['en']);
  assert.deepEqual(allowedLocales(undefined), ['en', 'zh-TW', 'es']);
});
