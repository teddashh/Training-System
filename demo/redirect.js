/* Loaded by the site's root 404.html; infer the mount from this script's URL. */
(() => {
  const source = document.currentScript?.src;
  if (!source) return;
  const base = new URL('.', source).pathname;
  const { pathname, search, hash } = window.location;
  if (pathname.startsWith(base) && pathname !== base && pathname !== base + 'index.html') {
    document.documentElement.hidden = true;
    window.location.replace(base + '?route=' + encodeURIComponent(pathname + search + hash));
  }
})();
