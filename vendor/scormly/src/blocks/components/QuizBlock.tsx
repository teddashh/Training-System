import type { BlockComponentProps } from '../types'
import type {
  BlockOfType,
  ChoiceOption,
  FillBlanksQuestion,
  MatchingPair,
  Question,
  SequenceItem,
} from '../../types/course'
import { useCourseStore } from '../../store/courseStore'
import { useT } from '../../i18n/I18nProvider'
import { blankAnswers } from '../fillBlanks'
import { TYPE_LABEL_KEYS, newItem, newOption, newPair } from '../quizQuestions'
import AddQuestionMenu from './AddQuestionMenu'

const BLANK_MODES: FillBlanksQuestion['mode'][] = ['type', 'select']

export default function QuizBlock({
  block,
  lessonId,
  selected,
}: BlockComponentProps<BlockOfType<'quiz'>>) {
  const update = useCourseStore((s) => s.updateBlockData)
  const { t } = useT('quiz')
  const { t: ta } = useT('assessment')
  const { questions, passingScore, showAnswers = true } = block.data

  function setQuestions(next: Question[], coalesceKey?: string) {
    update(lessonId, block.id, { questions: next }, coalesceKey)
  }

  // Replaces a single question while preserving the union member type.
  function replaceQuestion(qId: string, next: Question, coalesceKey?: string) {
    setQuestions(
      questions.map((q) => (q.id === qId ? next : q)),
      coalesceKey,
    )
  }

  function setPrompt(q: Question, prompt: string) {
    replaceQuestion(q.id, { ...q, prompt }, `quiz-prompt-${q.id}`)
  }

  function setQuestionFeedback(q: Question, feedback: string) {
    replaceQuestion(q.id, { ...q, feedback }, `quiz-qfb-${q.id}`)
  }


  function removeQuestion(qId: string) {
    setQuestions(questions.filter((q) => q.id !== qId))
  }

  // ── Options (single / multiple) ──
  function setOptions(
    q: SingleOrMultiple,
    options: ChoiceOption[],
    coalesceKey?: string,
  ) {
    replaceQuestion(q.id, { ...q, options }, coalesceKey)
  }

  function setOptionText(q: SingleOrMultiple, optId: string, text: string) {
    setOptions(
      q,
      q.options.map((o) => (o.id === optId ? { ...o, text } : o)),
      `quiz-opt-${optId}`,
    )
  }

  function setOptionFeedback(q: SingleOrMultiple, optId: string, feedback: string) {
    setOptions(
      q,
      q.options.map((o) => (o.id === optId ? { ...o, feedback } : o)),
      `quiz-optfb-${optId}`,
    )
  }

  function toggleCorrect(q: SingleOrMultiple, optId: string) {
    if (q.type === 'single') {
      setOptions(
        q,
        q.options.map((o) => ({ ...o, correct: o.id === optId })),
      )
    } else {
      setOptions(
        q,
        q.options.map((o) =>
          o.id === optId ? { ...o, correct: !o.correct } : o,
        ),
      )
    }
  }

  function addOption(q: SingleOrMultiple) {
    setOptions(q, [...q.options, newOption()])
  }

  function removeOption(q: SingleOrMultiple, optId: string) {
    setOptions(
      q,
      q.options.filter((o) => o.id !== optId),
    )
  }

  // ── Pairs (matching) ──
  function setPairs(q: MatchingQ, pairs: MatchingPair[], coalesceKey?: string) {
    replaceQuestion(q.id, { ...q, pairs }, coalesceKey)
  }

  function setPairField(
    q: MatchingQ,
    pairId: string,
    field: 'left' | 'right',
    value: string,
  ) {
    setPairs(
      q,
      q.pairs.map((p) => (p.id === pairId ? { ...p, [field]: value } : p)),
      `quiz-pair-${pairId}-${field}`,
    )
  }

  function addPair(q: MatchingQ) {
    setPairs(q, [...q.pairs, newPair()])
  }

  function removePair(q: MatchingQ, pairId: string) {
    setPairs(
      q,
      q.pairs.filter((p) => p.id !== pairId),
    )
  }

  // ── Items (sequence), authored in the correct order ──
  function setItems(q: SequenceQ, items: SequenceItem[], coalesceKey?: string) {
    replaceQuestion(q.id, { ...q, items }, coalesceKey)
  }

  function moveItem(q: SequenceQ, from: number, to: number) {
    if (to < 0 || to >= q.items.length) return
    const items = q.items.slice()
    const [moved] = items.splice(from, 1)
    items.splice(to, 0, moved)
    setItems(q, items)
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 text-sm">
        <span className="text-xs font-medium text-gray-500">
          {t('passingScore')}
        </span>
        <input
          type="number"
          min={0}
          max={100}
          value={passingScore}
          onChange={(e) => {
            const raw = Number(e.target.value)
            const clamped = Number.isNaN(raw)
              ? 0
              : Math.min(100, Math.max(0, Math.round(raw)))
            update(
              lessonId,
              block.id,
              { passingScore: clamped },
              `quiz-pass-${block.id}`,
            )
          }}
          className="w-20 rounded-md border border-gray-300 px-3 py-2 outline-none focus:border-brand"
        />
      </label>

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={showAnswers}
          onChange={(e) =>
            update(lessonId, block.id, { showAnswers: e.target.checked })
          }
          className="mt-0.5 h-4 w-4 accent-brand"
        />
        <span>
          <span className="block font-medium text-gray-700">
            {t('showAnswers')}
          </span>
          <span className="mt-0.5 block text-xs text-gray-500">
            {t('showAnswersHelp')}
          </span>
        </span>
      </label>

      <div className="space-y-4">
        {questions.map((q, index) => (
          <div
            key={q.id}
            className="space-y-4 rounded-lg border border-gray-200 bg-white p-5"
          >
            <div className="flex items-center justify-between gap-2">
              {/* The type is fixed once added: switching would discard the content. */}
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                {t('questionN', { n: index + 1 })}
                <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 normal-case tracking-normal text-gray-500">
                  {t(TYPE_LABEL_KEYS[q.type])}
                </span>
              </span>
              {selected && (
                <button
                  type="button"
                  onClick={() => removeQuestion(q.id)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  aria-label={t('removeQuestion')}
                >
                  ✕
                </button>
              )}
            </div>

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-500">
                {t('promptLabel')}
              </span>
              <textarea
                value={q.prompt}
                placeholder={t('promptPlaceholder')}
                rows={2}
                onChange={(e) => setPrompt(q, e.target.value)}
                className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-gray-800 outline-none placeholder-gray-300 focus:border-brand"
              />
            </label>

            <div className="space-y-2">
              {q.type === 'matching'
                ? renderPairs(q)
                : q.type === 'sequence'
                  ? renderItems(q)
                  : q.type === 'fillBlanks'
                    ? renderBlanks(q)
                    : renderOptions(q)}
            </div>

            {selected && (
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-gray-500">
                  {t('questionFeedback')}
                </span>
                <textarea
                  value={q.feedback ?? ''}
                  placeholder={t('questionFeedbackPlaceholder')}
                  rows={2}
                  onChange={(e) => setQuestionFeedback(q, e.target.value)}
                  className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-gray-800 outline-none placeholder-gray-300 focus:border-brand"
                />
              </label>
            )}
          </div>
        ))}
      </div>

      {selected && <AddQuestionMenu onAdd={(q) => setQuestions([...questions, q])} />}
    </div>
  )

  function renderOptions(q: SingleOrMultiple) {
    const isSingle = q.type === 'single'
    return (
      <>
        {q.options.map((o) => (
          <div
            key={o.id}
            className={`space-y-2 rounded-lg border p-3 ${
              o.correct ? 'border-brand bg-brand/10' : 'border-gray-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <input
                type={isSingle ? 'radio' : 'checkbox'}
                name={`correct-${q.id}`}
                checked={o.correct}
                onChange={() => toggleCorrect(q, o.id)}
                className="accent-brand"
                aria-label={t('correctOption')}
              />
              <input
                type="text"
                value={o.text}
                placeholder={t('optionPlaceholder')}
                onChange={(e) => setOptionText(q, o.id, e.target.value)}
                className="flex-1 bg-transparent text-gray-800 outline-none placeholder-gray-300"
              />
              {selected && (
                <button
                  type="button"
                  onClick={() => removeOption(q, o.id)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  aria-label={t('removeOption')}
                >
                  ✕
                </button>
              )}
            </div>
            {selected && (
              <input
                type="text"
                value={o.feedback ?? ''}
                placeholder={t('optionFeedbackPlaceholder')}
                onChange={(e) => setOptionFeedback(q, o.id, e.target.value)}
                className="ml-7 w-[calc(100%-1.75rem)] rounded-md border border-gray-200 bg-transparent px-3 py-1.5 text-xs text-gray-500 outline-none placeholder-gray-300 focus:border-brand"
              />
            )}
          </div>
        ))}
        {selected && (
          <button
            type="button"
            onClick={() => addOption(q)}
            className="btn-secondary text-sm"
          >
            {t('addOption')}
          </button>
        )}
      </>
    )
  }

  function renderPairs(q: MatchingQ) {
    return (
      <>
        {q.pairs.map((p) => (
          <div key={p.id} className="flex items-center gap-3">
            <input
              type="text"
              value={p.left}
              placeholder={t('pairLeftPlaceholder')}
              onChange={(e) => setPairField(q, p.id, 'left', e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-gray-800 outline-none placeholder-gray-300 focus:border-brand"
            />
            <span className="text-gray-400">↔</span>
            <input
              type="text"
              value={p.right}
              placeholder={t('pairRightPlaceholder')}
              onChange={(e) => setPairField(q, p.id, 'right', e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-gray-800 outline-none placeholder-gray-300 focus:border-brand"
            />
            {selected && (
              <button
                type="button"
                onClick={() => removePair(q, p.id)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label={t('removePair')}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {selected && (
          <button
            type="button"
            onClick={() => addPair(q)}
            className="btn-secondary text-sm"
          >
            {t('addPair')}
          </button>
        )}
      </>
    )
  }

  function renderItems(q: SequenceQ) {
    const arrow =
      'flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent'
    return (
      <>
        <p className="text-xs text-gray-500">{ta('itemsSequenceHelp')}</p>
        {q.items.map((it, i) => (
          <div key={it.id} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-400">
              {i + 1}
            </span>
            <input
              type="text"
              value={it.text}
              placeholder={ta('itemPlaceholder')}
              onChange={(e) =>
                setItems(
                  q,
                  q.items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)),
                  `quiz-item-${it.id}`,
                )
              }
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-gray-800 outline-none placeholder-gray-300 focus:border-brand"
            />
            {selected && (
              <>
                <button
                  type="button"
                  onClick={() => moveItem(q, i, i - 1)}
                  disabled={i === 0}
                  className={arrow}
                  aria-label={`${ta('moveUp')}: ${it.text}`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(q, i, i + 1)}
                  disabled={i === q.items.length - 1}
                  className={arrow}
                  aria-label={`${ta('moveDown')}: ${it.text}`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => setItems(q, q.items.filter((x) => x.id !== it.id))}
                  className={arrow}
                  aria-label={ta('removeItem')}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        ))}
        {selected && (
          <button
            type="button"
            onClick={() => setItems(q, [...q.items, newItem(q.items.length + 1)])}
            className="btn-secondary text-sm"
          >
            {ta('addItem')}
          </button>
        )}
      </>
    )
  }

  function renderBlanks(q: FillBlanksQuestion) {
    const blankCount = blankAnswers(q.text).length
    return (
      <>
        {selected && (
          <div className="flex flex-wrap gap-2">
            {BLANK_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => m !== q.mode && replaceQuestion(q.id, { ...q, mode: m })}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  q.mode === m ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {ta(m === 'type' ? 'fbModeType' : 'fbModeSelect')}
              </button>
            ))}
          </div>
        )}
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-500">{ta('textLabel')}</span>
          <textarea
            value={q.text}
            placeholder={ta('textPlaceholder')}
            rows={3}
            onChange={(e) => replaceQuestion(q.id, { ...q, text: e.target.value }, `quiz-blanks-${q.id}`)}
            className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 font-mono text-sm text-gray-800 outline-none placeholder-gray-300 focus:border-brand"
          />
          {selected && <span className="mt-1 block text-xs text-gray-500">{ta('textHelp')}</span>}
        </label>
        <p className={`text-xs ${blankCount ? 'text-gray-400' : 'text-amber-600'}`}>
          {blankCount ? ta('blanksCount', { n: blankCount }) : ta('noBlanks')}
        </p>
        {selected && q.mode === 'type' && (
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={!!q.caseSensitive}
              onChange={(e) => replaceQuestion(q.id, { ...q, caseSensitive: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-brand"
            />
            <span>
              <span className="block font-medium text-gray-700">{ta('caseSensitive')}</span>
              <span className="mt-0.5 block text-xs text-gray-500">{ta('caseSensitiveHelp')}</span>
            </span>
          </label>
        )}
      </>
    )
  }
}

type SingleOrMultiple = Extract<Question, { type: 'single' | 'multiple' }>
type MatchingQ = Extract<Question, { type: 'matching' }>
type SequenceQ = Extract<Question, { type: 'sequence' }>
