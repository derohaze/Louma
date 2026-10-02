'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';

type Stage = 'review' | 'processing' | 'success';

const RECIPIENT = { name: 'Karim Adel', initials: 'KA' };
const AVATAR_URL = '/avatar-karim-5.webp';
const ACCENT = '#8E53F8';

const ARROW_OPACITY = [1, 0.78, 0.54, 0.32, 0.16] as const;

function DottedChevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 28" fill="none" aria-hidden="true" className={className}>
      <circle cx="4" cy="4" r="2" fill="currentColor" />
      <circle cx="10" cy="9" r="2" fill="currentColor" />
      <circle cx="16" cy="14" r="2" fill="currentColor" />
      <circle cx="10" cy="19" r="2" fill="currentColor" />
      <circle cx="4" cy="24" r="2" fill="currentColor" />
    </svg>
  );
}
const AMOUNT = '1,450';

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}



/**
 * Fixed-geometry payment card. The outer card never changes size:
 * the three stages are absolutely stacked inside a fixed viewport and
 * only crossfade (opacity + transform). No layout shift, ever.
 */
const layerClass = (visible: boolean, reduced: boolean) =>
  cn(
    'absolute inset-0 flex flex-col',
    !reduced && 'transition-opacity duration-500 ease-out',
    visible ? 'opacity-100' : 'pointer-events-none opacity-0',
  );

