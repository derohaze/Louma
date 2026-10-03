import { Link } from "@tanstack/react-router";
import { ChartIncreaseIcon, Timer01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/page";
import { useT } from "@/shared/i18n";
import { FactList, Panel } from "@/shared/ui/panels";
import { revealDelay } from "@/shared/ui/page";
import { MiningOrb } from "@/features/mining/live/MiningOrb";
import type { MiningCycle } from "@/features/mining/cycle/useMiningCycle";

/** The no-session states: pool gate, device check, device block, or ready to mine. */
export function MiningReadyPanel({ cycle }: { cycle: MiningCycle }) {
  const t = useT("mining.cycle");
  const { poolRequired, isChecking, isDeviceBlocked, error } = cycle;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <section
        style={revealDelay(0)}
        className="card-enter overflow-hidden rounded-[22px] border bg-card p-5 shadow-sm sm:col-span-2"
      >
        {poolRequired ? (
          <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display font-semibold">{t("ready.poolTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t("ready.poolBody")}</p>
              <div className="mt-4">
                <Link to="/mining/pools">
                  <Button>
                    <Icon icon={UserGroupIcon} size={17} />
                    {t("ready.openPools")}
                  </Button>
                </Link>
              </div>
            </div>
            <MiningOrb state="working" size={180} label={t("ready.orb.idle")} />
          </div>
        ) : isChecking ? (
          <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display font-semibold">{t("ready.checkingTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t("ready.checkingBody")}</p>
            </div>
            <MiningOrb
              state="solving"
              size={180}
              label={t("ready.orb.checking")}
              caption={t("ready.captions.checking")}
              captionShimmer
            />
          </div>
        ) : isDeviceBlocked ? (
          <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display font-semibold">{t("ready.blockedTitle")}</h2>
              <p role="alert" className="mt-2 text-sm text-muted-foreground">
                {error}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{t("ready.blockedBody")}</p>
            </div>
            <MiningOrb
              state="working"
              ink="danger"
              size={180}
              label={t("ready.orb.blocked")}
              caption={t("ready.captions.blocked")}
              captionClassName="font-semibold text-destructive"
            />
          </div>
        ) : (
          <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display font-semibold">{t("ready.readyTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t("ready.readyBody")}</p>
              <ul className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
                <li className="rounded-full border bg-secondary px-3 py-1 text-secondary-foreground">
                  {t("ready.chips.lock")}
                </li>
                <li className="rounded-full border bg-secondary px-3 py-1 text-secondary-foreground">
                  {t("ready.chips.rate")}
                </li>
                <li className="rounded-full border bg-secondary px-3 py-1 text-secondary-foreground">
                  {t("ready.chips.resumes")}
                </li>
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">{t("ready.startHint")}</p>
            </div>
            <MiningOrb state="working" size={180} label={t("ready.orb.idle")} />
          </div>
        )}
      </section>
      <div style={revealDelay(1)} className="card-enter">
        <MiningInfoCard />
      </div>
    </div>
  );
}

export function MiningInfoCard({ delayMs }: { delayMs?: number } = {}) {
  const t = useT("mining.cycle");
  return (
    <Panel title={t("info.title")} description={t("info.description")} delayMs={delayMs}>
      <FactList
        items={[
          [t("info.cycleLength"), t("info.cycleLengthValue")],
          [t("info.rate"), t("info.rateValue")],
          [t("info.accrual"), t("info.accrualValue")],
          [t("info.storage"), t("info.storageValue")],
        ]}
      />
      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <Icon icon={Timer01Icon} size={15} className="mt-0.5 shrink-0" />
        {t("info.noteSession")}
      </p>
      <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
        <Icon icon={ChartIncreaseIcon} size={15} className="mt-0.5 shrink-0" />
        {t("info.noteCounter")}
      </p>
    </Panel>
  );
}
