export default {
  ready: {
    poolTitle: "Join a mining pool first",
    poolBody:
      "Mining is only possible from inside a pool. Pick Low for steadier rewards or Medium for higher variance — both pay the same on average.",
    openPools: "Open mining pools",
    checkingTitle: "Running security check",
    checkingBody:
      "Verifying this device with the protection system. This takes a few seconds — do not close the page.",
    blockedTitle: "Mining blocked on this device",
    blockedBody:
      "This decision comes from the protection system, not from this browser. Mining will not start on this device until the current cycle ends.",
    readyTitle: "Ready to mine",
    readyBody:
      "Start a cycle and the server assigns your rate for the next 24 hours. The rate is drawn per cycle and cannot be changed while the cycle runs.",
    chips: {
      lock: "24-hour lock",
      rate: "Server-assigned rate",
      resumes: "Resumes on any device",
    },
    startHint: "Use the Start mining action above — the orb shows the idle prospector.",
    orb: {
      idle: "Mining prospector idle",
      checking: "Running device security check",
      blocked: "Mining blocked on this device",
    },
    captions: {
      checking: "Checking security…",
      blocked: "Blocked",
    },
  },
  info: {
    title: "How mining works",
    description: "What the server guarantees.",
    cycleLength: "Cycle length",
    cycleLengthValue: "Exactly 24 hours",
    rate: "Rate",
    rateValue: "Chosen per cycle on the server",
    accrual: "Accrual",
    accrualValue: "Continuous, and capped at the cycle's end",
    storage: "Storage",
    storageValue: "Held on your account, not in this browser",
    noteSession:
      "Closing the tab or switching devices never stops or loses a cycle: reopening the page re-reads the same state from the server.",
    noteCounter:
      "The counter you see is a display of the server's reward. Only the server decides how much LMA is credited.",
  },
  active: {
    statusActive: "Mining",
    statusCompleted: "Cycle complete",
    statusSettled: "Cycle settled",
    remaining: "remaining",
    windowClosed: "window closed",
    orb: {
      ready: "Mining reward ready to collect",
      hashing: "Mining cycle hashing",
      settled: "Mining cycle settled",
    },
    captions: {
      ready: "Reward ready",
      hashing: "Hashing…",
      settled: "Settled",
    },
    earned: "Earned this cycle",
    alreadyCollected: "{amount} already collected",
    progressAria: "Mining cycle progress",
    elapsed: "{time} elapsed",
    window: "24:00:00 cycle",
    facts: {
      rate: "Mining rate",
      pool: "Pool",
      cycle: "Cycle",
      cycleValue: "#{number} · started {date}",
      windowEnds: "Window ends",
      maximum: "Maximum this cycle",
    },
    settlementPaused:
      "Settlement is paused on this network, so collection is unavailable right now. Your earned reward stays on your account and nothing is lost.",
    fullyCollected: "This cycle is fully collected. Start a new one to keep mining.",
    miningPaused:
      "Mining is paused on this network, so actions are unavailable. Your earned reward stays on your account and nothing is lost.",
    starting: "Starting…",
    rateCard: "Mining rate",
    rateNote: "Drawn by the server for this cycle and fixed until it ends.",
  },
  live: {
    title: "Live mining activity",
    srNote: "Mining activity. This feed is decorative and changes nothing.",
    waiting: "Waiting for cycle events…",
  },
  feed: {
    cycleActive: "Cycle #{number} active · {rate} LMA/h",
    windowEnds: "Window ends {date}",
    heartbeat: "+{amount} · {time} elapsed",
    autoCollecting: "Cycle #{number} window closed · collecting reward…",
    settled: "Reward settled · in your wallet",
    startRequest: "Starting cycle request…",
    startRefused: "Start request refused",
    collectingRequest: "Collecting reward…",
    collectionFailed: "Collection not confirmed · try again",
    collected: "Reward collected · {amount}",
  },
  toasts: {
    complete: "Mining cycle complete — collect your reward.",
    collected: "Reward collected into your wallet.",
  },
  errors: {
    notConfirmed: "The reward could not be confirmed yet. Try again.",
  },
  pools: {
    low: "Low Pool",
    medium: "Medium Pool",
  },
  ratePerHour: "{rate} LMA / hour",
};
