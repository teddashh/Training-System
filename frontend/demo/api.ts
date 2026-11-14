import { createRouter, notAvailable } from './router.ts';
import type { DemoState } from './state.ts';

export const unavailableEvent = 'training-demo-unavailable';
/** Kept independent of React so Request objects, bodies and pass-through can be tested without a server. */
export function demoFetch(original: typeof fetch, route: ReturnType<typeof createRouter>, location: string, prefix: string): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location);
    if (url.origin !== new URL(location).origin || !url.pathname.startsWith(prefix)) return original(input, init);
    const request = new Request(input instanceof Request ? input : url, init);
    if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    let body: Record<string, unknown> = {};
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (request.headers.get('Content-Type')?.includes('application/json')) body = await request.json();
      else if (request.headers.get('Content-Type')?.includes('multipart/form-data')) body = Object.fromEntries(await request.formData());
    }
    // downloadFile receives a localized normal API error, never a fake successful download.
    return route(request.method, url.pathname.slice(prefix.length), url.searchParams, body);
  };
}
export function blockedLink(link: Pick<HTMLAnchorElement, 'href' | 'hasAttribute'>, location: string, apiPrefix: string, studioPrefix: string) {
  const url = new URL(link.href, location);
  return link.hasAttribute('download') || url.origin === new URL(location).origin && (url.pathname.startsWith(apiPrefix) || url.pathname.startsWith(studioPrefix));
}
export function installApi(state: DemoState, { appPath, t }: { appPath: (path: string) => string; t: (key: string) => string }) {
  const route = createRouter(state, { appPath, t, origin: window.location.origin });
  const prefix = appPath('/api/');
  window.fetch = demoFetch(window.fetch.bind(window), route, window.location.href, prefix);
  const unavailable = () => window.dispatchEvent(new CustomEvent(unavailableEvent, { detail: t(notAvailable) }));
  const blocked = (link: HTMLAnchorElement) => blockedLink(link, window.location.href, prefix, appPath('/studio/'));
  const intercept = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    if (link && blocked(link)) { event.preventDefault(); event.stopImmediatePropagation(); unavailable(); }
  };
  document.addEventListener('click', intercept, true);
  document.addEventListener('auxclick', intercept, true);
  // Calendar downloads use a detached anchor; capture listeners cannot see its click.
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (blocked(this)) unavailable(); else click.call(this); };
}
