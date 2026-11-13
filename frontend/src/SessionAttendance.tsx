import { formatDate, formatTimeRange } from "./datetime";
import {useEffect, useState} from 'react';
import {Check} from 'lucide-react';
import {api, downloadFile} from './api';
import {t, useLocale} from './i18n';
import {ErrorBox} from './ui';
import type {Course, CourseSession, Enrollment} from './types';

export type SessionFile='sign-in'|'sign-in-pdf'|'attendance';
/** Sheets are rendered in the reader's language and time zone; the PDF is the printable sign-in sheet. */
export async function downloadSessionFile(courseId:number,sessionId:number,kind:SessionFile){
  const params=new URLSearchParams({kind,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});
  await downloadFile(`courses/${courseId}/sessions/${sessionId}/export/?${params}`,
    kind==='sign-in-pdf'?`session-${sessionId}-sign-in.pdf`:`session-${sessionId}-${kind}.xlsx`);
}
type Row=Enrollment&{person:string;department:string;employee_id:string|null};
type Attendance={results:Row[];counts:{present:number;absent:number;no_record:number};can_mark:boolean};
/** One line per person; a mark is saved at once and pressing it again clears it. */
export default function SessionAttendance({course,session,onSaved,refreshKey,heading=true}:{course:Course;session:CourseSession;onSaved:()=>void;refreshKey:number;
  /** False inside a dialog that already names the session (the sign-in sheet is on its card there). */
  heading?:boolean}) {
  const locale=useLocale();
  const [data,setData]=useState<Attendance|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState(''),[page,setPage]=useState(1);
  const base=`courses/${course.id}/sessions/${session.id}/`;
  useEffect(()=>{let active=true;setData(null);setPage(1);setError('');void api<Attendance>(base+'attendance/').then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[base,refreshKey]);
  async function mark(attendance:string,enrollment?:number){setBusy(true);setError('');try{setData(await api<Attendance>(base+'attendance/','POST',{attendance,enrollment,all_present:!enrollment}));onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function download(kind:SessionFile){setBusy(true);setError('');try{await downloadSessionFile(course.id,session.id,kind);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const rows=(data?.results||[]).filter(row=>(row.person+' '+row.department+' '+(row.employee_id||'')).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="form-section attendance">{heading&&<h3>{t('Attendance')} · {session.title}</h3>}
    <p className="muted">{formatDate(session.starts_at, locale)} · {formatTimeRange(session.starts_at, session.ends_at, locale)}{session.location?` · ${session.location}`:''}</p>
    <ErrorBox message={error}/>{data?<>
      <div className="attendance-bar">
        <p role="status">{t('Present')}: {data.counts.present} · {t('Absent')}: {data.counts.absent} · {t('No record')}: {data.counts.no_record}</p>
        <button type="button" className="btn" disabled={busy||!data.can_mark||!data.results.length} onClick={()=>void mark('present')}>{t('Mark all present')}</button>
      </div>
      {!data.can_mark&&<p className="field-hint">{t('Attendance opens when the session starts.')}</p>}
      {data.results.length>10&&<label className="attendance-search">{t('Search participants')}<input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label>}
      <ul className="attendance-list">{rows.slice((page-1)*20,page*20).map(row=><li key={row.id}>
        <div><strong>{row.person}</strong><span className="muted">{[row.employee_id,row.department].filter(Boolean).join(' · ')}</span></div>
        <div className="attendance-marks" role="group" aria-label={row.person}>{(['present','absent'] as const).map(value=>{
          const on=row.effective_attendance===value;
          return <button key={value} type="button" className="btn" disabled={busy||!data.can_mark} aria-pressed={on} onClick={()=>void mark(row.attendance===value?'':value,row.id)}>{on&&<Check size={14} aria-hidden="true"/>}{t(value==='present'?'Present':'Absent')}</button>;
        })}</div>
      </li>)}</ul>
      {!rows.length&&<p className="muted">{t('No matching enrollments')}</p>}
      {rows.length>20&&<div className="enrollment-pagination"><button type="button" className="btn" disabled={page===1} onClick={()=>setPage(page-1)}>{t('Previous')}</button><span>{page} / {Math.ceil(rows.length/20)}</span><button type="button" className="btn" disabled={page*20>=rows.length} onClick={()=>setPage(page+1)}>{t('Next')}</button></div>}
      <div className="heading-actions attendance-files">
        {heading&&<button type="button" className="text-btn" disabled={busy} onClick={()=>void download('sign-in')}>{t('Sign-in sheet (.xlsx)')}</button>}
        <button type="button" className="text-btn" disabled={busy||Date.now()<Date.parse(session.starts_at)} onClick={()=>void download('attendance')}>{t('Attendance results (.xlsx)')}</button>
      </div>
    </>:<p role="status">{t('Loading…')}</p>}
  </section>;
}
