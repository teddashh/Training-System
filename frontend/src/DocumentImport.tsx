import { useState } from "react";
import { api } from "./api";
import { t } from "./i18n";
import { ErrorBox } from "./ui";
export type DocumentPages = {pages: {number:number;text:string}[];page_count:number;skipped_pages:number[]};
export default function DocumentImport({onLoaded,onBusy}: {onLoaded:(document:DocumentPages|null,name:string)=>void;onBusy:(busy:boolean)=>void}) {
  const [document,setDocument]=useState<DocumentPages|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);
  return <section className="form-section"><h3>{t("Import PDF or PowerPoint")}</h3>
    <p className="muted">{t("Import text as editable lessons. Images, animations and slide layouts are not included. Review in Studio before publishing.")}</p>
    <label>{t("Document")}<input type="file" accept=".pdf,.pptx" disabled={loading} onChange={async e=>{
      const file=e.target.files?.[0];setDocument(null);onLoaded(null,"");if(!file)return;
      setError("");setLoading(true);onBusy(true);try{const body=new FormData();body.append('file',file);const result=await api<DocumentPages>('documents/convert/','POST',body,40000);setDocument(result);onLoaded(result,file.name.replace(/\.[^.]+$/,''));}catch(e){setError((e as Error).message);}finally{setLoading(false);onBusy(false);}
    }}/></label><p className="muted">{t("PDF / PPTX · up to 20 MB and 50 pages")}</p>
    {loading&&<p role="status">{t("Reading document…")}</p>}
    {document&&<><p role="status">{t("{count} lessons ready to edit",{count:document.pages.length})}</p>{document.skipped_pages.length>0&&<p className="notice">{t("Pages without text were skipped: {pages}",{pages:document.skipped_pages.join(', ')})}</p>}<details><summary>{t("Preview imported text")}</summary><div className="document-text-preview">{document.pages.map(p=><section key={p.number}><h4>{t("Page {number}",{number:p.number})}</h4><p>{p.text}</p></section>)}</div></details></>}
    <ErrorBox message={error}/>
  </section>;
}
