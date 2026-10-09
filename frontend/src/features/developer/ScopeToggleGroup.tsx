import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/shared/i18n";
import { Switch } from "@/shared/ui/switch";

const defaultScopes = ["checkout:create", "payments:read"];
const scopeLabelKeys = {
  "checkout:create": "scopeLabels.checkout",
  "payments:read": "scopeLabels.payments",
  "refunds:create": "scopeLabels.refunds",
  "subscriptions:manage": "scopeLabels.subscriptions",
  "products:manage": "scopeLabels.products",
  "webhooks:manage": "scopeLabels.webhooks",
  "credentials:manage": "scopeLabels.credentials",
} as const;

export function ScopeToggleGroup({
  name,
  label,
  scopes,
  onValueChange,
}: {
  name: string;
  label: string;
  scopes: readonly string[];
  onValueChange?: () => void;
}) {
  const t = useT("developer");
  const [selected, setSelected] = useState<string[]>(defaultScopes);
  const groupRef = useRef<HTMLDivElement>(null);
  const id = useId().replaceAll(":", "");

  useEffect(() => {
    const form = groupRef.current?.closest("form");
    if (!form) return;
    const reset = () => setSelected(defaultScopes);
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, []);

  const toggle = (scope: string, checked: boolean) => {
    setSelected((current) =>
      checked ? [...current, scope] : current.filter((entry) => entry !== scope),
    );
    onValueChange?.();
  };

  return (
    <fieldset className="rounded-2xl border p-4">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <div ref={groupRef} className="grid gap-2 sm:grid-cols-2">
        {scopes.map((scope) => {
          const active = selected.includes(scope);
          const labelId = `${id}-${scope.replace(/[^a-z0-9-]/gi, "-")}`;
          const labelKey = scopeLabelKeys[scope as keyof typeof scopeLabelKeys];
          if (!labelKey) return null;

          return (
            <div
              key={scope}
              className="flex min-h-12 items-center justify-between gap-4 rounded-xl border bg-card px-4 py-2.5"
            >
              {active && <input type="hidden" name={name} value={scope} />}
              <span id={labelId} className="text-sm font-medium text-foreground">
                {t(labelKey)}
              </span>
              <Switch
                checked={active}
                onCheckedChange={(checked) => toggle(scope, checked)}
                aria-labelledby={labelId}
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
