import {useEffect, useState} from 'react';
import type React from 'react';
import {learningProgress} from './learningProgress';
import NextSteps from './NextSteps';
import {selectNextSteps, type OwnAssignment} from './nextSteps';
import {api} from './api';
import {t, useLocale, countLabel} from './i18n';
import {formatDateTime} from './datetime';
import {appPath} from './paths';
import {managesSomething} from './navigation';
import {Spinner, ErrorBox, SectionTitle} from './ui';
import type {Course, Exam, User} from './types';

export default function Dashboard({user, courses, exams, go, refreshKey}: {
  user: User; courses: Course[]; exams: Exam[]; go: (path: string) => void; refreshKey: number;
}) {
  const locale = useLocale();
  const [assignments, setAssignments] = useState<OwnAssignment[]>([]);
  const [assignmentsReady, setAssignmentsReady] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState("");
  useEffect(() => {
    let active = true;
    api<OwnAssignment[]>('assignments/').then(rows => {if (active) {setAssignments(rows.filter(row => row.user_id === user.id)); setAssignmentsError('');}})
      .catch(error => {if (active) setAssignmentsError(error.message);})
      .finally(() => {if (active) setAssignmentsReady(true);});
    return () => {active = false;};
  }, [user.id, refreshKey]);
  const steps = selectNextSteps(courses, exams, assignments, user.id);

  const [pending, setPending] = useState<{id: number; title: string; count: number}[]>([]);
  const [attentionError, setAttentionError] = useState('');
  useEffect(() => {
    let active = true;
    setPending([]); setAttentionError('');
    if (user.access.courses !== 'none') {
      void Promise.all(courses.filter(course => course.can_manage && course.requires_approval).map(async course => {
        const roster = await api<{count: number}>(`courses/${course.id}/enrollments/?status=pending`);
        return {id: course.id, title: course.title, count: roster.count};
      })).then(rows => {if (active) setPending(rows.filter(row => row.count > 0));})
        .catch(error => {if (active) setAttentionError(error.message);});
    }
    return () => {active = false;};
  }, [courses, user.id, user.access.courses, refreshKey]);
  const upcoming = user.access.courses === 'none' ? [] : courses.filter(course => course.can_manage)
    .flatMap(course => course.sessions.filter(session => !session.cancelled && Date.parse(session.starts_at) > Date.now())
      .map(session => ({course, session})))
    .sort((a, b) => Date.parse(a.session.starts_at) - Date.parse(b.session.starts_at)).slice(0, 5);
  const progress = learningProgress(courses, exams, assignments, user.id);
  const link = (path: string) => ({href: appPath(path), onClick: (event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault(); go(path);
  }});
  const personal = <>
    <div className="page-heading"><h1>{t('Welcome back, {name}.', {name: user.display_name || user.username})}</h1></div>
    {!assignmentsReady ? <Spinner/> : assignmentsError ? <ErrorBox message={assignmentsError}/> : <section className="personal-progress">
      <p>{progress.total === 0 || progress.done === progress.total ? t("You're all caught up.") : t('{done} of {total} done', progress)}</p>
      {progress.total > 0 && progress.done < progress.total && <progress aria-label={t('Training progress')} max={progress.total} value={progress.done}/>}
    </section>}
    <NextSteps rows={steps} go={go}/>
  </>;
  return <>
    {personal}
    {user.access.courses !== 'none' && <div className="heading-actions home-create"><a className="btn primary" {...link('/authoring/new')}>{t('New training')}</a></div>}
    {upcoming.length > 0 && <section className="panel home-actions">
      <SectionTitle title={t('Upcoming sessions')}/>
      {upcoming.map(({course, session}) => <a className="home-action-row" key={session.id} {...link(`/authoring/${course.id}`)}>
        <time dateTime={session.starts_at}>{formatDateTime(session.starts_at, locale)}</time>
        <strong>{course.title}</strong><span>{t('{reserved} of {capacity}', {reserved: session.reserved, capacity: session.capacity})}</span>
      </a>)}
    </section>}
    <ErrorBox message={attentionError}/>
    {pending.length > 0 && <section className="panel home-actions">
      <SectionTitle title={t('Needs attention')}/>
      {pending.map(course => <a className="home-action-row" key={course.id} {...link(`/authoring/${course.id}?tab=people&status=pending`)}>
        <strong>{course.title}</strong><span>{countLabel(course.count, '{count} request', '{count} requests')}</span>
      </a>)}
    </section>}
    {managesSomething(user.access) && user.access.results === 'none' && <p className="home-more"><a className="text-btn" {...link('/reports')}>{t('Statistics')}</a></p>}
  </>;
}
