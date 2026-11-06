import { useMemo } from 'react'
import type { BlockComponentProps } from '../types'
import type { BlockOfType, FillBlanksData } from '../../types/course'
import { useCourseStore } from '../../store/courseStore'
import { useT } from '../../i18n/I18nProvider'
import { parseBlanks } from '../fillBlanks'
import ScoreSettings from './ScoreSettings'

const MODES: FillBlanksData['mode'][] = ['type', 'select']

export default function FillBlanksBlock({
  block,
  lessonId,
  selected,
}: BlockComponentProps<BlockOfType<'fillBlanks'>>) {
  const update = useCourseStore((s) => s.updateBlockData)
  const { t } = useT('assessment')
  const { text, mode, caseSensitive = false } = block.data
  const segments = useMemo(() => parseBlanks(text), [text])
  const blankCount = segments.filter((s) => s.kind === 'blank').length

  function patch(data: Partial<FillBlanksData>, coalesceKey?: string) {
    update(lessonId, block.id, data, coalesceKey)
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
              {t(m === 'type' ? 'fbModeType' : 'fbModeSelect')}
            </button>
          ))}
        </div>
      )}



      {selected ? (
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-500">{t('textLabel')}</span>
          <textarea
            value={text}
            placeholder={t('textPlaceholder')}
            rows={4}
            onChange={(e) => patch({ text: e.target.value }, `fillblanks-text-${block.id}`)}
            className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 font-mono text-sm text-gray-800 outline-none placeholder-gray-300 focus:border-brand"
          />
          <span className="mt-1 block text-xs text-gray-500">{t('textHelp')}</span>
        </label>
      ) : null}

      {/* Rendered sentence: blanks shown as chips with the canonical answer. */}
      <p className="leading-loose whitespace-pre-wrap text-gray-800">
        {segments.map((s, i) =>
          s.kind === 'text' ? (
            <span key={i}>{s.text}</span>
          ) : (
            <span
              key={i}
              title={s.answers.join(' | ')}
              className="mx-0.5 inline-block rounded border border-dashed border-brand bg-brand/10 px-2 leading-normal text-brand-dark"
            >
              {s.answers[0]}
              {s.answers.length > 1 && (
                <span className="ml-1 text-xs text-gray-500">+{s.answers.length - 1}</span>
              )}
            </span>
          ),
        )}
      </p>

      <p className={`text-xs ${blankCount ? 'text-gray-400' : 'text-amber-600'}`}>
        {blankCount ? t('blanksCount', { n: blankCount }) : t('noBlanks')}
      </p>
      {/* Scoring options last, below the content, and only while editing. */}
      {selected && (
        <div className="space-y-3 border-t border-gray-100 pt-3">
        <ScoreSettings
          blockId={block.id}
          passingScore={block.data.passingScore}
          showAnswers={block.data.showAnswers ?? true}
          onChange={(change, key) => patch(change, key)}
        />
        {mode === 'type' && (
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => patch({ caseSensitive: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-brand"
            />
            <span>
              <span className="block font-medium text-gray-700">{t('caseSensitive')}</span>
              <span className="mt-0.5 block text-xs text-gray-500">{t('caseSensitiveHelp')}</span>
            </span>
          </label>
        )}
        </div>
      )}
    </div>
  )
}
