import { appPath } from "./paths";
import AddToCalendar from "./AddToCalendar";
import { formatDate, formatTimeRange, zoneName } from "./datetime";
import CourseIntro, {SessionCard, SessionsHeading, sessionLabel} from "./CourseIntro";
export {sessionLabel} from "./CourseIntro";
import AssessmentBlock from "./AssessmentBlock";
import {useEffect,useState} from 'react';
import CourseMaterials from './CourseMaterials';
import {api} from './api';
import {countLabel,t,useLocale} from './i18n';
import {Badge,ErrorBox,Modal} from './ui';
import type {Course,CourseSession} from './types';

export function localDate(value?:string|null){
  if(!value)return '';
  const date=new Date(value);
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
const iso=(value:string)=>value?new Date(value).toISOString():null;


export function SessionEditor({course,session,onClose,onSaved}:{course:Course;session:CourseSession|null;onClose:()=>void;onSaved:()=>void}){
  const locale=useLocale();
  const [title,setTitle]=useState(session?.title||''),[start,setStart]=useState(localDate(session?.starts_at)),[end,setEnd]=useState(localDate(session?.ends_at));
  const [location,setLocation]=useState(session?.location||''),[meeting,setMeeting]=useState(session?.meeting_url||'');
  const [opens,setOpens]=useState(localDate(session?.registration_opens_at)),[closes,setCloses]=useState(localDate(session?.registration_closes_at));
  const [capacity,setCapacity]=useState(session?.capacity||100),[cancelled,setCancelled]=useState(session?.cancelled||false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(e:React.FormEvent){e.preventDefault();e.stopPropagation();setBusy(true);setError('');try{
    await api(`courses/${course.id}/sessions/${session?`${session.id}/`:''}`,session?'PATCH':'POST',{title,location:course.venue==='onsite'?location:'',meeting_url:meeting,starts_at:iso(start),ends_at:iso(end),registration_opens_at:iso(opens),registration_closes_at:iso(closes),capacity,cancelled,revision:session?.revision||0});
    onSaved();onClose();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Modal title={t(session?'Edit session':'Add session')} onClose={onClose} closeDisabled={busy} wide><form className="modal-form" onSubmit={save}>
    <p className="muted">{t('Times shown in {zone}',{zone:zoneName(locale)})}</p>
    <fieldset className="course-editor-fields" disabled={busy}><div className="form-grid">
      <label className="span-2">{t('Session name')}<input required maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      {course.venue==='onsite'&&<label className="span-2">{t('Location')}<input required maxLength={200} value={location} onChange={e=>setLocation(e.target.value)}/></label>}
      {course.venue!=='onsite'&&<label className="span-2">{t('Meeting link')}<input type="url" pattern="https://.*" maxLength={2000} placeholder="https://" value={meeting} onChange={e=>setMeeting(e.target.value)}/></label>}

      <label>{t('Session starts')}<input type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label>{t('Session ends')}<input type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></label>
      <label>{t('Seat limit')}<input type="number" min={1} max={10000} required value={capacity} onChange={e=>setCapacity(Number(e.target.value))}/></label>
    </div><details className="course-options"><summary>{t('More options')}</summary><div className="form-grid">
      <label>{t('Registration opens')}<input type="datetime-local" value={opens} onChange={e=>setOpens(e.target.value)}/></label>
      <label>{t('Registration closes')}<input type="datetime-local" value={closes} onChange={e=>setCloses(e.target.value)}/></label>
      {course.venue==='onsite'&&<label className="span-2">{t('Meeting link')}<input type="url" pattern="https://.*" maxLength={2000} placeholder="https://" value={meeting} onChange={e=>setMeeting(e.target.value)}/></label>}
    </div>{session&&<label className="checkbox-label"><input type="checkbox" checked={cancelled} onChange={e=>setCancelled(e.target.checked)}/>{t('Cancel this session')}</label>}</details>
    <ErrorBox message={error}/><div className="modal-footer"><button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" disabled={busy}>{t(busy?'Saving…':'Save session')}</button></div></fieldset>
  </form></Modal>;
}

export function CourseSessions({course,onSaved}:{course:Course;onSaved:()=>void}){
  const locale=useLocale();const [sessions,setSessions]=useState(course.sessions||[]),[editing,setEditing]=useState<CourseSession|null|undefined>(),[error,setError]=useState('');
  function refresh(){void api<CourseSession[]>(`courses/${course.id}/sessions/`).then(setSessions).catch(e=>setError(e.message));}
  useEffect(refresh,[course.id]);
  return <section className="form-section"><div className="section-heading"><h3>{t('Sessions')}</h3><button type="button" className="btn" onClick={()=>setEditing(null)}>{t('Add session')}</button></div>
    {sessions.length?<div className="session-list">{sessions.map(s=><div className="session-row" key={s.id}><div><strong>{s.title}</strong>{s.location&&<p>{t('Location')}: {s.location}</p>}{s.meeting_url&&<a className="btn" href={s.meeting_url} target="_blank" rel="noopener noreferrer">{t('Join meeting')}</a>}<p>{formatDate(s.starts_at, locale)} · {formatTimeRange(s.starts_at, s.ends_at, locale)}</p><small>{t('{reserved} / {capacity} seats reserved',{reserved:s.reserved,capacity:s.capacity})}</small></div><div className="heading-actions"><Badge tone={s.state==='open'?'teal':'neutral'}>{sessionLabel(s.state)}</Badge><button type="button" className="btn" aria-label={t('Edit session {name}',{name:s.title})} onClick={()=>setEditing(s)}>{t('Edit')}</button></div></div>)}</div>:<p className="muted">{t('No sessions yet.')}</p>}
    <ErrorBox message={error}/>{editing!==undefined&&<SessionEditor course={course} session={editing} onClose={()=>setEditing(undefined)} onSaved={()=>{refresh();onSaved();}}/>}
  </section>;
}

export function SessionEnrollment({course:initial,onClose,onSaved,onReady,message}:{message?:string;course:Course;onClose:()=>void;onSaved:()=>void;onReady:(course:Course)=>void}){
  useLocale();const [course,setCourse]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [choice,setChoice]=useState<number|null>(initial.sessions.find(s=>s.state==='open'&&s.remaining>0)?.id??null);
  const row=course.enrollment, reserved=row&&['approved','pending'].includes(row.status)&&row.session;
  async function refresh(){const next=await api<Course>(`courses/${course.id}/`);setCourse(next);setChoice(current=>next.sessions.some(s=>s.id===current&&s.state==='open'&&s.remaining>0)?current:next.sessions.find(s=>s.state==='open'&&s.remaining>0)?.id??null);onSaved();return next;}
  async function change(session?:number){setBusy(true);setError('');try{await api(`courses/${course.id}/${session?'enroll':'cancel-registration'}/`,'POST',{session,revision:row?.revision||0});await refresh();}catch(e){setError((e as Error).message);await refresh().catch(()=>{});}finally{setBusy(false);}}
  return <Modal title={t(reserved?'Sessions':'Choose a session')} onClose={onClose} closeDisabled={busy} wide><div className="modal-form"><CourseIntro course={course} dialog/>
    {message&&!reserved&&<p className="notice" role="status">{message}</p>}
    {row?.status==='removed'&&<p className="notice">{t('Enrollment was removed. Contact the course organizer.')}</p>}
    {reserved&&<p role="status" className="notice">{t(row.status==='pending'?'Waiting for approval':"You're registered")}</p>}
    <fieldset className="registration-choices" disabled={busy}>
    <SessionsHeading legend={t('Sessions')}/>
    <div className="session-list">{course.sessions.map(s=>{
      const selected=!!reserved&&row.session?.id===s.id;
      const bookable=s.state==='open'&&s.remaining>0&&row?.status!=='removed';
      return <SessionCard key={s.id} session={s} selected={selected} meetingUrl={s.meeting_url}
        seats={s.remaining>0&&s.remaining<=5?countLabel(s.remaining, '{count} seat left', '{count} seats left'):undefined}
        selection={!reserved?<input type="radio" name="session" value={s.id} checked={choice===s.id} disabled={!bookable} onChange={()=>setChoice(s.id)}/>:undefined}>
        {selected?<><AddToCalendar course={course}/>{course.venue!=='onsite' && row.status==='approved' && !s.cancelled && course.published && (!course.release_at || Date.parse(course.release_at)<=Date.now()) && Date.parse(s.starts_at)<=Date.now() && Date.now()<Date.parse(s.ends_at)&&<button type="button" className="btn primary" disabled={busy} onClick={()=>onReady(course)}>{t('Start learning')}</button>}{Date.parse(s.starts_at)>Date.now()&&<button type="button" className="text-btn" disabled={busy} onClick={()=>void change()}>{t('Cancel registration')}</button>}</>:reserved&&bookable?<button type="button" className="btn" onClick={()=>void change(s.id)}>{t('Switch to this session')}</button>:null}
      </SessionCard>;
    })}</div>{!course.sessions.length&&<p>{t('No sessions available.')}</p>}
    </fieldset>
    <ErrorBox message={error}/>
    {!reserved&&<div className="registration-action-bar"><button type="button" className="btn primary" disabled={busy||!choice||row?.status==='removed'} onClick={()=>choice&&void change(choice)}>{t(busy?'Processing…':course.requires_approval?'Request a seat':'Register')}</button></div>}
    {reserved&&<a className="text-btn" href={appPath('/my-training')}>{t('Go to my training')}</a>}
    {(course.can_manage||row?.status==='approved')&&<CourseMaterials course={course}/>}
    <AssessmentBlock course={course} onChanged={refresh}/>
    <div className="modal-footer"><button type="button" className="text-btn" disabled={busy} onClick={()=>{setBusy(true);void refresh().catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{t('Refresh status')}</button><button type="button" className="btn" onClick={onClose}>{t('Close')}</button></div>
  </div></Modal>;
}

export function RegistrationLink({course}:{course:Course}) {
  const [link,setLink]=useState(''), [copied,setCopied]=useState(false);
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  async function load(rotate=false) {
    setBusy(true);setError('');setCopied(false);
    try { const data=await api<{url:string}>(`courses/${course.id}/registration-link/`,'POST',{rotate});setLink(data.url); }
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  if(!course.can_manage || !course.published)return null;
  return <section className="form-section"><h3>{t('Registration link')}</h3>
    {link ? <div className="registration-share"><label>{t('Registration link')}<input readOnly value={link} onFocus={e=>e.target.select()}/></label>
      <button type="button" className="btn" disabled={busy} onClick={()=>{void navigator.clipboard?.writeText(link).then(()=>setCopied(true)).catch(()=>setCopied(false));}}>{t(copied?'Copied':'Copy link')}</button>
      <button type="button" className="btn" disabled={busy} onClick={()=>{if(window.confirm(t('Create a new registration link? The old link will stop working immediately.')))void load(true);}}>{t('Create new link')}</button>
    </div> : <button type="button" className="btn" disabled={busy} onClick={()=>void load()}>{t('Show registration link')}</button>}
    <ErrorBox message={error}/>
  </section>;
}
