import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/**
 * Console page frame: full-bleed shell, no outer margin — the sidebar sits
 * directly on the shell surface and the page itself on the white rounded
 * card under the topbar. Curves, sections, and color separation unchanged.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-backdrop min-h-screen">
      <div className="app-shell flex h-[calc(100vh/var(--ui-scale))] w-full overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col pr-3 pb-3">
          <Topbar />
          <main className="flex-1 overflow-y-auto rounded-[24px] bg-card px-8 py-8 shadow-[var(--shadow-soft)]">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
