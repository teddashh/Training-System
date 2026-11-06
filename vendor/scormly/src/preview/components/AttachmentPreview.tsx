import type { AttachmentFile } from '../../types/course'
import type { PreviewProps } from '../types'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import { useT } from '../../i18n/I18nProvider'
import { fileBadge, formatBytes } from '../../lib/files'

export default function AttachmentPreview({ block }: PreviewProps<'attachment'>) {
  const { title, files } = block.data
  if (files.length === 0) return null
  return (
    <div className="sc-attach">
      {title && <p className="sc-attach-title">{title}</p>}
      <ul className="sc-attach-list">
        {files.map((f) => (
          <li key={f.id}>
            <AttachmentRow file={f} />
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AttachmentRow({ file, children }: { file: AttachmentFile; children?: React.ReactNode }) {
  const { t } = useT('design')
  const url = useAssetUrl(file.src)
  return (
    <div className="sc-attach-item">
      <span className="sc-attach-badge" aria-hidden>
        {fileBadge(file.name)}
      </span>
      <span className="sc-attach-meta">
        <span className="sc-attach-name">{file.name}</span>
        {file.size ? <span className="sc-attach-size">{formatBytes(file.size)}</span> : null}
      </span>
      {children}
      <a className="sc-attach-dl" href={url || undefined} download={file.name}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden>
          <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{t('download')}</span>
        <span className="sr-only">{file.name}</span>
      </a>
    </div>
  )
}
