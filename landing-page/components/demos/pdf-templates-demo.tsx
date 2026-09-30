'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

const pdfTemplates = [
  {
    key: 'invoice' as const,
    label: 'Receipt',
    heading: 'RECEIPT #EF-1861',
    rows: [
      ['Transfer to Salma Adel', '450'],
      ['Transfer from Ahmed', '320'],
      ['Network fee — LMA', '65'],
    ],
    footer: ['Total', '1,285 LMA'],
  },
  {
    key: 'packing' as const,
    label: 'Statement',
    heading: 'STATEMENT #EF-1861',
    rows: [
      ['Transfers out', 'Qty 2'],
      ['Transfers in', 'Qty 1'],
      ['Note included', '—'],
    ],
    footer: ['Entries', '3'],
  },
  {
    key: 'label' as const,
    label: 'Transfer note',
    heading: 'RECIPIENT',
    rows: [
      ['Salma Adel', '+20 10• ••• ••61'],
      ['14 Tahrir St, Dokki', 'Giza'],
      ['Network: LMA', 'Amount 1,285'],
    ],
    footer: ['Reference', 'BST-90412'],
  },
];

const demoMutedText = 'text-neutral-500 dark:text-neutral-400';

export function PdfTemplatesDemo() {
  const [templateKey, setTemplateKey] = useState<'invoice' | 'packing' | 'label'>('invoice');
  const template = pdfTemplates.find((item) => item.key === templateKey)!;

  return (
    <div className="mt-auto flex flex-col gap-3">
      <div className="flex gap-1.5">
        {pdfTemplates.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTemplateKey(item.key)}
            className={cn(
              'cursor-pointer rounded-full px-3 py-1 text-[11px] font-semibold ring-1 transition-colors',
              templateKey === item.key
                ? 'bg-neutral-900 text-white ring-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:ring-neutral-100'
                : cn('ring-black/10 hover:bg-black/5 dark:ring-white/15 dark:hover:bg-white/10', demoMutedText),
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        key={templateKey}
        className="rounded-xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-sm dark:border-white/15 dark:bg-[#1E1E1E] dark:text-neutral-100"
      >
        <div className="flex items-baseline justify-between gap-2 border-b border-neutral-200 pb-2 fill-mode-both animate-in fade-in slide-in-from-bottom-1 duration-500 dark:border-white/10">
          <p className="text-[11px] font-bold tracking-[0.08em]">{template.heading}</p>
          <p className="text-[10px] font-semibold text-neutral-400 dark:text-neutral-500">louma.app</p>
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          {template.rows.map(([left, right], index) => (
            <div
              key={left}
              className="flex items-baseline justify-between gap-2 fill-mode-both animate-in fade-in slide-in-from-bottom-1 duration-500"
              style={{ animationDelay: `${100 + index * 90}ms` }}
            >
              <p className="truncate text-xs">{left}</p>
              <p className="shrink-0 text-[11px] font-semibold tabular-nums text-neutral-500 dark:text-neutral-400">
                {right}
              </p>
            </div>
          ))}
        </div>
        <div
          className="mt-2.5 flex items-baseline justify-between border-t border-dashed border-neutral-300 pt-2 fill-mode-both animate-in fade-in slide-in-from-bottom-1 duration-500 dark:border-white/15"
          style={{ animationDelay: `${100 + template.rows.length * 90}ms` }}
        >
          <p className="text-[11px] font-bold">{template.footer[0]}</p>
          <p className="text-xs font-bold tabular-nums">{template.footer[1]}</p>
        </div>
      </div>
      <p className={cn('text-[11px] font-semibold', demoMutedText)}>
        Generated from live wallet data — branded, print-ready, one click.
      </p>
    </div>
  );
}
