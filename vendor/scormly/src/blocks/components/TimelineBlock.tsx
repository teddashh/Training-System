import type { BlockComponentProps } from '../types'
import type { BlockOfType, TimelineItem, TimelineLayout } from '../../types/course'
import { useCourseStore } from '../../store/courseStore'
import { useT, translate } from '../../i18n/I18nProvider'
import { uid } from '../../lib/id'
import TimelinePreview from '../../preview/components/TimelinePreview'

const LAYOUTS: { value: TimelineLayout; key: string }[] = [
  { value: 'vertical', key: 'layoutVertical' },
  { value: 'stepper', key: 'layoutStepper' },
]

export default function TimelineBlock({
  block,
  lessonId,
  selected,
}: BlockComponentProps<BlockOfType<'timeline'>>) {
  const { t } = useT('hotspotTimeline')
  const update = useCourseStore((s) => s.updateBlockData)
  const { layout, items } = block.data

  // Unselected: show exactly what the learner sees.
  if (!selected) {
    return items.length ? (
      <TimelinePreview block={block} />
    ) : (
      <p className="text-sm text-gray-400">{t('noSteps')}</p>
    )
  }

  function setField(id: string, field: 'label' | 'title' | 'text', value: string) {
    const next = items.map((it) => (it.id === id ? { ...it, [field]: value } : it))
    update(lessonId, block.id, { items: next }, `timeline-${field}-${id}`)
  }

  function addItem() {
    const n = items.length + 1
    const item: TimelineItem = {
      id: uid('step'),
      label: translate('content', 'timelineLabel', { n }),
      title: translate('content', 'timelineTitle', { n }),
      text: '',
    }
    update(lessonId, block.id, { items: [...items, item] })
  }

  function removeItem(id: string) {
    update(lessonId, block.id, { items: items.filter((it) => it.id !== id) })
  }

  function move(index: number, dir: -1 | 1) {
    const next = [...items]
    const [it] = next.splice(index, 1)
    next.splice(index + dir, 0, it)
    update(lessonId, block.id, { items: next })
  }

  const inputCls =
    'w-full rounded border border-gray-200 px-3 py-2 text-sm outline-none placeholder-gray-300 focus:border-brand'
  const iconBtn =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs font-medium text-gray-500">{t('layout')}</span>
        {LAYOUTS.map((l) => (
          <button
            key={l.value}
            type="button"
            aria-pressed={layout === l.value}
            onClick={() => update(lessonId, block.id, { layout: l.value })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              layout === l.value
                ? 'bg-brand text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t(l.key)}
          </button>
        ))}
      </div>

      <ol className="relative ml-2 space-y-3 border-l-2 border-gray-200">
        {items.map((item, i) => (
          <li key={item.id} className="relative pl-6">
            <span className="absolute -left-[9px] top-3 h-4 w-4 rounded-full border-2 border-white bg-brand shadow" />
            <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.label}
                  placeholder={t('labelPlaceholder')}
                  aria-label={t('labelPlaceholder')}
                  onChange={(e) => setField(item.id, 'label', e.target.value)}
                  className={`${inputCls} flex-1 font-semibold text-brand`}
                />
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className={iconBtn}
                  aria-label={t('moveUp')}
                  title={t('moveUp')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === items.length - 1}
                  className={iconBtn}
                  aria-label={t('moveDown')}
                  title={t('moveDown')}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className={iconBtn}
                  aria-label={t('removeStep')}
                  title={t('removeStep')}
                >
                  ✕
                </button>
              </div>
              <input
                type="text"
                value={item.title}
                placeholder={t('stepTitlePlaceholder')}
                aria-label={t('stepTitlePlaceholder')}
                onChange={(e) => setField(item.id, 'title', e.target.value)}
                className={`${inputCls} font-medium`}
              />
              <textarea
                value={item.text}
                rows={2}
                placeholder={t('stepTextPlaceholder')}
                aria-label={t('stepTextPlaceholder')}
                onChange={(e) => setField(item.id, 'text', e.target.value)}
                className={`${inputCls} resize-y`}
              />
            </div>
          </li>
        ))}
      </ol>
      {items.length === 0 && <p className="text-sm text-gray-400">{t('noSteps')}</p>}

      <button type="button" onClick={addItem} className="btn-secondary text-sm">
        {t('addStep')}
      </button>
    </div>
  )
}
