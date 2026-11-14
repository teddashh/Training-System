import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t, useLocale } from '../src/i18n';
import { Modal } from '../src/ui';
import { appPath, routePath } from '../src/paths';
import { unavailableEvent } from './api';
import { reloadApp } from './reload';
import type { DemoState } from './state';
import './demo.css';

export default function DemoBar({ state }: { state: DemoState }) {
  const locale = useLocale();
  const initialLocale = useRef(locale);
  const userId = useSyncExternalStore(state.subscribe, () => state.data.userId);
  const [message, setMessage] = useState('');
  // Lists hold titles in the language they were fetched in, so a language change reloads the page.
  useEffect(() => {
    if (locale !== initialLocale.current) reloadApp();
  }, [locale]);
  useEffect(() => {
    const show = (event: Event) => setMessage((event as CustomEvent<string>).detail);
    window.addEventListener(unavailableEvent, show);
    return () => window.removeEventListener(unavailableEvent, show);
  }, []);
  return <>
    <div className="demo-bar" role="region" aria-label={t('Demo')}>
      <span>{t('Demo · synthetic data')}</span>
      <select aria-label={t('Demo view')} value={userId === null ? '' : state.data.view} onChange={event => { state.switchView(event.target.value as 'admin' | 'learner'); if (routePath().startsWith('/register')) reloadApp(); else window.location.assign(appPath('/')); }}>
        <option value="" disabled hidden>{t('Sign in')}</option>
        <option value="admin">{t('Administrator')}</option>
        <option value="learner">{t('Learner')}</option>
      </select>
      <button type="button" className="btn small" onClick={() => { state.reset(); try { sessionStorage.removeItem('training-registration'); } catch { /* Storage is optional. */ } window.location.assign(appPath('/')); }}>{t('Reset')}</button>
    </div>
    {message && <Modal title={t('Demo')} onClose={() => setMessage('')}><p className="demo-message" role="status">{message}</p></Modal>}
  </>;
}
