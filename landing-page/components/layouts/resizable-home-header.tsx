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
import { useT } from '@/lib/i18n';

/** The two links in the bar, named by translation key so a language switch redraws the header. */
const navItems = [
  { labelKey: 'footer.links.pricing', link: '/pricing' },
  { labelKey: 'footer.links.blog', link: '/blog' },
] as const;

// "Sign in" goes straight to the app's sign-in page. The app sends an already-authenticated
// visitor on to the dashboard (/ ), so a signed-in customer never sits on the form.
const signInUrl = 'https://app.loumapay.com/login';

function ThemeModeToggle() {
  const t = useT('common');
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
        aria-label={t('shell.theme.switchToLight')}
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
        aria-label={t('shell.theme.switchToDark')}
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
  const t = useT('common');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <header id="nd-nav" className={cn('h-14', className)}>
      <Navbar>
        <NavBody>
          <NavbarLogo />
          <NavItems items={navItems.map((item) => ({ name: t(item.labelKey), link: item.link }))} />
          <div className="relative z-20 flex items-center gap-4">
            <a
              href={signInUrl}
              className="text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white"
            >
              {t('shell.signIn')}
            </a>
            <ThemeModeToggle />
          </div>
        </NavBody>

        <MobileNav>
          <MobileNavHeader>
            <NavbarLogo />
            <div className="flex items-center gap-3">
              <a
                href={signInUrl}
                className="text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white"
              >
                {t('shell.signIn')}
              </a>
              <ThemeModeToggle />
              <MobileNavToggle
                isOpen={isMobileMenuOpen}
                label={isMobileMenuOpen ? t('shell.menu.close') : t('shell.menu.open')}
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
                <span className="block">{t(item.labelKey)}</span>
              </a>
            ))}
          </MobileNavMenu>
        </MobileNav>
      </Navbar>
    </header>
  );
}
