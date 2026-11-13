import { useEffect, useState } from 'react';
import { api } from './api';
import { t, useLocale } from './i18n';
import { ErrorBox, Modal, Spinner } from './ui';
import { brand } from './brand';

type Provider = {
  provider: string; server: boolean; configured: boolean; secret_required?: boolean;
  tenant_id?: string; client_id?: string; client_secret_set?: boolean;
  domains?: string[]; from_email?: string; host?: string; port?: number;
  security?: string; username?: string; password_set?: boolean;
  entra_redirect_uri?: string; google_redirect_uri?: string;
};
type Settings = {
  organization: { name: string; organization_name: string; title: string; logo_url: string | null; languages: string[]; languages_server: boolean };
  sign_in: Provider; email: Provider;
};
type Section = keyof Settings;
const sectionLabels = { organization: 'Organization', sign_in: 'Sign-in', email: 'Email' };
const providers: Record<string, string> = { none: 'None', entra: 'Microsoft Entra ID', google: 'Google Workspace', off: 'Off', smtp: 'SMTP server', graph: 'Microsoft 365 mailbox' };

export default function OrganizationSettings() {
  useLocale();
  const [data, setData] = useState<Settings | null>(null), [section, setSection] = useState<Section | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [languages, setLanguages] = useState<string[]>([]), [logo, setLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { void api<Settings>('settings/').then(setData).catch(e => setError(e.message)); }, []);
  function open(next: Section) {
    if (!data) return;
    const current = next === 'organization' ? {} : data[next];
    setFields(Object.fromEntries(Object.entries(current).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value ?? '')])));
    setFields(previous => ({...previous, organization_name: data.organization.organization_name, client_secret: '', password: ''}));
    setLanguages(data.organization.languages); setLogo(null); setRemoveLogo(false); setError(''); setNotice(''); setSection(next);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !section) return;
    setBusy(true); setError('');
    try {
      let body: Record<string, unknown>;
      if (section === 'organization') {
        body = {organization_name: fields.organization_name};
        if (!data.organization.languages_server) body.languages = languages;
      } else {
        body = { ...fields };
        if (section === 'sign_in') body.domains = (fields.domains || '').split(',').map(v => v.trim()).filter(Boolean);
        if (section === 'email') { body.port = Number(fields.port || 587); body.security = fields.security || 'starttls'; }
      }
      let updated = await api<Settings>(`settings/${section}/`, 'PUT', body);
      if (section === 'organization' && (logo || removeLogo)) {
        const upload = new FormData();
        if (logo) upload.append('logo', logo);
        updated = await api<Settings>('settings/logo/', logo ? 'POST' : 'DELETE', logo ? upload : undefined);
      }
      setData(updated); setSection(null);
      window.dispatchEvent(new Event('training-settings'));
    } catch (e) { setError((e as Error).message); window.dispatchEvent(new Event('training-settings')); }
    finally { setBusy(false); }
  }
  function field(key: string, label: string, type = 'text', required = true) {
    const saved = section && section !== 'organization' && provider === data?.[section].provider && !!data?.[section][key === 'password' ? 'password_set' : 'client_secret_set'];
    return <label key={key}>{t(label)}<input type={type} value={fields[key] || ''} required={required && type !== 'password'}
      maxLength={key === 'organization_name' ? 80 : undefined} autoComplete={type === 'password' ? 'new-password' : 'off'}
      placeholder={type === 'password' && saved ? t('Saved') : key === 'port' ? '587' : key === 'organization_name' ? data?.organization.name : undefined}
      onChange={e => setFields({...fields, [key]: e.target.value})} /></label>;
  }
  const provider = fields.provider || (section === 'email' ? 'off' : 'none');
  const redirect = data && (provider === 'google' ? data.sign_in.google_redirect_uri : data.sign_in.entra_redirect_uri);
  return <>
    {!section && <ErrorBox message={error} />}
    {!data && !error && <Spinner />}
    {data && (['organization', 'sign_in', 'email'] as const).map(key => {
      const locked = key !== 'organization' && data[key].server;
      const current = key === 'organization' ? null : data[key];
      return <section className="panel settings-section" key={key} aria-label={t(sectionLabels[key])}>
        <div className="management-section-heading"><h2>{t(sectionLabels[key])}</h2>
          {!locked && <button className="btn small" onClick={() => open(key)}>{t('Change')}</button>}
        </div>
        <div className="settings-body"><div className="settings-state">{key === 'organization' ? <><img src={data.organization.logo_url || brand.logo} alt={data.organization.name}/><span>{data.organization.name}</span></> :
          <span>{t(providers[current!.provider])}{current!.from_email ? ` · ${current!.from_email}` : ''}</span>}
          {locked && <span className="muted">{t('Set by the server')}</span>}
        </div>
        {locked && current && <div className="settings-facts">{current.tenant_id && <span>{t('Tenant ID')}: {current.tenant_id}</span>}{current.client_id && <span>{t('Client ID')}: {current.client_id}</span>}{current.domains?.length ? <span>{t('Workspace domains')}: {current.domains.join(', ')}</span> : null}{current.host && current.provider === 'smtp' && <span>{t('Host')}: {current.host}</span>}</div>}
        {current && current.provider !== 'none' && current.provider !== 'off' && !current.configured && <p className="muted">{t('Not configured')}</p>}
        {key === 'email' && data.email.provider !== 'off' && <button className="text-btn" disabled={busy} onClick={async () => {
          setBusy(true); setError(''); setNotice('');
          try { await api('email/test/', 'POST', {}); setNotice(t('Test email accepted. Check your inbox.')); }
          catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}>{t('Send test email to me')}</button>}
        </div>
      </section>;
    })}
    {notice && <p role="status" className="notice">{notice}</p>}
    {section && data && <Modal className="management-dialog" title={t(sectionLabels[section])} onClose={() => {if (!busy) setSection(null);}}>
      <form className="modal-form settings-form" onSubmit={save}>
        {section === 'organization' ? <>
          {field('organization_name', 'Organization name', 'text', false)}
          <label>{t('Logo')}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {setLogo(e.target.files?.[0] || null); setRemoveLogo(false);}} /></label>
          {(data.organization.logo_url || logo) && <button type="button" className="text-btn" onClick={() => {setRemoveLogo(true); setLogo(null);}} disabled={removeLogo}>{t('Remove logo')}</button>}
          <fieldset disabled={data.organization.languages_server}><legend>{t('Interface languages')}</legend>
            {data.organization.languages_server && <p className="muted">{t('Set by the server')}</p>}
            {['en', 'zh-TW', 'es'].filter(code => !data.organization.languages_server || languages.includes(code)).map((code) => <label className="check checkbox-label" key={code}>
              <input type="checkbox" checked={languages.includes(code)} onChange={e => setLanguages(e.target.checked ? [...languages, code] : languages.filter(value => value !== code))}/>
              {t(({en: 'English', 'zh-TW': 'Traditional Chinese', es: 'Spanish'} as Record<string, string>)[code])}
            </label>)}
          </fieldset>
        </> : <>
          <label>{t('Provider')}<select aria-label={t('Provider')} value={provider} onChange={e => setFields({...fields, provider: e.target.value})}>
            {(section === 'sign_in' ? ['none', 'entra', 'google'] : ['off', 'smtp', 'graph']).map(value => <option key={value} value={value}>{t(providers[value])}</option>)}
          </select></label>
          {data[section].secret_required && provider === data[section].provider && <p className="notice">{t(provider === 'smtp' ? 'Enter the password again.' : 'Enter the client secret again.')}</p>}
          {['entra', 'google', 'graph'].includes(provider) && <>
            {provider !== 'google' && field('tenant_id', 'Tenant ID')}
            {field('client_id', 'Client ID')}{field('client_secret', 'Client secret', 'password')}
          </>}
          {provider === 'google' && field('domains', 'Workspace domains')}
          {section === 'sign_in' && provider !== 'none' && <div className="settings-redirect">
            <label htmlFor="settings-redirect-uri">{t('Redirect URI')}</label>
            <div className="settings-copy"><input id="settings-redirect-uri" readOnly value={redirect || ''}/><button type="button" className="btn small" onClick={async () => {
              try { await navigator.clipboard.writeText(redirect || ''); setNotice(t('Copied')); }
              catch { setError(t('Copy the redirect URI from the field.')); }
            }}>{t('Copy')}</button></div>
          </div>}
          {provider === 'smtp' && <>
            {field('host', 'Host')}{field('port', 'Port', 'number', false)}
            <label>{t('Connection security')}<select aria-label={t('Connection security')} value={fields.security || 'starttls'} onChange={e => setFields({...fields, security: e.target.value})}>
              <option value="starttls">{t('STARTTLS')}</option><option value="ssl">{t('SSL')}</option><option value="none">{t('None')}</option>
            </select></label>
            {field('username', 'Username', 'text', false)}{field('password', 'Password', 'password', false)}
          </>}
          {section === 'email' && provider !== 'off' && field('from_email', 'From address', 'email')}
        </>}
        <ErrorBox message={error}/>
        {notice && <p role="status">{notice}</p>}
        <div className="modal-footer"><button type="button" className="btn" disabled={busy} onClick={() => setSection(null)}>{t('Cancel')}</button><button className="btn primary" disabled={busy}>{t(busy ? 'Saving…' : 'Save')}</button></div>
      </form>
    </Modal>}
  </>;
}