export function TransferAutomationHero() {
  const reducedMotion = usePrefersReducedMotion();
  const [stage, setStage] = useState<Stage>('review');
  const [dragX, setDragX] = useState(0);
  const [avatarOk, setAvatarOk] = useState(true);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ active: false, startX: 0, max: 0 });

  const startProcessing = useCallback(() => {
    dragState.current.active = false;
    setDragX(0);
    setStage('processing');
  }, []);

  // Single processing pass, then land on success.
  useEffect(() => {
    if (stage !== 'processing') return;
    const timer = window.setTimeout(() => setStage('success'), 2700);
    return () => window.clearTimeout(timer);
  }, [stage]);

  const reset = useCallback(() => {
    setDragX(0);
    setStage('review');
  }, []);

  const maxDrag = () => {
    const track = trackRef.current;
    if (!track) return 160;
    // Accent block starts at 52px wide inside 6px padding on both sides.
    return Math.max(80, track.clientWidth - 52 - 12);
  };

  const dragTo = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const next = clientX - rect.left - dragState.current.startX;
    setDragX(Math.min(Math.max(0, next), dragState.current.max));
  };

  const onTrackPointerDown = (event: React.PointerEvent) => {
    if (stage !== 'review') return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    // Grab offset keeps the block from jumping when pressing anywhere.
    dragState.current = {
      active: true,
      startX: event.clientX - rect.left - dragX,
      max: maxDrag(),
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onTrackPointerMove = (event: React.PointerEvent) => {
    if (!dragState.current.active || stage !== 'review') return;
    dragTo(event.clientX);
  };

  const onTrackPointerUp = () => {
    if (!dragState.current.active) return;
    if (dragX >= dragState.current.max - 8) {
      startProcessing();
    } else {
      dragState.current.active = false;
      setDragX(0);
    }
  };

  const onTrackKeyDown = (event: React.KeyboardEvent) => {
    if (stage !== 'review') return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const max = maxDrag();
      const next = Math.min(dragX + 24, max);
      dragState.current.max = max;
      dragState.current.active = true;
      setDragX(next);
      if (next >= max - 8) startProcessing();
    }
    if (event.key === 'Home') {
      dragState.current.active = false;
      setDragX(0);
    }
  };

  const dragRatio = Math.min(1, dragX / Math.max(1, dragState.current.max || maxDrag()));
  const trailStep = dragRatio * (ARROW_OPACITY.length + 1);

  return (
    <div className="grid w-full items-center gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-10">
      <style>{`
        @keyframes louma-check-draw { to { stroke-dashoffset: 0; } }
        @keyframes louma-ring-pop {
          0% { transform: scale(0.6); opacity: 0; }
          60% { transform: scale(1.04); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* Formal copy on a solid panel: readable in light and dark mode */}
      <div className="min-w-0 rounded-[2.5rem] border border-black/10 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 dark:border-white/10 dark:bg-neutral-950 dark:text-neutral-50">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
          Louma · Digital wallet for LMA
        </p>
        <h2 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl lg:text-[2.75rem] lg:leading-[1.08]">
          Send LMA like sending a message.
        </h2>
        <p className="mt-4 max-w-xl text-[15px] leading-7 text-neutral-600 dark:text-neutral-300">
          Choose a recipient, confirm the amount, and Louma settles the transfer — verified,
          confirmed, and receipted. Every movement is balanced in the ledger and available for
          audit at any time.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full bg-neutral-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
          >
            Open your wallet
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/features"
            className="inline-flex min-h-[44px] cursor-pointer items-center rounded-full border border-neutral-300 px-5 py-3 text-sm font-medium transition-colors hover:bg-neutral-100 dark:border-white/20 dark:hover:bg-white/10"
          >
            How settlement works
          </Link>
        </div>
        <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-t border-neutral-200 pt-5 text-sm dark:border-white/10">
          {[
            { id: 'fee', term: 'Network fee', value: '1%' },
            { id: 'time', term: 'Median settlement', value: '2.4 seconds' },
            { id: 'receipt', term: 'Receipt', value: 'With every transfer' },
          ].map((fact) => (
            <div key={fact.id}>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">{fact.term}</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Payment card: fixed width AND height in both modes */}
      <div className="mx-auto flex h-[500px] w-[300px] max-w-full flex-col rounded-[2.5rem] bg-white p-4 text-neutral-900 shadow-2xl shadow-black/25 lg:justify-self-end dark:bg-neutral-950 dark:text-neutral-50 dark:shadow-black/60">
        {/* Card header — brand only */}
        <div className="flex h-7 shrink-0 items-center justify-center">
          <span className="text-[15px] font-semibold tracking-tight">Louma Pay</span>
        </div>

        {/* Viewport — fixed, stages stack on top of each other */}
        <div className="relative mt-2 min-h-0 flex-1 overflow-hidden">
          {/* REVIEW layer */}
          <div aria-hidden={stage !== 'review'} className={layerClass(stage === 'review', reducedMotion)}>
            <p className="pt-6 text-center text-[11px] text-neutral-500 dark:text-neutral-400">
              Sending payment to {RECIPIENT.name}
            </p>
            <div className="mt-4 flex flex-col items-center">
              <span className="relative flex size-20 items-center justify-center overflow-hidden rounded-full bg-white dark:bg-neutral-800">
                {avatarOk ? (
                  <img
                    src={AVATAR_URL}
                    alt={RECIPIENT.name}
                    width={80}
                    height={80}
                    draggable={false}
                    className="size-20 object-cover"
                    onError={() => setAvatarOk(false)}
                  />
                ) : (
                  <span aria-hidden className="text-lg font-semibold text-neutral-700 dark:text-neutral-200">
                    {RECIPIENT.initials}
                  </span>
                )}
              </span>
              <span className="mt-2 text-sm font-semibold tracking-tight">{RECIPIENT.name}</span>
            </div>
            <p className="mt-3 text-center text-4xl leading-none font-bold tracking-tight whitespace-nowrap tabular-nums">
              {AMOUNT} <span className="text-xl font-semibold text-neutral-500 dark:text-neutral-400">LMA</span>
            </p>
          </div>

          {/* PROCESSING layer — one word, one animation */}
          <div aria-hidden={stage !== 'processing'} className={layerClass(stage === 'processing', reducedMotion)}>
            <div className="flex flex-1 flex-col items-center justify-center">
              <svg
                viewBox="0 0 48 48"
                aria-hidden
                className={cn('size-20', !reducedMotion && 'animate-spin')}
              >
                <circle cx="24" cy="24" r="20" fill="none" strokeWidth="4" className="stroke-neutral-200 dark:stroke-neutral-800" />
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  fill="none"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray="32 94"
                  className="stroke-neutral-900 dark:stroke-neutral-100"
                />
              </svg>
              <p className="mt-5 text-sm font-semibold">Processing…</p>
            </div>
          </div>

          {/* SUCCESS layer */}
          <div aria-hidden={stage !== 'success'} className={layerClass(stage === 'success', reducedMotion)}>
            <div className="flex flex-1 flex-col items-center justify-center">
              <span
                className={cn('flex size-20 items-center justify-center rounded-full border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10')}
                style={!reducedMotion ? { animation: 'louma-ring-pop 0.5s cubic-bezier(0.22,1,0.36,1) both' } : undefined}
              >
                <svg viewBox="0 0 24 24" className="size-10 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                  <path
                    d="M4 12.5 9.5 18 20 6.5"
                    strokeDasharray={30}
                    strokeDashoffset={reducedMotion ? 0 : 30}
                    style={!reducedMotion ? { animation: 'louma-check-draw 0.45s ease-out 0.25s forwards' } : undefined}
                  />
                </svg>
              </span>
              <p className="mt-4 text-center text-lg leading-snug font-semibold">
                Payment
                <br />
                Successful!
              </p>
              <p className="mt-3 text-xl font-bold tracking-tight whitespace-nowrap tabular-nums">
                {AMOUNT} <span className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">LMA</span>
              </p>
            </div>
          </div>
        </div>

        {/* Footer — fixed height, layers crossfade inside */}
        <div className="relative mt-2 h-[76px] shrink-0">
          {/* Swipe control */}
          <div className={cn('absolute inset-0', !reducedMotion && 'transition-opacity duration-400', stage === 'review' ? 'opacity-100' : 'pointer-events-none opacity-0')}>
            <div
              ref={trackRef}
              role="slider"
              tabIndex={0}
              aria-label={`Swipe to pay ${AMOUNT} LMA to ${RECIPIENT.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(dragRatio * 100)}
              onPointerDown={onTrackPointerDown}
              onPointerMove={onTrackPointerMove}
              onPointerUp={onTrackPointerUp}
              onPointerCancel={onTrackPointerUp}
              onKeyDown={onTrackKeyDown}
              className="relative h-16 cursor-pointer touch-none overflow-hidden rounded-[22px] bg-neutral-950 p-1.5 text-white outline-none select-none focus-visible:ring-2 focus-visible:ring-[#8E53F8] focus-visible:ring-offset-2 dark:bg-neutral-800 dark:focus-visible:ring-offset-neutral-950"
            >
              {/* Expanding accent block — the chevron rides its leading edge,
                  so the color can never run ahead of the arrow. */}
              <div
                aria-hidden
                className="absolute top-1.5 bottom-1.5 left-1.5 overflow-hidden"
                style={{ width: 52 + dragX, borderRadius: 16, backgroundColor: ACCENT }}
              >
                <div className="absolute inset-0 flex items-center justify-around px-3">
                  {ARROW_OPACITY.map((opacity, index) => (
                    <span
                      key={opacity}
                      className="inline-grid place-items-center text-white transition-opacity duration-150"
                      style={{ opacity: trailStep > index + 1 ? opacity : 0 }}
                    >
                      <DottedChevron className="h-7 w-5" />
                    </span>
                  ))}
                </div>
                <div
                  className="absolute inset-0 grid place-items-center text-white"
                  style={{ opacity: Math.max(0, 1 - dragRatio * 3) }}
                >
                  <DottedChevron className="h-7 w-5" />
                </div>
              </div>
              <span
                aria-hidden
                className="absolute inset-y-0 right-5 left-[76px] flex items-center justify-center text-sm font-medium whitespace-nowrap"
                style={{
                  opacity: Math.max(0, 1 - dragRatio * 1.6),
                  transform: `translateX(${dragRatio * 10}px)`,
                }}
              >
                Swipe to pay
              </span>
            </div>
          </div>

          {/* Replay */}
          <div className={cn('absolute inset-0 flex flex-col items-center justify-start pt-1', !reducedMotion && 'transition-opacity duration-400', stage === 'success' ? 'opacity-100' : 'pointer-events-none opacity-0')}>
            <button
              type="button"
              onClick={reset}
              tabIndex={stage === 'success' ? 0 : -1}
              className="min-h-[44px] cursor-pointer rounded-full border border-neutral-300 px-5 py-2 text-xs font-semibold transition-colors hover:bg-neutral-100 dark:border-white/20 dark:hover:bg-white/10"
            >
              Send another transfer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
