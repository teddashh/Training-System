import { useEffect, type RefObject } from 'react'

// Exposes the scroll container's inner width as the CSS variable --page-w, so
// full-bleed content (full-width images, cover pages) can break out of the
// centered content column: width: var(--page-w); margin-left: calc(50% - var(--page-w) / 2).
export function usePageWidthVar(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const apply = () => el.style.setProperty('--page-w', `${el.clientWidth}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
}
