import { Link } from "@tanstack/react-router";
import { ChartIncreaseIcon, Timer01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/page";
import { FactList, Panel } from "@/shared/ui/panels";
import { MiningOrb } from "@/features/mining/live/MiningOrb";
import type { MiningCycle } from "@/features/mining/cycle/useMiningCycle";

/** The no-session states: pool gate, device check, device block, or ready to mine. */
export function MiningReadyPanel({ cycle }: { cycle: MiningCycle }) {
  const { poolRequired, isChecking, isDeviceBlocked, error } = cycle;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <section className="overflow-hidden rounded-[22px] border bg-card p-5 shadow-sm sm:col-span-2">
        {poolRequired ? (
          <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display font-semibold">Join a mining pool first</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Mining is only possible from inside a pool. Pick Low for steadier rewards or Medium
                for higher variance — both pay the same on average.
              </p>
              <div className="mt-4">
                <Link to="/mining/pools">
                  <Button>
                    <Icon icon={UserGroupIcon} size={17} />
                    Open mining pools
                  </Button>
                </Link>
              </div>
            </div>
            <MiningOrb state="working" size={180} label="Mining prospector idle" />
          </div>
        ) : isChecking ? (
          <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display font-semibold">Running security check</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Verifying this device with the protection system. This takes a few seconds — do not
                close the page.
              </p>
            </div>
            <MiningOrb
              state="solving"
              size={180}
              label="Running device security check"
              caption="Checking security…"
              captionShimmer
            />
          </div>
        ) : isDeviceBlocked ? (
          <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display font-semibold">Mining blocked on this device</h2>
              <p role="alert" className="mt-2 text-sm text-muted-foreground">
                {error}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                This decision comes from the protection system, not from this browser. Mining will
                not start on this device until the current cycle ends.
              </p>
            </div>
            <MiningOrb
              state="working"
              ink="danger"
              size={180}
              label="Mining blocked on this device"
              caption="Blocked"
              captionClassName="font-semibold text-destructive"
            />
          </div>
        ) : (
          <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display font-semibold">Ready to mine</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Start a cycle and the server assigns your rate for the next 24 hours. The rate is
                drawn per cycle and cannot be changed while the cycle runs.
              </p>
              <ul className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
                <li className="rounded-full border bg-secondary px-3 py-1 text-secondary-foreground">
                  24-hour lock
                </li>
                <li className="rounded-full border bg-secondary px-3 py-1 text-secondary-foreground">
                  Server-assigned rate
                </li>
                <li className="rounded-full border bg-secondary px-3 py-1 text-secondary-foreground">
                  Resumes on any device
                </li>
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                Use the Start mining action above — the orb shows the idle prospector.
              </p>
            </div>
            <MiningOrb state="working" size={180} label="Mining prospector idle" />
          </div>
        )}
      </section>
      <MiningInfoCard />
    </div>
  );
}

export function MiningInfoCard() {
  return (
    <Panel title="How mining works" description="What the server guarantees.">
      <FactList
        items={[
          ["Cycle length", "Exactly 24 hours"],
          ["Rate", "Chosen per cycle on the server"],
          ["Accrual", "Continuous, and capped at the cycle's end"],
          ["Storage", "Held on your account, not in this browser"],
        ]}
      />
      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <Icon icon={Timer01Icon} size={15} className="mt-0.5 shrink-0" />
        Closing the tab or switching devices never stops or loses a cycle: reopening the page
        re-reads the same state from the server.
      </p>
      <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
        <Icon icon={ChartIncreaseIcon} size={15} className="mt-0.5 shrink-0" />
        The counter you see is a display of the server's reward. Only the server decides how much
        LMA is credited.
      </p>
    </Panel>
  );
}
