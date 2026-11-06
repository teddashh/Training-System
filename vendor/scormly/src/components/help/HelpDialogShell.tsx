import { useRef, type ReactNode } from 'react'
import { useDialog } from '../../hooks/useDialog'
import { useT } from '../../i18n/I18nProvider'

// Shared modal frame for the help dialogs (Q&A, What's new).
export default function HelpDialogShell({
  id,
  title,
  onClose,
  children,
}: {
  id: string
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useT('common')
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref, onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 id={id} className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('dismiss')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 outline-none hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-brand"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  )
}
