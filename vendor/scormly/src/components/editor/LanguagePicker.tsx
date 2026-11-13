import { useEffect, useRef, useState } from 'react'
import { useLang, useT } from '../../i18n/I18nProvider'
import { LANGUAGES } from '../../i18n/types'

// Shares English, Traditional Chinese and Spanish with the company platform.
export default function LanguagePicker() {
  const { lang, setLang, languages } = useLang()
  const { t } = useT('common')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (languages.length < 2) return null
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('interfaceLanguage')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium uppercase text-gray-600 hover:bg-gray-100"
      >
        {lang}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-44 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
          {languages.map(id => LANGUAGES.find(l => l.id === id)!).map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setLang(l.id)
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                l.id === lang ? 'font-medium text-gray-900' : 'text-gray-600'
              }`}
            >
              {l.label}
              {l.id === lang && <span className="text-brand">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
