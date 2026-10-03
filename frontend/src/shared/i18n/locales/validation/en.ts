/**
 * What the shared validators answer with: the amount and password rules every form in the wallet
 * applies. Read through `translate()` in `shared/lib/platform/validation`, which no component owns —
 * the same messages are shown by the transfer form and the security pages.
 */
export default {
  amount: {
    empty: "Enter an amount.",
    invalid: "Enter a positive amount, with up to four decimals.",
    zero: "Enter an amount greater than zero.",
    tooSmall: "That amount is too small to send.",
    tooLarge: "That amount is more than you can send.",
  },
  password: {
    minLength: "At least {min} characters",
    letter: "Contains a letter",
    number: "Contains a number",
    tooLong: "Use at most {max} characters.",
    weak: "Use at least {min} characters with both letters and numbers.",
    mismatch: "The two passwords do not match.",
  },
};
