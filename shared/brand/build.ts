/** Build-time pack resolution shared by the platform and Studio. */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import messages from '../locales/messages.json'

export function loadBrand() {
  const name = process.env.BRAND ?? 'default'
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('BRAND must contain only lowercase letters, digits and hyphens.')
  const path = fileURLToPath(new URL(`./${name}/`, import.meta.url))
  for (const file of ['brand.json', 'tokens.css', 'logo.svg', 'logo-horizontal.svg']) {
    if (!existsSync(path + file)) throw new Error(`Unknown or incomplete BRAND pack: ${name} (${file})`)
  }
  const data = JSON.parse(readFileSync(path + 'brand.json', 'utf8'))
  const tokens = Object.fromEntries([...readFileSync(path + 'tokens.css', 'utf8').matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2]]))
  return { path, data, tokens }
}

export const brandPack = loadBrand()
export const brandAlias = { '@brand': brandPack.path.replace(/\/$/, '') }
let building = false
export const brandHtml = {
  name: 'deployment-brand',
  configResolved(config: { command: string }) { building = config.command === 'build' },
  buildStart(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: string }) => unknown }) {
    if (building) this.emitFile({ type: 'asset', fileName: 'favicon.svg', source: readFileSync(brandPack.path + 'logo.svg', 'utf8') })
  },
  transformIndexHtml: {
    order: 'pre' as const,
    handler(html: string) {
      const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const describe = (key: keyof typeof messages) => escape(messages[key].en.replace('{organization}', brandPack.data.organization))
      return html.split('__PLATFORM_TITLE__').join(describe('{organization} · Enterprise learning platform'))
        .split('__PLATFORM_DESCRIPTION__').join(describe('{organization} enterprise learning and assessment platform'))
        .split('__STUDIO_DESCRIPTION__').join(describe('{organization} course authoring workspace'))
        .split('__BRAND_COLOR__').join(escape(brandPack.tokens['brand-blue']))
        .split('__BRAND_ICON__').join(building ? '%BASE_URL%favicon.svg' : 'data:image/svg+xml,' + encodeURIComponent(readFileSync(brandPack.path + 'logo.svg', 'utf8')))
    },
  },
}
