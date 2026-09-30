'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Reveals its children with a fade + rise the first time they scroll into
 * view. Renders visible by default until JS hydrates the observer, so the
 * content is never hidden for crawlers or users without JavaScript.
 */
export function ScrollReveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isObserving, setIsObserving] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    // Elements already on screen at mount reveal immediately — no hidden flash.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );
    observer.observe(element);
    setIsObserving(true);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={elementRef}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        'transition-all duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]',
        isObserving && !isRevealed ? 'translate-y-6 opacity-0' : 'translate-y-0 opacity-100',
        className,
      )}
    >
      {children}
    </div>
  );
}
