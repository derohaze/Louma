import { useEffect, useRef } from "react";
import { thinkingOrbs, type OrbState } from "@/lib/thinking-orbs";
import { cn } from "@/lib/utils";

/**
 * Minimal mining visual built on the Thinking Orbs canvas engine (MIT, see
 * `lib/thinking-orbs.ts` for the full notice which ships with the bundle).
 *
 * No backgrounds, glows, rings or colors are added here — just the
 * transparent canvas plus an optional plain status line underneath.
 */
export function MiningOrb({
  state,
  size = 180,
  speed = 1,
  paused = false,
  label,
  caption,
  captionShimmer = false,
  className,
}: {
  state: OrbState;
  size?: number;
  speed?: number;
  paused?: boolean;
  label: string;
  caption?: string;
  captionShimmer?: boolean;
  className?: string;
}) {
  const scopeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    const destroy = thinkingOrbs(scope, { state, size, speed, theme: "auto", paused });
    return () => destroy();
  }, [state, size, speed, paused]);

  return (
    <div ref={scopeRef} className={cn("flex flex-col items-center gap-2", className)}>
      <canvas
        data-thinking-orb
        data-orb-state={state}
        data-orb-size={String(size)}
        data-orb-speed={String(speed)}
        data-orb-theme="auto"
        role="img"
        aria-label={label}
      />
      {caption ? (
        <p
          role="status"
          className={cn("text-xs text-muted-foreground", captionShimmer && "orb-caption-shimmer")}
        >
          {caption}
        </p>
      ) : null}
    </div>
  );
}
