import { useEffect, useRef, type RefObject } from 'react'

const ITEM = '[role="menuitem"]:not([disabled])'

interface MenuOptions {
  open: boolean
  onClose: () => void
  rootRef: RefObject<HTMLElement | null>
  /** Gets focus back when the menu is closed with Esc. */
  triggerRef?: RefObject<HTMLElement | null>
  /** Focus the first item on open (off when the menu focuses a search field). */
  focusFirst?: boolean
}

// Shared dropdown behaviour: outside click and Esc close the menu; ↑/↓/Home/
// End move focus between its [role=menuitem] elements; Tab closes it. From a
// text field inside the menu, ↓ enters the item list and ↑ on the first item
// returns to the field.
export function useMenu({ open, onClose, rootRef, triggerRef, focusFirst = true }: MenuOptions) {
  // Latest onClose without re-running the effect (and re-focusing) every render.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const root = rootRef.current
    if (!open || !root) return
    const items = () => [...root.querySelectorAll<HTMLElement>(ITEM)]
    if (focusFirst) items()[0]?.focus()

    function onPointerDown(e: PointerEvent) {
      if (!root!.contains(e.target as Node)) close.current()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close.current()
        triggerRef?.current?.focus()
        return
      }
      if (e.key === 'Tab') {
        close.current()
        return
      }
      const list = items()
      if (!list.length) return
      const i = list.indexOf(document.activeElement as HTMLElement)
      let next: HTMLElement | undefined
      if (e.key === 'ArrowDown') next = list[(i + 1) % list.length]
      else if (e.key === 'ArrowUp') {
        const field = root!.querySelector<HTMLElement>('input')
        next = i <= 0 && field ? field : list[(i - 1 + list.length) % list.length]
      } else if (e.key === 'Home' && i >= 0) next = list[0]
      else if (e.key === 'End' && i >= 0) next = list[list.length - 1]
      if (next) {
        e.preventDefault()
        next.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, rootRef, triggerRef, focusFirst])
}
