import type { AuditEntry } from "@/shared/lib/mock-data";
import { RoleBadge } from "./primitives";

export function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  return (
    <ol className="relative space-y-4 pl-5">
      <span className="absolute left-[5px] top-1 bottom-1 w-px bg-border" />
      {entries.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-5 top-1.5 size-[11px] rounded-full border-2 border-card bg-primary ring-2 ring-primary-soft" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{e.staff}</span>
            <RoleBadge role={e.role} />
            <span className="text-muted-foreground">{e.action.toLowerCase()}</span>
          </div>
          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
            {e.target} · {e.time}
          </div>
        </li>
      ))}
    </ol>
  );
}
