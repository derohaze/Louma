'use client';

import { cn } from '@/lib/cn';
import { IconMenu2, IconX } from '@tabler/icons-react';
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
} from 'motion/react';
import type { ElementType, ReactNode } from 'react';
import React, { useState } from 'react';

interface NavbarProps {
  children: ReactNode;
  className?: string;
}

interface NavBodyProps {
  children: ReactNode;
  className?: string;
  visible?: boolean;
}

interface NavItemsProps {
  items: {
    name: string;
    link: string;
  }[];
  className?: string;
  onItemClick?: () => void;
}

interface MobileNavProps {
  children: ReactNode;
  className?: string;
  visible?: boolean;
}

interface MobileNavHeaderProps {
  children: ReactNode;
  className?: string;
}

interface MobileNavMenuProps {
  children: ReactNode;
  className?: string;
  isOpen: boolean;
}

/**
 * ONE shadow geometry, with the two states differing only in alpha.
 *
 * The visible and hidden states used to be `boxShadow: <long list>` versus `boxShadow: 'none'`.
 * `none` cannot be interpolated, so the transition snapped at both ends and repainted the whole
 * bar — the visible glitch on every scroll toggle. Matching structures interpolate smoothly.
 */
const NAV_SHADOW =
  '0 0 24px rgba(34, 42, 53, 0.06), 0 1px 1px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(34, 42, 53, 0.04), 0 0 4px rgba(34, 42, 53, 0.08), 0 16px 68px rgba(47, 48, 55, 0.05), 0 1px 0 rgba(255, 255, 255, 0.1) inset';
const NAV_SHADOW_HIDDEN =
  '0 0 24px rgba(34, 42, 53, 0), 0 1px 1px rgba(0, 0, 0, 0), 0 0 0 1px rgba(34, 42, 53, 0), 0 0 4px rgba(34, 42, 53, 0), 0 16px 68px rgba(47, 48, 55, 0), 0 1px 0 rgba(255, 255, 255, 0) inset';

/** How far the bar travels down once it detaches from the top edge. */
const NAV_LIFT_PX = 6;

/**
 * How far the bar pulls in from full width once scrolled. Deliberately small: the bar keeps its
 * footprint and only tightens a little, instead of collapsing into a narrow pill.
 */
const NAV_SHRINK = '92%';

export function Navbar({ children, className }: NavbarProps) {
  const { scrollY } = useScroll();
  const [visible, setVisible] = useState(false);

  // Hysteresis, not a single threshold: `latest > 8` re-armed the spring on every jitter around
  // that line — momentum scrolling, rubber-banding, sub-pixel trackpad deltas — which made the bar
  // flicker and replay its animation. Enter late, leave early, and the state only flips on intent.
  useMotionValueEvent(scrollY, 'change', (latest) => {
    setVisible((current) => (current ? latest > 8 : latest > 24));
  });

  return (
    <motion.div className={cn('fixed inset-x-0 top-0 z-40 w-full', className)}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ visible?: boolean }>, { visible })
          : child,
      )}
    </motion.div>
  );
}

export function NavBody({ children, className, visible }: NavBodyProps) {
  return (
    <motion.div
      animate={{
        backdropFilter: visible ? 'blur(10px)' : 'blur(0px)',
        boxShadow: visible ? NAV_SHADOW : NAV_SHADOW_HIDDEN,
        width: visible ? NAV_SHRINK : '100%',
        y: visible ? NAV_LIFT_PX : 0,
      }}
      transition={{
        type: 'spring',
        stiffness: 200,
        damping: 50,
      }}
      className={cn(
        // The tint is a class swap, not an animated property, so it needs its own transition or it
        // pops in a frame while the width and blur are still easing.
        'relative z-[60] mx-auto hidden h-14 max-w-7xl flex-row items-center justify-between rounded-full bg-transparent px-4 py-2 transition-colors duration-300 lg:flex dark:bg-transparent',
        visible && 'bg-white/80 dark:bg-neutral-950/80',
        className,
      )}
      style={{
        maxWidth: 'calc(100vw - 2rem)',
      }}
    >
      {children}
    </motion.div>
  );
}

export function NavItems({ items, className, onItemClick }: NavItemsProps) {
  return (
    <motion.div
      className={cn(
        'absolute inset-0 hidden flex-1 flex-row items-center justify-center space-x-8 text-sm font-medium lg:flex',
        className,
      )}
    >
      {items.map((item) => (
        <a
          href={item.link}
          key={item.link}
          onClick={onItemClick}
          className="text-neutral-600 transition-colors hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white"
        >
          {item.name}
        </a>
      ))}
    </motion.div>
  );
}

