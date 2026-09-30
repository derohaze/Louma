'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

const workspaceModules = [
  {
    name: 'transfers',
    description: 'Track transfer work from send to settlement.',
    signal: '1,284 transfers sent this month',
  },
  {
    name: 'balance',
    description: 'Hold, receive, and send your LMA balance.',
    signal: '248 transfers · 231 confirmed',
  },
  {
    name: 'contacts',
    description: 'Keep recipient context close to every transfer.',
    signal: '3,412 contacts · 642 repeat senders',
  },
  {
    name: 'settlement',
    description: 'Surface settlement events before they become disputes.',
    signal: '34 pending · 87% settled rate',
  },
  {
    name: 'activity',
    description: 'Materialize reports that help you decide what to do next.',
    signal: 'Balance +18% YoY · 4.2x volume',
  },
];

const demoEase = 'ease-[cubic-bezier(0.4,0,0.2,1)]';

export function ModulesShowcaseDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused) return;
    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % workspaceModules.length);
    }, 2800);
    return () => window.clearInterval(timer);
  }, [isPaused]);

  return (
    <div className="mt-auto flex flex-col gap-2">
      {workspaceModules.map((module, index) => {
        const isActive = index === activeIndex;
        return (
          <button
            key={module.name}
            type="button"
            aria-expanded={isActive}
            onClick={() => {
              setIsPaused(true);
              setActiveIndex(index);
            }}
            className={cn(
              'flex flex-col rounded-xl border border-dashed p-2 text-start text-sm transition-colors duration-300',
              isActive
                ? 'border-brand-secondary bg-brand-secondary/5'
                : 'border-brand-secondary/40 hover:border-brand-secondary',
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'size-1.5 rounded-full transition-colors duration-300',
                  isActive ? 'bg-brand-secondary' : 'bg-fd-muted-foreground/40',
                )}
              />
              <p className="font-medium">{module.name}</p>
            </div>
            <div
              className={cn(
                'grid transition-all duration-500',
                demoEase,
                isActive ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
            >
              <div className="overflow-hidden">
                <div className="h-12">
                  <p
                    className={cn(
                      'truncate pt-1.5 text-xs text-fd-muted-foreground transition-all duration-500',
                      demoEase,
                      isActive ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
                    )}
                    style={{ transitionDelay: isActive ? '75ms' : '0ms' }}
                  >
                    {module.description}
                  </p>
                  <p
                    className={cn(
                      'truncate pt-1 text-[11px] font-semibold tabular-nums transition-all duration-500',
                      demoEase,
                      isActive ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
                    )}
                    style={{ transitionDelay: isActive ? '150ms' : '0ms' }}
                  >
                    {module.signal}
                  </p>
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
