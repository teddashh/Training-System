import { useState, type ChangeEvent, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { saveAsset, UnsupportedFormatError, toastUploadError, type AssetKind } from '../../lib/assets'

// Small shared controls for block settings panels (shown while a block is
// selected), so every block's options look and behave the same.

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'

/** Settings strip shown under/over a selected block. */
export function SettingsBar({ children }: { children: ReactNode }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-gray-200/80 bg-white/90 px-3 py-2.5 text-gray-700 shadow-sm backdrop-blur"
    >
      {children}
    </div>
  )
}

/** Labelled segmented control (a radio group rendered as pills). */
export function Segmented<V extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: V
  options: readonly (readonly [V, string])[]
  onChange: (v: V) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-2">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <span className="inline-flex rounded-lg bg-gray-100 p-0.5">
        {options.map(([v, text]) => {
          const checked = v === value
          return (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(v)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                checked
                  ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {text}
            </button>
          )
        })}
      </span>
    </div>
  )
}

/**
 * Upload handler for a single asset: saves the picked file and passes the
 * stored path on. Unsupported formats set `error` (shown inline by the caller);
 * other failures are toasted.
 */
export function useAssetUpload(kind: AssetKind, onSaved: (path: string, file: File) => void) {
  const [error, setError] = useState(false)
  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    setError(false)
    for (const file of files) {
      try {
        onSaved(await saveAsset(file, kind), file)
      } catch (err) {
        if (err instanceof UnsupportedFormatError) setError(true)
        else toastUploadError(err)
      }
    }
  }
  return { onPick, error }
}

/** A button-styled file input. */
export function UploadButton({
  label,
  accept,
  multiple,
  onPick,
  variant = 'secondary',
}: {
  label: string
  accept?: string
  multiple?: boolean
  onPick: (e: ChangeEvent<HTMLInputElement>) => void
  variant?: 'secondary' | 'subtle'
}) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-1.5 text-sm focus-within:outline-2 focus-within:outline-brand ${
        variant === 'secondary'
          ? 'btn-secondary'
          : 'rounded-md px-2.5 py-1 font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      {label}
      <input type="file" accept={accept} multiple={multiple} onChange={onPick} className="sr-only" />
    </label>
  )
}

/** Textarea that grows with its content (no inner scrollbar). */
export function AutoTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string },
) {
  return (
    <textarea
      rows={1}
      {...props}
      ref={(el) => {
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
      }}
      onInput={(e) => {
        const el = e.currentTarget
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
      }}
      style={{ resize: 'none', overflow: 'hidden', ...props.style }}
    />
  )
}
