import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as auth from "../../auth/service.js";
import * as wallets from "../../wallets/service.js";
import { getSubscription, requirePro } from "../../subscriptions/service.js";
import { listAddressHistory } from "../../../infrastructure/mongodb/subscription-repository.js";
import { publicIdSchema } from "../schemas.js";
import { authenticated, getAuth, parseBody } from "../http-helpers.js";

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/me", authenticated, async (request) =>
    auth.getCurrentUser({ collections: app.collections, ownerUserId: getAuth(request).userId }),
  );
  app.patch("/api/v1/me", authenticated, async (request) => {
    const body = parseBody(
      z
        .object({
          displayName: z.string().trim().min(1).max(32).optional(),
          country: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
        })
        .strict()
        .refine((value) => value.displayName !== undefined || value.country !== undefined),
      request.body,
    );
    return {
      user: await auth.updateProfile({
        collections: app.collections,
        ownerUserId: getAuth(request).userId,
        ...body,
        requestId: request.id,
        redis: app.redis,
      }),
    };
  });

  app.get("/api/v1/wallet", authenticated, async (request) => ({
    wallet: await wallets.getWallet({
      collections: app.collections,
      ownerUserId: getAuth(request).userId,
    }),
  }));

  app.get("/api/v1/subscription", authenticated, async (request) => ({ subscription: await getSubscription(app.collections, getAuth(request).userId) }));

  app.get("/api/v1/wallet/custom-address", authenticated, async (request) => {
    const ownerUserId = getAuth(request).userId;
    const subscription = await requirePro(app.collections, ownerUserId);
    const history = await listAddressHistory(app.collections, ownerUserId);
    return { subscription, history: history.map((row) => ({ id: row.publicId, previousAddress: row.previousAddress, nextAddress: row.nextAddress, reason: row.reason, createdAt: row.createdAt.toISOString() })) };
  });

  app.patch("/api/v1/wallet/custom-address", authenticated, async (request) => {
    await requirePro(app.collections, getAuth(request).userId);
    const body = parseBody(z.object({ address: z.string().min(3).max(16) }).strict(), request.body);
    return {
      wallet: await wallets.setCustomAddress({
        collections: app.collections,
        mongoClient: app.mongoClient,
        ownerUserId: getAuth(request).userId,
        handle: body.address,
        requestId: request.id,
      }),
    };
  });

  app.get("/api/v1/sessions", authenticated, async (request) => ({
    sessions: await auth.listSessions({
      collections: app.collections,
      ownerUserId: getAuth(request).userId,
      currentSessionId: getAuth(request).sessionId,
    }),
  }));
  app.delete("/api/v1/sessions/:id", authenticated, async (request, reply) => {
    const params = parseBody(z.object({ id: publicIdSchema }).strict(), request.params);
    const current = getAuth(request);
    await auth.revokeSession({
      collections: app.collections,
      ownerUserId: current.userId,
      sessionId: params.id,
      currentSessionId: current.sessionId,
      requestId: request.id,
    });
    return reply.code(204).send();
  });
}
