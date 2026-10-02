'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { cn } from '@/lib/cn';

/**
 * Mining marketing surface.
 *
 * The 3D here is CSS 3D rather than a fifth WebGL context: the pillar cards
 * above already run four renderers, and a new canvas is the fastest way to
 * bring back the scroll jank this page had.
 *
 * The device guard that gates mining stays off this page on purpose. Its
 * weights, thresholds, caps and reason codes are not published: naming them
 * would hand anyone trying to farm rewards a precise evasion map. Keep this
 * copy to outcomes a user can actually observe.
 */

const BLOCKS = [0, 1, 2, 3, 4, 5] as const;

const FACTS = [
  { id: 'direct', term: 'Direct', detail: 'Rewards land in your wallet' },
  { id: 'cycle', term: 'Every cycle', detail: 'No claim or withdrawal step' },
  { id: 'receipt', term: 'Receipted', detail: 'Every credit stays auditable' },
] as const;

export function MiningGuard() {
  const sectionRef = useRef<HTMLElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const stack = stackRef.current;
    if (!section || !stack) return;

    const ctx = gsap.context(() => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) return;

      const at = 'top 78%';

      // Blocks drop into place one after another, oldest first.
      gsap.from('[data-block]', {
        autoAlpha: 0,
        y: 46,
        rotate: -18,
        scale: 0.72,
        duration: 0.62,
        ease: 'back.out(1.7)',
        stagger: 0.085,
        scrollTrigger: { trigger: section, start: at, once: true },
      });

      gsap.from('[data-fact]', {
        autoAlpha: 0,
        y: 14,
        duration: 0.42,
        ease: 'power2.out',
        stagger: 0.08,
        scrollTrigger: { trigger: section, start: at, once: true },
      });

      // Slow hover on the finished stack, so it reads as a live object.
      gsap.to(stack, {
        y: -9,
        duration: 2.6,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      aria-label="Mining"
      className="col-span-full mx-auto w-full max-w-[1400px]"
    >
      <div className="grid items-center gap-10 overflow-hidden rounded-[2rem] bg-[#ECECEE] p-7 text-neutral-900 ring-1 ring-black/5 sm:rounded-[2.5rem] sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:gap-14 lg:p-12 dark:bg-[#141414] dark:text-neutral-50 dark:ring-white/10">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
            Mining
          </p>
          <h2 className="mt-3 max-w-xl text-balance text-2xl font-medium tracking-tight sm:text-3xl lg:text-[2.25rem] lg:leading-[1.1]">
            Every cycle pays out.
          </h2>
          <p className="mt-4 max-w-lg text-[15px] leading-7 text-neutral-600 dark:text-neutral-300">
            Start mining on a device you already own. Louma credits LMA to your wallet when you
            collect a finished cycle — one tap on the mining page, with a receipt you can check
            long after the fact.
          </p>

          <dl className="mt-8 grid gap-x-8 gap-y-5 sm:grid-cols-3">
            {FACTS.map((fact) => (
              <div key={fact.id} data-fact>
                <dt className="text-[15px] font-medium tracking-tight">{fact.term}</dt>
                <dd className="mt-1 text-[13px] leading-6 text-neutral-600 dark:text-neutral-300">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Isometric block stack. Pure CSS 3D, driven by GSAP. */}
        <div className="relative mx-auto h-[220px] w-[260px] max-w-full shrink-0">
          <div
            ref={stackRef}
            className="absolute inset-0 [transform-style:preserve-3d] [perspective:900px]"
          >
            <div className="absolute inset-0 [transform:rotateX(58deg)_rotateZ(45deg)] [transform-style:preserve-3d]">
              {BLOCKS.map((index) => (
                <span
                  key={index}
                  data-block
                  className={cn(
                    'absolute size-11 rounded-[9px] [transform:rotateX(-90deg)]',
                    index % 2 === 0
                      ? 'bg-gradient-to-br from-[#fbbf24] to-[#d97706] shadow-[0_5px_0_0_#a16207]'
                      : 'bg-gradient-to-br from-[#fcd34d] to-[#b45309] shadow-[0_5px_0_0_#92400e]',
                  )}
                  style={{ left: 44 + index * 22, bottom: 20 + index * 25 }}
                />
              ))}
            </div>
          </div>
          <p className="absolute inset-x-0 bottom-0 text-center text-[12px] leading-5 text-neutral-500 dark:text-neutral-400">
            Every block your device secures is settled to the ledger.
          </p>
        </div>
      </div>
    </section>
  );
}
