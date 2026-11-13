import AddToCalendar from "./AddToCalendar";
import type { NextStep } from './nextSteps';
import { t, useLocale } from './i18n';
import { Badge, SectionTitle } from './ui';
import { formatDate, formatDateTime, formatTimeRange } from './datetime';

export default function NextSteps({rows, go}: {rows: NextStep[]; go: (path: string) => void}) {
  const locale = useLocale();
  if (!rows.length) return null;
  return <section className="panel next-steps">
    <SectionTitle title={t('Next steps')}/>
    <div className="next-steps-content">
    <ul className="next-steps-list">{rows.slice(0, 5).map((row, index) => {
      const caption = row.session ? `${formatDate(row.session.starts_at, locale, true)} · ${formatTimeRange(row.session.starts_at, row.session.ends_at, locale)}${row.session.location ? ` · ${row.session.location}` : ''}`
        : row.caption === 'progress' ? t('{progress}% complete', {progress: row.progress!})
        : row.caption === 'Assigned to you' ? `${t('Assigned to you')}${row.due ? ` · ${t('Due {time}', {time: formatDateTime(row.due, locale)})}` : ''}`
        : row.caption === 'assessment' ? row.course?.title || t(row.action) : t(row.caption);
      return <li className="next-step" key={row.key}>
        <div><strong>{row.title}</strong><p className="muted">{caption}</p>{row.badge && <Badge tone="amber">{t(row.badge)}</Badge>}</div>
        <div className="heading-actions"><button type="button" className={`btn${index === 0 ? ' primary' : ''}`} onClick={() => go(row.path)}>{t(row.action)}</button>{row.session && row.course && <AddToCalendar course={row.course}/>}</div>
      </li>;
    })}</ul>
    {rows.length > 5 && <p className="muted">{t('{count} more in My training and My exams', {count: rows.length - 5})}</p>}
    <div className="heading-actions"><button type="button" className="text-btn" onClick={() => go('/my-training')}>{t('My training')}</button><button type="button" className="text-btn" onClick={() => go('/my-exams')}>{t('My exams')}</button></div>
    </div>
  </section>;
}
