import type { HTMLAttributes } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/cn';

const contributors = [
  { id: '124599', login: 'shadcn' },
  { id: '35677084', login: 'anthonyshew' },
  { id: '38025074', login: 'aidenybai' },
  { id: '10645823', login: 'ssalbdivad' },
  { id: '1519870', login: 'trueadm' },
  { id: '7557657', login: 'tpritchard' },
  { id: '1325721', login: 'Sheraff' },
  { id: '8399034', login: 'JohnWalk3r' },
];

export interface ContributorCounterProps extends HTMLAttributes<HTMLDivElement> {
  displayCount?: number;
}

export default function ContributorCounter({
  displayCount = 8,
  ...props
}: ContributorCounterProps): React.ReactElement {
  const topContributors = contributors.slice(0, displayCount);

  return (
    <div {...props} className={cn('flex flex-col items-center gap-4', props.className)}>
      <div className="flex flex-row flex-wrap items-center justify-center md:pe-4">
        {topContributors.map((contributor, i) => (
          <a
            key={contributor.login}
            href={`https://github.com/${contributor.login}`}
            rel="noreferrer noopener"
            target="_blank"
            className="size-10 overflow-hidden rounded-full border-4 border-fd-background bg-fd-background md:-mr-4 md:size-12"
            style={{
              zIndex: topContributors.length - i,
            }}
          >
            <Image
              src={`https://avatars.githubusercontent.com/u/${contributor.id}`}
              alt={`${contributor.login} avatar`}
              unoptimized
              width={48}
              height={48}
            />
          </a>
        ))}
      </div>
      <div className="text-center text-sm text-fd-muted-foreground">
        Some of our best contributors.
      </div>
    </div>
  );
}
