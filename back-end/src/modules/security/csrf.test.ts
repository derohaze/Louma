import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import {
  assertCsrfToken,
  isStateChangingMethod,
  preauthCsrfToken,
  sessionCsrfToken,
} from "./csrf.js";

/**
 * The CSRF token is what separates a request the wallet made from one another site made on the
 * customer's behalf, so what matters here is that it is derived per scope, keyed by the application's
 * own secret, and refused everywhere else — including when it is absent, repeated, or truncated.
 */
const base = {
  MONGODB_URI: "mongodb://127.0.0.1:27017/louma",
  MONGODB_DATABASE: "louma",
  ACCESS_TOKEN_SECRET: Buffer.alloc(32, 1).toString("base64"),
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
};
const config = loadConfig({ ...base });

const isAppError =
  (code: string) =>
  (error: unknown): boolean =>
    error instanceof AppError && error.code === code;

test("a scope always derives the same token, and scopes never share one", () => {
  assert.equal(preauthCsrfToken(config), preauthCsrfToken(config));
  assert.equal(sessionCsrfToken(config, "session-a"), sessionCsrfToken(config, "session-a"));
  const distinct = new Set([
    preauthCsrfToken(config),
    sessionCsrfToken(config, "session-a"),
    sessionCsrfToken(config, "session-b"),
  ]);
  assert.equal(distinct.size, 3, "each scope has its own token");
});

test("a session token is keyed, not a hash of the session id", () => {
  const otherKey = loadConfig({ ...base, APP_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64") });
  assert.notEqual(
    sessionCsrfToken(otherKey, "session-a"),
    sessionCsrfToken(config, "session-a"),
    "reading the session id is not enough to produce the token",
  );
});

test("a token is accepted by its own scope and refused by every other", () => {
  const session = sessionCsrfToken(config, "session-a");
  assert.doesNotThrow(() => assertCsrfToken({ config, provided: session, expected: session }));
  assert.throws(
    () => assertCsrfToken({ config, provided: preauthCsrfToken(config), expected: session }),
    isAppError("csrf_token_invalid"),
  );
  assert.throws(
    () => assertCsrfToken({ config, provided: sessionCsrfToken(config, "session-b"), expected: session }),
    isAppError("csrf_token_invalid"),
  );
});

test("a missing, repeated, oversized, or truncated token is refused", () => {
  const expected = preauthCsrfToken(config);
  for (const provided of [undefined, null, "", 42, ["a", "b"], "x".repeat(200), expected.slice(0, -1)]) {
    assert.throws(
      () => assertCsrfToken({ config, provided, expected }),
      isAppError("csrf_token_invalid"),
      String(provided),
    );
  }
});

test("only the methods that change state have to prove themselves", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(isStateChangingMethod(method), false, method);
  }
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    assert.equal(isStateChangingMethod(method), true, method);
  }
});
