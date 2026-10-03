export default {
  on: {
    title: "Two-factor authentication is on",
  },
  off: {
    title: "Two-factor authentication is off",
    body: "Turn the switch on to set up an authenticator app: confirm your account password, then scan the secret key and enter the first code it shows.",
  },
  switchLabel: "Two-factor authentication",
  disable: {
    body: "Enter your account password and a current authenticator or recovery code to turn two-factor off.",
    action: "Turn off two-factor",
    busy: "Turning off…",
  },
  enabled: {
    remainingOne: "{count} recovery code remaining",
    remaining: "{count} recovery codes remaining",
    enabledAt: " · enabled {date}",
  },
  start: {
    body: "Confirm your account password to start setting up an authenticator app.",
    action: "Start setup",
    busy: "Starting…",
  },
  setup: {
    key: "Authenticator key",
    code: "Six-digit code",
    qrLabel: "Authenticator setup QR code",
    confirm: "Turn on two-factor",
    checking: "Checking…",
  },
  fields: {
    password: "Account password",
    code: "Authenticator or recovery code",
  },
  recovery: {
    title: "Recovery codes",
    description: "Each code works once. They are shown only now.",
    copyNote: "Copy them somewhere safe before leaving this page.",
  },
  regenerate: {
    title: "Regenerate recovery codes",
    description: "Your account password and a current authenticator or recovery code are required.",
    action: "Generate new codes",
  },
  messages: {
    started: "Scan the key in your authenticator app, then enter the six-digit code it shows.",
    enabled: "Two-factor authentication is on. Store your recovery codes now.",
    disabled: "Two-factor authentication is off.",
    regenerated: "New recovery codes generated. The old set no longer works.",
  },
};
