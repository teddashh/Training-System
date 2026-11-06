import { useHelpStore } from '../../help/helpStore'
import { RELEASES } from '../../help/releaseNotes'
import { useLang, useT } from '../../i18n/I18nProvider'
import HelpDialogShell from './HelpDialogShell'

// Release notes, newest first (see help/releaseNotes.ts).
export default function WhatsNewDialog() {
  const { t } = useT('help')
  const { lang } = useLang()
  const close = useHelpStore((s) => s.closeDialog)
  return (
    <HelpDialogShell id="whats-new-title" title={t('whatsNewTitle')} onClose={close}>
      <div className="space-y-6">
        {RELEASES.map((release, i) => (
          <section key={release.id}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              {release.date &&
                new Date(release.date).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' })}
              {i === 0 && (
                <span className="rounded-full bg-brand/10 px-2 py-0.5 normal-case tracking-normal text-brand">
                  {t('newBadge')}
                </span>
              )}
            </h3>
            <ul className="space-y-2">
              {release.items[lang].map((item) => (
                <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-gray-700">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </HelpDialogShell>
  )
}
