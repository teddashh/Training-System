import type { DividerData } from '../../types/course'

// Learner rendering of a divider (also used by the editor). Mirrors
// renderDivider() in the SCORM player; styled by the sc-divider-* classes.
export default function DividerView({ style, label, editLabel }: DividerData & { editLabel?: React.ReactNode }) {
  switch (style) {
    case 'spacer':
      return <div className="sc-spacer" aria-hidden />
    case 'gradient':
      return <hr className="sc-divider sc-divider-gradient" />
    case 'dots':
      return (
        <div role="separator" className="sc-divider sc-divider-dots">
          <span />
          <span />
          <span />
        </div>
      )
    case 'ornament':
      return (
        <div role="separator" className="sc-divider sc-divider-ornament">
          <span aria-hidden>✦</span>
        </div>
      )
    case 'wave':
      return <div role="separator" className="sc-divider sc-divider-wave" />
    case 'label':
      return (
        <div role="separator" aria-label={label || undefined} className="sc-divider sc-divider-label">
          {editLabel ?? <span>{label}</span>}
        </div>
      )
    default:
      return <hr className="sc-divider sc-divider-line" style={{ borderTopStyle: style }} />
  }
}
