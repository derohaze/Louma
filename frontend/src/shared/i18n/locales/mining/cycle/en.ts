export default {
  ready: {
    poolTitle: "Join a mining pool first",
    poolBody:
      "Mining is only possible from inside a pool, and a pool is held only while you mine in it: a stop or a finished cycle releases it, so take one again to keep mining. Pick Low for steadier rewards or Medium for higher variance — both pay the same on average.",
    openPools: "Open mining pools",
    checkingTitle: "Running security check",
    checkingBody:
      "Verifying this device with the protection system. This takes a few seconds — do not close the page.",
    blockedTitle: "Mining blocked on this device",
    blockedBody:
      "This decision comes from the protection system, not from this browser. Mining will not start on this device until the current cycle ends.",
    readyTitle: "Ready to mine",
    readyBody:
      "Start a cycle and the server assigns your rate for it. Mining runs for up to 10 hours inside each 24-hour window, and the rate cannot be changed while a cycle runs.",
    chips: {
      lock: "Rate fixed per cycle",
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
    cycleLength: "Mining per window",
    cycleLengthValue: "Up to 10 hours, inside a 24-hour window",
    rate: "Rate",
    rateValue: "Chosen per cycle on the server",
    accrual: "Accrual",
    accrualValue: "Continuous, and capped at the cycle's end",
    storage: "Storage",
    storageValue: "Held on your account, not in this browser",
    noteSession:
      "Closing the tab or switching devices never stops or loses a cycle: reopening the page re-reads the same state from the server.",
    noteStop:
      "Stopping is always available, with one exception: if the cycle has earned rewards while settlement or payouts are paused, it cannot be stopped until settlement resumes. Otherwise mining pauses, what you earned is collected, your pool is released, and the hours left in the window stay yours to resume with.",
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
    window: "10:00:00 max per window",
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
    miningPaused:
      "Mining is paused on this network, so actions are unavailable. Your earned reward stays on your account and nothing is lost.",
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
    stopRequest: "Stopping mining…",
    stopped: "Mining stopped · reward collected",
    stopFailed: "Stop not confirmed · try again",
    collectingRequest: "Collecting reward…",
    collectionFailed: "Collection not confirmed · try again",
    collected: "Reward collected · {amount}",
  },
  toasts: {
    complete: "Mining cycle complete — collect your reward.",
    collected: "Reward collected into your wallet.",
    stopped:
      "Mining stopped — your pool was released, and the hours left in the window stay yours.",
  },
  errors: {
    deviceEvidenceRequired:
      "Mining cannot start because this browser hides or does not provide enough device information. Use a browser that exposes device information or allow it for this site, then try again. Your account is not blocked.",
    networkInUse:
      "Mining is already active from this network. Try again after the current cycle ends, or continue on a device that has already mined here.",
    notConfirmed: "The reward could not be confirmed yet. Try again.",
    stopNotConfirmed: "Mining could not be stopped. Try again.",
  },
  pools: {
    low: "Low Pool",
    medium: "Medium Pool",
  },
  ratePerHour: "{rate} LMA / hour",
};
