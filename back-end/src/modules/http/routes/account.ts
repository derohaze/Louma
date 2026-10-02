import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as auth from "../../auth/service.js";
import * as wallets from "../../wallets/service.js";
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

  app.patch("/api/v1/wallet/custom-address", authenticated, async (request) => {
    const body = parseBody(z.object({ address: z.string().min(4).max(25) }).strict(), request.body);
    return {
      wallet: await wallets.setCustomAddress({
        collections: app.collections,
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
