import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { downloadFile } from './api';
import { countLabel, t, useLocale } from './i18n';
import { ErrorBox, Modal } from './ui';
import { PeoplePicker } from './PeopleDirectory';
import { GroupPicker } from './Groups';
import { REASONS, accepted, appendLines, skipped, type RosterInput, type RosterReport } from './simpleTraining';

export type PeopleNames = { people: Record<number, string>; groups: Record<number, string> };
export const emptyNames = (): PeopleNames => ({ people: {}, groups: {} });

/** The skipped lines exactly as typed, each with a two-word reason. */
export function SkippedLines({ rows }: { rows: RosterReport['rows'] }) {
  useLocale();
  return <ul className="people-skipped">{rows.map((row, i) => <li key={i}><span>{row.input}</span><span className="muted">{t(REASONS[row.outcome] || 'Not checked')}</span></li>)}</ul>;
}

/** "18 people · 2 not found" with the unresolved lines one click away. */
export function CheckLine({ report, checking }: { report?: RosterReport; checking?: boolean }) {
  useLocale();
  const [open, setOpen] = useState(false);
  if (checking) return <p className="field-hint" role="status">{t('Checking…')}</p>;
  if (!report) return null;
  const rest = skipped(report), notFound = rest.every(row => row.outcome === 'not_found');
  return <div className="people-check" role="status">
    <p className="field-hint">{countLabel(accepted(report), '{count} person', '{count} people')}
      {rest.length > 0 && ` · ${t(notFound ? '{count} not found' : '{count} skipped', { count: rest.length })}`}
      {rest.length > 0 && <button type="button" className="text-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{t(open ? 'Hide' : 'Show')}</button>}
    </p>
    {open && <SkippedLines rows={rest} />}
  </div>;
}

export default function PeopleBox({ id, value, names, onChange, onCheck, onUpload, report, checking, disabled = false, error }: {
  id: string; value: RosterInput; names: PeopleNames; disabled?: boolean; error?: string;
  report?: RosterReport; checking?: boolean;
  onChange: (value: RosterInput, names: PeopleNames) => void;
  /** Called with the box's latest value whenever it is complete: on blur, after picking and after a file. */
  onCheck: (value: RosterInput) => void;
  /** Returns the lines the server read from a CSV or XLSX file. */
  onUpload: (file: File) => Promise<string[]>;
}) {
  useLocale();
  const [picking, setPicking] = useState(false), [view, setView] = useState<'people' | 'groups'>('people');
  const [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  // The pickers report the ticked row just before the new selection, so its name can label the chip.
  const ticked = useRef<{ kind: 'people' | 'groups'; id: number; name: string } | null>(null);
  function change(next: RosterInput, nextNames = names) { onChange(next, nextNames); }
  function pick(kind: 'people' | 'groups', ids: number[]) {
    const row = ticked.current?.kind === kind ? ticked.current : null;
    ticked.current = null;
    change({ ...value, [kind]: ids }, row ? { ...names, [kind]: { ...names[kind], [row.id]: row.name } } : names);
  }
  function remove(kind: 'people' | 'groups', key: number) {
    const next = { ...value, [kind]: value[kind].filter(item => item !== key) };
    change(next); onCheck(next);
  }
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true); setUploadError('');
    try {
      const next = { ...value, text: appendLines(value.text, await onUpload(file)) };
      change(next); onCheck(next);
    } catch (e) { setUploadError((e as Error).message); }
    finally { setUploading(false); }
  }
  function closePicker() { setPicking(false); onCheck(value); }
  async function downloadTemplate() {
    setDownloading(true); setUploadError('');
    try { await downloadFile('trainings/people-template/', 'people-template.xlsx'); }
    catch (e) { setUploadError((e as Error).message); }
    finally { setDownloading(false); }
  }
  const chips = [...value.people.map(key => ['people', key] as const), ...value.groups.map(key => ['groups', key] as const)];
  return <div className="people-box">
    <label htmlFor={id}>{t('People')}</label>
    {chips.length > 0 && <div className="heading-actions linked-course-chips">{chips.map(([kind, key]) => {
      const name = names[kind][key] || `#${key}`;
      return <span className="badge neutral" key={kind + key}>{name}
        <button type="button" className="icon-btn" disabled={disabled} aria-label={t('Remove {title}', { title: name })} onClick={() => remove(kind, key)}><X size={14} /></button>
      </span>;
    })}</div>}
    <textarea id={id} rows={4} value={value.text} disabled={disabled || uploading} placeholder={t('Paste e-mails or employee IDs')}
      aria-invalid={!!error} aria-describedby={error ? id + '-error' : undefined}
      onChange={e => change({ ...value, text: e.target.value })} onBlur={() => onCheck(value)} />
    <div className="people-box-actions">
      <button type="button" className="text-btn" disabled={disabled} onClick={() => setPicking(true)}>{t('Pick people')}</button>
      <label className={'text-btn people-upload' + (disabled || uploading ? ' is-disabled' : '')}>{t(uploading ? 'Reading…' : 'Upload file')}
        <input className="sr-only" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={disabled || uploading} onChange={e => void upload(e)} />
      </label>
      <button type="button" className="text-btn" disabled={disabled || downloading} onClick={() => void downloadTemplate()}>{t('Download template')}</button>
    </div>
    {error && <span className="field-hint danger-text" id={id + '-error'}>{error}</span>}
    <ErrorBox message={uploadError} />
    {!disabled && <CheckLine report={report} checking={checking} />}
    {picking && <Modal title={t('Pick people')} wide onClose={closePicker}>
      <div className="modal-form">
        <div className="heading-actions training-views">
          <button type="button" className="btn" aria-pressed={view === 'people'} onClick={() => setView('people')}>{t('People')}</button>
          <button type="button" className="btn" aria-pressed={view === 'groups'} onClick={() => setView('groups')}>{t('Groups')}</button>
        </div>
        {view === 'people'
          ? <PeoplePicker selected={value.people} onChange={ids => pick('people', ids)}
            onPerson={person => { ticked.current = { kind: 'people', id: person.id, name: person.display_name || person.username }; }} />
          : <GroupPicker selected={value.groups} onChange={ids => pick('groups', ids)}
            onGroup={group => { ticked.current = { kind: 'groups', id: group.id, name: group.name }; }} />}
        <div className="modal-footer"><button type="button" className="btn primary" onClick={closePicker}>{t('Done')}</button></div>
      </div>
    </Modal>}
  </div>;
}
