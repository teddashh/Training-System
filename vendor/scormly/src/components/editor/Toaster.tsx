import { useToastStore, type ToastTone } from '../../store/toastStore'
import { useT } from '../../i18n/I18nProvider'

const TONE_ICON: Record<ToastTone, React.ReactNode> = {
  info: null,
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-emerald-400" aria-hidden>
      <path d="m5 12 5 5 9-10" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}
      strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-red-400" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  ),
}

// Bottom-center stack of transient notifications (see store/toastStore).
export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  const { t } = useT('common')

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className="toast-in pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl bg-gray-900 py-2.5 pl-4 pr-2 text-sm text-white shadow-lg"
        >
          {TONE_ICON[toast.tone] && <span className="shrink-0">{TONE_ICON[toast.tone]}</span>}
          <span className="min-w-0 flex-1">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick()
                dismiss(toast.id)
              }}
              className="shrink-0 rounded-md px-2.5 py-1 font-semibold text-brand-light hover:bg-white/10"
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label={t('dismiss')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
