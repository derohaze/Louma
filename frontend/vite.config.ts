// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

/**
 * The customer app talks to the Louma API on the same origin (`/api/v1/...`), which keeps the
 * refresh cookie first-party and removes the need for CORS in development. The dev server proxies
 * those requests to the backend; set VITE_API_PROXY_TARGET when the API runs elsewhere.
 */
const apiTarget = process.env["VITE_API_PROXY_TARGET"] ?? "http://127.0.0.1:3001";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    server: {
      proxy: {
        "/api": { target: apiTarget, changeOrigin: false },
      },
    },
  },
});
