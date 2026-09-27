import { SignJWT, jwtVerify } from "jose";
import { ACCESS_TOKEN_TTL_SECONDS } from "../../shared/types.js";
import { unauthorized } from "../../shared/errors.js";

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

export async function createAccessToken(claims: AccessClaims, secret: Buffer): Promise<string> {
  return new SignJWT({ typ: "access", sid: claims.sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string, secret: Buffer): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (payload["typ"] !== "access" || typeof payload.sub !== "string" || typeof payload["sid"] !== "string") {
      throw unauthorized();
    }
    return { userId: payload.sub, sessionId: payload["sid"] };
  } catch {
    throw unauthorized();
  }
}
