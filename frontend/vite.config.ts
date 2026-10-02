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
 *
 * The target follows the backend's own port: an explicit VITE_API_PROXY_TARGET wins, otherwise the
 * proxy uses LOUMA_API_PORT when it is set, falling back to the port `back-end/.env.development`
 * runs on. A proxy pointed at a port nothing listens on looks exactly like a broken API from the
 * browser, so the fallback here and the backend's own default port must stay the same (8000).
 */
const apiPort = process.env["LOUMA_API_PORT"] ?? "8000";
const apiTarget = process.env["VITE_API_PROXY_TARGET"] ?? `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Vercel (which sets VERCEL=1 at build time) needs the Nitro Vercel preset so the SSR
  // server compiles to Vercel Functions. Everywhere else the wrapper's own default applies:
  // the Lovable sandbox pins cloudflare-module regardless of this option.
  ...(process.env["VERCEL"] ? { nitro: { preset: "vercel" } } : {}),
  vite: {
    build: {
      // No source maps in any build: a `.js.map` file next to the bundle would publish the
      // original source to "View Source". Vite defaults to no maps; this pins it so a future
      // mode/preset can never re-enable them silently. Minification stays on for size/perf —
      // real obfuscation is deliberately not used (see reply: it costs perf and buys nothing
      // over minify + no-maps against DevTools, which cannot be blocked anyway).
      sourcemap: false,
    },
    server: {
      port: 3000,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: false },
      },
    },
    optimizeDeps: {
      // Every page pulls the Hugeicons barrel through the shell: left to per-module dev
      // transforms, that graph is hundreds of files the browser requests one by one on first
      // load, which is where the minutes-long first paint comes from. Pre-bundling collapses
      // each package into one cached esbuild chunk (node_modules/.vite) instead. Only ESM
      // packages with a single cheap entry belong here — never add a thousands-module barrel
      // like lucide-react, it would make the optimization step itself slower and the chunk
      // bigger.
      include: ["sonner", "qrcode.react", "@hugeicons/react", "@hugeicons/core-free-icons"],
    },
  },
});
