import { useEffect, useState } from 'react';
import { api } from './api';
import { t, useLocale } from './i18n';
import { ErrorBox, Modal } from './ui';
import type { User } from './types';

export type PeoplePage = { results: User[]; total: number; page: number; page_size: number; departments: string[] };

// Shared query hook for the People table and future group membership pickers.
export function usePeoplePage(path: string, params: Record<string, string | number>) {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<PeoplePage>({ results: [], total: 0, page: 1, page_size: 50, departments: [] });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      api<PeoplePage & { people?: User[] }>(`${path}?${query}`)
        .then(result => { if (active) setData({ ...result, results: result.results || result.people || [] }); })
        .catch(e => { if (active) setError(e.message); })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [path, query, version]);
  return { data, loading, error, reload: () => setVersion(v => v + 1) };
}

export function PeoplePagination({ page, total, pageSize = 50, loading, onPage }: {
  page: number; total: number; pageSize?: number; loading: boolean; onPage: (page: number) => void;
}) {
  return <div className="toolbar people-pagination" aria-label={t('People pages')}>
    <span aria-live="polite">{t('Page {page} of {pages} · {total} people', { page, pages: Math.max(1, Math.ceil(total / pageSize)), total })}</span>
    {total > pageSize && <>
      <button type="button" className="btn" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>{t('Previous')}</button>
      <button type="button" className="btn" disabled={loading || page * pageSize >= total} onClick={() => onPage(page + 1)}>{t('Next')}</button>
    </>}
  </div>;
}

