'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { FaqItem } from '../data';
import { faqItems } from '../data';

function FaqRow({
  index,
  item,
  isOpen,
  onToggle,
}: {
  index: number;
  item: FaqItem;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const answerId = `pricing-faq-answer-${index}`;

  return (
    <div className="py-5">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={answerId}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-6 text-start text-sm font-semibold"
      >
        <span>{item.question}</span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-fd-muted-foreground transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      <div
        id={answerId}
        className={cn(
          'grid transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]',
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <p
            className={cn(
              'mt-3 max-w-2xl text-sm leading-6 text-fd-muted-foreground transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]',
              isOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
            )}
            style={{
              transitionDelay: isOpen ? `${index * 75}ms` : '0ms',
            }}
          >
            {item.answer}
          </p>
        </div>
      </div>
    </div>
  );
}

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="mx-auto mt-24 grid w-full max-w-[1180px] grid-cols-1 gap-12 border-t border-fd-border pt-14 dark:border-[#262626] lg:grid-cols-[0.85fr_1.15fr]">
      <h2 className="text-2xl font-medium tracking-normal md:text-3xl">Questions & Answers</h2>
      <div className="divide-y divide-fd-border dark:divide-[#262626]">
        {faqItems.map((item, index) => (
          <FaqRow
            key={item.question}
            index={index}
            item={item}
            isOpen={openIndex === index}
            onToggle={() => setOpenIndex((current) => (current === index ? null : index))}
          />
        ))}
      </div>
    </section>
  );
}
