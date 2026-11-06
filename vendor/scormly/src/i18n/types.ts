// Interface languages. ONLY the editor shell (chrome) is localized, not the
// course content — block text stays exactly as the author entered it.
export type Language = 'en' | 'zh-TW' | 'es' | 'uk'

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'es', label: 'Español' },
]

// English is the default. The company platform shares the saved preference.
export const DEFAULT_LANGUAGE: Language = 'en'

// Translation table for a single namespace: key → string, for each language.
export type LocaleTable = Record<'en' | 'uk', Record<string, string>>
