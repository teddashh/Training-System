import type { ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useT } from '../../i18n/I18nProvider'
import ResultMark from './ResultMark'

const arrowBtn =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent'

/** The learner's order, kept in step with the authored items: items added
 *  while the preview is open are appended, removed ones dropped. */
export function currentOrder(order: string[], ids: string[]): string[] {
  return [...order.filter((id) => ids.includes(id)), ...ids.filter((id) => !order.includes(id))]
}

// "Put in order" list shared by the ordering block and quiz sequence
// questions: drag (pointer or keyboard) or the arrow buttons. `items` are in
// the correct order; `order` is the learner's (see currentOrder).
export default function SequenceList({
  items,
  order,
  onChange,
  submitted,
  reveal,
}: {
  items: { id: string; text: string }[]
  order: string[]
  onChange: (order: string[]) => void
  submitted: boolean
  reveal: boolean
}) {
  const { t } = useT('assessment')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = items.map((it) => it.id)
  const byId = new Map(items.map((it) => [it.id, it]))

  function move(index: number, delta: number) {
    const to = index + delta
    if (to < 0 || to >= order.length) return
    onChange(arrayMove(order, index, to))
  }

  function onSortEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    const from = order.indexOf(String(e.active.id))
    const to = order.indexOf(String(e.over.id))
    if (from !== -1 && to !== -1) onChange(arrayMove(order, from, to))
  }

  const rowTone = (ok: boolean) =>
    reveal ? (ok ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50') : 'border-gray-200/90 bg-white'

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSortEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ol className="space-y-2">
          {order.map((id, i) => {
            const it = byId.get(id)!
            const correctIndex = ids.indexOf(id)
            return (
              <SortableRow key={id} id={id} disabled={submitted} className={rowTone(correctIndex === i)}>
                {reveal && <ResultMark ok={correctIndex === i} />}
                <span className="flex-1 text-gray-800">{it.text}</span>
                {reveal && correctIndex !== i && (
                  <span className="text-xs text-gray-500">{t('correctPosition', { n: correctIndex + 1 })}</span>
                )}
                {!submitted && (
                  <>
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className={arrowBtn}
                      aria-label={`${t('moveUp')}: ${it.text}`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === order.length - 1}
                      className={arrowBtn}
                      aria-label={`${t('moveDown')}: ${it.text}`}
                    >
                      ↓
                    </button>
                  </>
                )}
              </SortableRow>
            )
          })}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

function SortableRow({
  id,
  disabled,
  className,
  children,
}: {
  id: string
  disabled: boolean
  className: string
  children: ReactNode
}) {
  const { t } = useT('assessment')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : undefined }}
      className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-shadow ${className} ${
        isDragging ? 'z-10 shadow-xl ring-2 ring-brand/40' : 'hover:shadow-md'
      }`}
    >
      {!disabled && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={t('dragItem')}
          className="flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
            <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>
      )}
      {children}
    </li>
  )
}
