import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveLanguage, resolveLanguages } from '../src/i18n/I18nProvider'
import LanguagePicker from '../src/components/editor/LanguagePicker'

const state = vi.hoisted(() => ({ lang: 'en', languages: ['en'], setLang: vi.fn() }))
vi.mock('../src/i18n/I18nProvider', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/i18n/I18nProvider')>()
  return { ...actual, useLang: () => state, useT: () => ({ t: (key: string) => key }) }
})
describe('deployment interface languages', () => {
  it('clamps stored languages to the ordered allowed list', () => {
    expect(resolveLanguages(['es', 'en', 'uk', 'es'])).toEqual(['es', 'en'])
    expect(resolveLanguage('zh-TW', ['es', 'en'])).toBe('es')
    expect(resolveLanguages(undefined)).toEqual(['en', 'zh-TW', 'es'])
  })
  it('renders no picker or wrapper for one language', () => {
    state.languages = ['en']
    expect(renderToStaticMarkup(createElement(LanguagePicker))).toBe('')
    state.languages = ['en', 'es']
    expect(renderToStaticMarkup(createElement(LanguagePicker))).toContain('button')
  })
})
