import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { parseTheme, readThemeCookie, useTheme, THEME_COOKIE, type Theme } from "@/hooks/use-theme";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

/**
 * Kept in one place so the preload hint and the stylesheet below can never drift apart.
 * Loaded non-blocking (see RootShell): a render-blocking font stylesheet turns any slow or
 * hanging fonts.googleapis.com request into a blank page, which is exactly what a first visit
 * looks like on a flaky network. `display=swap` already accepts a font swap, so painting first
 * with system fonts changes nothing visually once the webfonts arrive.
 */
const FONT_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * The theme cookie exactly as the request carried it.
 *
 * A server function, because the reader it needs is a server-only module the build refuses to place
 * in the browser bundle — and its handler is the one part of this file that build moves out of that
 * bundle. The browser side is a name it never calls: the theme of a document was already decided by
 * the server that served it, and only a later navigation in the same tab needs to read it again.
 */
const readThemeFromRequest = createServerFn({ method: "GET" }).handler(async () => {
  const { getCookie } = await import("@tanstack/react-start/server");
  return parseTheme(getCookie(THEME_COOKIE) ?? null);
});

/**
 * The colour scheme the document is rendered with, read from the same cookie on both sides: from the
 * request on the server, and from `document.cookie` in the browser. It is the one input that cannot
 * be reconciled after the fact — `<html>`'s `class` and `color-scheme` — so the two sides have to
 * start from the same value rather than from a guess the other one is later asked to forgive.
 */
async function readDocumentTheme(): Promise<Theme> {
  if (typeof document !== "undefined") return readThemeCookie();
  return readThemeFromRequest();
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  /**
   * Read before anything renders, because it decides `<html>`'s attributes. Doing it in a route load
   * (rather than inside the shell) is what makes the value part of the dehydrated router state: the
   * first client render then uses the very value the server rendered with, instead of reading storage
   * again and disagreeing with it by one attribute.
   */
  beforeLoad: async () => ({ theme: await readDocumentTheme() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { title: "MyHome — Sales Workspace" },
      {
        name: "description",
        content: "Track sales conversations, leads, follow-ups, and team performance.",
      },
      { name: "author", content: "MyHome" },
      { property: "og:title", content: "MyHome — Sales Workspace" },
      {
        property: "og:description",
        content: "A focused workspace for sales activity and customer conversations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      // Preload only — the stylesheet itself is applied non-blocking in RootShell below, so a
      // slow fonts request never holds the first paint hostage.
      { rel: "preload", as: "style", href: FONT_CSS_URL },
      {
        rel: "icon",
        type: "image/png",
        sizes: "64x64",
        href: "/louma-favicon-64x64.png?v=2",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/louma-favicon-32x32.png?v=2",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/louma-favicon-16x16.png?v=2",
      },
      { rel: "apple-touch-icon", href: "/Louma_Brand_logos/png/louma-logo-128x128.png" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const { theme: documentTheme } = Route.useRouteContext();
  /**
   * The source of truth for these two attributes, on both sides of the wire. `documentTheme` is the
   * value the server rendered with while this is the first client render (so the markup matches),
   * and the store takes over from there — a switch flipped anywhere re-renders this element with the
   * new choice, and the cookie it also writes means the next document is rendered with it as well.
   *
   * There is deliberately no bootstrap script writing these attributes before hydration: the server
   * already rendered them, so the dark-mode visitor gets their theme from the first byte and there is
   * nothing left for React to disagree with.
   */
  const { theme } = useTheme(documentTheme);
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={theme === "dark" ? "dark" : undefined}
      style={{ colorScheme: theme }}
    >
      <head>
        <HeadContent />
        {/*
         * Extensions (Avast/AVG "bis_skin_checked" and similar) add attributes to
         * arbitrary <div>s after the server HTML is parsed but before React
         * hydrates. React then reports a hydration mismatch it will not patch.
         * Strip those attributes as early as possible and keep stripping until
         * hydration settles, so the DOM React hydrates matches the server HTML.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var A='bis_skin_checked';function c(r){try{if(!r)return;if(r.hasAttribute&&r.hasAttribute(A))r.removeAttribute(A);var e=r.querySelectorAll?r.querySelectorAll('['+A+']'):[];for(var i=0;i<e.length;i++)e[i].removeAttribute(A);}catch(_){}}c(document);try{var o=new MutationObserver(function(m){for(var i=0;i<m.length;i++){var x=m[i];if(x.type==='attributes'&&x.attributeName===A){if(x.target.removeAttribute)x.target.removeAttribute(A);}else if(x.addedNodes){for(var j=0;j<x.addedNodes.length;j++)c(x.addedNodes[j]);}}});o.observe(document.documentElement,{attributes:true,childList:true,subtree:true,attributeFilter:[A]});window.addEventListener('load',function(){setTimeout(function(){try{o.disconnect();}catch(_){}c(document);},3000);});}catch(_){}})();",
          }}
        />
        {/*
         * The font stylesheet loads with `media="print"` so it never blocks rendering, then flips
         * to `all` once fetched (standard non-blocking-CSS pattern). Without this, the browser
         * waits for fonts.googleapis.com before painting anything.
         */}
        <link
          rel="stylesheet"
          href={FONT_CSS_URL}
          media="print"
          onLoad={(event) => {
            event.currentTarget.media = "all";
          }}
        />
      </head>
      {/*
       * `suppressHydrationWarning`: browser extensions add attributes to <body> before React
       * hydrates (Chrome extensions add `cz-shortcut-listen`, Grammarly and others add their own).
       * React only sees that the attribute list differs, not why, so it warns about a mismatch it
       * will not patch up — once per page load. Nothing server-rendered depends on <body>'s
       * attributes, so the attribute-only mismatch is suppressed on this element alone.
       */}
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      {/*
       * One notification surface for the whole app, so a failed action (a logout that never reached
       * the API) can be reported where the customer is looking instead of being swallowed.
       */}
      <Toaster />
    </QueryClientProvider>
  );
}
