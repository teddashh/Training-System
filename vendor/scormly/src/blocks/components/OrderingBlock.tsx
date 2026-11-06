import type { BlockComponentProps } from '../types'
import type {
  BlockOfType,
  OrderingCategory,
  OrderingData,
  OrderingItem,
} from '../../types/course'
import { useCourseStore } from '../../store/courseStore'
import { uid } from '../../lib/id'
import { useT, translate } from '../../i18n/I18nProvider'
import ScoreSettings from './ScoreSettings'

const MODES: OrderingData['mode'][] = ['sequence', 'categories']

const iconBtn =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent'

export default function OrderingBlock({
  block,
  lessonId,
  selected,
}: BlockComponentProps<BlockOfType<'ordering'>>) {
  const update = useCourseStore((s) => s.updateBlockData)
  const { t } = useT('assessment')
  const { mode, prompt, items, categories } = block.data
  const isCategories = mode === 'categories'

  function patch(data: Partial<OrderingData>, coalesceKey?: string) {
    update(lessonId, block.id, data, coalesceKey)
  }

  function setItems(next: OrderingItem[], coalesceKey?: string) {
    patch({ items: next }, coalesceKey)
  }

  function setItem(id: string, change: Partial<OrderingItem>, coalesceKey?: string) {
    setItems(items.map((it) => (it.id === id ? { ...it, ...change } : it)), coalesceKey)
  }

  function moveItem(index: number, delta: number) {
    const to = index + delta
    if (to < 0 || to >= items.length) return
    const next = items.slice()
    const [moved] = next.splice(index, 1)
    next.splice(to, 0, moved)
    setItems(next)
  }

  function addItem() {
    setItems([
      ...items,
      { id: uid('item'), text: translate('content', 'orderingItem', { n: items.length + 1 }) },
    ])
  }

  function setCategories(next: OrderingCategory[], coalesceKey?: string) {
    patch({ categories: next }, coalesceKey)
  }

  function addCategory() {
    setCategories([
      ...categories,
      {
        id: uid('cat'),
        title: translate('content', 'orderingCategory', { n: categories.length + 1 }),
      },
    ])
  }

  function removeCategory(id: string) {
    // Drop the now-dangling assignments in the same undo step.
    patch({
      categories: categories.filter((c) => c.id !== id),
      items: items.map((it) => (it.categoryId === id ? { ...it, categoryId: undefined } : it)),
    })
  }

  return (
    <div className="space-y-4">
      {selected && (
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => m !== mode && patch({ mode: m })}
              className={`rounded-md px-4 py-2 text-sm font-medium ${
                mode === m ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t(m === 'sequence' ? 'modeSequence' : 'modeCategories')}
            </button>
          ))}
        </div>
      )}


      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-gray-500">{t('promptLabel')}</span>
        <textarea
          value={prompt}
          placeholder={t('promptPlaceholder')}
          rows={2}
          onChange={(e) => patch({ prompt: e.target.value }, `ordering-prompt-${block.id}`)}
          className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-gray-800 outline-none placeholder-gray-300 focus:border-brand"
        />
      </label>

      {isCategories && (
        <div className="space-y-2">
          <span className="block text-xs font-medium text-gray-500">{t('categoriesLabel')}</span>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center gap-1 rounded-md border border-gray-300 py-1 pr-1 pl-3 focus-within:border-brand"
              >
                <input
                  type="text"
                  value={cat.title}
                  placeholder={t('categoryPlaceholder')}
                  aria-label={t('categoryPlaceholder')}
                  onChange={(e) =>
                    setCategories(
                      categories.map((c) => (c.id === cat.id ? { ...c, title: e.target.value } : c)),
                      `ordering-cat-${cat.id}`,
                    )
                  }
                  className="w-36 bg-transparent text-sm text-gray-800 outline-none placeholder-gray-300"
                />
                {selected && (
                  <button
                    type="button"
                    onClick={() => removeCategory(cat.id)}
                    className={iconBtn}
                    aria-label={t('removeCategory')}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {selected && (
              <button type="button" onClick={addCategory} className="btn-secondary text-sm">
                {t('addCategory')}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <span className="block text-xs font-medium text-gray-500">
          {t(isCategories ? 'itemsCategories' : 'itemsSequence')}
        </span>
        {!isCategories && selected && (
          <span className="block text-xs text-gray-400">{t('itemsSequenceHelp')}</span>
        )}
        {items.map((it, i) => (
          <div key={it.id} className="flex items-center gap-2 rounded-lg border border-gray-200 p-2">
            {!isCategories && (
              <span className="w-6 shrink-0 text-center text-xs font-semibold text-gray-400">
                {i + 1}
              </span>
            )}
            <input
              type="text"
              value={it.text}
              placeholder={t('itemPlaceholder')}
              aria-label={t('itemPlaceholder')}
              onChange={(e) => setItem(it.id, { text: e.target.value }, `ordering-item-${it.id}`)}
              className="min-w-0 flex-1 bg-transparent px-1 text-gray-800 outline-none placeholder-gray-300"
            />
            {isCategories && (
              <select
                value={it.categoryId ?? ''}
                aria-label={t('itemCategory')}
                onChange={(e) => setItem(it.id, { categoryId: e.target.value || undefined })}
                className="max-w-[45%] rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-brand"
              >
                <option value="">{t('noCategory')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            )}
            {selected && !isCategories && (
              <>
                <button
                  type="button"
                  onClick={() => moveItem(i, -1)}
                  disabled={i === 0}
                  className={iconBtn}
                  aria-label={t('moveUp')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(i, 1)}
                  disabled={i === items.length - 1}
                  className={iconBtn}
                  aria-label={t('moveDown')}
                >
                  ↓
                </button>
              </>
            )}
            {selected && (
              <button
                type="button"
                onClick={() => setItems(items.filter((x) => x.id !== it.id))}
                className={iconBtn}
                aria-label={t('removeItem')}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {selected && (
          <button type="button" onClick={addItem} className="btn-secondary text-sm">
            {t('addItem')}
          </button>
        )}
      </div>
      {/* Scoring options last, below the content, and only while editing. */}
      {selected && (
        <div className="space-y-3 border-t border-gray-100 pt-3">
        <ScoreSettings
          blockId={block.id}
          passingScore={block.data.passingScore}
          showAnswers={block.data.showAnswers ?? true}
          onChange={(change, key) => patch(change, key)}
        />
        </div>
      )}
    </div>
  )
}
