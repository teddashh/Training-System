import { useHelpStore } from '../../help/helpStore'
import Tour from './Tour'
import FaqDialog from './FaqDialog'
import WhatsNewDialog from './WhatsNewDialog'

// Help is available from the toolbar without interrupting editing on first use.
export default function HelpLayer() {
  const tourOpen = useHelpStore((s) => s.tourOpen)
  const dialog = useHelpStore((s) => s.dialog)

  return (
    <>
      {tourOpen && <Tour />}
      {dialog === 'faq' && <FaqDialog />}
      {dialog === 'whatsNew' && <WhatsNewDialog />}
    </>
  )
}
