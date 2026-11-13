import { brandAlias, brandHtml } from '../../shared/brand/build'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// The company build supplies /training/studio/ (or /studio/ in root tests).
// This authenticated authoring workspace has no public marketing prerender.
export default defineConfig({
  base: '/',
  resolve: { alias: brandAlias },
  plugins: [brandHtml, react(), tailwindcss()],
})
