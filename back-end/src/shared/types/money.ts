export const CURRENCY = "LMA";
export const MONEY_DECIMALS = 4;
export const MONEY_SCALE = 10_000;
/**
 * The largest amount a single transfer may carry, in minor units.
 *
 * There is no longer a product ceiling here: a wallet must be able to move any amount it can hold,
 * so the only bound left is the one the arithmetic itself imposes. Money is an exact integer of
 * minor units, and a JavaScript number — and therefore a BSON number — represents every integer up
 * to 2^53 exactly.
 *
 * This is the largest whole amount below that boundary. Stopping at a whole amount leaves slack for
 * the fee's rounding step (it adds half a minor unit before dividing), so every intermediate the
 * money arithmetic produces — the fee, the recipient's net, each ledger line — stays an exact
 * integer rather than relying on a rounding that is itself unrepresentable.
 */
export const MAX_TRANSFER_MINOR = Math.floor(Number.MAX_SAFE_INTEGER / MONEY_SCALE) * MONEY_SCALE;
export const MIN_TRANSFER_MINOR = 1;
export const FEE_PERCENT = 1;
export const MAX_NOTE_LENGTH = 240;

/**
 * The largest amount a single ledger line may carry, in minor units. It equals the maximum transfer
 * amount — the largest movement the product can produce — so every financial document (account
 * projection, ledger entry, transaction amount) is bounded by it, which keeps every persisted money
 * integer inside the safe-integer range no matter how many operations land.
 */
export const LEDGER_AMOUNT_MAX_MINOR = MAX_TRANSFER_MINOR;

/**
 * The largest value an account projection may hold, in minor units. Unlike a single ledger line
 * (bounded by `LEDGER_AMOUNT_MAX_MINOR`, the largest movement the product can produce), a projection
 * accumulates every movement that lands on the account, so it is bounded by the exact-integer range
 * instead: a wallet or the fee account must not hit a ceiling just because it has been used a lot.
 */
export const LEDGER_BALANCE_MAX_MINOR = Number.MAX_SAFE_INTEGER;
