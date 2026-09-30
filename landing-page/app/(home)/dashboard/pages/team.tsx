'use client';

import { cn } from '@/lib/cn';
import { demoMutedText, demoSoftTile } from '../tokens';
import { demoTeam } from '../data';
import { Reveal, SectionCard, ShortcutStat, StatusPill } from '../shared';

export function TeamDemoPage() {
  return (
    <div className="w-full max-w-full min-w-0 space-y-4 overflow-hidden">
      <Reveal index={0}>
        <h2 className="text-xl font-semibold md:text-2xl">Profile</h2>
      </Reveal>
      <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ShortcutStat label="Contacts" value="12" detail="10 active" icon="UserGroupIcon" index={1} />
        <ShortcutStat label="Access" value="5" detail="in use" icon="UserSettings01Icon" index={2} />
        <ShortcutStat label="Checks" value="8" detail="security checks" icon="SecurityCheckIcon" index={3} />
        <ShortcutStat label="Pending" value="2" detail="invites" icon="Mail01Icon" index={4} />
      </div>
      <Reveal index={5}>
        <SectionCard title="Trusted contacts">
          <div className="space-y-2">
            {demoTeam.map((member) => (
              <div
                key={member.name}
                className={cn(
                  'grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-xl px-3 py-2.5 transition-colors sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                  demoSoftTile,
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
                  {member.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{member.name}</p>
                  <p className={cn('text-[11px]', demoMutedText)}>{member.role}</p>
                </div>
                <StatusPill label={member.status} tone={member.tone} />
              </div>
            ))}
          </div>
        </SectionCard>
      </Reveal>
    </div>
  );
}
