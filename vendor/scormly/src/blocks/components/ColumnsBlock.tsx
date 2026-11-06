import type { BlockComponentProps } from '../types'
import type { BlockOfType, ColumnsStyle, TextColumn } from '../../types/course'
import { useCourseStore } from '../../store/courseStore'
import { translate, useT } from '../../i18n/I18nProvider'
import { uid } from '../../lib/id'
import RichTextEditor from '../../components/editor/RichTextEditor'
import { Segmented, SettingsBar } from '../../components/editor/controls'

const STYLES: ColumnsStyle[] = ['plain', 'cards', 'lines']

// 2–4 side-by-side text columns (stacked on phones). Same markup as
// ColumnsPreview and the player's renderColumns.
export default function ColumnsBlock({
  block,
  lessonId,
  selected,
}: BlockComponentProps<BlockOfType<'columns'>>) {
  const update = useCourseStore((s) => s.updateBlockData)
  const { t } = useT('design')
  const { t: tt } = useT('text')
  const { columns, style } = block.data

  function setCount(n: number) {
    if (n === columns.length) return
    const next: TextColumn[] = columns.slice(0, n)
    while (next.length < n) {
      next.push({
        id: uid('col'),
        title: translate('content', 'columnTitle', { n: next.length + 1 }),
        html: `<p>${translate('content', 'columnText')}</p>`,
      })
    }
    update(lessonId, block.id, { columns: next })
  }

  function patch(id: string, p: Partial<TextColumn>, key: string) {
    update(lessonId, block.id, { columns: columns.map((c) => (c.id === id ? { ...c, ...p } : c)) }, key)
  }

  return (
    <div className="space-y-3">
      {selected && (
        <SettingsBar>
          <Segmented<number>
            label={t('columnsCount')}
            value={columns.length}
            onChange={setCount}
            options={[
              [2, '2'],
              [3, '3'],
              [4, '4'],
            ]}
          />
          <Segmented<ColumnsStyle>
            label={t('columnsStyle')}
            value={style}
            onChange={(v) => update(lessonId, block.id, { style: v })}
            options={STYLES.map((s) => [s, t(`colStyle_${s}`)] as const)}
          />
        </SettingsBar>
      )}
      <div className={`sc-columns sc-columns-${columns.length} sc-columns-${style}`}>
        {columns.map((col) => (
          <div key={col.id} className="sc-column">
            <h3 className="sc-column-title">
              <input
                type="text"
                value={col.title}
                placeholder={t('columnTitlePlaceholder')}
                onChange={(e) => patch(col.id, { title: e.target.value }, `col-title-${col.id}`)}
                className="w-full bg-transparent outline-none placeholder:text-current placeholder:opacity-40"
              />
            </h3>
            <RichTextEditor
              html={col.html}
              placeholder={tt('paragraphPlaceholder')}
              className="sc-column-text"
              onChange={(html) => patch(col.id, { html }, `col-html-${col.id}`)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
