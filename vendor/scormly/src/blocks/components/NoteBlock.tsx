import type { BlockComponentProps } from '../types'
import type { BlockOfType, NoteVariant } from '../../types/course'
import { useCourseStore } from '../../store/courseStore'
import { useT } from '../../i18n/I18nProvider'
import NoteView from '../../preview/components/NoteView'
import { AutoTextarea, Segmented, SettingsBar } from '../../components/editor/controls'

const VARIANTS: NoteVariant[] = ['note', 'tip', 'success', 'warning']

export default function NoteBlock({
  block,
  lessonId,
  selected,
}: BlockComponentProps<BlockOfType<'note'>>) {
  const update = useCourseStore((s) => s.updateBlockData)
  const { t } = useT('text')
  const { variant, text } = block.data

  return (
    <div className="space-y-3">
      {selected && (
        <SettingsBar>
          <Segmented<NoteVariant>
            label={t('noteKind')}
            value={variant}
            onChange={(v) => update(lessonId, block.id, { variant: v })}
            options={VARIANTS.map((v) => [v, t(v)] as const)}
          />
        </SettingsBar>
      )}
      <NoteView variant={variant}>
        <AutoTextarea
          value={text}
          placeholder={variant === 'warning' ? t('warningPlaceholder') : t('notePlaceholder')}
          onChange={(e) => update(lessonId, block.id, { text: e.target.value }, `note-text-${block.id}`)}
          className="sc-note-text w-full bg-transparent outline-none placeholder:text-current placeholder:opacity-40"
        />
      </NoteView>
    </div>
  )
}
