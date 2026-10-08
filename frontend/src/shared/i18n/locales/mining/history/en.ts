export default {
  title: "Mining History",
  description: "Every past mining cycle with its rate, earnings, and collected rewards.",
  heading: "Cycle history",
  headingNote: "Mining cycles and rewards inside the selected period",
  range: {
    label: "History period",
    last1: "Last 24 hours",
    last7: "Last 7 days",
    last30: "Last 30 days",
    last90: "Last 90 days",
    last120: "Last 120 days",
  },
  loading: "Loading cycles…",
  empty: {
    title: "No cycles yet",
    detail: "Start your first mining cycle above — it will be remembered here once it ends.",
  },
  stats: {
    collected: "Collected",
    cycles: "Cycles",
    averageRate: "Average rate",
  },
  status: {
    active: "Running",
    completed: "Ready to collect",
    settled: "Collected",
  },
  cycle: "Cycle #{number}",
  cycleMeta: "{rate} LMA/h · ended {date}",
  earned: "earned {amount}",
  loadOlder: "Load older cycles",
};
