import { brandAlias, brandHtml } from '../shared/brand/build'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  resolve: { alias: brandAlias },
  plugins: [brandHtml, react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/admin": "http://127.0.0.1:8000",
      "/static": "http://127.0.0.1:8000",
      "/studio": "http://127.0.0.1:5174",
    },
  },
});
