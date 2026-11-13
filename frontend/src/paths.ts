// Vite's base is shared by assets, navigation and API/download links.
const base = import.meta.env.BASE_URL.replace(/\/$/, "");

export function appPath(path = "/") {
  return base + "/" + path.replace(/^\/+/, "");
}

export function routePath(pathname = window.location.pathname) {
  if (pathname === base) return "/";
  return base && pathname.startsWith(base + "/")
    ? pathname.slice(base.length)
    : pathname;
}
