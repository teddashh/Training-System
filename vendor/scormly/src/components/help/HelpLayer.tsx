import { useEffect } from 'react'
import { useCourseStore } from '../../store/courseStore'
import { tourAlreadyDone, useHelpStore } from '../../help/helpStore'
import Tour from './Tour'
import FaqDialog from './FaqDialog'
import WhatsNewDialog from './WhatsNewDialog'

const AUTOSTART_DELAY_MS = 700

// Renders the tour and help dialogs, and offers the tour once on first use of
// the builder (until it is skipped or finished).
export default function HelpLayer() {
  const tourOpen = useHelpStore((s) => s.tourOpen)
  const dialog = useHelpStore((s) => s.dialog)

  useEffect(() => {
    if (tourAlreadyDone()) return
    const timer = window.setTimeout(() => {
      const s = useCourseStore.getState()
      // Don't interrupt something the author already opened.
      if (s.previewOpen || s.settingsOpen || s.shortcutsOpen) return
      useHelpStore.getState().startTour()
    }, AUTOSTART_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <>
      {tourOpen && <Tour />}
      {dialog === 'faq' && <FaqDialog />}
      {dialog === 'whatsNew' && <WhatsNewDialog />}
    </>
  )
}
