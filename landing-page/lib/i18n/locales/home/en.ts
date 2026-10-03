export default {
  seo: {
    title: 'Digital wallet for LMA',
    description:
      'Louma is a digital wallet for holding, sending, and receiving LMA — with mining rewards, a full transaction history, custom receiving addresses, and a built-in security centre.',
  },
  /** The opening statement under the hero; `**…**` marks the highlighted words. */
  intro:
    'Louma is a **digital wallet** for holding, sending, and receiving **LMA**. It keeps balance, transfers, mining rewards, and transaction history in one reliable surface, backed by a security centre and a complete audit trail.',
  hero: {
    eyebrow: 'Louma · Digital wallet for LMA',
    title: 'Send LMA like sending a message.',
    body: 'Choose a recipient, confirm the amount, and Louma settles the transfer — verified, confirmed, and receipted. Every movement is balanced in the ledger and available for audit at any time.',
    primaryAction: 'Open your wallet',
    secondaryAction: 'How settlement works',
    facts: {
      fee: { term: 'Network fee', value: '1%' },
      time: { term: 'Median settlement', value: '2.4 seconds' },
      receipt: { term: 'Receipt', value: 'With every transfer' },
    },
    card: {
      brand: 'Louma Pay',
      sendingTo: 'Sending payment to {name}',
      processing: 'Processing…',
      success: 'Payment Successful!',
      swipeToPay: 'Swipe to pay',
      swipeAria: 'Swipe to pay {amount} LMA to {name}',
      another: 'Send another transfer',
    },
  },
  pillars: {
    aria: 'Louma capabilities',
    coin: {
      title: 'LMA Currency',
      description:
        'A fixed-supply asset for everyday settlement — hold, send, and receive with a balanced ledger behind every movement.',
    },
    mining: {
      title: 'Mining',
      description:
        'Earn LMA for keeping the network alive. Rewards settle straight to your wallet, every cycle.',
    },
    transfer: {
      title: 'Transfers',
      description:
        'Idempotent by design: the same transfer can never settle twice. Confirm once, receipted forever.',
    },
    shield: {
      title: 'Protection',
      description:
        'Every transfer is verified against the ledger and gated by your credentials before anything moves.',
    },
  },
  mining: {
    aria: 'Mining',
    eyebrow: 'Mining',
    title: 'Every cycle pays out.',
    body: 'Start mining on a device you already own. Louma credits LMA to your wallet when you collect a finished cycle — one tap on the mining page, with a receipt you can check long after the fact.',
    facts: {
      direct: { term: 'Direct', detail: 'Rewards land in your wallet' },
      cycle: { term: 'Every cycle', detail: 'Collect it with one tap' },
      receipt: { term: 'Receipted', detail: 'Every credit stays auditable' },
    },
    caption: 'Every block your device secures is settled to the ledger.',
  },
};