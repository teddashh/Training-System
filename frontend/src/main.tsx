import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { routePath } from "./paths";
import "./style.css";
window.addEventListener('vite:preloadError', event => {
  if (routePath().startsWith('/attempt/')) return;
  try {
    const key = 'training-chunk-reload', now = Date.now();
    const previous = Number(sessionStorage.getItem(key));
    if (previous && now - previous < 5 * 60 * 1000) return;
    sessionStorage.setItem(key, String(now));
  } catch { return; } // Without persistent throttling, surface the error instead of risking a loop.
  event.preventDefault();
  window.location.reload();
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
