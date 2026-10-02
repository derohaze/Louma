import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as transfers from "../../transfers/service.js";
import { MAX_NOTE_LENGTH } from "../../../shared/types.js";
import { pageLimitSchema, publicIdSchema, transferPreviewSchema, transferSchema } from "../schemas.js";
import { authenticated, getAuth, parseBody } from "../http-helpers.js";
import { displayNameCache, enforceRateLimit, settingsCache } from "../../../app.js";

export async function registerTransferRoutes(app: FastifyInstance): Promise<void> {
  /**
   * The staged transfer form's own read: resolving the recipient address, and quoting the tax and the
   * balance for an amount.
   *
   * It is a POST even though it writes nothing, for two reasons: the address a sender is about to pay
   * is not something this API puts in a URL (access logs, `Referer`, browser history), and a session
   * that is merely present in the browser must not be usable to probe which addresses exist from
   * another origin — a state-changing method is the one the CSRF guard covers.
   */
  app.post(
    "/api/v1/transfers/preview",
    {
      ...authenticated,
      config: { rateLimit: { max: 30, timeWindow: 60_000 } },
      schema: {
        body: {
          type: "object",
          required: ["recipientAddress"],
          additionalProperties: false,
          properties: {
            recipientAddress: { type: "string", minLength: 1, maxLength: 128 },
            amount: { type: "string", minLength: 1, maxLength: 32 },
            note: { type: "string", maxLength: MAX_NOTE_LENGTH },
          },
        },
      },
    },
    async (request, reply) => {
      const body = parseBody(transferPreviewSchema, request.body);
      const auth = getAuth(request);
      const ok = await enforceRateLimit({ app, reply, scope: "transfer-preview", identity: auth.userId, limit: app.config.redis.transferPreviewMaxPerMinute, requestId: request.id });
      if (!ok) return reply;
      return {
        preview: await transfers.previewTransfer({
          collections: app.collections,
          ownerUserId: auth.userId,
          displayNameCache: displayNameCache(app),
          recipientAddress: body.recipientAddress,
          amount: body.amount,
          note: body.note,
          requestId: request.id,
        }),
      };
    },
  );

  app.post(
    "/api/v1/transfers",
    {
      ...authenticated,
      config: { rateLimit: { max: 30, timeWindow: 60_000 } },
      schema: {
        headers: {
          type: "object",
          properties: { "idempotency-key": { type: "string", minLength: 8, maxLength: 128 } },
        },
        body: {
          type: "object",
          required: ["authorizationId", "recipientAddress", "amount"],
          additionalProperties: false,
          properties: {
            authorizationId: { type: "string", format: "uuid" },
            recipientAddress: { type: "string", minLength: 1, maxLength: 128 },
            amount: { type: "string", minLength: 1, maxLength: 32 },
            note: { type: "string", maxLength: MAX_NOTE_LENGTH },
            transferPassword: { type: "string", minLength: 1, maxLength: 128 },
            twoFactorCode: { type: "string", minLength: 6, maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const current = getAuth(request);
      const body = parseBody(transferSchema, request.body);
      // No distributed throttle on execution: duplicate submits are answered by the idempotency
      // record (same key replays, never re-executes) and credential guessing is bounded by the
      // authorization-attempt limit. A per-minute cap here would refuse legitimate concurrent
      // transfers with 429 while telling the client the money was refused.
      const result = await transfers.createTransfer({
        collections: app.collections,
        mongoClient: app.mongoClient,
        config: app.config,
        cache: settingsCache(app),
        ownerUserId: current.userId,
        ...body,
        idempotencyKey: Array.isArray(request.headers["idempotency-key"])
          ? request.headers["idempotency-key"][0]
          : request.headers["idempotency-key"],
        requestId: request.id,
      });
      return reply.code(result.replayed ? 200 : 201).send({ transaction: result, transfer: result });
    },
  );

  app.get("/api/v1/transfers/:id", authenticated, async (request) => {
    const params = parseBody(z.object({ id: publicIdSchema }).strict(), request.params);
    return {
      transfer: await transfers.getTransaction({
        collections: app.collections,
        ownerUserId: getAuth(request).userId,
        transactionId: params.id,
      }),
    };
  });

  app.get("/api/v1/transactions", authenticated, async (request) => {
    const query = parseBody(
      z
        .object({
          cursor: z.string().uuid().optional(),
          limit: pageLimitSchema,
          direction: z.enum(["sent", "received", "all"]).optional(),
        })
        .strict(),
      request.query,
    );
    return transfers.listTransactions({
      collections: app.collections,
      ownerUserId: getAuth(request).userId,
      cursor: query.cursor,
      limit: query.limit,
      direction: query.direction,
    });
  });

  app.get("/api/v1/transactions/:id", authenticated, async (request) => {
    const params = parseBody(z.object({ id: publicIdSchema }).strict(), request.params);
    return {
      transaction: await transfers.getTransaction({
        collections: app.collections,
        ownerUserId: getAuth(request).userId,
        transactionId: params.id,
      }),
    };
  });
}
