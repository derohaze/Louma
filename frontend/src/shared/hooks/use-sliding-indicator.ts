import { useRef, useState } from "react";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";

type IndicatorPosition = {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
};

/** Measures the selected item so one shared highlight can slide between adjacent choices. */
export function useSlidingIndicator<TContainer extends HTMLElement, TItem extends HTMLElement>(
  selection: string,
) {
  const containerRef = useRef<TContainer | null>(null);
  const activeRef = useRef<TItem | null>(null);
  const baseSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [position, setPosition] = useState<IndicatorPosition | null>(null);

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    const active = activeRef.current;
    if (!container || !active) {
      setPosition(null);
      return;
    }

    const measureActivePosition = () => {
      const activeWidth = active.offsetWidth;
      const activeHeight = active.offsetHeight;
      if (activeWidth === 0 || activeHeight === 0) return;

      if (!baseSizeRef.current) {
        baseSizeRef.current = { width: activeWidth, height: activeHeight };
      }
      const baseSize = baseSizeRef.current;
      const nextPosition = {
        x: active.offsetLeft,
        y: active.offsetTop,
        width: baseSize.width,
        height: baseSize.height,
        scaleX: activeWidth / baseSize.width,
        scaleY: activeHeight / baseSize.height,
      };
      setPosition((currentPosition) =>
        currentPosition &&
        currentPosition.x === nextPosition.x &&
        currentPosition.y === nextPosition.y &&
        currentPosition.scaleX === nextPosition.scaleX &&
        currentPosition.scaleY === nextPosition.scaleY
          ? currentPosition
          : nextPosition,
      );
    };

    measureActivePosition();
    window.addEventListener("resize", measureActivePosition);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureActivePosition);
    observer?.observe(container);
    observer?.observe(active);

    return () => {
      window.removeEventListener("resize", measureActivePosition);
      observer?.disconnect();
    };
  }, [selection]);

  return { containerRef, activeRef, position };
}
