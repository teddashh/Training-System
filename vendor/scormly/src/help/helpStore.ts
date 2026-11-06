import { create } from 'zustand'
import { LATEST_RELEASE } from './releaseNotes'

// Per-browser memory of what the author has already seen. Storage can be
// unavailable (private mode, blocked site data), so every access is guarded
// and a failure just means the tour / badge may show again.
const TOUR_KEY = 'scormly.tourDone'
const WHATS_NEW_KEY = 'scormly.whatsNewSeen'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore — see above
  }
}

export type HelpDialog = 'faq' | 'whatsNew'

interface HelpState {
  tourOpen: boolean
  dialog: HelpDialog | null
  /** Release id the author last opened in "What's new". */
  whatsNewSeen: string | null
  startTour: () => void
  /** Skip or finish: never offer the tour automatically again. */
  endTour: () => void
  openDialog: (dialog: HelpDialog) => void
  closeDialog: () => void
}

export const useHelpStore = create<HelpState>()((set) => ({
  tourOpen: false,
  dialog: null,
  whatsNewSeen: read(WHATS_NEW_KEY),
  startTour: () => set({ tourOpen: true, dialog: null }),
  endTour: () => {
    write(TOUR_KEY, '1')
    // Someone who just toured the builder doesn't need a "new" badge for
    // features they have never seen the old version of.
    if (read(WHATS_NEW_KEY) === null) write(WHATS_NEW_KEY, LATEST_RELEASE)
    set({ tourOpen: false, whatsNewSeen: read(WHATS_NEW_KEY) ?? LATEST_RELEASE })
  },
  openDialog: (dialog) => {
    if (dialog === 'whatsNew') {
      write(WHATS_NEW_KEY, LATEST_RELEASE)
      set({ dialog, whatsNewSeen: LATEST_RELEASE })
    } else set({ dialog })
  },
  closeDialog: () => set({ dialog: null }),
}))

export function tourAlreadyDone(): boolean {
  return read(TOUR_KEY) !== null
}

export function hasUnseenRelease(seen: string | null): boolean {
  return seen !== LATEST_RELEASE
}