export type PeopleFilters = { search?: string; department?: string; status?: string; signed_in?: string };
export function PeoplePicker({ selected, onChange, path = 'exams/audience-options/', includeInactive = false, onFiltersChange, disabled = false, maxSelected, onPerson }: {
  onPerson?: (person: User) => void;
  selected: number[]; onChange: (ids: number[]) => void; path?: string; includeInactive?: boolean;
  onFiltersChange?: (filters: PeopleFilters) => void; disabled?: boolean; maxSelected?: number;
}) {
  useLocale();
  const [filters, setFilters] = useState<PeopleFilters>({}), [page, setPage] = useState(1);
  const { data, loading, error } = usePeoplePage(path, { ...filters, page });
  function filter(key: keyof PeopleFilters, value: string) {
    const next = { ...filters, [key]: value };
    setFilters(next); setPage(1); onFiltersChange?.(next);
  }
  return <div className="people-picker">
    <div className="toolbar people-toolbar">
      <input disabled={disabled} aria-label={t('Search people')} placeholder={t('Search people')} value={filters.search || ''} onChange={e => filter('search', e.target.value)} />
      <label className="people-filter">{t('Department')}<select disabled={disabled} value={filters.department || ''} onChange={e => filter('department', e.target.value)}>
        <option value="">{t('All departments')}</option>{data.departments.map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      {includeInactive && <>
        <label className="people-filter">{t('Status')}<select disabled={disabled} value={filters.status || ''} onChange={e => filter('status', e.target.value)}>
          <option value="">{t('All statuses')}</option><option value="active">{t('Active')}</option><option value="inactive">{t('Disabled')}</option>
        </select></label>
        <label className="people-filter">{t('Sign-in')}<select disabled={disabled} value={filters.signed_in || ''} onChange={e => filter('signed_in', e.target.value)}>
          <option value="">{t('All people')}</option><option value="yes">{t('Signed in')}</option><option value="no">{t('Not signed in yet')}</option>
        </select></label>
      </>}
    </div>
    <ErrorBox message={error} />
    <fieldset className="audience-options" disabled={disabled || loading} aria-busy={loading}>
      <legend>{t('Selected people')} ({selected.length})</legend>
      {data.results.map(person => <label className="checkbox" key={person.id}>
        <input type="checkbox" disabled={!!maxSelected && selected.length >= maxSelected && !selected.includes(person.id)} checked={selected.includes(person.id)} onChange={e => { onPerson?.(person); onChange(e.target.checked ? [...selected, person.id] : selected.filter(id => id !== person.id)); }} />
        {person.display_name || person.username}{person.department && ` · ${person.department}`}{person.is_active === false && ` · ${t('Disabled')}`}
      </label>)}
      {loading && <p className="muted">{t('Loading…')}</p>}
      {!loading && !data.results.length && <p className="muted">{t('No people match these filters.')}</p>}
    </fieldset>
    <PeoplePagination page={page} total={data.total} loading={loading || disabled} onPage={setPage} />
  </div>;
}

type Counts = Record<string, number | Record<string, number>>;
type Summary = { groups?: Record<string, number>; counts: Counts; samples: Record<string, string[]>; mass_deactivation_guard: boolean; deactivation_candidates: number };
type Status = { configured: boolean; interval_hours: number; last_run: { at: string; actor: string | null; counts: Counts } | null };
const labels: Record<string, string> = {
  synced: 'Groups synced', failed: 'Groups failed', guarded: 'Groups needing review', deferred: 'Groups deferred',
  create: 'Create', update: 'Update', unchanged: 'Unchanged', deactivate: 'Deactivate', reactivate: 'Reactivate',
  conflicts: 'Conflicts', protected: 'Protected accounts', guest: 'Guests', disabled: 'Disabled',
  unlicensed: 'Unlicensed', no_email: 'No usable email', domain: 'Email domain excluded',
  mass_deactivation_guard: 'Mass-deactivation guard', deactivation_candidates: 'Deactivation candidates',
};
function SyncCounts({ counts, samples }: { counts: Counts; samples?: Record<string, string[]> }) {
  const rows = Object.entries(counts).flatMap(([key, value]) => typeof value === 'number' ? [[key, value] as const] : Object.entries(value));
  return <dl className="directory-counts">{rows.map(([key, value]) => <div key={key}>
    <dt>{t(labels[key] || key)}</dt><dd><strong>{value}</strong>{samples?.[key]?.length ? <small>{samples[key].join(', ')}</small> : null}</dd>
  </div>)}</dl>;
}

export function DirectorySync({ onApplied }: { onApplied: () => void }) {
  useLocale();
  const [status, setStatus] = useState<Status | null>(null), [preview, setPreview] = useState<Summary | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [applied, setApplied] = useState(false);
  const load = () => api<Status>('directory/status/').then(setStatus).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);
  async function run(apply: boolean) {
    setBusy(true); setError('');
    try {
      const result = await api<Summary>('directory/run/', 'POST', { apply });
      setPreview(result); setApplied(apply);
      if (apply) { onApplied(); await load(); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel directory-sync">
    <div className="toolbar">
      <button className="btn" disabled={busy || !status} onClick={() => run(false)}>{busy ? t('Loading…') : t('Sync from Microsoft Entra')}</button>
      <span className="muted">{status?.interval_hours ? t('Scheduled every {hours} hours', { hours: status.interval_hours }) : t('Manual sync only')}</span>
    </div>
    {status && !status.configured && <p>{t('Directory sync is not configured. Set the directory credentials and matching Entra tenant.')}</p>}
    {status?.last_run ? <details><summary>{t('Last directory sync')}: {new Date(status.last_run.at).toLocaleString()} · {status.last_run.actor || t('Command line / scheduler')}</summary><SyncCounts counts={status.last_run.counts} /></details> : <p className="muted">{t('No directory sync has been applied yet.')}</p>}
    {!preview && <ErrorBox message={error} />}
    {preview && <Modal className="management-dialog" title={applied ? t('Directory sync applied') : t('Directory sync preview')} onClose={() => { if (!busy) setPreview(null); }}>
      <div className="modal-form">
        {!applied && <p>{t('Apply fetches the directory again. Counts may change. Existing training records and permissions are preserved.')}</p>}
        {preview.mass_deactivation_guard && <p role="alert">{t('Mass-deactivation guard: no accounts will be deactivated. Review the listing; only an operator can override this from the command line.')} ({preview.deactivation_candidates})</p>}
        <SyncCounts counts={{ ...preview.counts, deactivation_candidates: preview.deactivation_candidates }} samples={preview.samples} />
        {preview.groups && <div><h3>{t('Linked Entra groups')}</h3><SyncCounts counts={preview.groups} /></div>}
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button className="btn" disabled={busy} onClick={() => setPreview(null)}>{applied ? t('Close') : t('Cancel')}</button>
          {!applied && <button className="btn primary" disabled={busy} onClick={() => run(true)}>{busy ? t('Loading…') : t('Apply directory sync')}</button>}
        </div>
      </div>
    </Modal>}
  </section>;
}
