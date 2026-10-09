import { useStaff } from "@/shared/lib/staff-store";
import {
  PERMISSIONS,
  ROLES,
  roleLabel,
  type Permission,
  type PermissionCategory,
} from "@/shared/lib/permissions";
import { Guard, PageHeader, RoleBadge, Panel } from "@/shared/components/primitives";
import { Switch } from "@/shared/ui/switch";

export function RolesPage() {
  return (
    <Guard perm="roles.manage">
      <Inner />
    </Guard>
  );
}

const CATS: PermissionCategory[] = [
  "Users",
  "Wallet",
  "Withdrawals",
  "Mining",
  "Support",
  "Staff",
  "System",
  "Logs",
];

function Inner() {
  const { matrix, togglePermission, act } = useStaff();
  const perms = Object.entries(PERMISSIONS) as [Permission, (typeof PERMISSIONS)[Permission]][];

  return (
    <div>
      <PageHeader
        title="Roles & permissions"
        subtitle="Owner only · toggling updates the sidebar and guards live (mock)"
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {ROLES.map((r) => (
          <div key={r.id} className="surface flex items-center gap-2 px-4 py-2.5">
            <RoleBadge role={r.id} />
            <span className="text-xs text-muted-foreground">
              L{r.rank} · {r.summary}
            </span>
          </div>
        ))}
      </div>
      {CATS.map((cat) => {
        const rows = perms.filter(([, d]) => d.category === cat);
        if (!rows.length) return null;
        return (
          <Panel key={cat} title={cat} className="mb-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-semibold">Permission</th>
                    {ROLES.map((r) => (
                      <th key={r.id} className="px-2 py-2 text-center font-semibold">
                        {roleLabel(r.id)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([p, def]) => (
                    <tr key={p} className="border-b last:border-0">
                      <td className="py-2.5 pr-4 font-medium">{def.label}</td>
                      {ROLES.map((r) => (
                        <td key={r.id} className="px-2 py-2 text-center">
                          <Switch
                            checked={r.id === "owner" ? true : matrix[r.id][p]}
                            disabled={r.id === "owner"}
                            onCheckedChange={() => {
                              togglePermission(r.id, p);
                              act(`Toggled permission ${def.label}`, `${roleLabel(r.id)}`);
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
