import { brand, setOrganization } from '../brand'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './types'
import { companyApi } from '../lib/platformApi'
import { DICTIONARY, type Namespace } from './dictionary'

const STORAGE_KEY = 'training-language'

// Current UI language mirrored at module scope so non-React code (the store,
// services) can localize default content via translate().
let currentLanguage: Language = DEFAULT_LANGUAGE

export function getCurrentLanguage(): Language {
  return currentLanguage
}

function interpolate(
  str: string,
  vars?: Record<string, string | number>,
): string {
  vars = { organization: brand.organization, ...vars }
  return str.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  )
}

/** Translate outside React (uses the last-known UI language). */
export function translate(
  namespace: Namespace,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const table = DICTIONARY[namespace][currentLanguage]
  return interpolate(table[key] ?? key, vars)
}

interface I18nContextValue {
  lang: Language
  setLang: (lang: Language) => void
  languages: Language[]
}

const I18nContext = createContext<I18nContextValue | null>(null)

function detectInitial(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'zh-TW' || stored === 'es') {
      currentLanguage = stored
      return stored
    }
  } catch { /* Restricted browser storage: use English. */ }
  return DEFAULT_LANGUAGE
}

export function resolveLanguages(value: unknown): Language[] {
  const list = Array.isArray(value) ? value.filter((id): id is Language => LANGUAGES.some(l => l.id === id)) : LANGUAGES.map(l => l.id)
  return list.length ? [...new Set(list)] : ['en']
}

export function resolveLanguage(current: Language, languages: Language[]): Language {
  return languages.includes(current) ? current : languages[0]
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(detectInitial)
  const [languages, setLanguages] = useState<Language[]>(LANGUAGES.map(l => l.id))
  const [ready, setReady] = useState(false)

  const persist = useCallback((next: Language) => {
    currentLanguage = next
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* Use the in-memory choice. */ }
    document.documentElement.lang = next
    document.cookie = `django_language=${next === 'zh-TW' ? 'zh-hant' : next}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
    setLangState(next)
  }, [])

  const setLang = useCallback((next: Language) => {
    persist(resolveLanguage(next, languages))
  }, [languages, persist])

  useEffect(() => {
    let alive = true
    fetch(companyApi + 'auth/session/', { credentials: 'same-origin' })
      .then(response => {
        if (!response.ok) throw new Error('Session unavailable')
        return response.json()
      })
      .then(session => { if (alive) setOrganization(session.organization); return resolveLanguages(session.languages) })
      .catch(() => LANGUAGES.map(l => l.id))
      .then(allowed => {
        if (!alive) return
        setLanguages(allowed)
        persist(resolveLanguage(detectInitial(), allowed))
        setReady(true)
      })
    return () => { alive = false }
  }, [persist])

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setLang(event.newValue as Language)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [setLang])

  const value = useMemo(() => ({ lang, setLang, languages }), [lang, setLang, languages])
  return <I18nContext.Provider value={value}>{ready ? children : null}</I18nContext.Provider>
}

export function useLang(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useLang must be used within I18nProvider')
  return ctx
}

export type TFunction = (key: string, vars?: Record<string, string | number>) => string

// Translation hook bound to a namespace. Returns t(key) → string in the current
// language (falling back to the key itself) and the current language. Supports {var} substitution.
export function useT(namespace: Namespace): { t: TFunction; lang: Language } {
  const { lang } = useLang()
  const table = DICTIONARY[namespace][lang]

  const t = useCallback<TFunction>(
    (key, vars) => {
      return interpolate(table[key] ?? key, vars)
    },
    [table],
  )

  return { t, lang }
}
