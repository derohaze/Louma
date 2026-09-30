'use client';

import { type RefObject, useEffect, useState } from 'react';

const observed = new Map<Element, (entry: IntersectionObserverEntry) => void>();

let sharedObserver: IntersectionObserver | null = null;

function getObserver() {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        observed.get(entry.target)?.(entry);
      });
    });
  }
  return sharedObserver;
}

export function useIsVisible(ref: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    observed.set(element, (entry) => {
      setVisible(entry.isIntersecting);
    });

    getObserver().observe(element);

    return () => {
      observed.delete(element);
      sharedObserver?.unobserve(element);
    };
  }, [ref]);

  return visible;
}
