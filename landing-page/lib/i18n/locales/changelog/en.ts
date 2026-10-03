export default {
  seo: {
    title: 'Changelog',
    description: 'New features, improvements, and fixes shipped to the Louma wallet.',
  },
  header: {
    eyebrow: 'Product',
    title: 'Changelog',
    description: 'Everything we ship — new features, improvements, and fixes, in one running record.',
  },
  latest: 'Latest',
  alsoIn: 'Also in this release',
  tags: {
    new: 'New',
    improved: 'Improved',
    fixed: 'Fixed',
  },
  releases: [
    {
      version: '1.4',
      date: 'June 28, 2026',
      title: 'Transaction search & statements',
      summary:
        'Every transfer is now easy to find — by amount, address, date, or note — and receipts and statements render themselves from live transfer data.',
      highlights: [
        {
          title: 'Transaction search out of the box',
          description:
            'Amount, address, date, and note fields are indexed straight from your history. Find any transfer in seconds with filters and saved queries — no exports, no spreadsheets.',
        },
        {
          title: 'Receipt & statement templates',
          description:
            'Receipts and statements render as clean, print-ready PDFs directly from transfer data. Pick a template, and the document draws itself — no design work required.',
        },
      ],
      entries: [
        {
          tag: 'improved',
          text: 'Account search now covers generated statements and confirmation events.',
        },
        {
          tag: 'improved',
          text: 'Search index rebuilds run incrementally on new transfers.',
        },
        {
          tag: 'fixed',
          text: 'Receipt lines no longer truncate mid-word on long addresses.',
        },
      ],
    },
    {
      version: '1.3',
      date: 'May 19, 2026',
      title: 'Suspicious transfer screening',
      summary:
        'Suspicious transfers are held for review before they settle — scored, explained, and one click away from a decision.',
      highlights: [
        {
          title: 'Risk verdicts on every transfer',
          description:
            'Address patterns, validation, and cross-service signals combine into a 0–100 risk score. High-risk transfers pause in a review queue with the exact reasons spelled out.',
        },
        {
          title: 'One-click block & flag',
          description:
            'Blocking a transfer automatically flags the address for future transfers across your account, so repeat offenders never settle again.',
        },
      ],
      entries: [
        {
          tag: 'new',
          text: 'Held transfers surface in the realtime notifications feed.',
        },
        {
          tag: 'improved',
          text: 'Review queue supports bulk decisions with keyboard shortcuts.',
        },
        {
          tag: 'fixed',
          text: 'Confirmation webhook retries no longer duplicate settlement events under high load.',
        },
      ],
    },
    {
      version: '1.2',
      date: 'April 7, 2026',
      title: 'Insights for daily decisions',
      summary:
        'Reports materialize live from transfer, settlement, and mining events — no exports, no spreadsheets, no waiting.',
      highlights: [
        {
          title: 'Live balance & transfer trends',
          description:
            'Switch the metric and watch the trend redraw in place. Every chart is fed by the same event stream that powers the rest of the wallet, so numbers always agree.',
        },
        {
          title: 'Mining that joins the dots',
          description:
            'Mining connects to a live rate per account, turning “what is this actually earning?” into a number on the dashboard instead of a weekend project.',
        },
      ],
      entries: [
        {
          tag: 'improved',
          text: 'Report queries are pre-aggregated by workers — dashboards load ~60% faster.',
        },
        {
          tag: 'improved',
          text: 'Date-range presets remember your last selection per report.',
        },
      ],
    },
    {
      version: '1.1',
      date: 'February 23, 2026',
      title: 'Connected services expansion',
      summary:
        'More services, richer confirmation events, and fewer “where did my transfer go?” questions.',
      highlights: [
        {
          title: 'Regional service coverage',
          description:
            'Native integrations for additional regional services, with send, transit, confirmation, and settlement events landing in the same unified timeline.',
        },
        {
          title: 'Stalled-transfer detection',
          description:
            'Settlement-exception detection flags transfers that stop moving before you notice — so you can act first instead of reacting.',
        },
      ],
      entries: [
        {
          tag: 'improved',
          text: 'Tracking pages resolve service branding automatically.',
        },
        {
          tag: 'fixed',
          text: 'Timezone handling for service timestamps across accounts.',
        },
      ],
    },
    {
      version: '1.0',
      date: 'January 12, 2026',
      title: 'Louma 1.0 — the wallet',
      summary:
        'The first public release — built on a secure core architecture, with strict account isolation and realtime everything.',
      highlights: [
        {
          title: 'One wallet for daily LMA work',
          description:
            'Balance, transfers, contacts, settlement, and history move together in a single wallet, backed by queues and event streams instead of page refreshes.',
        },
        {
          title: 'Account security & scoping',
          description:
            'Passwords, active sessions, and account protection, with every request scoped to your account. Boundaries are enforced at the platform layer, not by convention.',
        },
      ],
      entries: [
        {
          tag: 'new',
          text: 'Address book imports validate and sync safely, with rollback on failure.',
        },
        {
          tag: 'new',
          text: 'Realtime notifications for transfers, settlements, balance, and services.',
        },
      ],
    },
  ],
};