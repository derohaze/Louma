'use client';

// The Three.js scenes live in ./feature-pillar-canvas and are loaded lazily: a
// ~600 KB dependency must not sit in the initial homepage bundle and compete
// with first paint. The card text below stays server-rendered for SEO.

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import type { PillarKind } from './feature-pillar-canvas';

const PillarCanvas = dynamic(() => import('./feature-pillar-canvas').then((m) => m.PillarCanvas), {
  // Same box the canvas will occupy, so the card does not reflow once Three.js lands.
  loading: () => <CanvasSlot />,
});

/** Fixed-size stand-in that reserves the canvas box before Three.js arrives. */
function CanvasSlot({ glow }: { glow?: string }) {
  return (
    <div className="relative min-h-0 w-full flex-1" aria-hidden>
      {glow && <div className="absolute inset-0 opacity-0 transition-opacity" style={{ background: glow }} />}
    </div>
  );
}

/** Only the styling lives here; the words come from `locales/home`, so they re-render on a switch. */
interface Pillar {
  id: PillarKind;
  cardClass: string;
  titleClass: string;
  descriptionClass: string;
  fallbackGlow: string;
}

const PILLARS: Pillar[] = [
  {
    id: 'coin',
    cardClass: 'bg-[#ececee] dark:bg-[#141414]',
    titleClass: 'text-neutral-900 dark:text-white',
    descriptionClass: 'text-neutral-600 dark:text-neutral-400',
    fallbackGlow: 'radial-gradient(circle at 50% 45%, #f5d76e 0%, #d4af37 45%, transparent 70%)',
  },
  {
    id: 'mining',
    cardClass: 'bg-[#141417] dark:bg-[#141414]',
    titleClass: 'text-white',
    descriptionClass: 'text-neutral-400',
    fallbackGlow: 'radial-gradient(circle at 50% 45%, #a78bfa 0%, #8E53F8 45%, transparent 70%)',
  },
  {
    id: 'transfer',
    cardClass: 'bg-[#e4dcff] dark:bg-[#141414]',
    titleClass: 'text-neutral-900 dark:text-white',
    descriptionClass: 'text-neutral-600 dark:text-neutral-400',
    fallbackGlow: 'radial-gradient(circle at 50% 45%, #cbd5e1 0%, #64748b 50%, transparent 72%)',
  },
  {
    id: 'shield',
    cardClass: 'bg-[#efedea] dark:bg-[#141414]',
    titleClass: 'text-neutral-900 dark:text-white',
    descriptionClass: 'text-neutral-600 dark:text-neutral-400',
    fallbackGlow: 'radial-gradient(circle at 50% 45%, #6ee7b7 0%, #10b981 45%, transparent 70%)',
  },
];

/* ------------------------- Section ------------------------- */

export function FeaturePillars() {
  const t = useT('home');
  const sectionRef = useRef<HTMLElement>(null);
  const [canvasesReady, setCanvasesReady] = useState(false);

  // Only mount the canvases once the section is close to the viewport. Rendering them
  // on the server would emit a preload for the ~550 KB Three.js chunk, so visitors would
  // download it before ever scrolling to it. Below the fold, nobody sees the difference.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (!('IntersectionObserver' in window)) {
      setCanvasesReady(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setCanvasesReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) return;
      gsap.from('[data-pillar]', {
        y: 64,
        autoAlpha: 0,
        duration: 0.9,
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 82%',
          once: true,
        },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      aria-label={t('pillars.aria')}
      className="col-span-full mx-auto w-full max-w-[1400px]"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
        {PILLARS.map((pillar) => (
          <article
            key={pillar.id}
            data-pillar
            className={cn(
              'flex h-[440px] flex-col overflow-hidden rounded-[2rem] p-6 sm:h-[500px]',
              pillar.cardClass,
            )}
          >
            <h3 className={cn('text-center text-lg font-medium tracking-tight', pillar.titleClass)}>
              {t(`pillars.${pillar.id}.title` as 'pillars.coin.title')}
            </h3>
            {canvasesReady ? (
              <PillarCanvas kind={pillar.id} glow={pillar.fallbackGlow} />
            ) : (
              <CanvasSlot glow={pillar.fallbackGlow} />
            )}
            <p className={cn('pb-2 text-center text-[13px] leading-6', pillar.descriptionClass)}>
              {t(`pillars.${pillar.id}.description` as 'pillars.coin.description')}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
