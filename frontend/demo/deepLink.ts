/** Only accept paths inside this mount; never turn a query parameter into an external redirect. */
export function restoredRoute(search: string, base: string, origin: string) {
  const route = new URLSearchParams(search).get('route');
  if (!route || !route.startsWith('/') || route.startsWith('//')) return null;
  try {
    const url = new URL(route, origin);
    if (url.origin !== origin || !url.pathname.startsWith(base)) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}
