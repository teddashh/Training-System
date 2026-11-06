import { describe, expect, it } from 'vitest'
import { DICTIONARY } from '../src/i18n/dictionary'
import { DEFAULT_LANGUAGE, LANGUAGES } from '../src/i18n/types'
import fs from 'node:fs'
import vm from 'node:vm'
import messages from '../../../shared/locales/messages.json'
import { translate } from '../src/i18n/I18nProvider'

const placeholders = (value: string) => [...value.matchAll(/\{\w+\}/g)].map(m => m[0]).sort()
describe('company interface languages', () => {
  it('offers English, Traditional Chinese and Spanish with English as default', () => {
    expect(DEFAULT_LANGUAGE).toBe('en')
    expect(LANGUAGES.map(l => l.id)).toEqual(['en', 'zh-TW', 'es'])
  })
  it('has a complete dictionary and matching placeholders for every namespace', () => {
    const catalogEnglish = new Set(Object.values(messages).map(message => message.en))
    for (const [name, table] of Object.entries(DICTIONARY)) {
      for (const locale of ['zh-TW', 'es'] as const) {
        expect(Object.keys(table[locale]).sort(), `${name}/${locale}`).toEqual(Object.keys(table.en).sort())
        for (const key of Object.keys(table.en)) {
          expect(catalogEnglish.has(table.en[key]), `${name}.${key} is missing from the shared catalog`).toBe(true)
          expect(table[locale][key].length, `${name}.${key}`).toBeGreaterThan(0)
          expect(placeholders(table[locale][key]), `${name}.${key}/${locale}`).toEqual(placeholders(table.en[key]))
        }
      }
    }
  })
  it('preserves authored values containing replacement tokens', () => {
    expect(translate('common', 'lessonDeleted', { title: 'Budget $& / $1 / $$' })).toBe('Lesson “Budget $& / $1 / $$” deleted')
  })
  it('includes complete Traditional Chinese in the exported player', () => {
    const source = fs.readFileSync('public/scorm-player/player.js', 'utf8')
    const table = source.slice(source.indexOf('var T = ') + 8, source.indexOf('\n  function supportedLanguage'))
    const translations = vm.runInNewContext('(' + table.trim().replace(/;$/, '') + ')')
    expect(Object.keys(translations['zh-TW']).sort()).toEqual(Object.keys(translations.en).sort())
    for (const key of Object.keys(translations.en)) {
      expect(placeholders(translations['zh-TW'][key])).toEqual(placeholders(translations.en[key]))
    }
  })
})
