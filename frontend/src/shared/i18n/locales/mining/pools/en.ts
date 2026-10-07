export default {
  title: "Mining Pools",
  description: "Take a room first — mining is only possible from inside one.",
  shortDescription: "Take a room to start mining.",
  loadError: "Couldn't load mining pools",
  retry: "Try again",
  goToMining: "Go to mining",
  joinedMining:
    "You are mining in {pool} · your speed {power} H ({share}% of the room). The room lasts as long as your cycle: stopping mining releases it.",
  joinedReady:
    "Your room is {pool}. Press Start on the mining page to mine in it — a room nobody starts from is released on its own.",
  switchWait:
    "Room changes are limited to one every few minutes: you can take the other room in {minutes} min. The room you just left is available now.",
  badges: {
    full: "Full",
    variance: "Higher variance",
    steady: "Steady",
  },
  occupancyAria: "{pool} occupancy",
  miners: "{active} / {max} miners",
  yourShare: " · your share {share}%",
  facts: {
    rewardRange: "Reward range",
    roomPower: "Room power",
    yourSpeed: "Your speed",
    cycle: "Cycle",
    cycleValue: "Up to 10 hours a day · tagged with this room",
  },
  split:
    "Speed splits across members: {power} H ÷ {miners} {unit}. Both rooms average the same reward over time.",
  units: {
    minerOne: "miner",
    minerOther: "miners",
  },
  actions: {
    currentRoom: "Current room",
    roomFull: "Room full",
    joining: "Joining…",
    switchTo: "Take {pool}",
    join: "Take {pool}",
    leave: "Leave room",
    leaving: "Leaving…",
  },
  errors: {
    switchCooldown:
      "Room changes are limited to one every few minutes. Take the room you were just in, or try another room a little later.",
    cycleActive: "A mining cycle is running. Stop mining to release the room, then take another.",
  },
  how: {
    title: "How rooms work",
    description: "The rules both rooms share.",
    membership: "Your room",
    membershipValue: "One room at a time, held while you mine in it",
    gate: "Mining gate",
    gateValue: "Start is refused until you hold a room",
    release: "Releasing the room",
    releaseValue: "Stop mining releases the room immediately; a finished window releases it too",
    changes: "Changing rooms",
    changesValue:
      "Limited to one change every few minutes; taking your own room again is always free",
    cycleLength: "Cycle length",
    cycleLengthValue: "Up to 10 hours a day, tagged with its room",
    rewards: "Rewards",
    rewardsValue: "Bounded random factor per cycle, same average in both rooms",
  },
  names: {
    low: "Low Pool",
    medium: "Medium Pool",
  },
  descriptions: {
    low: "Steadier rewards, smaller swings. Best for predictable mining.",
    medium: "Higher variance, bigger upside. Same long-run average as Low.",
  },
};
