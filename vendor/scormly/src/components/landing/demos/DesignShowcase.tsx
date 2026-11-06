import { useMemo, useState } from 'react'
import { useLang, useT } from '../../../i18n/I18nProvider'
import { makeSampleCourse } from '../../../lib/sampleCourse'
import IntroView from '../../../preview/IntroView'
import BlockPreview from '../../../preview/BlockPreview'
import { blockWrapperProps, BLOCK_BACKGROUNDS } from '../../../blocks/styleClasses'
import type { Block, BlockBackground } from '../../../types/course'

// Landing visual for the design features: the sample course's real cover page
// and a statement block whose background the visitor can switch, rendered
// with the same learner components as the preview and player.
export default function DesignShowcase() {
  const { t } = useT('landing')
  const { t: td } = useT('design')
  const { lang } = useLang()
  const [bg, setBg] = useState<BlockBackground>('gradient')
  const course = useMemo(() => {
    const c = makeSampleCourse(lang)
    return { ...c, intro: { ...c.intro!, showOutline: false } }
  }, [lang])
  const statement = useMemo<Block | undefined>(
    () => course.lessons.flatMap((l) => l.blocks).find((b) => b.type === 'quote' && b.data.variant === 'statement'),
    [course],
  )

  return (
    <div data-theme={course.theme} className="relative">
      <div className="origin-top overflow-hidden rounded-[1.75rem] border border-gray-200 bg-white p-3 shadow-2xl shadow-gray-900/15">
        <div className="pointer-events-none select-none [zoom:0.62]" aria-hidden>
          <IntroView course={course} onStart={() => {}} onOpenLesson={() => {}} />
        </div>
      </div>
      {statement && (
        <div className="relative z-10 -mt-16 ml-auto w-[88%] rounded-3xl border border-gray-200 bg-white p-4 shadow-xl shadow-gray-900/10 sm:-mr-6">
          <div {...blockWrapperProps({ ...statement.settings, background: bg, spacing: 'normal' })}>
            <BlockPreview block={statement} />
          </div>
          <div role="radiogroup" aria-label={t('designSwatches')} className="mt-3 flex items-center gap-2 px-1">
            <span className="mr-1 text-xs font-medium text-gray-500">{td('background')}</span>
            {BLOCK_BACKGROUNDS.map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={b === bg}
                aria-label={td(`bg_${b}`)}
                title={td(`bg_${b}`)}
                onClick={() => setBg(b)}
                data-bg={b}
                className={`swatch h-7 w-7 rounded-full ring-offset-2 transition hover:scale-110 ${
                  b === bg ? 'ring-2 ring-brand' : 'ring-1 ring-gray-200'
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
