import {useEffect, useState} from 'react';
import {ArrowDown, ArrowUp, FileText, FileSpreadsheet, Presentation, Link as LinkIcon} from 'lucide-react';
import {api} from './api';
import {t, useLocale} from './i18n';
import {ErrorBox} from './ui';
import type {Course} from './types';

type Material = {id:number; title:string; position:number; filename:string; size:number; url:string; download_url:string};
function MaterialIcon({item}:{item:Material}) {
  const ext=item.filename.split('.').pop()?.toLowerCase();
  const Icon=item.url?LinkIcon:ext==='xlsx'?FileSpreadsheet:ext==='pptx'||ext==='ppt'?Presentation:FileText;
  return <Icon size={18} aria-hidden="true"/>;
}
export default function CourseMaterials({course,edit=false}:{course:Course;edit?:boolean}) {
  useLocale();
  const [items,setItems]=useState<Material[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [title,setTitle]=useState(''),[url,setUrl]=useState(''),[file,setFile]=useState<File|null>(null),[kind,setKind]=useState('file'),[fileKey,setFileKey]=useState(0);
  const base=`courses/${course.id}/materials/`;
  async function refresh(){setItems(await api<Material[]>(base));}
  useEffect(()=>{let active=true;setLoading(true);void api<Material[]>(base).then(rows=>{if(active)setItems(rows);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[base]);
  async function run(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function add(){await run(async()=>{const data=new FormData();data.append('title',title);if(kind==='file'&&file)data.append('file',file);else data.append('url',url);await api(base,'POST',data);setTitle('');setUrl('');setFile(null);setFileKey(v=>v+1);});}
  function move(index:number,delta:number){const next=[...items];[next[index],next[index+delta]]=[next[index+delta],next[index]];void run(()=>api(base,'POST',{order:next.map(item=>item.id)}));}
  return <section className="form-section materials-section"><h3>{t('Materials')}</h3><ErrorBox message={error}/>
    {loading?<p role="status">{t('Loading…')}</p>:!items.length?<p className="muted">{t('No materials yet.')}</p>:<div className="session-list">{items.map((item,index)=><div className="session-row material-row" key={item.id}>
      <div className="material-title"><MaterialIcon item={item}/><a href={item.url||item.download_url} target="_blank" rel="noopener noreferrer">{item.title}</a>{item.size>0&&<small>{item.size<1024*1024?`${Math.ceil(item.size/1024)} KB`:`${(item.size/1024/1024).toFixed(1)} MB`}</small>}</div>
      {edit&&<div className="material-controls"><label>{t('Title')}<input maxLength={200} value={item.title} disabled={busy} onChange={e=>setItems(items.map(row=>row.id===item.id?{...row,title:e.target.value}:row))}/></label>
        <div className="heading-actions"><button type="button" className="btn" disabled={busy||!item.title.trim()} onClick={()=>void run(()=>api(base+item.id+'/','PATCH',{title:item.title}))}>{t('Rename')}</button>
        <button type="button" className="icon-btn" disabled={busy||index===0} aria-label={t('Move material up')} onClick={()=>move(index,-1)}><ArrowUp size={16}/></button>
        <button type="button" className="icon-btn" disabled={busy||index===items.length-1} aria-label={t('Move material down')} onClick={()=>move(index,1)}><ArrowDown size={16}/></button>
        <button type="button" className="btn danger-text" disabled={busy} onClick={()=>void run(()=>api(base+item.id+'/','DELETE'))}>{t('Delete')}</button></div></div>}
    </div>)}</div>}
    {edit&&<fieldset className="course-editor-fields" disabled={busy}><div className="form-grid">
      <label>{t('Material type')}<select value={kind} onChange={e=>setKind(e.target.value)}><option value="file">{t('File')}</option><option value="link">{t('Link')}</option></select></label>
      <label>{t('Title')}<input value={title} maxLength={200} onChange={e=>setTitle(e.target.value)}/></label>
      {kind==='file'?<label className="span-2">{t('File')}<input key={fileKey} type="file" accept=".pdf,.pptx,.ppt,.docx,.xlsx" onChange={e=>setFile(e.target.files?.[0]||null)}/><span className="field-hint">{t('PDF, PPTX, PPT, DOCX or XLSX, up to 100 MB.')}</span></label>:<label className="span-2">{t('Link')}<input type="url" value={url} placeholder="https://" onChange={e=>setUrl(e.target.value)}/></label>}
    </div><button type="button" className="btn" disabled={busy||!title.trim()||(kind==='file'?!file:!url.startsWith('https://'))} onClick={()=>void add()}>{t(busy?'Saving…':'Add material')}</button></fieldset>}
  </section>;
}
