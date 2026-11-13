import { useEffect, useRef, useState, type ReactNode } from 'react'
import Logo from '../layout/Logo'
import { workspaceBase } from '../../lib/companyCourse'
import LanguagePicker from '../editor/LanguagePicker'
import { useT } from '../../i18n/I18nProvider'
import { isFileSystemAccessSupported } from '../../lib/fileSystem'
import {
  createBrowserProject,
  createNewProject,
  openBrowserProject,
  openExistingProject,
  openRecentProject,
  NoProjectError,
} from '../../lib/projectService'
import {
  deleteBrowserProject,
  isBrowserStorageSupported,
  listBrowserProjects,
  type BrowserProject,
} from '../../lib/browserProjects'
import { openProjectZip, ZipProjectError } from '../../lib/importProjectZip'
import {
  listRecentProjects,
  forgetRecentProject,
  type RecentProject,
} from '../../lib/recentProjects'

interface WelcomeScreenProps {
  /** Continue into the builder without a folder (in-memory, no saving). */
  onSkip: () => void
  /** Open the built-in sample course (in memory). */
  onSample: () => void
}

export default function WelcomeScreen({ onSkip, onSample }: WelcomeScreenProps) {
  const { t, lang } = useT('welcome')
  const { t: tc } = useT('common')
  const supported = isFileSystemAccessSupported()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recents, setRecents] = useState<RecentProject[]>([])
  const zipInputRef = useRef<HTMLInputElement>(null)
  // Projects kept in the browser's own storage (see browserProjects).
  const inBrowser = isBrowserStorageSupported()
  const [browserProjects, setBrowserProjects] = useState<BrowserProject[]>([])

  useEffect(() => {
    if (supported) void listRecentProjects().then(setRecents)
  }, [supported])

  useEffect(() => {
    if (inBrowser) void listBrowserProjects().then(setBrowserProjects)
  }, [inBrowser])

  async function run(action: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await action()
    } catch (err) {
      // User dismissing the OS picker is not an error.
      if (err instanceof DOMException && err.name === 'AbortError') {
        // ignore
      } else if (err instanceof ZipProjectError) {
        setError(t(`zip_${err.reason}`, { detail: err.detail }))
      } else if (err instanceof NoProjectError) {
        setError(t('noProject'))
      } else {
        setError(t('genericError'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="studio-welcome flex h-full flex-col bg-gray-50">
      <a href={workspaceBase + 'authoring'} className="studio-back px-6 py-3 text-sm text-brand">← {tc('backToCourses')}</a>
      <div className="flex items-center justify-between px-6 py-2">
        <Logo />
        <LanguagePicker />
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-3xl">
          <div className="mb-10 text-center">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              {tc('studioTitle')}
            </h1>
            <p className="mt-2 text-gray-500">{t('tagline')}</p>
          </div>

          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Returning authors see their projects first. */}
          {browserProjects.length > 0 && (
            <div className="mb-8">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {t('browserListTitle')}
              </p>
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
                {browserProjects.map((p) => (
                  <li key={p.id} className="flex items-center">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => openBrowserProject(p.id))}
                      className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50"
                    >
                      <span aria-hidden className="text-brand"><WelcomeIcon kind="browser" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-800">{p.title}</span>
                        <span className="block text-xs text-gray-400">
                          {t('updatedAgo', { when: new Date(p.updatedAt).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) })}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      title={t('deleteBrowserProject')}
                      aria-label={`${t('deleteBrowserProject')}: ${p.title}`}
                      onClick={async () => {
                        if (!window.confirm(t('deleteBrowserConfirm', { title: p.title }))) return
                        await deleteBrowserProject(p.id)
                        setBrowserProjects(await listBrowserProjects())
                      }}
                      className="px-3 py-3 text-gray-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-gray-400">{t('browserListHint')}</p>
            </div>
          )}

          {recents.length > 0 && (
            <div className="mb-8">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {t('recentTitle')}
              </p>
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
                {recents.map((r) => (
                  <li key={r.name} className="flex items-center">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => openRecentProject(r.handle))}
                      className="flex flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50"
                    >
                      <span aria-hidden className="text-brand"><WelcomeIcon kind="folder" /></span>
                      <span className="truncate text-sm font-medium text-gray-800">
                        {r.name}
                      </span>
                    </button>
                    <button
                      type="button"
                      title={t('removeRecent')}
                      aria-label={t('removeRecent')}
                      onClick={async () => {
                        await forgetRecentProject(r.name)
                        setRecents(await listRecentProjects())
                      }}
                      className="px-3 py-3 text-gray-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <WelcomeCard icon={<WelcomeIcon kind="plus" />} title={t('browserTitle')} text={t(inBrowser ? 'browserText' : 'startText')} cta={t('browserTitle')} primary disabled={busy} onClick={() => inBrowser ? void run(createBrowserProject) : onSkip()} />
            <WelcomeCard icon={<WelcomeIcon kind="archive" />} title={t('zipTitle')} text={t('zipText')} cta={t('zipTitle')} disabled={busy} onClick={() => zipInputRef.current?.click()} />
          </div>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <details className="min-w-0 flex-1">
              <summary className="cursor-pointer py-3 text-sm text-gray-600">{tc('advancedOptions')}</summary>
          {!supported && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-semibold">{t('unsupportedTitle')}</p>
              <p className="mt-1">{t('unsupportedText')}</p>
            </div>
          )}

              <div className="grid gap-3 sm:grid-cols-2">
                <button className="btn-secondary text-sm" disabled={!supported || busy} onClick={() => void run(createNewProject)}>{t('createTitle')}</button>
                <button className="btn-secondary text-sm" disabled={!supported || busy} onClick={() => void run(openExistingProject)}>{t('openTitle')}</button>
              </div>
            </details>
            <button className="py-3 text-sm text-brand underline" disabled={busy} onClick={onSample}>{t('sampleTitle')}</button>
          </div>
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void run(() => openProjectZip(file))
            }}
          />

          {busy && (
            <p role="status" className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-brand" />
              {t('opening')}
            </p>
          )}

          <p className="mt-8 text-center text-xs text-gray-400">
            {t(inBrowser ? 'privacyNote' : 'startText')}
          </p>
        </div>
      </div>
    </div>
  )
}

interface WelcomeCardProps {
  primary?: boolean
  icon: ReactNode
  title: string
  text: string
  cta: string
  disabled?: boolean
  onClick: () => void
}

function WelcomeCard({ icon, title, text, cta, disabled, onClick, primary }: WelcomeCardProps) {
  return (
    <div className="studio-welcome-card flex flex-col rounded-2xl border border-gray-200 bg-white p-7 shadow-sm">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-2xl text-brand">
        <span aria-hidden>{icon}</span>
      </div>
      <h2 className="mt-5 text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-600">{text}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`${primary ? 'btn-primary' : 'btn-secondary'} mt-5 text-sm disabled:opacity-40`}
      >
        {cta}
      </button>
    </div>
  )
}

function WelcomeIcon({ kind }: { kind: 'plus' | 'folder' | 'archive' | 'browser' | 'edit' | 'learn' }) {
  const paths = {
    plus: 'M12 5v14M5 12h14',
    folder: 'M3 7V5h6l2 2h10v13H3V7Zm0 3h18',
    archive: 'M5 3h14v18H5V3Zm7 0v12m-2 1h4v3h-4v-3Z',
    browser: 'M3 4h18v16H3V4Zm0 5h18M6 6.5h.01M9 6.5h.01',
    edit: 'm4 16 12-12 4 4L8 20H4v-4Zm10-10 4 4',
    learn: 'm2 8 10-5 10 5-10 5L2 8Zm4 3v6l6 3 6-3v-6m4-3v8',
  }
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]} /></svg>
}
