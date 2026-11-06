import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { DEFAULT_LANGUAGE, type Language } from './types'
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
  if (!vars) return str
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

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(detectInitial)

  const setLang = useCallback((next: Language) => {
    setLangState(next)
    currentLanguage = next
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* Use the in-memory choice. */ }
  }, [])

  useEffect(() => {
    currentLanguage = lang
    document.documentElement.lang = lang
    document.cookie = `django_language=${lang === 'zh-TW' ? 'zh-hant' : lang}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
  }, [lang])

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && ['en', 'zh-TW', 'es'].includes(event.newValue || '')) {
        currentLanguage = event.newValue as Language
        setLangState(currentLanguage)
      }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
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
