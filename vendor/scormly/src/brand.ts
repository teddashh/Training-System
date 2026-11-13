/** Deployment identity and the portable company theme. */
import data from '@brand/brand.json'
import logo from '@brand/logo.svg'
import horizontalLogo from '@brand/logo-horizontal.svg'
import css from '@brand/tokens.css?raw'
const tokens = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2]]))
export const brand = { ...data, logo, horizontalLogo, uploadedLogo: false }
export const companyThemeTokens = {
  brand: tokens['brand-pink'], brandLight: tokens['brand-cyan'], brandDark: tokens['brand-burgundy'],
  radiusBtn: tokens['radius-control'], radiusInteractive: tokens['radius-panel'],
}
export function resolveThemeAlias(theme: string): string {
  return (brand.studio_theme_aliases as string[]).includes(theme) ? 'company' : theme
}

export function setOrganization(org?: { name: string; title: string; logo_url: string | null }) {
  if (!org) return
  Object.assign(brand, { uploadedLogo: !!org.logo_url, organization: org.name, title: org.title,
    logo: org.logo_url || logo, horizontalLogo: org.logo_url || horizontalLogo,
    logo_alt: org.logo_url ? org.name : data.logo_alt })
}
