import { formatDate, formatTimeRange, zoneName } from "./datetime";
export { formatDateTime as sessionDateTime } from "./datetime";
import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import { MapPin } from 'lucide-react';
import { CourseArtwork } from './CourseCover';
import { Badge } from './ui';
import { countLabel, t, useLocale } from './i18n';
import type { Course } from './types';

export type IntroSession = {
  id: number; title: string; starts_at: string; ends_at: string; location?: string; state: string; registration_opens_at?: string | null;
};
type IntroCourse = Pick<Course, 'title' | 'description' | 'cover' | 'category' | 'duration_minutes' |
  'delivery_mode' | 'venue' | 'requires_approval'> & {sessions: IntroSession[]};

export function sessionLabel(state: string) {
  return t(({open: 'Registration open', upcoming: 'Registration opens later', closed: 'Registration closed',
    full: 'Full', in_progress: 'In progress', ended: 'Ended', cancelled: 'Cancelled'} as Record<string, string>)[state] || state);
}


export default function CourseIntro({course, dialog = false}: {course: IntroCourse; dialog?: boolean}) {
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false), [clamped, setClamped] = useState(false);
  const description = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const element = description.current;
    if (!element) return;
    const measure = () => setClamped(element.scrollHeight > parseFloat(getComputedStyle(element).lineHeight) * 5 + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [course.description, locale]);
  return <section className={`course-intro${dialog ? ' course-intro-dialog' : ''}`}>
    <CourseArtwork cover={course.cover} title={course.title} heading={dialog ? 'h3' : 'h1'}/>
    <p className="course-intro-summary">{t(course.venue === 'onsite' ? 'On-site' : course.delivery_mode === 'scheduled' ? 'Online' : 'Self-paced')} · {countLabel(course.duration_minutes, '{count} minute', '{count} minutes')}{course.requires_approval && <> · {t('Approval required')}</>}</p>
    {course.description && <div>
      <p ref={description} className={`preserve-lines course-intro-description${expanded ? '' : ' is-clamped'}`}>{course.description}</p>
      {clamped && <button type="button" className="text-btn" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t(expanded ? 'Show less' : 'Show more')}</button>}
    </div>}
  </section>;
}

// Dialogs use a "Sessions" sub-heading; the public page's radio group uses its legend instead.
export function SessionsHeading({legend}: {legend?: string}) {
  const locale = useLocale();
  const zone = <p className="muted sessions-zone">{t('Times shown in {zone}', {zone: zoneName(locale)})}</p>;
  return legend ? <><legend className="sessions-legend">{legend}</legend>{zone}</>
    : <div className="sessions-heading"><h3>{t('Sessions')}</h3>{zone}</div>;
}

export function SessionCard({session, selected = false, selection, children, seats, meetingUrl}: {
  session: IntroSession; selected?: boolean; selection?: ReactNode; children?: ReactNode;
  seats?: ReactNode; meetingUrl?: string;
}) {
  const locale = useLocale();
  const start = new Date(session.starts_at);
  const Tag = selection ? 'label' : 'article';
  return <Tag className={`session-row session-card${selected ? ' is-reserved' : ''}`}>
    <div className="session-card-date">{selection}<div className="session-date-tile" aria-hidden="true">
      <span>{new Intl.DateTimeFormat(locale, {weekday: 'short'}).format(start)}</span>
      <strong>{new Intl.DateTimeFormat(locale, {day: 'numeric'}).format(start)}</strong>
      <span>{new Intl.DateTimeFormat(locale, {month: 'short'}).format(start)}</span>
    </div></div>
    <div className="session-card-body">
      <strong>{session.title}</strong>
      <p><span>{formatDate(session.starts_at, locale)} · </span>{formatTimeRange(session.starts_at, session.ends_at, locale)}</p>
      {session.location && <p className="session-location"><MapPin size={16} aria-hidden="true"/><span>{session.location}</span></p>}
      {meetingUrl && <a className="btn" href={meetingUrl} target="_blank" rel="noopener noreferrer">{t('Join meeting')}</a>}
      {seats && <p className="session-card-meta">{seats}</p>}
      {(session.state !== 'open' || selected) && <div className="heading-actions">
        {session.state !== 'open' && <Badge tone={session.state === 'upcoming' || session.state === 'full' ? 'amber' : 'neutral'}>{session.state === 'upcoming' && session.registration_opens_at ? t('Opens {date}', {date: formatDate(session.registration_opens_at, locale)}) : sessionLabel(session.state)}</Badge>}
        {selected && <Badge tone="teal">{t('Your session')}</Badge>}
      </div>}
    </div>
    {/* Conditions that came out false must not leave an empty row under the card. */}
    {Children.toArray(children).length > 0 && <div className="heading-actions session-card-actions">{children}</div>}
  </Tag>;
}
