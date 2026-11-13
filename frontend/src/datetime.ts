/** Schedules use minute precision; evidence timestamps retain their existing format. */
export function formatDateTime(value: string, locale: string, {zone = false, weekday = false}: {zone?: boolean; weekday?: boolean} = {}) {
  return new Intl.DateTimeFormat(locale, {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(zone ? {timeZoneName: 'short' as const} : {}), ...(weekday ? {weekday: 'short' as const} : {})}).format(new Date(value));
}
export function formatDate(value: string, locale: string, weekday = false) {
  return new Intl.DateTimeFormat(locale, {year: 'numeric', month: 'short', day: 'numeric', ...(weekday ? {weekday: 'short' as const} : {})}).format(new Date(value));
}
export function formatTimeRange(start: string, end: string, locale: string) {
  const a = new Date(start), b = new Date(end);
  const time = new Intl.DateTimeFormat(locale, {hour: 'numeric', minute: '2-digit'});
  const sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return `${time.format(a)} – ${sameDay ? '' : formatDate(end, locale) + ' '}${time.format(b)}`;
}
/** The reader's own time zone in words ("Central Time"), never an identifier such as America/Chicago. */
export function zoneName(locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {timeZoneName: 'longGeneric'}).formatToParts(new Date())
      .find(part => part.type === 'timeZoneName')?.value || Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
}
