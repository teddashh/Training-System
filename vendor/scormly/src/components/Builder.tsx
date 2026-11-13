import { useEffect, useRef, useState } from 'react'
import { openCompanyCourse, useCompanyCourse, workspaceBase } from '../lib/companyCourse'
import Header from './layout/Header'
import Sidebar from './layout/Sidebar'
import Workspace from './layout/Workspace'
import WelcomeScreen from './welcome/WelcomeScreen'
import ZipUpdateDialog from './editor/ZipUpdateDialog'
import PreviewOverlay from './preview/PreviewOverlay'
import ProjectSettings from './editor/ProjectSettings'
import Toaster from './editor/Toaster'
import ShortcutsHelp from './editor/ShortcutsHelp'
import ExportCheckDialog from './editor/ExportCheckDialog'
import HelpLayer from './help/HelpLayer'
import { runExport, useExportStore } from '../export/runExport'
import ThemeProvider from '../theme/ThemeProvider'
import { useUndoRedoShortcuts } from '../hooks/useUndoRedoShortcuts'
import { useEditorShortcuts } from '../hooks/useEditorShortcuts'
import { useAutosave } from '../hooks/useAutosave'
import { useCourseStore } from '../store/courseStore'
import { flushSave, hasPendingSave, restoreOpenProject } from '../lib/projectService'
import { useRoute, navigate } from '../hooks/useRoute'
import { useT, useLang } from '../i18n/I18nProvider'
import { hasUnsavedZipChanges } from '../lib/exportProjectZip'
import { setMemoryUserInstructions } from '../lib/userInstructions'

// Course builder (editor). Rendered on the #/app route. Shows the welcome screen
// until a project folder is opened (or the user opts to continue without saving).
export default function Builder() {
  useUndoRedoShortcuts()
  useEditorShortcuts()
  useAutosave()
  const directoryHandle = useCourseStore((s) => s.directoryHandle)
  // Set for a project opened from a .zip too (no folder, see openProjectZip).
  const projectName = useCourseStore((s) => s.projectName)
  const previewOpen = useCourseStore((s) => s.previewOpen)
  const settingsOpen = useCourseStore((s) => s.settingsOpen)
  const setSettingsOpen = useCourseStore((s) => s.setSettingsOpen)
  const shortcutsOpen = useCourseStore((s) => s.shortcutsOpen)
  const exportPending = useExportStore((s) => s.pending !== null)
  const { projectKey, demo } = useRoute()
  const { lang } = useLang()
  const { t } = useT('common')
  const { t: tw } = useT('welcome')
  const companyCourse = useCompanyCourse(state => state.binding?.course)
  const [skipped, setSkipped] = useState(false)
  const openSample = () => {
    useCourseStore.getState().loadSampleCourse(lang)
    setSkipped(true)
  }

  // #/demo (from the landing page) opens the sample course directly, unless a
  // project folder is already open in this tab.
  useEffect(() => {
    if (demo && !useCourseStore.getState().directoryHandle) openSample()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo])
  // Try to restore the project named in the URL (after a page refresh / shared link).
  const [restoring, setRestoring] = useState(true)
  const [openError, setOpenError] = useState('')
  const opening = useRef<Promise<void> | null>(null)

  useEffect(() => {
    let active = true
    // StrictMode can run the effect twice; importing a draft must run only once.
    opening.current ??= (async () => {
      if (await openCompanyCourse(projectKey)) return
      const ok = await restoreOpenProject(projectKey)
      if (!ok && projectKey) navigate('app')
    })()
    void opening.current.catch(error => { if (active) setOpenError((error as Error).message) })
      .finally(() => { if (active) setRestoring(false) })
    return () => {
      active = false
    }
    // Run once on mount; projectKey is read from the initial URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Warn before closing the tab while edits would be lost: unsaved or failed
  // writes to the project folder, or any edits in no-folder ("try anyway") mode.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const s = useCourseStore.getState()
      const atRisk = s.directoryHandle
        ? hasPendingSave() || s.saveState === 'error'
        : (skipped || s.projectName !== null) && s.past.length > 0 && hasUnsavedZipChanges()
      if (!atRisk) return
      if (s.directoryHandle) void flushSave()
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [skipped])

  if (openError) return <div className="p-6 text-sm"><p role="alert">{openError}</p><a className="btn-secondary mt-4 inline-flex" href={workspaceBase + 'authoring'}>{t('backToCourses')}</a></div>
  if (restoring) {
    return (
      <><ZipUpdateDialog /><div className="flex h-full items-center justify-center bg-gray-50" role="status">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-brand" />
        <span className="sr-only">{t('opening')}</span>
      </div></>
    )
  }

  if (!directoryHandle && !skipped && !projectName) {
    return (
      <>
        <ZipUpdateDialog />
        <WelcomeScreen
          onSample={() => {
            navigate('demo')
            openSample()
          }}
          onSkip={() => {
            // Regenerate the demo course in the current UI language (the module-load
            // default may not match the user's selected language).
            useCourseStore.getState().newDemoCourse()
            setMemoryUserInstructions(null)
            setSkipped(true)
          }}
        />
      </>
    )
  }

  return (
    <ThemeProvider>
      <ZipUpdateDialog />
      <div className="studio-context flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 text-sm">
        <a className="py-3 text-brand" href={workspaceBase + 'authoring'}>← {t('backToCourses')}</a><span className="studio-course-context text-gray-600" title={companyCourse?.title}>{companyCourse ? t('editingCourse', { title: companyCourse.title }) : t('studioTitle')}</span>
      </div>
      <Header />
      {!directoryHandle && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 sm:text-sm">
          <span>{tw('noFolderBanner')}</span>
          <button
            type="button"
            onClick={() => void runExport('project')}
            className="font-semibold underline underline-offset-2 hover:text-amber-700"
          >
            {t('downloadProject')}
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <Workspace />
      </div>
      {previewOpen && <PreviewOverlay />}
      {settingsOpen && <ProjectSettings onClose={() => setSettingsOpen(false)} />}
      {shortcutsOpen && <ShortcutsHelp />}
      {exportPending && <ExportCheckDialog />}
      <HelpLayer />
      <Toaster />
    </ThemeProvider>
  )
}
