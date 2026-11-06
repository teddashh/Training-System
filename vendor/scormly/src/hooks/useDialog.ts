import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Modal dialog focus handling: move focus into the dialog on open, keep Tab
// cycling inside it, close on Esc, and give focus back to whatever had it
// before (e.g. the button that opened the dialog).
export function useDialog(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  { focusContainer = false }: { focusContainer?: boolean } = {},
) {
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const previous = document.activeElement as HTMLElement | null
    const focusables = () => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (focusContainer) root.focus()
    else (focusables()[0] ?? root).focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
        return
      }
      if (e.key !== 'Tab') return
      const list = focusables()
      if (!list.length) return
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !root!.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !root!.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [ref, focusContainer])
}
