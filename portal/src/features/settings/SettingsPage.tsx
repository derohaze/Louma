import { useState } from "react";
import { useStaff } from "@/shared/lib/staff-store";
import { Guard, PageHeader, Panel, KV, StatusBadge } from "@/shared/components/primitives";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { toast } from "sonner";

export function SettingsPage() {
  return (
    <Guard perm="system.settings">
      <Inner />
    </Guard>
  );
}

function Inner() {
  const { act } = useStaff();
  const [eco, setEco] = useState({
    difficulty: "4.4",
    reward: "152",
    commission: "2.5",
    maxMiners: "250",
  });
  const [maint, setMaint] = useState(false);

  const save = (what: string) => {
    act(`Updated ${what}`, "platform configuration", JSON.stringify(eco));
    toast.success(`${what} saved (mock)`);
  };

  return (
    <div>
      <PageHeader
        title="System settings"
        subtitle="Owner only · platform configuration, economy, health (all mocked)"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Mining economy">
          <div className="grid gap-3">
            {(
              [
                ["difficulty", "Mining difficulty"],
                ["reward", "Block reward (LMP)"],
                ["commission", "Platform commission %"],
                ["maxMiners", "Max miners per room"],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="grid gap-1.5">
                <Label className="text-xs">{label}</Label>
                <Input
                  value={eco[k as keyof typeof eco]}
                  onChange={(e) => setEco({ ...eco, [k]: e.target.value })}
                  className="rounded-xl"
                />
              </div>
            ))}
            <Button className="rounded-xl" onClick={() => save("mining economy")}>
              Save economy
            </Button>
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel title="System health">
            <KV
              rows={[
                ["API servers", <StatusBadge key="a" status="Active" />],
                ["Database", <StatusBadge key="b" status="Active" />],
                ["Cache", <StatusBadge key="c" status="Degraded" />],
                ["Mining engine", <StatusBadge key="d" status="Mining" />],
              ]}
            />
          </Panel>
          <Panel title="Maintenance mode">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Blocks new sessions, keeps staff console online (mock).
              </p>
              <Switch
                checked={maint}
                onCheckedChange={(v) => {
                  setMaint(v);
                  act(v ? "Enabled maintenance" : "Disabled maintenance", "platform");
                }}
              />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
