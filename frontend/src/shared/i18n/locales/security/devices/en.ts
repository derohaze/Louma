export default {
  panel: {
    title: "Signed-in devices",
    description: "Revoking a device ends its session on the next request.",
  },
  signOutOthers: "Sign out other devices",
  confirm: {
    title: "Sign out {count} other device(s)?",
    body: "They stay signed in until their next request, then need your credentials and a second factor again. This device is not affected.",
    action: "Sign them out",
  },
  loading: "Loading devices…",
  lastActive: "Last active {lastActive} · expires {expires}",
  thisDevice: "This device",
  currentSession: "Current session",
  signOut: "Sign out",
  empty: "No active sessions were found.",
  messages: {
    revoked: "{device} signed out.",
    revokedOthers: "{count} other session(s) signed out.",
  },
  lostDevice: {
    question: "Lost a device?",
    freeze: "Freeze the wallet",
    tail: "first, then revoke the session.",
  },
};
