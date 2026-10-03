export default {
  set: {
    title: "Transfer password is set",
    body: "Every transfer asks for it before any LMA leaves the wallet.",
    action: "Change transfer password",
    submit: "Update password",
  },
  unset: {
    title: "No transfer password is set",
    body: "Without it, a signed-in session can move funds on its own.",
    action: "Set transfer password",
    submit: "Set password",
  },
  description: "Separate from your wallet password, so a leaked sign-in cannot move funds.",
  current: "Current transfer password",
  next: "New transfer password",
  nextHint: "At least 8 characters",
  repeat: "Repeat new transfer password",
  rules: {
    title: "When it applies",
    description: "Rules the wallet follows on every transfer.",
    everyTransfer: "Every transfer",
    required: "This password is required",
    notRequired: "Not required",
    wrongPassword: "Wrong password",
    wrongPasswordDetail: "The transfer is refused before any LMA leaves the wallet",
  },
  errors: {
    currentRequired: "Enter your current transfer password.",
  },
  messages: {
    saved: "Transfer password updated.",
  },
};
