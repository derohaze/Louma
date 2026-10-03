import { useEffect, useState } from "react";
import { useT } from "@/shared/i18n";
import { Panel } from "@/shared/ui/panels";

/**
 * Local mining-activity feed shown while a cycle is running.
 *
 * Every line narrates a real event from this page's own state machine — cycle
 * announcements, start/collect requests and their confirmed outcomes — and
 * nothing else. It reads server state, it never writes it: no request, no
 * mutation and no side effect originates here, exactly like the mining
 * countdown display. Amounts shown are the same confirmed numbers the session
 * card already renders.
 */

export type FeedLine = {
  id: number;
  text: string;
  /** Stagger for lines that mount together, so they cascade instead of popping. */
  delay: number;
};

const MAX_VISIBLE = 6;
const CHAR_TICK_MS = 28;

export function MiningLiveLog({ events }: { events: FeedLine[] }) {
  const t = useT("mining.cycle");
  const visible = events.slice(-MAX_VISIBLE);
  const done = visible.slice(0, -1);
  const current = visible.length > 0 ? visible[visible.length - 1] : undefined;
  const [shown, setShown] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    setShown(0);
  }, [current?.id]);

  const typing = !!current && !reducedMotion && shown < current.text.length;
  useEffect(() => {
    if (!typing || !current) return;
    const id = window.setInterval(() => {
      setShown((value) => Math.min(value + 1, current.text.length));
    }, CHAR_TICK_MS);
    return () => window.clearInterval(id);
  }, [typing, current]);

  const enterClass = reducedMotion ? undefined : "mining-log-enter";
  const delayOf = (line: FeedLine) =>
    enterClass ? { animationDelay: `${line.delay}ms` } : undefined;

  return (
    <Panel title={t("live.title")}>
      <p className="sr-only">{t("live.srNote")}</p>
      <div
        aria-hidden
        className="flex h-36 flex-col justify-end gap-1 overflow-hidden font-mono text-[11px] leading-5 text-[#9898A0] select-none [mask-image:linear-gradient(to_bottom,transparent,black_28px)]"
      >
        {visible.length === 0 && <p>{t("live.waiting")}</p>}
        {done.map((line) => (
          <p key={line.id} className={`truncate ${enterClass ?? ""}`} style={delayOf(line)}>
            {line.text}
          </p>
        ))}
        {current && (
          <p key={current.id} className={`truncate ${enterClass ?? ""}`} style={delayOf(current)}>
            {reducedMotion ? current.text : current.text.slice(0, shown)}
            {typing && <span className="animate-pulse">▍</span>}
          </p>
        )}
      </div>
    </Panel>
  );
}
