/**
 * The privacy policy as data rather than markup, so the document can be rendered in any language and
 * the wording lives beside every other translation. `**…**` marks the emphasised part of a block.
 */
export default {
  seo: {
    title: 'Privacy Policy',
    description: 'How Louma collects, uses, protects, and shares data across the wallet.',
  },
  title: 'Privacy Policy',
  lastUpdated: 'June 1, 2026',
  sections: [
    {
      id: 'introduction',
      title: 'Introduction',
      body: [
        {
          p: 'Louma (**“Louma”, “we”, “us”, “our”**) provides a digital wallet for holding, sending, and receiving LMA, so account holders can manage their balance, transfers, mining, and history from a single account (the **“Service”**).',
        },
        {
          p: 'This Privacy Policy explains what data we collect, why we collect it, how we protect it, and the choices you have. It applies to our websites, apps, APIs, and any other product or service that links to this policy. By using the Service, you agree to the practices described here.',
        },
      ],
    },
    {
      id: 'data-we-collect',
      title: 'Data We Collect',
      body: [
        { p: 'We collect three categories of data:' },
        {
          ul: [
            '**Account data** — name, email address, phone number, account name, billing details, and authentication credentials you provide when you create or manage an account.',
            '**Wallet data** — the activity you and your connected services bring into the platform: balances, receiving addresses, transfers, transaction history, mining records, and generated documents such as receipts and statements. This data belongs to you.',
            '**Usage data** — log data, device and browser information, IP address, pages viewed, and feature interactions, collected automatically to keep the Service secure and reliable.',
          ],
        },
      ],
    },
    {
      id: 'how-we-use-data',
      title: 'How We Use Data',
      body: [
        { p: 'We use the data we collect to:' },
        {
          ul: [
            'Provide, operate, and maintain the Service, including syncing your connected services.',
            'Process transfers and send related notifications (transfer events, settlement updates).',
            'Detect and prevent fraud and abuse, including our suspicious transfer review.',
            'Monitor performance, debug issues, and improve product features.',
            'Communicate with you about updates, security notices, and support requests.',
            'Comply with legal obligations.',
          ],
        },
        {
          p: '**We do not sell your data.** We do not use your wallet data to train models for other accounts, and we never share your recipients’ information with advertisers.',
        },
      ],
    },
    {
      id: 'tenant-isolation',
      title: 'Account Isolation',
      body: [
        {
          p: 'Louma is built with strict account boundaries. Every query that touches wallet data is scoped to your account, and access is verified on every request — no account can read, infer, or aggregate another account’s data.',
        },
        {
          p: 'Aggregate, fully anonymized metrics (for example, overall platform uptime or total request volume) may be used internally to operate the Service; these can never be traced back to an individual account or account holder.',
        },
      ],
    },
    {
      id: 'sharing',
      title: 'When We Share Data',
      body: [
        { p: 'We share data only in the following limited situations:' },
        {
          ul: [
            '**Service providers** — infrastructure, payment processing, and email delivery vendors who process data on our behalf under contractual confidentiality and data-protection obligations.',
            '**Connected services** — when you link a service, an exchange rate source, or a network provider, we exchange the data required to run that connection, at your direction.',
            '**Legal requirements** — when required by law, regulation, or valid legal process, and only after reviewing the request’s scope.',
            '**Business transfers** — if Louma is involved in a merger or acquisition, data may transfer as part of that transaction; this policy will continue to apply.',
          ],
        },
      ],
    },
    {
      id: 'security',
      title: 'Security',
      body: [
        {
          p: 'We apply defense-in-depth across the platform: encryption in transit (TLS) and at rest, scoped API tokens, role-based access control inside accounts, audit logging of sensitive operations, and isolation between the gateway, core, and worker layers of our architecture.',
        },
        {
          p: 'No system is perfectly secure. If we become aware of a breach affecting your data, we will notify you without undue delay and share the information you need to respond.',
        },
      ],
    },
    {
      id: 'retention',
      title: 'Data Retention & Deletion',
      body: [
        {
          p: 'We retain wallet data for as long as your account is active. When you delete a record, a custom address, or your account, the data is removed from production systems promptly and purged from backups on a rolling schedule (no longer than 90 days).',
        },
        {
          p: 'You can export your data at any time from the wallet, and you may request full deletion by contacting us — we honor deletion requests regardless of your plan.',
        },
      ],
    },
    {
      id: 'cookies',
      title: 'Cookies & Tracking',
      body: [
        {
          p: 'We use a small set of first-party cookies that are strictly necessary for the Service: session authentication, security (CSRF protection), and remembering preferences like theme. We do not run third-party advertising trackers on the platform.',
        },
      ],
    },
    {
      id: 'your-rights',
      title: 'Your Rights',
      body: [
        { p: 'Depending on your jurisdiction, you may have the right to:' },
        {
          ul: [
            'Access a copy of the personal data we hold about you.',
            'Correct inaccurate data.',
            'Delete your data (“right to be forgotten”).',
            'Export your data in a portable format.',
            'Object to or restrict certain processing.',
          ],
        },
        {
          p: 'To exercise any of these rights, email **legal@louma.com**. We respond to verified requests within 30 days.',
        },
      ],
    },
    {
      id: 'changes',
      title: 'Changes to This Policy',
      body: [
        {
          p: 'We may update this policy as the Service evolves. For material changes we will notify account holders by email and show a notice in the wallet at least 14 days before the change takes effect. The “Last updated” date at the top of this page always reflects the current version.',
        },
      ],
    },
  ],
};