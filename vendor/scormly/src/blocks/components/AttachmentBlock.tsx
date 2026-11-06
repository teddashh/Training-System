import type { BlockComponentProps } from '../types'
import type { AttachmentFile, BlockOfType } from '../../types/course'
import { useCourseStore, blocksOf } from '../../store/courseStore'
import { useT } from '../../i18n/I18nProvider'
import { uid } from '../../lib/id'
import { useAssetUpload } from '../../components/editor/controls'
import { AttachmentRow } from '../../preview/components/AttachmentPreview'

// Downloadable files (PDF, spreadsheets, slides, archives…) stored in
// assets/files/ and offered under their original names.
export default function AttachmentBlock({
  block,
  lessonId,
  selected,
}: BlockComponentProps<BlockOfType<'attachment'>>) {
  const update = useCourseStore((s) => s.updateBlockData)
  const { t } = useT('design')
  const { title, files } = block.data

  // Read the latest list from the store: a multi-file pick saves one by one.
  const latestFiles = (): AttachmentFile[] => {
    const b = blocksOf(useCourseStore.getState().course, lessonId)?.find((x) => x.id === block.id)
    return b?.type === 'attachment' ? b.data.files : files
  }
  const upload = useAssetUpload('file', (src, file) =>
    update(lessonId, block.id, {
      files: [...latestFiles(), { id: uid('file'), src, name: file.name, size: file.size }],
    }),
  )

  function patch(id: string, p: Partial<AttachmentFile>, key?: string) {
    update(lessonId, block.id, { files: files.map((f) => (f.id === id ? { ...f, ...p } : f)) }, key)
  }

  return (
    <div className="sc-attach">
      <input
        type="text"
        value={title ?? ''}
        placeholder={t('attachmentTitlePlaceholder')}
        onChange={(e) => update(lessonId, block.id, { title: e.target.value }, `attach-title-${block.id}`)}
        className="sc-attach-title w-full bg-transparent outline-none placeholder:text-current placeholder:opacity-40"
      />
      {files.length > 0 && (
        <ul className="sc-attach-list">
          {files.map((f) => (
            <li key={f.id}>
              {selected ? (
                <div className="sc-attach-item">
                  <input
                    type="text"
                    value={f.name}
                    aria-label={t('fileName')}
                    onChange={(e) => patch(f.id, { name: e.target.value }, `attach-name-${f.id}`)}
                    className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-brand"
                  />
                  <button
                    type="button"
                    onClick={() => update(lessonId, block.id, { files: files.filter((x) => x.id !== f.id) })}
                    aria-label={t('removeFile')}
                    title={t('removeFile')}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <AttachmentRow file={f} />
              )}
            </li>
          ))}
        </ul>
      )}
      {(selected || files.length === 0) && (
        <label className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-300 bg-white/60 px-6 py-6 text-center text-gray-400 transition hover:border-brand hover:text-brand">
          <span className="text-sm font-medium">+ {t('addFiles')}</span>
          <span className="text-xs">{t('addFilesHint')}</span>
          <input type="file" multiple onChange={upload.onPick} className="sr-only" />
        </label>
      )}
      {upload.error && <p className="mt-2 text-sm text-red-600">{t('unsupportedFile')}</p>}
    </div>
  )
}
