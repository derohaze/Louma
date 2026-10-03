/** The terms of service as data rather than markup, so the document renders in any language. */
export default {
  seo: {
    title: 'Terms of Service',
    description: 'The agreement that governs your use of the Louma wallet.',
  },
  title: 'Terms of Service',
  description:
    'The plain-language agreement between you and Louma — what you can expect from us, and what we ask of you.',
  lastUpdated: 'July 5, 2026',
  sections: [
    {
      id: 'agreement',
      title: 'The Agreement',
      body: [
        {
          p: 'These Terms of Service (the **“Terms”**) are a binding agreement between you — the individual or company creating an account — and Louma. They govern your access to and use of the Louma wallet, websites, APIs, and related services (the **“Service”**).',
        },
        {
          p: 'By creating an account or using the Service, you accept these Terms. If you are accepting on behalf of a company, you confirm you have the authority to bind that company.',
        },
      ],
    },
    {
      id: 'accounts',
      title: 'Accounts & Access',
      body: [
        { p: 'You must provide accurate registration information and keep it up to date.' },
        {
          p: 'You are responsible for safeguarding your credentials and API tokens, and for all activity that happens under your account.',
        },
        {
          p: 'Account holders control access to their account; actions taken while signed in are the account holder’s responsibility.',
        },
        {
          p: 'You must be at least 18 years old, or the age of legal majority in your jurisdiction, to use the Service.',
        },
      ],
    },
    {
      id: 'acceptable-use',
      title: 'Acceptable Use',
      body: [
        { p: 'You agree not to:' },
        {
          ul: [
            'Use the Service for any unlawful purpose or to move illicit funds.',
            'Attempt to access data belonging to another account or bypass account isolation.',
            'Probe, scan, or test the vulnerability of the Service without written authorization.',
            'Send spam, abusive messages, or fraudulent transfers through the platform.',
            'Resell, sublicense, or white-label the Service without a written agreement.',
            'Interfere with the Service’s operation, including overloading our infrastructure.',
          ],
        },
        {
          p: 'We may suspend or terminate accounts that violate these rules — where practical, we will warn you first and give you a chance to correct the issue.',
        },
      ],
    },
    {
      id: 'your-data',
      title: 'Your Data & Content',
      body: [
        {
          p: 'You own your data. Balances, transfers, transaction history, documents, and everything else you bring into your account remain yours. You grant us only the limited license needed to host, process, and display that data in order to operate the Service — nothing more.',
        },
        {
          p: 'You are responsible for ensuring you have the legal right to the data you provide, including your recipients’ personal information, and for complying with the data protection laws that apply to your use of the Service. Our handling of data is described in the Privacy Policy.',
        },
      ],
    },
    {
      id: 'integrations',
      title: 'Connected Services & Third-Party Services',
      body: [
        {
          p: 'The Service connects to third-party platforms such as exchange rate sources, network providers, and identity services. Those services are governed by their own terms, and we are not responsible for their availability, accuracy, or conduct. When a connection changes or removes its API, we will make reasonable efforts to adapt, but we cannot guarantee uninterrupted compatibility.',
        },
      ],
    },
    {
      id: 'billing',
      title: 'Plans, Billing & Renewal',
      body: [
        {
          p: 'Paid plans are billed in advance on a recurring basis (monthly or annually) and renew automatically until cancelled.',
        },
        {
          p: 'You can cancel at any time from the wallet; cancellation takes effect at the end of the current billing period.',
        },
        {
          p: 'Fees are non-refundable except where required by law or stated otherwise in a written agreement.',
        },
        { p: 'We may change pricing with at least 30 days’ notice; changes apply from your next billing cycle.' },
      ],
    },
    {
      id: 'availability',
      title: 'Service Availability',
      body: [
        {
          p: 'We work to keep the Service available around the clock, with redundant infrastructure and monitored queues. However, the Service is provided **“as is”** and **“as available”** — we do not guarantee it will be uninterrupted or error-free. Planned maintenance is announced in advance whenever possible.',
        },
      ],
    },
    {
      id: 'ip',
      title: 'Intellectual Property',
      body: [
        {
          p: 'The Service — including its software, design, documentation, and branding — is owned by Louma and protected by intellectual-property laws. These Terms do not grant you any right to our trademarks or source code beyond the right to use the Service. Feedback you send us may be used to improve the product without obligation to you.',
        },
      ],
    },
    {
      id: 'liability',
      title: 'Limitation of Liability',
      body: [
        {
          p: 'To the maximum extent permitted by law, Louma will not be liable for indirect, incidental, special, consequential, or punitive damages — including lost profits, lost data, or business interruption — arising from your use of the Service.',
        },
        {
          p: 'Our total aggregate liability for any claim relating to the Service is limited to the amount you paid us in the twelve (12) months before the event giving rise to the claim.',
        },
      ],
    },
    {
      id: 'termination',
      title: 'Termination',
      body: [
        {
          p: 'You may stop using the Service and delete your account at any time. We may suspend or terminate your access if you materially breach these Terms, if required by law, or if we discontinue the Service (with at least 90 days’ notice for paid plans).',
        },
        {
          p: 'After termination you will have a 30-day window to export your data, after which it is deleted in line with our retention schedule.',
        },
      ],
    },
    {
      id: 'changes',
      title: 'Changes to These Terms',
      body: [
        {
          p: 'We may revise these Terms from time to time. For material changes we will notify account holders by email at least 14 days before the new Terms take effect. Continued use of the Service after that date constitutes acceptance of the updated Terms.',
        },
      ],
    },
  ],
};