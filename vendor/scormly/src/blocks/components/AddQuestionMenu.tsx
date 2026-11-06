import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Block, Question, QuestionType } from '../../types/course'
import { useMenu } from '../../hooks/useMenu'
import { useT } from '../../i18n/I18nProvider'
import BlockHoverPreview from '../../components/editor/BlockHoverPreview'
import { QUESTION_TYPES, TYPE_LABEL_KEYS, newQuestion } from '../quizQuestions'

const TYPE_ICON: Record<QuestionType, string> = {
  single: '◉',
  multiple: '☑',
  matching: '⇄',
  sequence: '⇅',
  fillBlanks: '▭',
}

/** Hover card width (BlockHoverPreview is 22rem). */
const PREVIEW_PX = 352

// "+ Add question": the type is picked up front, with a live preview on
// hover, because switching a question's type later would discard its content.
export default function AddQuestionMenu({ onAdd }: { onAdd: (q: Question) => void }) {
  const { t } = useT('quiz')
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const [hover, setHover] = useState<{ type: QuestionType; block: Block; left: number; top: number } | null>(
    null,
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<number | undefined>(undefined)

  useMenu({ open, onClose: () => setOpen(false), rootRef, triggerRef })
  useEffect(() => {
    if (open) return
    window.clearTimeout(hoverTimer.current)
    setHover(null)
  }, [open])
  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])

  function toggle() {
    const rect = triggerRef.current?.getBoundingClientRect()
    // Open upward when the menu (~5 rows) wouldn't fit below.
    if (rect) setUp(window.innerHeight - rect.bottom < 340 && rect.top > window.innerHeight - rect.bottom)
    setOpen((v) => !v)
  }

  // Beside the menu (right, else left), like the Add block menu; none on
  // narrow screens.
  function showPreview(type: QuestionType) {
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => {
      const rect = menuRef.current?.getBoundingClientRect()
      if (!rect || window.innerWidth < 1024) return
      const gap = 16
      const left =
        rect.right + gap + PREVIEW_PX <= window.innerWidth - 8
          ? rect.right + gap
          : rect.left - gap - PREVIEW_PX >= 8
            ? rect.left - gap - PREVIEW_PX
            : null
      if (left === null) return
      const top = Math.max(64, Math.min(rect.top, window.innerHeight - 440))
      const block: Block = {
        id: 'question-preview',
        type: 'quiz',
        settings: {},
        data: { passingScore: 80, showAnswers: true, questions: [newQuestion(type)] },
      }
      setHover({ type, block, left, top })
    }, 300)
  }

  function hidePreview(type: QuestionType) {
    window.clearTimeout(hoverTimer.current)
    setHover((h) => (h?.type === type ? null : h))
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="btn-secondary text-sm"
      >
        {t('addQuestion')}
      </button>

      {open &&
        hover &&
        createPortal(
          <div className="fixed z-50" style={{ left: hover.left, top: hover.top }}>
            <BlockHoverPreview
              key={hover.type}
              title={t(TYPE_LABEL_KEYS[hover.type])}
              description={t(`${TYPE_LABEL_KEYS[hover.type]}Desc`)}
              blocks={[hover.block]}
            />
          </div>,
          // Inside the themed builder root so the theme's colors apply.
          rootRef.current?.closest('[data-theme]') ?? document.body,
        )}

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('questionType')}
          className={`pop-in absolute left-0 z-30 w-72 rounded-xl border border-gray-200 bg-white p-1.5 shadow-2xl ${
            up ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {QUESTION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              onClick={() => {
                onAdd(newQuestion(type))
                setOpen(false)
              }}
              onMouseEnter={() => showPreview(type)}
              onMouseLeave={() => hidePreview(type)}
              onFocus={() => showPreview(type)}
              onBlur={() => hidePreview(type)}
              className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-sm text-brand-dark"
              >
                {TYPE_ICON[type]}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">{t(TYPE_LABEL_KEYS[type])}</span>
                <span className="block text-xs text-gray-500">{t(`${TYPE_LABEL_KEYS[type]}Desc`)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