export function MobileNav({ children, className, visible }: MobileNavProps) {
  return (
    <motion.div
      animate={{
        backdropFilter: visible ? 'blur(10px)' : 'blur(0px)',
        boxShadow: visible ? NAV_SHADOW : NAV_SHADOW_HIDDEN,
        width: visible ? '90%' : '100%',
        paddingLeft: visible ? '12px' : '0px',
        paddingRight: visible ? '12px' : '0px',
        borderRadius: visible ? '2rem' : '0px',
        y: visible ? NAV_LIFT_PX : 0,
      }}
      transition={{
        type: 'spring',
        stiffness: 200,
        damping: 50,
      }}
      className={cn(
        'relative z-50 mx-auto flex w-full max-w-[calc(100vw-2rem)] flex-col items-center justify-between bg-transparent px-0 py-2 transition-colors duration-300 lg:hidden',
        visible && 'bg-white/80 dark:bg-neutral-950/80',
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

export function MobileNavHeader({ children, className }: MobileNavHeaderProps) {
  return <div className={cn('flex w-full flex-row items-center justify-between', className)}>{children}</div>;
}

export function MobileNavMenu({ children, className, isOpen }: MobileNavMenuProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn(
            'absolute inset-x-0 top-16 z-50 flex w-full flex-col items-start justify-start gap-4 rounded-2xl bg-white px-4 py-6 shadow-[0_0_24px_rgba(34,_42,_53,_0.06),_0_1px_1px_rgba(0,_0,_0,_0.05),_0_0_0_1px_rgba(34,_42,_53,_0.04),_0_0_4px_rgba(34,_42,_53,_0.08),_0_16px_68px_rgba(47,_48,_55,_0.05),_0_1px_0_rgba(255,_255,_255,_0.1)_inset] dark:bg-neutral-950',
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function MobileNavToggle({ isOpen, onClick }: { isOpen: boolean; onClick: () => void }) {
  return isOpen ? (
    <IconX className="text-black dark:text-white" onClick={onClick} />
  ) : (
    <IconMenu2 className="text-black dark:text-white" onClick={onClick} />
  );
}

export function NavbarLogo() {
  return (
    <a
      href="/"
      className="relative z-20 mr-4 flex items-center space-x-2 px-2 py-1 text-sm font-normal text-black"
    >
      <span className="font-medium text-black dark:text-white">Louma</span>
    </a>
  );
}

export function NavbarButton({
  href,
  as: Tag = 'a',
  children,
  className,
  variant = 'primary',
  ...props
}: {
  href?: string;
  as?: ElementType;
  children: ReactNode;
  className?: string;
  variant?: 'primary' | 'secondary' | 'dark' | 'gradient';
} & (React.ComponentPropsWithoutRef<'a'> | React.ComponentPropsWithoutRef<'button'>)) {
  const baseStyles =
    'relative inline-block cursor-pointer rounded-md bg-white px-4 py-2 text-center text-sm font-bold text-black transition duration-200 hover:-translate-y-0.5';

  const variantStyles = {
    primary:
      'shadow-[0_0_24px_rgba(34,_42,_53,_0.06),_0_1px_1px_rgba(0,_0,_0,_0.05),_0_0_0_1px_rgba(34,_42,_53,_0.04),_0_0_4px_rgba(34,_42,_53,_0.08),_0_16px_68px_rgba(47,_48,_55,_0.05),_0_1px_0_rgba(255,_255,_255,_0.1)_inset]',
    secondary: 'bg-transparent shadow-none dark:text-white',
    dark: 'bg-black text-white shadow-[0_0_24px_rgba(34,_42,_53,_0.06),_0_1px_1px_rgba(0,_0,_0,_0.05),_0_0_0_1px_rgba(34,_42,_53,_0.04),_0_0_4px_rgba(34,_42,_53,_0.08),_0_16px_68px_rgba(47,_48,_55,_0.05),_0_1px_0_rgba(255,_255,_255,_0.1)_inset]',
    gradient:
      'bg-gradient-to-b from-blue-500 to-blue-700 text-white shadow-[0px_2px_0px_0px_rgba(255,255,255,0.3)_inset]',
  };

  return (
    <Tag href={href || undefined} className={cn(baseStyles, variantStyles[variant], className)} {...props}>
      {children}
    </Tag>
  );
}
