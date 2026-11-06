import { useT } from '../../i18n/I18nProvider'

// Passing score + "show correct answers" controls shared by the scored
// exercise editors (ordering, fill in the blanks). Mirrors the quiz editor.
export default function ScoreSettings({
  blockId,
  passingScore,
  showAnswers,
  onChange,
}: {
  blockId: string
  passingScore: number
  showAnswers: boolean
  onChange: (change: { passingScore?: number; showAnswers?: boolean }, coalesceKey?: string) => void
}) {
  const { t } = useT('quiz')
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 text-sm">
        <span className="text-xs font-medium text-gray-500">{t('passingScore')}</span>
        <input
          type="number"
          min={0}
          max={100}
          value={passingScore}
          onChange={(e) => {
            const raw = Number(e.target.value)
            const clamped = Number.isNaN(raw) ? 0 : Math.min(100, Math.max(0, Math.round(raw)))
            onChange({ passingScore: clamped }, `score-pass-${blockId}`)
          }}
          className="w-20 rounded-md border border-gray-300 px-3 py-2 outline-none focus:border-brand"
        />
      </label>

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={showAnswers}
          onChange={(e) => onChange({ showAnswers: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-brand"
        />
        <span>
          <span className="block font-medium text-gray-700">{t('showAnswers')}</span>
          <span className="mt-0.5 block text-xs text-gray-500">{t('showAnswersHelp')}</span>
        </span>
      </label>
    </div>
  )
}
