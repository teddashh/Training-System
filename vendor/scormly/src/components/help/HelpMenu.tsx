import { useRef, useState } from 'react'
import { useMenu } from '../../hooks/useMenu'
import { useCourseStore } from '../../store/courseStore'
import { hasUnseenRelease, useHelpStore } from '../../help/helpStore'
import { GITHUB_ISSUES_URL } from '../../lib/links'
import { KEYS } from '../../lib/keyboard'
import { useT } from '../../i18n/I18nProvider'

const ITEM =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none'

// Header "?" menu: tour, what's new (badged until opened), builder Q&A,
// keyboard shortcuts, issue tracker.
export default function HelpMenu() {
  const { t } = useT('help')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const startTour = useHelpStore((s) => s.startTour)
  const openDialog = useHelpStore((s) => s.openDialog)
  const unseen = useHelpStore((s) => hasUnseenRelease(s.whatsNewSeen))
  const setShortcutsOpen = useCourseStore((s) => s.setShortcutsOpen)
  useMenu({ open, onClose: () => setOpen(false), rootRef, triggerRef })

  function pick(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <div ref={rootRef} className="relative" data-tour="help">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('help')}
        aria-label={t('help')}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100"
      >
        <HelpIcon />
        {unseen && (
          <span aria-hidden className="absolute right-1 top-1 h-2 w-2 rounded-full bg-brand ring-2 ring-white" />
        )}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-2 w-60 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
          <button type="button" role="menuitem" className={ITEM} onClick={() => pick(startTour)}>
            {t('menuTour')}
          </button>
          <button type="button" role="menuitem" className={ITEM} onClick={() => pick(() => openDialog('whatsNew'))}>
            {t('menuWhatsNew')}
            {unseen && (
              <span className="ml-auto rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                {t('newBadge')}
              </span>
            )}
          </button>
          <button type="button" role="menuitem" className={ITEM} onClick={() => pick(() => openDialog('faq'))}>
            {t('menuFaq')}
          </button>
          <button type="button" role="menuitem" className={ITEM} onClick={() => pick(() => setShortcutsOpen(true))}>
            {t('menuShortcuts')}
            <span className="ml-auto text-xs text-gray-400">{KEYS.help}</span>
          </button>
          <div className="my-1 h-px bg-gray-100" />
          <a
            role="menuitem"
            href={GITHUB_ISSUES_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className={ITEM}
          >
            {t('menuReport')}
          </a>
        </div>
      )}
    </div>
  )
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.25a2.5 2.5 0 0 1 4.86.83c0 1.67-2.36 2.17-2.36 3.42M12 16.75h.01" />
    </svg>
  )
}
