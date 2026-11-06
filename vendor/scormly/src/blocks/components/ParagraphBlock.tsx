import type { BlockComponentProps } from '../types'
import type { BlockOfType, ParagraphVariant } from '../../types/course'
import { useCourseStore } from '../../store/courseStore'
import { useT } from '../../i18n/I18nProvider'
import RichTextEditor from '../../components/editor/RichTextEditor'
import { Segmented, SettingsBar } from '../../components/editor/controls'

const VARIANTS: ParagraphVariant[] = ['normal', 'lead', 'dropcap', 'columns']

export default function ParagraphBlock({
  block,
  lessonId,
  selected,
}: BlockComponentProps<BlockOfType<'paragraph'>>) {
  const update = useCourseStore((s) => s.updateBlockData)
  const { t } = useT('text')
  const variant = block.data.variant ?? 'normal'

  return (
    <div className="space-y-3">
      {selected && (
        <SettingsBar>
          <Segmented<ParagraphVariant>
            label={t('paragraphStyle')}
            value={variant}
            onChange={(v) => update(lessonId, block.id, { variant: v })}
            options={VARIANTS.map((v) => [v, t(`para_${v}`)] as const)}
          />
        </SettingsBar>
      )}
      <RichTextEditor
        html={block.data.html}
        placeholder={t('paragraphPlaceholder')}
        className={`sc-para-${variant}`}
        onChange={(html) =>
          update(lessonId, block.id, { html }, `paragraph-html-${block.id}`)
        }
      />
    </div>
  )
}
