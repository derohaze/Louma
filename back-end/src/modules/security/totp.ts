import { verify } from "otplib";

/** Six digits is what an authenticator app produces; anything else is a recovery code. */
const TOTP_TOKEN_PATTERN = /^\d{6}$/;

/**
 * Verifies a one-time authenticator code and never throws.
 *
 * otplib reports a malformed token by throwing, and every caller here also accepts a recovery code,
 * which is not six digits: without this guard the recovery path would answer 500 instead of falling
 * through to the recovery-code check.
 */
export async function verifyTotpToken(secret: string, token: string): Promise<boolean> {
  if (!TOTP_TOKEN_PATTERN.test(token)) return false;
  const result = await verify({ secret, token }).catch(() => null);
  return result?.valid === true;
}
