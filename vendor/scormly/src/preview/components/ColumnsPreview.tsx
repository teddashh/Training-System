import type { PreviewProps } from '../types'
import RichHtml from '../RichHtml'

export default function ColumnsPreview({ block }: PreviewProps<'columns'>) {
  const { columns, style } = block.data
  return (
    <div className={`sc-columns sc-columns-${columns.length} sc-columns-${style}`}>
      {columns.map((col) => (
        <div key={col.id} className="sc-column">
          {col.title && <h3 className="sc-column-title">{col.title}</h3>}
          <RichHtml html={col.html} className="rich-text sc-column-text" />
        </div>
      ))}
    </div>
  )
}
