export function reloadTarget(pathname: string, search: string, hash: string, base: string) {
  return pathname === base ? null : base + '?route=' + encodeURIComponent(pathname + search + hash);
}

export function reloadApp(
  location: Pick<Location, 'pathname' | 'search' | 'hash' | 'reload' | 'replace'> = window.location,
  base = import.meta.env ? import.meta.env.BASE_URL.replace(/\/$/, '') + '/' : '/',
) {
  const target = reloadTarget(location.pathname, location.search, location.hash, base);
  if (target === null) location.reload();
  else location.replace(target);
}
