import type { LegalSection } from '@/components/layouts/legal-page';

export const privacySections: LegalSection[] = [
  {
    id: 'introduction',
    title: 'Introduction',
    body: (
      <>
        <p>
          Louma (<strong>“Louma”, “we”, “us”, “our”</strong>) provides a digital wallet for
          holding, sending, and receiving LMA, so account holders can manage their balance,
          transfers, mining, and history from a single account (the{' '}
          <strong>“Service”</strong>).
        </p>
        <p>
          This Privacy Policy explains what data we collect, why we collect it, how we protect
          it, and the choices you have. It applies to our websites, apps, APIs, and any
          other product or service that links to this policy. By using the Service, you agree to
          the practices described here.
        </p>
      </>
    ),
  },
  {
    id: 'data-we-collect',
    title: 'Data We Collect',
    body: (
      <>
        <p>We collect three categories of data:</p>
        <ul>
          <li>
            <strong>Account data</strong> — name, email address, phone number, account name,
            billing details, and authentication credentials you provide when you create or manage
            an account.
          </li>
          <li>
            <strong>Wallet data</strong> — the activity you and your connected services bring
            into the platform: balances, receiving addresses, transfers, transaction history,
            mining records, and generated documents such as receipts and statements. This
            data belongs to you.
          </li>
          <li>
            <strong>Usage data</strong> — log data, device and browser information, IP address,
            pages viewed, and feature interactions, collected automatically to keep the Service
            secure and reliable.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'how-we-use-data',
    title: 'How We Use Data',
    body: (
      <>
        <p>We use the data we collect to:</p>
        <ul>
          <li>Provide, operate, and maintain the Service, including syncing your connected services.</li>
          <li>Process transfers and send related notifications (transfer events, settlement updates).</li>
          <li>Detect and prevent fraud and abuse, including our suspicious transfer review.</li>
          <li>Monitor performance, debug issues, and improve product features.</li>
          <li>Communicate with you about updates, security notices, and support requests.</li>
          <li>Comply with legal obligations.</li>
        </ul>
        <p>
          <strong>We do not sell your data.</strong> We do not use your wallet data to train
          models for other accounts, and we never share your recipients&apos; information with
          advertisers.
        </p>
      </>
    ),
  },
  {
    id: 'tenant-isolation',
    title: 'Account Isolation',
    body: (
      <>
        <p>
          Louma is built with strict account boundaries. Every query that touches wallet data is
          scoped to your account, and access is verified on every request — no account can read,
          infer, or aggregate another account&apos;s data.
        </p>
        <p>
          Aggregate, fully anonymized metrics (for example, overall platform uptime or total
          request volume) may be used internally to operate the Service; these can never be
          traced back to an individual account or account holder.
        </p>
      </>
    ),
  },
  {
    id: 'sharing',
    title: 'When We Share Data',
    body: (
      <>
        <p>We share data only in the following limited situations:</p>
        <ul>
          <li>
            <strong>Service providers</strong> — infrastructure, payment processing, and email
            delivery vendors who process data on our behalf under contractual confidentiality and
            data-protection obligations.
          </li>
          <li>
            <strong>Connected services</strong> — when you link a service, an exchange rate
            source, or a network provider, we exchange the data required to run that connection,
            at your direction.
          </li>
          <li>
            <strong>Legal requirements</strong> — when required by law, regulation, or valid
            legal process, and only after reviewing the request&apos;s scope.
          </li>
          <li>
            <strong>Business transfers</strong> — if Louma is involved in a merger or
            acquisition, data may transfer as part of that transaction; this policy will continue
            to apply.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'security',
    title: 'Security',
    body: (
      <>
        <p>
          We apply defense-in-depth across the platform: encryption in transit (TLS) and at rest,
          scoped API tokens, role-based access control inside accounts, audit logging of
          sensitive operations, and isolation between the gateway, core, and worker layers of our
          architecture.
        </p>
        <p>
          No system is perfectly secure. If we become aware of a breach affecting your data, we
          will notify you without undue delay and share the information you need to respond.
        </p>
      </>
    ),
  },
  {
    id: 'retention',
    title: 'Data Retention & Deletion',
    body: (
      <>
        <p>
          We retain wallet data for as long as your account is active. When you delete a
          record, a custom address, or your account, the data is removed from production systems
          promptly and purged from backups on a rolling schedule (no longer than 90 days).
        </p>
        <p>
          You can export your data at any time from the wallet, and you may request full
          deletion by contacting us — we honor deletion requests regardless of your plan.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies & Tracking',
    body: (
      <>
        <p>
          We use a small set of first-party cookies that are strictly necessary for the Service:
          session authentication, security (CSRF protection), and remembering preferences like
          theme. We do not run third-party advertising trackers on the platform.
        </p>
      </>
    ),
  },
  {
    id: 'your-rights',
    title: 'Your Rights',
    body: (
      <>
        <p>Depending on your jurisdiction, you may have the right to:</p>
        <ul>
          <li>Access a copy of the personal data we hold about you.</li>
          <li>Correct inaccurate data.</li>
          <li>Delete your data (&ldquo;right to be forgotten&rdquo;).</li>
          <li>Export your data in a portable format.</li>
          <li>Object to or restrict certain processing.</li>
        </ul>
        <p>
          To exercise any of these rights, email{' '}
          <strong>legal@louma.com</strong>. We respond to verified requests within 30 days.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to This Policy',
    body: (
      <>
        <p>
          We may update this policy as the Service evolves. For material changes we will notify
          account holders by email and show a notice in the wallet at least 14 days before
          the change takes effect. The &ldquo;Last updated&rdquo; date at the top of this page always
          reflects the current version.
        </p>
      </>
    ),
  },
];
