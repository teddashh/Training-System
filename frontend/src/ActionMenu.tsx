import {useEffect, useRef, type ReactNode} from 'react';
import {MoreHorizontal} from 'lucide-react';
import {t} from './i18n';

/** One small menu for the less frequent actions of a row or a page. It opens towards the side with room and
 *  closes on a choice, an outside press, Escape or when focus leaves it. */
export default function ActionMenu({title, label, children}: {title: string; label?: string; children: ReactNode}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  function hide() {
    if (panel.current?.hidePopover && panel.current.matches(':popover-open')) panel.current.hidePopover();
  }
  function close(focus = false) {
    if (!menu.current?.open) return;
    hide();
    menu.current.open = false;
    if (focus) menu.current.querySelector('summary')?.focus();
  }
  function position() {
    const box = menu.current, popup = panel.current;
    if (!box?.open || !popup) return;
    const anchor = box.querySelector('summary')!.getBoundingClientRect();
    const dialog = box.closest('.modal')?.getBoundingClientRect();
    if (anchor.bottom <= Math.max(0, dialog?.top || 0) || anchor.top >= Math.min(window.innerHeight, dialog?.bottom ?? window.innerHeight)) { close(); return; }
    const gap = 8;
    popup.style.maxHeight = '';
    const width = popup.getBoundingClientRect().width, height = popup.getBoundingClientRect().height;
    const leftEdge = dialog?.left || 0;
    const left = anchor.right - width < leftEdge + gap ? anchor.left : anchor.right - width;
    const below = window.innerHeight - anchor.bottom - gap * 2, above = anchor.top - gap * 2;
    const down = below >= height || below >= above;
    const available = Math.max(1, down ? below : above);
    popup.style.left = `${Math.max(gap, Math.min(left, window.innerWidth - width - gap))}px`;
    popup.style.top = `${down ? anchor.bottom + gap : Math.max(gap, anchor.top - gap - Math.min(height, available))}px`;
    popup.style.maxHeight = `${available}px`;
  }
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) position(); };
    const resize = () => position();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) {
        event.preventDefault(); event.stopImmediatePropagation(); close(true);
      }
    };
    const observer = new ResizeObserver(position);
    if (panel.current) observer.observe(panel.current);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', resize);
      observer.disconnect();
    };
  }, []);
  return <details ref={menu} className="course-more action-menu" onToggle={event => {
    if (event.target !== event.currentTarget) return;
    const box = menu.current;
    if (box?.open) { panel.current?.showPopover?.(); position(); }
    else hide();
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    <summary className={label ? 'btn' : 'icon-btn'} aria-label={label ? undefined : t('More actions for {title}', {title})}>{label || <MoreHorizontal size={18}/>}</summary>
    <div ref={panel} popover="manual" className="course-more-panel" onClick={event => {
      const target = event.target as HTMLElement;
      if (menu.current?.contains(target) && target.closest('button,a') && !target.closest('[data-keep-menu]')) close(true);
    }}>{children}</div>
  </details>;
}
