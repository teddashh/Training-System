import type { Course, CourseSession } from './types';

type CalendarSession = Pick<CourseSession, 'id' | 'revision' | 'title' | 'starts_at' | 'ends_at' | 'location' | 'meeting_url'>;
export const calendarUtc = (value: string | Date) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const escapeText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
export function foldCalendarLine(value: string) {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let line = '', bytes = 0;
  for (const character of value) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) { lines.push(line); line = ' '; bytes = 1; }
    line += character; bytes += size;
  }
  lines.push(line);
  return lines.join('\r\n');
}
export function buildSessionCalendar(course: Pick<Course, 'title'>, session: CalendarSession, userId: number,
  {organization, host, url, now = new Date(), joinMeeting = 'Join meeting', trainingDetails = 'Training details'}: {organization: string; host: string; url: string; now?: Date; joinMeeting?: string; trainingDetails?: string}) {
  const summary = !session.title || session.title === course.title ? course.title : `${course.title} — ${session.title}`;
  const description = (session.meeting_url ? `${joinMeeting}: ${session.meeting_url}\n\n` : '') + `${trainingDetails}: ${url}`;
  const lines = ['BEGIN:VCALENDAR', `PRODID:-//${organization.replace(/[^a-zA-Z0-9 ._-]/g, '').trim() || 'Training'}//Training//EN`, 'VERSION:2.0', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:training-session-${session.id}-${userId}@${host}`, `DTSTAMP:${calendarUtc(now)}`, `DTSTART:${calendarUtc(session.starts_at)}`,
    `DTEND:${calendarUtc(session.ends_at)}`, `SEQUENCE:${session.revision}`, `SUMMARY:${escapeText(summary)}`,
    ...(session.location ? [`LOCATION:${escapeText(session.location)}`] : []), `URL:${url}`, `DESCRIPTION:${escapeText(description)}`,
    'END:VEVENT', 'END:VCALENDAR'];
  return lines.map(foldCalendarLine).join('\r\n') + '\r\n';
}
export function downloadCalendar(content: string) {
  const url = URL.createObjectURL(new Blob([content], {type: 'text/calendar;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url; link.download = 'training-session.ics';
  document.body.append(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}
