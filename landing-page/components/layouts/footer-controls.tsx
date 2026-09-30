'use client';

import { useEffect, useState } from 'react';
import { Globe2, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/cn';

const themeOptions = [
  { value: 'system', label: 'System mode', icon: Monitor },
  { value: 'light', label: 'Light mode', icon: Sun },
  { value: 'dark', label: 'Dark mode', icon: Moon },
] as const;

export function FooterControls() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeTheme = mounted ? theme ?? 'system' : 'system';

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="inline-flex h-9 items-center rounded-full bg-[#eeeeee] p-1 text-neutral-600 dark:bg-[#1E1E1E] dark:text-neutral-300">
        {themeOptions.map((option) => {
          const Icon = option.icon;
          const isActive = activeTheme === option.value;

          return (
            <button
              key={option.value}
              type="button"
              aria-label={option.label}
              aria-pressed={isActive}
              onClick={() => setTheme(option.value)}
              className={cn(
                'inline-flex size-7 items-center justify-center rounded-full transition-colors hover:text-neutral-950 dark:hover:text-white',
                isActive && 'bg-white text-neutral-950 shadow-sm dark:bg-[#333333] dark:text-white',
              )}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>

      <span
        aria-label="Current language: English"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#eeeeee] px-3 text-sm font-semibold text-neutral-900 dark:bg-[#1E1E1E] dark:text-white"
      >
        <Globe2 className="size-4" />
        <span>English</span>
      </span>
    </div>
  );
}
