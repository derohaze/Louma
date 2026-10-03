'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/cn';
import { LANGUAGES, languageLabel, useI18n, useT } from '@/lib/i18n';

const THEME_VALUES = ['system', 'light', 'dark'] as const;

export function FooterControls() {
  const t = useT('common');
  const { theme, setTheme } = useTheme();
  const { language, setLanguage } = useI18n();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeTheme = mounted ? theme ?? 'system' : 'system';

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div
        className="inline-flex h-9 items-center rounded-full bg-[#eeeeee] p-1 text-neutral-600 dark:bg-[#1E1E1E] dark:text-neutral-300"
        role="group"
        aria-label={t('brand.tagline')}
      >
        {THEME_VALUES.map((value) => {
          const Icon = value === 'system' ? Monitor : value === 'light' ? Sun : Moon;
          const label = t(`shell.theme.${value}` as 'shell.theme.system');
          const isActive = activeTheme === value;

          return (
            <button
              key={value}
              type="button"
              aria-label={label}
              aria-pressed={isActive}
              onClick={() => setTheme(value)}
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

      {/*
        The language switch: the same two choices the dashboard offers, writing the same cookie, so
        a visitor who reads Arabic on the marketing site finds the wallet in Arabic too.
      */}
      <div
        className="inline-flex h-9 items-center gap-1 rounded-full bg-[#eeeeee] p-1 text-neutral-600 dark:bg-[#1E1E1E] dark:text-neutral-300"
        role="group"
        aria-label={t('shell.language.label')}
      >
        {LANGUAGES.map((option) => {
          const isActive = option.code === language;

          return (
            <button
              key={option.code}
              type="button"
              lang={option.code}
              aria-pressed={isActive}
              aria-label={t('shell.language.switchTo', { language: languageLabel(option.code) })}
              onClick={() => setLanguage(option.code)}
              className={cn(
                'inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold transition-colors hover:text-neutral-950 dark:hover:text-white',
                isActive && 'bg-white text-neutral-950 shadow-sm dark:bg-[#333333] dark:text-white',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}