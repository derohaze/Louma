import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as security from "../../security/service.js";
import * as wallets from "../../wallets/service.js";
import { loginPasswordSchema, passwordSchema, totpCodeSchema } from "../schemas.js";
import { authenticated, getAuth, parseBody } from "../http-helpers.js";

export async function registerSecurityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/security", authenticated, async (request) =>
    security.getSecurityOverview({
      collections: app.collections,
      config: app.config,
      ownerUserId: getAuth(request).userId,
    }),
  );

  // Every second-factor change asks for the account password as well as the proof that change needs.
  // A session alone must not be able to bind an authenticator (a stolen one could add a factor the
  // owner does not hold), and a code alone must not be able to weaken the factor it proves.
  app.post(
    "/api/v1/security/2fa/enable",
    { ...authenticated, config: { rateLimit: { max: 5, timeWindow: 60_000 } } },
    async (request) => {
      const body = parseBody(z.object({ password: loginPasswordSchema }).strict(), request.body);
      return security.beginTwoFactorSetup({
        collections: app.collections,
        config: app.config,
        ownerUserId: getAuth(request).userId,
        ...body,
      });
    },
  );
  app.post("/api/v1/security/2fa/confirm", authenticated, async (request) => {
    const body = parseBody(z.object({ code: totpCodeSchema }).strict(), request.body);
    return security.confirmTwoFactorSetup({
      collections: app.collections,
      config: app.config,
      ownerUserId: getAuth(request).userId,
      ...body,
      requestId: request.id,
    });
  });
  app.post("/api/v1/security/2fa/disable", authenticated, async (request) => {
    const body = parseBody(
      z.object({ password: loginPasswordSchema, code: z.string().min(6).max(64) }).strict(),
      request.body,
    );
    return security.disableTwoFactor({
      collections: app.collections,
      config: app.config,
      mongoClient: app.mongoClient,
      ownerUserId: getAuth(request).userId,
      ...body,
      requestId: request.id,
    });
  });
  app.post("/api/v1/security/2fa/recovery-codes", authenticated, async (request) => {
    const body = parseBody(
      z.object({ password: loginPasswordSchema, code: z.string().min(6).max(64) }).strict(),
      request.body,
    );
    return security.regenerateRecoveryCodes({
      collections: app.collections,
      config: app.config,
      ownerUserId: getAuth(request).userId,
      ...body,
      requestId: request.id,
    });
  });
  app.post("/api/v1/security/freeze", authenticated, async (request) =>
    wallets.setWalletFrozen({
      collections: app.collections,
      ownerUserId: getAuth(request).userId,
      frozen: true,
      requestId: request.id,
    }),
  );
  app.post("/api/v1/security/unfreeze", authenticated, async (request) => {
    const body = parseBody(
      z.object({ password: loginPasswordSchema, code: z.string().min(6).max(64).optional() }).strict(),
      request.body,
    );
    const current = getAuth(request);
    await security.verifySensitiveAction({
      collections: app.collections,
      config: app.config,
      ownerUserId: current.userId,
      password: body.password,
      code: body.code,
      requestId: request.id,
      action: "wallet_unfreeze_authorized",
    });
    return wallets.setWalletFrozen({
      collections: app.collections,
      ownerUserId: current.userId,
      frozen: false,
      requestId: request.id,
    });
  });
  app.post("/api/v1/security/transfer-password", authenticated, async (request) => {
    const body = parseBody(
      z.object({ currentPassword: z.string().max(128).optional(), newPassword: passwordSchema }).strict(),
      request.body,
    );
    return security.setTransferPassword({
      collections: app.collections,
      mongoClient: app.mongoClient,
      ownerUserId: getAuth(request).userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      requestId: request.id,
    });
  });
}
