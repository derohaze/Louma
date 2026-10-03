export default {
  title: "Mining Pools",
  description: "Join a pool first — mining is only possible from inside one.",
  shortDescription: "Join a pool to start mining.",
  loadError: "Couldn't load mining pools",
  retry: "Try again",
  goToMining: "Go to mining",
  joined:
    "You are mining in {pool} · your speed {power} H ({share}% of the room). Switch rooms anytime — the running cycle keeps the room it started in.",
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
    cycleValue: "24 hours · tagged with this room",
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
    switchTo: "Switch to {pool}",
    join: "Join {pool}",
  },
  how: {
    title: "How rooms work",
    description: "The rules both rooms share.",
    membership: "Membership",
    membershipValue: "One room at a time — join or switch anytime",
    gate: "Mining gate",
    gateValue: "Start is refused until you join a room",
    cycleLength: "Cycle length",
    cycleLengthValue: "Exactly 24 hours, tagged with its room",
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
