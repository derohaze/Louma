'use client';

import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CheckmarkCircle02Icon,
  ChevronRightIcon,
  Logout01Icon,
  Moon01Icon,
  SecurityCheckIcon,
  Settings01Icon,
  StoreLocation01Icon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';
import { iconMap } from '../icons';
import { demoEase, demoLabelMini, demoMutedText, demoPopover } from '../tokens';
import { demoNavSections, demoWorkspaces } from '../data';
import type { DemoPageKey } from '../data';
import { ExpandCollapse } from '../shared';

export function DemoSidebar({
  page,
  onNavigate,
}: {
  page: DemoPageKey;
  onNavigate: (page: DemoPageKey) => void;
}) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [workspace, setWorkspace] = useState(demoWorkspaces[0]);

  const workspaceStaggerClass = cn(
    'transition-all duration-500',
    demoEase,
    workspaceOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
  );
  const workspaceStaggerDelay = (index: number) => ({
    transitionDelay: workspaceOpen ? `${index * 75}ms` : '0ms',
  });

  return (
    <aside className="hidden w-56 shrink-0 flex-col pt-3 lg:flex">
      <div className="flex items-center gap-2.5 px-4 pb-3">
        <span className="relative flex h-6 w-9 shrink-0 items-center justify-center" aria-hidden="true">
          <img src="/darklogo.svg" alt="" className="block h-full w-full object-contain dark:hidden" />
          <img src="/whitelogo.svg" alt="" className="hidden h-full w-full object-contain dark:block" />
        </span>
        <span className="text-[13px] font-semibold">Louma</span>
      </div>

      <div className="px-2.5 pb-2">
        <button
          type="button"
          aria-expanded={workspaceOpen}
          onClick={() => setWorkspaceOpen((open) => !open)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-xl bg-[#f2f2f2] px-2.5 py-2 text-start transition-colors hover:bg-[#e8e8e8] dark:bg-[#242424] dark:text-neutral-100 dark:hover:bg-[#303030]"
        >
          <HugeiconsIcon icon={StoreLocation01Icon} size={16} strokeWidth={1.8} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">{workspace.name}</span>
            <span className={cn('block truncate text-[10px]', demoMutedText)}>{workspace.role}</span>
          </span>
          <HugeiconsIcon
            icon={ChevronRightIcon}
            size={14}
            strokeWidth={1.8}
            className={cn('shrink-0 transition-transform duration-500', demoEase, demoMutedText, workspaceOpen ? '-rotate-90' : 'rotate-90')}
          />
        </button>
        <ExpandCollapse isOpen={workspaceOpen}>
          <div className="space-y-0.5 pt-1.5">
            {demoWorkspaces.map((item, index) => {
              const active = item.name === workspace.name;
              return (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => {
                    setWorkspace(item);
                    setWorkspaceOpen(false);
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-start',
                    workspaceStaggerClass,
                    active
                      ? 'bg-[#d9d9d9] dark:bg-[#303030]'
                      : 'hover:bg-[#e8e8e8] dark:hover:bg-[#242424]',
                  )}
                  style={workspaceStaggerDelay(index)}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-black/[0.06] text-[10px] font-bold dark:bg-white/[0.08]">
                    {item.name[0]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold">{item.name}</span>
                    <span className={cn('block truncate text-[10px]', demoMutedText)}>{item.role}</span>
                  </span>
                  {active && (
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} strokeWidth={1.8} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                  )}
                </button>
              );
            })}
          </div>
        </ExpandCollapse>
      </div>

      <nav className="no-scrollbar flex-1 overflow-y-auto px-2.5 pb-3">
        {demoNavSections.map((section) => (
          <div key={section.label} className="mb-3">
            <div className={cn('px-2 pb-1', demoLabelMini)}>{section.label}</div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.key === page;
                const IconComponent = iconMap[item.icon];
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onNavigate(item.key)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-[12px] transition-[background-color,color] duration-150',
                      active
                        ? 'bg-[#d9d9d9] font-medium text-neutral-900 dark:bg-[#303030] dark:text-neutral-100'
                        : 'text-neutral-500 hover:bg-[#e8e8e8] hover:text-neutral-900 dark:text-neutral-500 dark:hover:bg-[#242424] dark:hover:text-neutral-100',
                    )}
                  >
                    <HugeiconsIcon icon={IconComponent} size={16} strokeWidth={1.8} className="shrink-0" />
                    <span className="truncate font-medium">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="relative px-2.5 pb-3">
        <div
          inert={!profileOpen}
          className={cn(
            'absolute bottom-full left-2.5 right-2.5 z-40 mb-1.5 p-1.5 transition-all duration-500',
            demoEase,
            demoPopover,
            profileOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
          )}
        >
          {[
            { icon: Settings01Icon, label: 'Settings' },
            { icon: SecurityCheckIcon, label: 'Security centre' },
            { icon: Moon01Icon, label: 'Appearance' },
            { icon: Logout01Icon, label: 'Log out', danger: true },
          ].map((item, index) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setProfileOpen(false)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-[12px] font-medium transition-all duration-500',
                demoEase,
                profileOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
                item.danger
                  ? 'text-rose-600 hover:bg-rose-500/10 dark:text-rose-400'
                  : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]',
              )}
              style={{ transitionDelay: profileOpen ? `${index * 75}ms` : '0ms' }}
            >
              <HugeiconsIcon icon={item.icon} size={15} strokeWidth={1.8} className="shrink-0" />
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-expanded={profileOpen}
          onClick={() => setProfileOpen((open) => !open)}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-start transition-colors',
            profileOpen ? 'bg-[#e8e8e8] dark:bg-[#242424]' : 'hover:bg-[#e8e8e8] dark:hover:bg-[#242424]',
          )}
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-semibold text-white dark:bg-[#303030] dark:text-neutral-100">
            OS
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">Omar Sherif</p>
            <p className={cn('truncate text-[10px]', demoMutedText)}>Account holder</p>
          </div>
          <HugeiconsIcon
            icon={ChevronRightIcon}
            size={14}
            strokeWidth={1.8}
            className={cn('shrink-0 transition-transform duration-500', demoEase, demoMutedText, profileOpen ? 'rotate-90' : '-rotate-90')}
          />
        </button>
      </div>
    </aside>
  );
}
