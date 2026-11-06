// Display helpers for attachment files (mirrored in the SCORM player).

/** "2.4 MB" style size; empty for unknown sizes. */
export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes < 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`
}

/** Upper-case extension badge text ("PDF"), or "FILE". */
export function fileBadge(name: string): string {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]
  return ext ? ext.toUpperCase() : 'FILE'
}
