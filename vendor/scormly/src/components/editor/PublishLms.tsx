import { useRef, useState } from 'react'
import { useT } from '../../i18n/I18nProvider'
import { useMenu } from '../../hooks/useMenu'
import { buildScormZip } from '../../export/exportScorm'
import type { ScormVersion } from '../../export/scormManifest'
import { buildProjectZip } from '../../lib/exportProjectZip'
import { useCourseStore } from '../../store/courseStore'
import { checkCourse, hasBlockingIssues } from '../../export/courseCheck'
import { bindCompanyCourse, companyApi, currentCompanyCourse, workspaceBase, type CompanyCourse } from '../../lib/companyCourse'

export default function PublishLms() {
  const { t } = useT('common')
  const [open, setOpen] = useState(false)
  const [courses, setCourses] = useState<CompanyCourse[]>([])
  const [selected, setSelected] = useState('')
  const [version, setVersion] = useState<ScormVersion>('1.2')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [published, setPublished] = useState<CompanyCourse | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useMenu({ open, onClose: () => { if (!busy && !creating) setOpen(false) }, rootRef, triggerRef })
  const target = courses.find(course => String(course.id) === selected)

  async function makeAvailable() {
    if (!published || published.published || busy) return
    setBusy(true); setError('')
    try {
      const csrf = document.cookie.split('; ').find(value => /^(?:__Host-)?training_csrf=/.test(value))?.split('=')[1] || ''
      const response = await fetch(`${companyApi}courses/${published.id}/`, {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': decodeURIComponent(csrf) },
        body: JSON.stringify({ published: true }),
      })
      if (!response.ok) throw new Error(t('availabilityFailed'))
      const updated: CompanyCourse = await response.json()
      bindCompanyCourse(updated); setPublished(updated)
    } catch { setError(t('availabilityFailed')) }
    finally { setBusy(false) }
  }

  async function prepare() {
    if (busy || creating) return
    setOpen(!open)
    if (open) return
    setError(''); setPublished(null); setCourses([]); setSelected(''); setLoading(true)
    try {
      const session = await fetch(companyApi + 'auth/session/', { credentials: 'same-origin' })
      if (!session.ok) throw new Error(t('lmsSignIn'))
      const response = await fetch(companyApi + 'courses/', { credentials: 'same-origin' })
      if (!response.ok) throw new Error(t('lmsSignIn'))
      const items = (await response.json() as CompanyCourse[]).filter(item => item.can_manage)
      setCourses(items)
      const bound = currentCompanyCourse()
      // A generic draft starts with no destination; never silently pick the first course.
      if (bound && items.some(item => item.id === bound.id)) {
        setSelected(String(bound.id))
        setVersion(items.find(item => item.id === bound.id)?.package?.version === '2004' ? '2004' : '1.2')
      }
    } catch (error) { setError((error as Error).message) }
    finally { setLoading(false) }
  }

  async function createCourse() {
    if (creating || busy || loading) return
    setCreating(true); setError('')
    try {
      const { course } = useCourseStore.getState()
      const csrf = document.cookie.split('; ').find(value => /^(?:__Host-)?training_csrf=/.test(value))?.split('=')[1] || ''
      const response = await fetch(companyApi + 'courses/', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': decodeURIComponent(csrf) },
        body: JSON.stringify({ title: course.title, description: course.description, blocks: [], published: false }),
      })
      if (!response.ok) throw new Error(t('createCourseFailed'))
      const created: CompanyCourse = await response.json()
      setCourses(items => [created, ...items]); setSelected(String(created.id)); setVersion('1.2')
      bindCompanyCourse(created)
    } catch (error) { setError((error as Error).message) }
    finally { setCreating(false) }
  }

  async function publish() {
    if (!target || busy || creating || loading) return
    setBusy(true); setError('')
    try {
      const { course, directoryHandle } = useCourseStore.getState()
      if (hasBlockingIssues(checkCourse(course))) throw new Error(t('lmsFixIssues'))
      const scorm = await buildScormZip(version)
      const project = await buildProjectZip(course, directoryHandle)
      const data = new FormData()
      data.append('file', await scorm.generateAsync({ type: 'blob' }), `course-scorm${version === '2004' ? '2004' : '12'}.zip`)
      data.append('source', await project.generateAsync({ type: 'blob' }), 'course-project.zip')
      const csrf = document.cookie.split('; ').find(value => /^(?:__Host-)?training_csrf=/.test(value))?.split('=')[1] || ''
      const response = await fetch(`${companyApi}courses/${selected}/upload/`, {
        method: 'POST', credentials: 'same-origin', headers: { 'X-CSRFToken': decodeURIComponent(csrf) }, body: data,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : t('publishFailed'))
      const updated = { ...target, package: { id: result.id, has_source: true, version } }
      bindCompanyCourse(updated)
      setPublished(updated)
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }

  return <div ref={rootRef} className="relative" data-tour="export">
    <button ref={triggerRef} type="button" className="btn-primary text-sm" aria-expanded={open} onClick={() => void prepare()}>{t('lmsPublish')}</button>
    {open && <div role="region" aria-label={t('lmsPublish')} className="studio-publish-panel absolute right-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-24px)] rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-xl">
      {published ? <>
        <p role="status" className="mb-3">{t(published.published ? 'lmsPublished' : 'draftPublished', { title: published.title })}</p>
        {published.published
          ? <a className="btn-primary inline-flex" href={workspaceBase + `assignments?action=assign&course=${published.id}&report=1`}>{t('assignTraining')}</a>
          : <><p className="mb-3 text-gray-600">{t('availabilityHint')}</p><button type="button" className="btn-primary" disabled={busy} onClick={() => void makeAvailable()}>{t(busy ? 'makingAvailable' : 'makeAvailable')}</button></>}
        <a className="mt-3 flex min-h-11 items-center text-brand underline" href={workspaceBase + 'authoring'}>{t('backToCourses')}</a>
      </> : <>
        <label className="block font-medium">{t('lmsCourse')}
          <select aria-label={t('lmsCourse')} className="mt-2 w-full rounded border border-gray-300 p-2 font-normal" value={selected} disabled={busy || creating || loading} onChange={event => { setSelected(event.target.value); setVersion(courses.find(course => String(course.id) === event.target.value)?.package?.version === '2004' ? '2004' : '1.2') }}>
            <option value="">{t('chooseCourse')}</option>{courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
          </select>
        </label>
        {loading ? <p role="status" className="mt-3 text-gray-500">{t('loadingCourses')}</p> : !error && !courses.length ? <p className="mt-3 text-gray-500">{t('lmsNoCourses')} </p> : <p className="mt-3 text-gray-500">{t(target?.published ? 'replaceContent' : target ? 'draftVisibility' : 'lmsIntro')}</p>}
        {!error && !loading && !target && <button type="button" className="mt-2 text-brand underline" disabled={busy || creating} onClick={() => void createCourse()}>{t(creating ? 'creatingCourse' : 'createCourse')}</button>}
        <details className="my-3">
          <summary className="cursor-pointer py-2 text-gray-600">{t('advancedOptions')}</summary>
          <label className="block text-gray-600">{t('lmsFormat')}
            <select className="mt-1 w-full rounded border border-gray-300 p-2" value={version} disabled={busy} onChange={event => setVersion(event.target.value as ScormVersion)}>
              <option value="1.2">SCORM 1.2</option><option value="2004">SCORM 2004</option>
            </select>
          </label>
        </details>
        <button type="button" className="btn-primary" disabled={busy || creating || loading || !target} onClick={() => void publish()}>{busy ? t('publishing') : t('lmsPublish')}</button>
      </>}
      {error && <p role="alert" className="mt-3 break-words text-red-700">{error}</p>}
    </div>}
  </div>
}
