import { useRef, useState, type PointerEvent } from "react";
import { useI18n, useT } from "@/shared/i18n";

function DottedChevron() {
  return (
    <svg viewBox="0 0 20 28" fill="currentColor" aria-hidden="true" className="h-7 w-5">
      <circle cx="4" cy="4" r="2" />
      <circle cx="10" cy="9" r="2" />
      <circle cx="16" cy="14" r="2" />
      <circle cx="10" cy="19" r="2" />
      <circle cx="4" cy="24" r="2" />
    </svg>
  );
}

export function SlideToPay({
  disabled,
  onComplete,
}: {
  disabled: boolean;
  onComplete: () => void;
}) {
  const t = useT("checkout");
  const { language } = useI18n();
  const direction = language === "ar" ? -1 : 1;
  const track = useRef<HTMLDivElement>(null);
  const gesture = useRef({ pointer: -1, start: 0, distance: 0, travel: 0 });
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const reset = () => {
    gesture.current.pointer = -1;
    gesture.current.distance = 0;
    setProgress(0);
    setDragging(false);
  };
  const start = (event: PointerEvent<HTMLSpanElement>) => {
    if (disabled || !event.isPrimary || event.button !== 0 || !track.current) return;
    gesture.current = {
      pointer: event.pointerId,
      start: event.clientX,
      distance: 0,
      travel: Math.max(1, track.current.clientWidth - 64),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const move = (event: PointerEvent<HTMLSpanElement>) => {
    const current = gesture.current;
    if (disabled || current.pointer !== event.pointerId) return;
    current.distance = Math.min(
      current.travel,
      Math.max(0, (event.clientX - current.start) * direction),
    );
    setProgress(current.distance / current.travel);
  };
  const finish = (event: PointerEvent<HTMLSpanElement>) => {
    if (gesture.current.pointer !== event.pointerId) return;
    const complete = !disabled && gesture.current.distance >= gesture.current.travel - 6;
    reset();
    if (complete) onComplete();
  };
  return (
    <div>
      <div
        ref={track}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={t("swipe")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-valuetext={progress >= 1 ? t("swipeReady") : t("swipeKeyboard")}
        aria-disabled={disabled}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Escape" || event.key === "Home") {
            event.preventDefault();
            reset();
          }
          if (event.key === "End") {
            event.preventDefault();
            setProgress(1);
          }
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            setProgress((current) =>
              Math.max(
                0,
                Math.min(1, current + (event.key === "ArrowRight" ? direction : -direction) * 0.1),
              ),
            );
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (progress >= 0.99) {
              reset();
              onComplete();
            }
          }
        }}
        onBlur={reset}
        className={`louma-swipe ${disabled ? "opacity-40" : ""}`}
      >
        <span
          className="louma-swipe-label"
          style={{ opacity: Math.max(0, 1 - progress * 1.7) }}
          aria-hidden="true"
        >
          {t("swipe")}
        </span>
        <span
          className={`louma-swipe-fill ${dragging ? "is-dragging" : ""}`}
          style={{ width: `calc(52px + (100% - 64px) * ${progress})` }}
          aria-hidden="true"
        >
          <span className="louma-swipe-trail" style={{ opacity: progress }}>
            <DottedChevron />
            <DottedChevron />
            <DottedChevron />
            <DottedChevron />
            <DottedChevron />
          </span>
          <span
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={reset}
            onLostPointerCapture={reset}
            className="louma-swipe-handle"
          >
            <DottedChevron />
          </span>
        </span>
      </div>
    </div>
  );
}
