import { useEffect, useState } from 'react';
import { api } from './api';
import { t, useLocale } from './i18n';
import { Empty, ErrorBox, Modal } from './ui';
import { PeoplePagination, PeoplePicker, usePeoplePage } from './PeopleDirectory';
import { EntraBadge, EntraDialog, EntraStatus, UnlinkEntra } from './EntraGroups';
import type { EntraResult } from './EntraGroups';
import type { PeopleFilters } from './PeopleDirectory';

export type TrainingGroup = { id: number; name: string; description: string; member_count: number; active_member_count: number; entra_group_id: string | null; entra_display_name: string | null; entra_last_synced_at: string | null; entra_sync_result: EntraResult | null };
type GroupPage = { results: TrainingGroup[]; total: number };
function useGroups(search: string, page: number, manual = false) {
  const [data, setData] = useState<GroupPage>({ results: [], total: 0 }), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    const timer = setTimeout(() => {
      api<GroupPage>(`groups/?${new URLSearchParams({ search, page: String(page), manual: String(manual) })}`)
        .then(result => { if (active) setData(result); })
        .catch(e => { if (active) setError(e.message); })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [search, page, version, manual]);
  return { data, loading, error, reload: () => setVersion(v => v + 1) };
}

function GroupPagination({ page, total, loading, onPage }: { page: number; total: number; loading: boolean; onPage: (page: number) => void }) {
  return <div className="toolbar people-pagination">
    <span aria-live="polite">{t('Page {page} of {pages} · {total} groups', { page, pages: Math.max(1, Math.ceil(total / 50)), total })}</span>
    {total > 50 && <>
      <button type="button" className="btn" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>{t('Previous')}</button>
      <button type="button" className="btn" disabled={loading || page * 50 >= total} onClick={() => onPage(page + 1)}>{t('Next')}</button>
    </>}
  </div>;
}

export function GroupPicker({ selected, onChange, single = false, disabled = false, manual = false, onGroup }: { selected: number[]; onChange: (ids: number[]) => void; single?: boolean; disabled?: boolean; manual?: boolean; onGroup?: (group: TrainingGroup) => void }) {
  useLocale();
  const [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const { data, loading, error } = useGroups(search, page, manual);
  return <div className="group-picker">
    <input aria-label={t('Search groups')} placeholder={t('Search groups')} disabled={disabled} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
    <ErrorBox message={error} />
    <fieldset className="audience-options" disabled={disabled || loading}>
      <legend>{t('Selected groups')} ({selected.length})</legend>
      {data.results.map(group => <label className="checkbox" key={group.id}>
        <input type="checkbox" checked={selected.includes(group.id)} onChange={e => { onGroup?.(group); onChange(e.target.checked ? single ? [group.id] : [...selected, group.id] : selected.filter(id => id !== group.id)); }} />
        <span>{group.name} <EntraBadge group={group} /> · {t('{count} active members', { count: group.active_member_count })}</span>
      </label>)}
      {loading && <p>{t('Loading…')}</p>}
      {!loading && !data.results.length && <p>{t('No groups match this search.')}</p>}
    </fieldset>
    <button type="button" className="text-btn" disabled={disabled || !selected.length} onClick={() => onChange([])}>{t("Clear selection")}</button>
    <GroupPagination page={page} total={data.total} loading={loading || disabled} onPage={setPage} />
  </div>;
}

export function AddToGroup({ userIds, onClose, onSaved }: { userIds: number[]; onClose: () => void; onSaved: () => void }) {
  const [selected, setSelected] = useState<number[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError('');
    try { await api(`groups/${selected[0]}/members/`, 'POST', { user_ids: userIds }); onSaved(); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal className="management-dialog" title={t('Add to group')} onClose={() => { if (!busy) onClose(); }}>
    <div className="modal-form">
      <p>{t('{count} people selected', { count: userIds.length })}</p>
      <GroupPicker selected={selected} onChange={setSelected} single manual disabled={busy} />
      <ErrorBox message={error} />
      <div className="modal-footer"><button className="btn" disabled={busy} onClick={onClose}>{t('Cancel')}</button><button className="btn primary" disabled={busy || !selected.length || !userIds.length || userIds.length > 1000} onClick={save}>{t('Add to group')}</button></div>
    </div>
  </Modal>;
}

function GroupEditor({ group, onClose, onSaved }: { group?: TrainingGroup; onClose: () => void; onSaved: (group: TrainingGroup) => void }) {
  const [name, setName] = useState(group?.name || ''), [description, setDescription] = useState(group?.description || '');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { onSaved(await api<TrainingGroup>(group ? `groups/${group.id}/` : 'groups/', group ? 'PATCH' : 'POST', { name, description })); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal className="management-dialog" title={group ? t('Edit group') : t('Create group')} onClose={() => { if (!busy) onClose(); }}>
    <form className="modal-form" onSubmit={save}>
      <label>{t('Group name')}<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>{t('Description')}<textarea maxLength={2000} rows={3} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <ErrorBox message={error} />
      <div className="modal-footer"><button type="button" className="btn" disabled={busy} onClick={onClose}>{t('Cancel')}</button><button className="btn primary" disabled={busy}>{t('Save')}</button></div>
    </form>
  </Modal>;
}

type MatchingPreview = { matching: number; to_add: number; preview: string };
function AddPeople({ group, onClose, onSaved }: { group: TrainingGroup; onClose: () => void; onSaved: () => void }) {
  const [selected, setSelected] = useState<number[]>([]), [filters, setFilters] = useState<PeopleFilters>({});
  const [preview, setPreview] = useState<MatchingPreview | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function add(all: boolean) {
    setBusy(true); setError('');
    try {
      if (all) await api(`groups/${group.id}/matching-members/`, 'POST', { filters, apply: true, preview: preview?.preview });
      else await api(`groups/${group.id}/members/`, 'POST', { user_ids: selected });
      onSaved(); onClose();
    } catch (e) { setError((e as Error).message); if (all) setPreview(null); } finally { setBusy(false); }
  }
  async function count() {
    setBusy(true); setError('');
    try { setPreview(await api<MatchingPreview>(`groups/${group.id}/matching-members/`, 'POST', { filters })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal className="management-dialog" title={t('Add people')} onClose={() => { if (!busy) onClose(); }}>
    <div className="modal-form">
      <p><strong>{group.name}</strong></p><p className="muted">{t('Inactive people can remain in a group but cannot receive training through it.')}</p>
      <PeoplePicker path="users/" includeInactive selected={selected} onChange={setSelected} disabled={busy} maxSelected={1000} onFiltersChange={next => { setFilters(next); setPreview(null); }} />
      <button className="btn" disabled={busy} onClick={count}>{t('Count all matching people')}</button>
      {preview && <div className="notice"><p>{t('{matching} matching people; {adding} will be added. Existing members are kept.', { matching: preview.matching, adding: preview.to_add })}</p><button className="btn" disabled={busy || !preview.to_add} onClick={() => add(true)}>{t('Add all {count} matching', { count: preview.matching })}</button></div>}
      <ErrorBox message={error} />
      <div className="modal-footer"><button className="btn" disabled={busy} onClick={onClose}>{t('Cancel')}</button><button className="btn primary" disabled={busy || !selected.length} onClick={() => add(false)}>{t('Add selected people')}</button></div>
    </div>
  </Modal>;
}

function GroupDetail({ group, onBack, onEdit, onChanged }: { group: TrainingGroup; onBack: () => void; onEdit: () => void; onChanged: () => void }) {
  const [entra, setEntra] = useState(false), [unlinking, setUnlinking] = useState(false);
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<number[]>([]), [removing, setRemoving] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const { data, loading, error: loadError, reload } = usePeoplePage(`groups/${group.id}/members/`, { search, page });
  const refresh = () => { reload(); onChanged(); };
  async function remove() {
    setBusy(true); setError('');
    try { await api(`groups/${group.id}/remove-members/`, 'POST', { user_ids: selected }); setSelected([]); setRemoving(false); refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <>
    <button className="text-btn" onClick={onBack}>{t('Back to groups')}</button>
    <div className="page-heading"><div><h1>{group.name}</h1></div><div className="heading-actions"><button className="btn" onClick={onEdit}>{t('Edit group')}</button>{!group.entra_group_id && <button className="btn primary" onClick={() => setAdding(true)}>{t('Add people')}</button>}<button className="btn" onClick={() => setEntra(true)}>{t(group.entra_group_id ? 'Sync now' : 'Link Entra group')}</button>{group.entra_group_id && <button className="btn" onClick={() => setUnlinking(true)}>{t('Unlink')}</button>}</div></div>
    {group.entra_group_id && <EntraStatus group={group} />}
    <div className="toolbar people-toolbar"><input aria-label={t('Search members')} placeholder={t('Search members')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />{!group.entra_group_id && <><span>{t('{count} people selected', { count: selected.length })}</span><button className="btn" disabled={!selected.length} onClick={() => setRemoving(true)}>{t('Remove selected members')}</button><button className="text-btn" disabled={!selected.length} onClick={() => setSelected([])}>{t('Clear selection')}</button></>}</div>
    <ErrorBox message={error || loadError} />
    {loading && <p role="status">{t('Loading…')}</p>}
    <div className="panel table-panel people-table"><table><thead><tr><th>{t('Person')}</th><th>{t('Department')}</th><th>{t('Status')}</th></tr></thead><tbody>{data.results.map(person => <tr key={person.id}>
      <td><label className="checkbox">{!group.entra_group_id && <input type="checkbox" disabled={loading || selected.length >= 1000 && !selected.includes(person.id)} checked={selected.includes(person.id)} onChange={e => setSelected(e.target.checked ? [...selected, person.id] : selected.filter(id => id !== person.id))} />}<span><strong>{person.display_name || person.username}</strong><small className="group-person-email">{person.email}</small></span></label></td>
      <td data-label={t('Department')}>{person.department || '—'}</td><td data-label={t('Status')}>{person.is_active ? t('Active') : t('Disabled')}</td>
    </tr>)}</tbody></table>{!loading && !data.total && <Empty title={t('No people match these filters.')} />}</div>
    <PeoplePagination page={page} total={data.total} loading={loading} onPage={setPage} />
    {entra && <EntraDialog group={group} onClose={() => setEntra(false)} onSaved={refresh} />}
    {unlinking && <UnlinkEntra group={group} onClose={() => setUnlinking(false)} onSaved={refresh} />}
    {adding && <AddPeople group={group} onClose={() => setAdding(false)} onSaved={refresh} />}
    {removing && <Modal className="management-dialog" title={t('Remove selected members')} onClose={() => { if (!busy) setRemoving(false); }}><div className="modal-form"><p>{t('Remove {count} people from this group? Existing assignments and records are kept.', { count: selected.length })}</p><ErrorBox message={error} /><div className="modal-footer"><button className="btn" disabled={busy} onClick={() => setRemoving(false)}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={remove}>{t('Remove')}</button></div></div></Modal>}
  </>;
}

export function GroupsView() {
  useLocale();
  const [entra, setEntra] = useState(false);
  const [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const { data, loading, error: loadError, reload } = useGroups(search, page);
  const [opened, setOpened] = useState<TrainingGroup | null>(null), [editing, setEditing] = useState<TrainingGroup | null>(null), [creating, setCreating] = useState(false), [deleting, setDeleting] = useState<TrainingGroup | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true); setError('');
    try { await api(`groups/${deleting!.id}/`, 'DELETE'); setDeleting(null); reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function refreshDetail() {
    reload();
    if (opened) api<TrainingGroup>(`groups/${opened.id}/`).then(setOpened).catch(e => setError(e.message));
  }
  return <div className="training-groups">
    {opened ? <GroupDetail group={opened} onBack={() => setOpened(null)} onEdit={() => setEditing(opened)} onChanged={refreshDetail} /> : <>
      <div className="page-heading"><div><h1>{t('Groups')}</h1></div><div className="heading-actions"><button className="btn" onClick={() => setEntra(true)}>{t('Add Entra group')}</button><button className="btn primary" onClick={() => setCreating(true)}>{t('Create group')}</button></div></div>
      <div className="toolbar"><input aria-label={t('Search groups')} placeholder={t('Search groups')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
      {loading && <p role="status">{t('Loading…')}</p>}
      <div className="panel table-panel people-table"><table><thead><tr><th>{t('Group name')}</th><th>{t('Members')}</th><th>{t('Actions')}</th></tr></thead><tbody>{data.results.map(group => <tr key={group.id}>
        <td><button className="text-btn" onClick={() => setOpened(group)}>{group.name}</button> <EntraBadge group={group} /><p className="muted">{group.description}</p></td><td data-label={t('Members')}>{group.member_count} · {t('{count} active members', { count: group.active_member_count })}</td>
        <td className="people-row-actions"><button className="text-btn" onClick={() => setEditing(group)}>{t('Edit group')}</button><button className="text-btn" onClick={() => { setError(''); setDeleting(group); }}>{t('Delete group')}</button></td>
      </tr>)}</tbody></table>{!loading && !data.total && <Empty title={t('No groups match this search.')} />}</div>
      <GroupPagination page={page} total={data.total} loading={loading} onPage={setPage} />
    </>}
    <ErrorBox message={error || loadError} />
    {entra && <EntraDialog onClose={() => setEntra(false)} onSaved={reload} />}
    {(creating || editing) && <GroupEditor group={editing || undefined} onClose={() => { setCreating(false); setEditing(null); }} onSaved={group => { reload(); if (opened?.id === group.id) setOpened(group); }} />}
    {deleting && <Modal className="management-dialog" title={t('Delete group')} onClose={() => { if (!busy) setDeleting(null); }}><div className="modal-form"><p><strong>{deleting.name}</strong></p><p>{t('Delete this group? People, existing assignments and training records are kept.')}</p><ErrorBox message={error} /><div className="modal-footer"><button className="btn" disabled={busy} onClick={() => setDeleting(null)}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={remove}>{t('Delete group')}</button></div></div></Modal>}
  </div>;
}

export function GroupFilter({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const [open, setOpen] = useState(false), [name, setName] = useState('');
  useEffect(() => {
    let active = true; setName('');
    if (value) api<TrainingGroup>(`groups/${value}/`).then(group => { if (active) setName(group.name); }).catch(() => {});
    return () => { active = false; };
  }, [value]);
  return <div className="group-filter"><span>{t('Group')}</span><button type="button" className="btn" onClick={() => setOpen(true)}>{value ? name || t('Selected groups') : t('All groups')}</button>
    {value && <button type="button" className="text-btn" onClick={() => onChange(null)}>{t('Clear group filter')}</button>}
    {open && <Modal className="management-dialog" title={t('Filter by group')} onClose={() => setOpen(false)}><div className="modal-form"><GroupPicker single selected={value ? [value] : []} onChange={ids => onChange(ids[0] || null)} /><div className="modal-footer"><button className="btn" onClick={() => setOpen(false)}>{t('Close')}</button></div></div></Modal>}
  </div>;
}
