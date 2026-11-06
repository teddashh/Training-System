import { useRef, useState } from 'react'
import { useT } from '../../i18n/I18nProvider'
import { useMenu } from '../../hooks/useMenu'
import { buildScormZip } from '../../export/exportScorm'
import { buildProjectZip } from '../../lib/exportProjectZip'
import { useCourseStore } from '../../store/courseStore'
import { checkCourse, hasBlockingIssues } from '../../export/courseCheck'

type LmsCourse = { id: number; title: string }

export default function PublishLms() {
  const { t } = useT('common')
  const [open, setOpen] = useState(false)
  const [courses, setCourses] = useState<LmsCourse[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useMenu({ open, onClose: () => setOpen(false), rootRef, triggerRef })

  async function prepare() {
    setOpen(!open)
    setMessage('')
    if (open) return
    try {
      await fetch('/api/auth/session/', { credentials: 'same-origin' })
      const response = await fetch('/api/courses/', { credentials: 'same-origin' })
      if (!response.ok) throw new Error(t('lmsSignIn'))
      const items = await response.json() as LmsCourse[]
      setCourses(items)
      setSelected(String(items[0]?.id || ''))
    } catch (error) { setMessage((error as Error).message) }
  }

  async function publish() {
    setBusy(true)
    setMessage('')
    try {
      const { course, directoryHandle } = useCourseStore.getState()
      if (hasBlockingIssues(checkCourse(course))) throw new Error(t('lmsFixIssues'))
      const scorm = await buildScormZip('1.2')
      const project = await buildProjectZip(course, directoryHandle)
      const data = new FormData()
      data.append('file', await scorm.generateAsync({ type: 'blob' }), 'course-scorm12.zip')
      data.append('source', await project.generateAsync({ type: 'blob' }), 'course-project.zip')
      const csrf = document.cookie.split('; ').find(v => /^(?:__Host-)?training_csrf=/.test(v))?.split('=')[1] || ''
      const response = await fetch(`/api/courses/${selected}/upload/`, {
        method: 'POST', credentials: 'same-origin', headers: { 'X-CSRFToken': decodeURIComponent(csrf) }, body: data,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(JSON.stringify(result))
      setMessage(t('lmsPublished'))
    } catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }

  return <div ref={rootRef} className="relative">
    <button ref={triggerRef} type="button" className="btn-secondary text-sm" aria-expanded={open} onClick={() => void prepare()}>{t('lmsPublish')}</button>
    {open && <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-4 text-sm shadow-xl">
      <p className="mb-3 text-gray-500">{t('lmsIntro')}</p>
      <select className="mb-3 w-full rounded-md border border-gray-200 p-2" value={selected} onChange={e => setSelected(e.target.value)} aria-label={t('lmsCourse')}>
        <option value="">{t('lmsCourse')}</option>{courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>
      <button type="button" className="btn-primary w-full" disabled={busy || !selected} onClick={() => void publish()}>{busy ? t('exporting') : t('lmsPublish')}</button>
      {message && <p role="status" className="mt-3 break-words text-xs text-gray-600">{message}</p>}
    </div>}
  </div>
}
