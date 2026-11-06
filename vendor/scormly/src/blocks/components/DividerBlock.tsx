import type { BlockComponentProps } from '../types'
import type { BlockOfType, DividerStyle } from '../../types/course'
import { useCourseStore } from '../../store/courseStore'
import { useT } from '../../i18n/I18nProvider'
import DividerView from '../../preview/components/DividerView'

const STYLES: DividerStyle[] = ['solid', 'dashed', 'dotted', 'gradient', 'dots', 'ornament', 'wave', 'label', 'spacer']

export default function DividerBlock({
  block,
  lessonId,
  selected,
}: BlockComponentProps<BlockOfType<'divider'>>) {
  const update = useCourseStore((s) => s.updateBlockData)
  const { t } = useT('blocks')
  const { style, label } = block.data

  return (
    <div className="space-y-3">
      {selected && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('divider')}>
          {STYLES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={style === s}
              onClick={() =>
                update(lessonId, block.id, s === 'label' && !label ? { style: s, label: t('dividerLabelDefault') } : { style: s })
              }
              className={`flex min-w-[5.5rem] flex-col items-center gap-1.5 rounded-lg border px-2.5 pb-1.5 pt-2.5 text-xs font-medium transition ${
                style === s
                  ? 'border-brand bg-brand/5 text-brand-dark'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <span className="pointer-events-none block w-16 scale-75" aria-hidden>
                <DividerView style={s} label="01" />
              </span>
              {t(`divider_${s}`)}
            </button>
          ))}
        </div>
      )}
      {style === 'spacer' ? (
        // Empty space for the learner; a faint outline only while editing.
        <div className="sc-spacer rounded-md border border-dashed border-gray-200" />
      ) : (
        <DividerView
          style={style}
          label={label}
          editLabel={
            style === 'label' ? (
              <span>
                <input
                  type="text"
                  value={label ?? ''}
                  aria-label={t('dividerLabel')}
                  placeholder={t('dividerLabel')}
                  size={Math.max(4, (label ?? '').length + 1)}
                  onChange={(e) => update(lessonId, block.id, { label: e.target.value }, `divider-label-${block.id}`)}
                  className="bg-transparent text-center outline-none"
                />
              </span>
            ) : undefined
          }
        />
      )}
    </div>
  )
}
