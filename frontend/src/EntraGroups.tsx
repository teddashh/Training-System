import { useEffect, useState } from 'react';
import { api } from './api';
import { t, useLocale } from './i18n';
import { ErrorBox, Modal } from './ui';
import type { TrainingGroup } from './Groups';

export type EntraCounts = { entra_members: number; with_account: number; without_account: number; to_add: number; to_remove: number; current_members: number };
export type EntraResult = { status: 'ok' | 'error' | 'guard'; code: string | null; counts: Partial<EntraCounts>; at: string };
type EntraGroup = { id: string; name: string; description: string; kind: string };
type Preview = { counts: EntraCounts; entra: EntraGroup; name: string; preview: string };
const labels: Record<keyof EntraCounts, string> = {
  entra_members: 'Entra user members', with_account: 'With a Training account', without_account: 'Without a Training account',
  to_add: 'Members to add', to_remove: 'Current members to remove', current_members: 'Current members',
};
const countOrder: (keyof EntraCounts)[] = ['entra_members', 'with_account', 'without_account', 'current_members', 'to_add', 'to_remove'];
export function EntraCountsView({ counts, applied = false }: { counts: Partial<EntraCounts>; applied?: boolean }) {
  const displayLabels = applied ? { ...labels, to_add: 'Members added', to_remove: 'Members removed', current_members: 'Members before sync' } : labels;
  return <dl className="directory-counts entra-counts">{countOrder.filter(key => counts[key] !== undefined).map(key => <div key={key}><dt>{t(displayLabels[key])}</dt><dd><strong>{counts[key]}</strong></dd></div>)}</dl>;
}
export function EntraBadge({ group }: { group: TrainingGroup }) {
  if (!group.entra_group_id) return null;
  return <><span className="badge blue">Entra</span>{group.entra_sync_result?.status === 'error' && <span className="badge amber">{t('Sync failed')}</span>}{group.entra_sync_result?.status === 'guard' && <span className="badge amber">{t('Sync needs review')}</span>}</>;
}
const errors: Record<string, string> = {
  group_permission: 'The directory app lacks the Microsoft Graph application permission GroupMember.Read.All. Ask the tenant owner to approve admin consent.',
  group_missing: 'The Entra group no longer exists or cannot be read; members were not changed.',
};
export function EntraStatus({ group }: { group: TrainingGroup }) {
  const result = group.entra_sync_result;
  return <section className="panel directory-sync">
    <p className="entra-status-line"><EntraBadge group={group} />{' '}{t('Members come from the Entra group {name}. Last synced {time}.', { name: group.entra_display_name || '', time: group.entra_last_synced_at ? new Date(group.entra_last_synced_at).toLocaleString() : t('Never synced') })}</p>
    {result?.status === 'error' && <p role="alert">{t(errors[result.code || ''] || 'Entra group sync failed. Members were not changed. Preview and try again.')}</p>}
    {result?.status === 'guard' && <p role="alert">{t('Automatic sync would remove more than half the members. No members were changed. Review with Sync now.')}</p>}
    {result && <EntraCountsView counts={result.counts} applied={result.status === 'ok'} />}
  </section>;
}

export function EntraDialog({ group, onClose, onSaved }: { group?: TrainingGroup; onClose: () => void; onSaved: () => void }) {
  useLocale();
  const sync = !!group?.entra_group_id;
  const [search, setSearch] = useState(''), [results, setResults] = useState<EntraGroup[]>([]), [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<EntraGroup | null>(null), [name, setName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (sync || search.trim().length < 2) { setResults([]); setSearching(false); return; }
    let active = true; setSearching(true); setError(''); setResults([]);
    const timer = setTimeout(() => {
      api<{ results: EntraGroup[] }>(`groups/entra-search/?${new URLSearchParams({ search })}`)
        .then(data => { if (active) setResults(data.results); })
        .catch(e => { if (active) setError(e.message); })
        .finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [search, sync]);
  async function run(apply: boolean) {
    setBusy(true); setError('');
    try {
      const path = group ? `groups/${group.id}/${sync ? 'entra-sync' : 'entra-link'}/` : 'groups/entra-create/';
      const result = await api<Preview>(path, 'POST', { ...(selected ? { entra_id: selected.id } : {}), ...(!group ? { name } : {}), apply, preview: preview?.preview });
      if (apply) { onSaved(); onClose(); } else setPreview(result);
    } catch (e) { setError((e as Error).message); setPreview(null); } finally { setBusy(false); }
  }
  return <Modal className="management-dialog" title={sync ? t('Sync now') : group ? t('Link Entra group') : t('Add Entra group')} onClose={() => { if (!busy) onClose(); }}>
    <div className="modal-form">
      {!sync && <>
        <label>{t('Search Entra groups or paste an object ID')}<input disabled={busy} value={search} onChange={e => { setSearch(e.target.value); setSelected(null); setPreview(null); }} /></label>
        {search.trim().length < 2 && <p className="muted">{t('Enter at least 2 characters.')}</p>}
        {searching && <p role="status">{t('Loading…')}</p>}
        {!searching && search.trim().length >= 2 && !results.length && !error && <p>{t('No groups match this search.')}</p>}
        {!!results.length && <fieldset className="audience-options entra-search-results" disabled={busy}>
          <legend>{t('Select an Entra group.')}</legend>
          {results.map(item => <label className="checkbox" key={item.id}><input type="radio" name="entra-group" checked={selected?.id === item.id} onChange={() => { setSelected(item); setName(item.name.slice(0, 100)); setPreview(null); }} /><span><strong>{item.name}</strong> · {t(item.kind)}<small className="entra-description" title={item.description}>{item.description}</small></span></label>)}
        </fieldset>}
        {results.length === 20 && <p className="muted">{t('Showing the first 20 matches. Type more of the name to narrow the list.')}</p>}
        {selected && !group && <label>{t('Group name')}<input maxLength={100} disabled={busy} value={name} onChange={e => { setName(e.target.value); setPreview(null); }} /></label>}
      </>}
      {sync && <p><strong>{group?.entra_display_name}</strong></p>}
      <p>{t('Only existing Training accounts are matched. People without an account are counted only. Existing assignments and learning records stay unchanged.')}</p>
      {preview && <div aria-live="polite"><EntraCountsView counts={preview.counts} /><p>{t('The group will mirror Entra. Current members outside this Entra group will be removed.')}</p></div>}
      <ErrorBox message={error} />
      <div className="modal-footer"><button className="btn" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy || !sync && (!selected || !group && !name.trim())} onClick={() => run(!!preview)}>{busy ? t('Loading…') : preview ? sync ? t('Apply sync') : group ? t('Link Entra group') : t('Add Entra group') : t('Preview membership')}</button>
      </div>
    </div>
  </Modal>;
}

export function UnlinkEntra({ group, onClose, onSaved }: { group: TrainingGroup; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function unlink() {
    setBusy(true); setError('');
    try { await api(`groups/${group.id}/entra-unlink/`, 'POST'); onSaved(); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal className="management-dialog" title={t('Unlink Entra group')} onClose={() => { if (!busy) onClose(); }}><div className="modal-form">
    <p>{t('Unlink this Entra group? Current members stay and become manually managed.')}</p><ErrorBox message={error} />
    <div className="modal-footer"><button className="btn" disabled={busy} onClick={onClose}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={unlink}>{t('Unlink')}</button></div>
  </div></Modal>;
}
