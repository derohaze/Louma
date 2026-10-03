export default {
  title: "Transfer",
  description: "Send LMA to another wallet address.",
  frozenNotice: "The wallet is frozen, so every transfer is refused.",
  unfreeze: "Unfreeze it",
  availableBalance: "Available balance",
  taxNote:
    "The 1% network tax is taken from what the sender pays; the recipient receives the rest.",
  credential: {
    required: "A credential is required",
    none: "No credential is set",
    accepts: "This wallet accepts {methods} before any LMA leaves it.",
    methodsBoth: "your transfer password or an authenticator code",
    methodsPassword: "your transfer password",
    methodsCode: "an authenticator code",
    without:
      "Without a transfer password or an authenticator, a signed-in session can move funds on its own.",
    setUp: "Set up a credential",
    final: "Transfers are final after submission. Nothing moves until the last step.",
  },
};
