import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createAccessToken, verifyAccessToken } from "./access-token.js";

const secret = randomBytes(32);
const claims = () => ({ userId: randomUUID(), sessionId: randomUUID() });

test("an access token round-trips its claims", async () => {
  const issued = claims();
  const token = await createAccessToken(issued, secret);
  assert.deepEqual(await verifyAccessToken(token, secret), issued);
});

test("a token signed with another secret is rejected", async () => {
  const token = await createAccessToken(claims(), randomBytes(32));
  await assert.rejects(() => verifyAccessToken(token, secret));
});

test("a malformed or empty token is rejected", async () => {
  await assert.rejects(() => verifyAccessToken("", secret));
  await assert.rejects(() => verifyAccessToken("not.a.jwt", secret));
});

test("an expired access token is rejected", async () => {
  const issued = claims();
  const expired = await new SignJWT({ typ: "access", sid: issued.sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(issued.userId)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(secret);
  await assert.rejects(() => verifyAccessToken(expired, secret));
});

test("a token without the access marker is rejected", async () => {
  const issued = claims();
  const refreshLike = await new SignJWT({ typ: "refresh", sid: issued.sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(issued.userId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
  await assert.rejects(() => verifyAccessToken(refreshLike, secret));
});
