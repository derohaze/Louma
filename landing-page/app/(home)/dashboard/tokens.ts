/* ------------------------------------------------------------------ */
/* Theme tokens — mirrored from front-end/src/index.css, inlined here */
/* since the landing page has its own theme system.                   */
/* ------------------------------------------------------------------ */

export const demoCard =
  'bg-white text-neutral-900 shadow-none ring-0 dark:bg-[#161616] dark:text-neutral-100';
export const demoSoftTile =
  'bg-[#f2f2f2] text-neutral-900 dark:bg-[#242424] dark:text-neutral-100';
export const demoMutedText = 'text-neutral-500 dark:text-neutral-400';
export const demoLabelMini =
  'text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400';
export const demoRowHover =
  'group-hover:bg-black/[0.04] dark:group-hover:bg-white/[0.06]';
export const demoEase = 'ease-[cubic-bezier(0.4,0,0.2,1)]';
export const demoPopover =
  'rounded-2xl border-0 bg-white text-neutral-900 shadow-none dark:bg-[#161616] dark:text-neutral-100';

export type PillTone = 'success' | 'warning' | 'danger' | 'neutral' | 'progress';

export const pillTones: Record<PillTone, string> = {
  success:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  warning:
    'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
  danger:
    'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30',
  neutral:
    'bg-black/[0.05] text-neutral-600 ring-black/[0.07] dark:bg-white/[0.06] dark:text-neutral-300 dark:ring-white/10',
  progress:
    'bg-black/[0.05] text-neutral-600 ring-black/[0.07] dark:bg-white/[0.06] dark:text-neutral-300 dark:ring-white/10',
};
