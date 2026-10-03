export default {
  title: "Wallet",
  description: "Your wallet balance and receiving address.",
  transfer: "Transfer",
  primaryAddress: "Primary address",
  qrAria: "Receiving address QR code",
  flow: {
    title: "Balance & Flow",
    subtitle: "Money in vs money out",
    chartAria: "Money in and out across the last 30 days",
  },
  growth: {
    title: "Volume Growth",
    prev: "(prev {amount})",
    summary: "{count} {unit} moved {volume} LMA in the last {days} days.",
  },
  income: {
    title: "Income Share",
    note: "Share of the flow coming in · last {days} days",
  },
  breakdown: {
    title: "Flow Breakdown",
    subtitle: "Where the money sits · last {days} days",
    mined: "Mined",
  },
  totals: {
    transfers: "Transfers · last {days} days",
    vsPrev: "{arrow} {percent}% vs prev ({count})",
    movedOut: "moved out of {total} total volume",
  },
};
