import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { appPath } from './paths';
import { t, useLocale, LanguagePicker, countLabel } from './i18n';
import { ErrorBox, Spinner } from './ui';
import CourseIntro, {SessionCard, SessionsHeading} from './CourseIntro';
import AddToCalendar from './AddToCalendar';
import { CurrentUserContext } from './access';
import SignInMethods from './SignInMethods';
import { completeRegistration, storeRegistrationChoice } from './registration';
import type { Course, User, Enrollment } from './types';

export type PublicCourse = Pick<Course, 'id' | 'title' | 'description' | 'category' | 'cover' |
  'duration_minutes' | 'delivery_mode' | 'venue' | 'requires_approval'> & {
    sessions: {id: number; title: string; starts_at: string; ends_at: string;
      location?: string; state: string; seats_remain: boolean; seats_left?: number | null; registration_opens_at?: string | null}[];
    enrollment?: {status: Enrollment['status']; session: number | null} | null;
  };

export default function Registration({user, entra, onLogin}: {
  user: User | null; entra: boolean; onLogin: (user: User) => void;
}) {
  useLocale();
  const [course, setCourse] = useState<PublicCourse | null>(null);
  const [ownCourse, setOwnCourse] = useState<Course | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [signin, setSignin] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lookupVersion = useRef(0);
  const signinHeading = useRef<HTMLHeadingElement>(null);
  const reserved = course?.enrollment && ['approved', 'pending'].includes(course.enrollment.status);
  useEffect(() => { if (signin) signinHeading.current?.focus(); }, [signin]);
  async function lookup(signedIn: boolean) {
    const version = ++lookupVersion.current;
    // The key remains in the fragment: never store it or place it in a return URL.
    const next = await api<PublicCourse>('registration/lookup/', 'POST', {key: window.location.hash.slice(1)});
    const own = signedIn ? await api<Course>(`courses/${next.id}/`) : null;
    if (version !== lookupVersion.current) return;
    setCourse({...next, sessions: next.sessions.map(session => {
      const detail = own?.sessions.find(row => row.id === session.id);
      return detail ? {...session, seats_left: session.seats_left === undefined ? (detail.remaining > 0 && detail.remaining <= 5 ? detail.remaining : null) : session.seats_left, registration_opens_at: session.registration_opens_at ?? detail.registration_opens_at} : session;
    })});
    setSelected(current => next.sessions.some(s => s.id === current && s.state === 'open' && s.seats_remain) ? current : next.sessions.find(s => s.state === 'open' && s.seats_remain)?.id ?? null);
    setOwnCourse(own);
  }
  useEffect(() => {void lookup(!!user).catch(e => setError(e.message));}, [user?.id]);
  async function enroll(session = selected) {
    if (!course) return;
    setBusy(true); setError('');
    try { await completeRegistration(course.id, session); await lookup(true); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!course || !ownCourse) return;
    setBusy(true); setError('');
    try { await api(`courses/${course.id}/cancel-registration/`, 'POST', {revision: ownCourse.enrollment?.revision || 0}); await lookup(true); }
    catch (e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }
  return <CurrentUserContext.Provider value={user}><div className="guest-page registration-page">
    <LanguagePicker />
    <main className="guest-card">
      <ErrorBox message={error} />
      {!course && !error && <Spinner />}
      {course && <>
        <CourseIntro course={course}/>
        {course.enrollment?.status === 'removed' && <p className="notice">{t('Enrollment was removed. Contact the course organizer.')}</p>}
        {reserved && <p className="notice" role="status">{t(course.enrollment?.status === 'pending' ? 'Waiting for approval' : "You're registered")}</p>}
        {course.delivery_mode === 'scheduled' && <fieldset className="registration-choices" disabled={busy || signin}>
          <SessionsHeading legend={t(reserved ? 'Sessions' : 'Choose a session')}/>
          {course.sessions.map(session => {
            const held = !!reserved && course.enrollment?.session === session.id;
            const bookable = session.state === 'open' && session.seats_remain && course.enrollment?.status !== 'removed';
            return <SessionCard key={session.id} session={session} selected={held}
              seats={session.seats_left != null && session.seats_left > 0 && session.seats_left <= 5 ? countLabel(session.seats_left, '{count} seat left', '{count} seats left') : undefined}
              selection={!reserved ? <input type="radio" name="session" value={session.id} checked={selected === session.id}
                disabled={!bookable} onChange={() => {setSelected(session.id); setSignin(false);}}/> : undefined}>
              {held && ownCourse && <AddToCalendar course={ownCourse}/>}
              {reserved && !held && bookable && <button className="btn" onClick={() => void enroll(session.id)}>{t('Switch to this session')}</button>}
            </SessionCard>;
          })}
          {!course.sessions.length && <p>{t('No sessions available.')}</p>}
        </fieldset>}
        {!reserved && !signin && <div className="registration-action-bar"><button className="btn primary" disabled={busy || course.enrollment?.status === 'removed' || (course.delivery_mode === 'scheduled' && !selected)}
          onClick={() => {
            try {sessionStorage.removeItem('training-registration');} catch { /* Email sign-in needs no storage. */ }
            if (user) void enroll(); else setSignin(true);
          }}>{t(busy ? 'Processing…' : course.requires_approval ? 'Request a seat' : 'Register')}</button></div>}
        {reserved && <div className="heading-actions">
          <a className="text-btn" href={appPath('/my-training')}>{t('Go to my training')}</a>
          {ownCourse?.enrollment?.session && Date.parse(ownCourse.enrollment.session.starts_at) > Date.now() && <button className="text-btn" disabled={busy} onClick={() => void cancel()}>{t('Cancel registration')}</button>}
        </div>}
        {signin && <section className="registration-signin">
          <h2 ref={signinHeading} tabIndex={-1}>{t('Sign in to register')}</h2>
          <SignInMethods entra={entra} beforeMicrosoft={event => {
            try {storeRegistrationChoice(course.id, selected);}
            catch {event.preventDefault(); setError(t('Enable session storage to continue with company sign-in.'));}
          }} onLogin={async next => {onLogin(next); setSignin(false); await enroll();}}/>
        </section>}
      </>}
    </main>
  </div></CurrentUserContext.Provider>;
}
