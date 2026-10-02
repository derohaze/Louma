'use client';

import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  MobileNav,
  MobileNavHeader,
  MobileNavMenu,
  MobileNavToggle,
  Navbar,
  NavbarLogo,
  NavBody,
  NavItems,
} from '@/components/ui/resizable-navbar';
import { cn } from '@/lib/cn';

const navItems = [
  {
    name: 'Pricing',
    link: '/pricing',
  },
  {
    name: 'Blog',
    link: '/blog',
  },
];

const appUrl = 'https://app.loumapay.com';

function ThemeModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === 'dark';
  const isLight = mounted && resolvedTheme === 'light';

  return (
    <div className="inline-flex h-9 items-center rounded-full border bg-white p-1 shadow-sm dark:bg-neutral-950">
      <button
        type="button"
        aria-label="Switch to light mode"
        aria-pressed={isLight}
        onClick={() => setTheme('light')}
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-full text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
          isLight && 'bg-neutral-100 text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-neutral-100',
        )}
      >
        <Sun className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Switch to dark mode"
        aria-pressed={isDark}
        onClick={() => setTheme('dark')}
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-full text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
          isDark && 'bg-neutral-100 text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-neutral-100',
        )}
      >
        <Moon className="size-4" />
      </button>
    </div>
  );
}

export function ResizableHomeHeader({ className }: ComponentProps<'header'>) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <header id="nd-nav" className={cn('h-14', className)}>
      <Navbar>
        <NavBody>
          <NavbarLogo />
          <NavItems items={navItems} />
          <div className="relative z-20 flex items-center gap-4">
            <a
              href={appUrl}
              className="text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white"
            >
              Sign in
            </a>
            <ThemeModeToggle />
          </div>
        </NavBody>

        <MobileNav>
          <MobileNavHeader>
            <NavbarLogo />
            <div className="flex items-center gap-3">
              <a
                href={appUrl}
                className="text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white"
              >
                Sign in
              </a>
              <ThemeModeToggle />
              <MobileNavToggle
                isOpen={isMobileMenuOpen}
                onClick={() => setIsMobileMenuOpen((isOpen) => !isOpen)}
              />
            </div>
          </MobileNavHeader>

          <MobileNavMenu isOpen={isMobileMenuOpen}>
            {navItems.map((item) => (
              <a
                key={item.link}
                href={item.link}
                onClick={() => setIsMobileMenuOpen(false)}
                className="relative text-neutral-600 dark:text-neutral-300"
              >
                <span className="block">{item.name}</span>
              </a>
            ))}
          </MobileNavMenu>
        </MobileNav>
      </Navbar>
    </header>
  );
}
