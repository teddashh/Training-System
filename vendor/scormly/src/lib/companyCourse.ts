import { create } from 'zustand'
import type { Course, Block } from '../types/course'
import { DEFAULT_COURSE_SETTINGS, DEFAULT_INTRO } from '../types/course'
import { DEFAULT_THEME } from '../theme/themes'
import { useCourseStore } from '../store/courseStore'
import { createBrowserProjectFromCourse, restoreOpenProject } from './projectService'
import { openProjectZip } from './importProjectZip'
import { isBrowserStorageSupported, BROWSER_KEY_PREFIX } from './browserProjects'
import { uid } from './id'
import { translate } from '../i18n/I18nProvider'

import { companyApi } from './platformApi'
export { workspaceBase, companyApi } from './platformApi'
export type CompanyCourse = {
  id: number; title: string; description: string; published: boolean; can_manage: boolean
  blocks: { type: string; text: string; source_page?: number }[]
  package: { id: string; has_source: boolean; version: string } | null
}
type Binding = { course: CompanyCourse; projectId: string }
export const useCompanyCourse = create<{ binding: Binding | null }>(() => ({ binding: null }))
const draftKey = (id: number) => `training-content-draft:${id}`
type Draft = { key: string; packageId: string | null }

function rememberedDraft(course: CompanyCourse): string | null {
  try {
    const draft: Draft = JSON.parse(localStorage.getItem(draftKey(course.id)) || 'null')
    return draft?.packageId === (course.package?.id ?? null) && draft.key.startsWith(BROWSER_KEY_PREFIX) ? draft.key : null
  } catch { return null }
}

export function bindCompanyCourse(course: CompanyCourse) {
  useCompanyCourse.setState({ binding: { course, projectId: useCourseStore.getState().course.id } })
  const url = new URL(window.location.href)
  url.searchParams.set('course', String(course.id))
  if (url.hash === '#/demo') url.hash = '#/app'
  window.history.replaceState(null, '', url)
  const hash = window.location.hash
  if (hash.startsWith('#/app/')) {
    try {
      const key = decodeURIComponent(hash.slice(6))
      if (key.startsWith(BROWSER_KEY_PREFIX)) {
        // A browser project belongs to one course at a time. Publishing a copy
        // elsewhere must not leave an old course pointing to that local draft.
        for (const name of Object.keys(localStorage)) {
          if (name.startsWith('training-content-draft:') && name !== draftKey(course.id)) {
            try { if (JSON.parse(localStorage.getItem(name) || 'null')?.key === key) localStorage.removeItem(name) } catch { /* Ignore malformed old entries. */ }
          }
        }
        localStorage.setItem(draftKey(course.id), JSON.stringify({ key, packageId: course.package?.id ?? null }))
      }
    } catch { /* Storage may be disabled; the project itself is still usable. */ }
  }
}

/** A changed project must never inherit another project's publish destination. */
export function currentCompanyCourse(): CompanyCourse | null {
  const { binding } = useCompanyCourse.getState()
  return binding?.projectId === useCourseStore.getState().course.id ? binding.course : null
}

export function courseToContent(course: CompanyCourse): Course {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const blocks: Block[] = course.blocks.filter(block => block.text.trim()).map(block => block.type === 'heading'
    ? { id: uid('block'), type: 'heading', settings: {}, data: { level: 2, text: block.text } }
    : { id: uid('block'), type: 'paragraph', settings: {}, data: { html: '<p>' + escape(block.text).replace(/\n/g, '<br>') + '</p>' } })
  const pageHeadings = course.blocks.filter(block => block.type === 'heading' && block.source_page)
  const lessons: Course['lessons'] = pageHeadings.length ? pageHeadings.map(heading => {
    const start = course.blocks.indexOf(heading), next = course.blocks.findIndex((b, i) => i > start && !!b.source_page)
    const text = course.blocks.slice(start + 1, next < 0 ? undefined : next).map(b => b.text).join('\n\n')
    return { id: uid('lesson'), title: heading.text, status: 'published', blocks: [{id:uid('block'),type:'paragraph',settings:{},data:{html:'<p>'+escape(text).replace(/\n/g,'<br>')+'</p>'}}] }
  }) : [{ id: uid('lesson'), title: translate('content', 'lessonN', { n: 1 }), status: blocks.length ? 'published' : 'draft', blocks }]
  return { id: uid('course'), title: course.title, description: course.description, theme: DEFAULT_THEME,
    settings: { ...DEFAULT_COURSE_SETTINGS }, intro: { ...DEFAULT_INTRO },
    lessons }
}

/** Restore a local draft or fetch the editable source of the selected course. */
export async function openCompanyCourse(projectKey: string | null): Promise<boolean> {
  const id = new URLSearchParams(window.location.search).get('course')
  if (!id) return false
  if (!/^[1-9]\d*$/.test(id)) throw new Error(translate('common', 'courseUnavailable'))
  const response = await fetch(`${companyApi}courses/${id}/`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(translate('common', 'courseUnavailable'))
  const course: CompanyCourse = await response.json()
  if (!course.can_manage) throw new Error(translate('common', 'courseUnavailable'))
  const savedKey = rememberedDraft(course)
  // Only restore a remembered association; a random project URL is not a binding.
  if (savedKey && (!projectKey || projectKey === savedKey) && await restoreOpenProject(savedKey)) {
    bindCompanyCourse(course)
    return true
  }
  if (course.package) {
    if (!course.package.has_source) throw new Error(translate('common', 'sourceUnavailable'))
    const source = await fetch(`${companyApi}courses/${id}/source/`, { credentials: 'same-origin' })
    if (!source.ok) throw new Error(translate('common', 'sourceUnavailable'))
    await openProjectZip(new File([await source.blob()], 'content-backup.zip', { type: 'application/zip' }))
    if (!useCourseStore.getState().projectName) throw new Error(translate('common', 'openingCancelled'))
  } else {
    const content = courseToContent(course)
    if (isBrowserStorageSupported()) await createBrowserProjectFromCourse(content)
    else {
      useCourseStore.getState().loadCourse(content)
      useCourseStore.setState({ projectName: course.title, directoryHandle: null })
    }
  }
  bindCompanyCourse(course)
  return true
}

// Opening a different local project ends the course association immediately.
useCourseStore.subscribe((state, previous) => {
  if (state.course.id === previous.course.id || !useCompanyCourse.getState().binding) return
  useCompanyCourse.setState({ binding: null })
  const url = new URL(window.location.href)
  url.searchParams.delete('course')
  window.history.replaceState(null, '', url)
})
