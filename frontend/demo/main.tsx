import './catalogue';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { flushSync } from 'react-dom';
import App from '../src/App';
import { t } from '../src/i18n';
import { appPath, routePath } from '../src/paths';
import '../src/style.css';
import DemoBar from './DemoBar';
import { installApi } from './api';
import { createState } from './state';
import { restoredRoute } from './deepLink';

let storage: Storage | undefined;
try { storage = sessionStorage; } catch { /* The demo still works in memory. */ }
const state = createState(storage);
installApi(state, { appPath, t });
const route = restoredRoute(window.location.search, import.meta.env.BASE_URL, window.location.origin);
if (route) history.replaceState({}, '', route);
window.addEventListener('vite:preloadError', event => {
  if (routePath().startsWith('/attempt/')) return;
  try {
    const key = 'training-chunk-reload', now = Date.now();
    const previous = Number(sessionStorage.getItem(key));
    if (previous && now - previous < 5 * 60 * 1000) return;
    sessionStorage.setItem(key, String(now));
  } catch { return; }
  event.preventDefault(); window.location.reload();
});
flushSync(() => ReactDOM.createRoot(document.getElementById('demo-bar')!).render(<DemoBar state={state} />));
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
