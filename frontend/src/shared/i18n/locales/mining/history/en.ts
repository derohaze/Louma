export default {
  title: "Mining History",
  description: "Every past mining cycle with its rate, earnings, and collected rewards.",
  heading: "Cycle history",
  headingNote: "Every 24-hour cycle this account ran, newest first",
  loading: "Loading cycles…",
  empty: {
    title: "No cycles yet",
    detail: "Start your first 24-hour cycle above — it will be remembered here once it ends.",
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
