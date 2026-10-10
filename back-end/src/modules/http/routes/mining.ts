import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as mining from "../../mining/service.js";
import * as pools from "../../mining/pools.js";
import { historyWindowDays } from "../../subscriptions/service.js";
import { authBody, historyDaysSchema, pageLimitSchema } from "../schemas.js";
import { authenticated, miningRateLimit, clientIp, getAuth, parseBody } from "../http-helpers.js";
import { enforceRateLimit, membershipCache, settingsCache } from "../../../app.js";

export async function registerMiningRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Mining is persisted segments plus a clock, so these endpoints read and settle state; they never
   * accept a rate, a window, or an elapsed time from the caller. `start`, `stop`, and `settle` are
   * the only writes, all safe to repeat: `start` while a segment runs is refused, `stop` with no
   * active segment returns the current state, and a settle with nothing new to post writes nothing.
   */
  app.get(
    "/api/v1/mining/state",
    { ...authenticated, config: { rateLimit: miningRateLimit(app.config, 240, 60_000) } },
    async (request) =>
      mining.getMiningState({
        collections: app.collections,
        config: app.config,
        ownerUserId: getAuth(request).userId,
        cache: settingsCache(app),
        membershipCache: membershipCache(app),
      }),
  );

  /**
   * Community mining rooms (MVP): two system pools, a held room required to start.
   *
   * A membership is a hold that ends with the cycle it justified: joining grants the room for the
   * join -> start step, a start extends it to the cycle's end, and stopping or finishing releases
   * it. Joining the room already held is an idempotent no-op; changing rooms is refused while a
   * cycle runs (stop first — stopping releases the room) and throttled once per cooldown. Counts
   * are live holds only.
   */
  app.get("/api/v1/mining/pools", { ...authenticated, config: { rateLimit: miningRateLimit(app.config, 120, 60_000) } }, async (request) =>
    pools.getMiningPoolsState({
      collections: app.collections,
      config: app.config,
      ownerUserId: getAuth(request).userId,
      cache: settingsCache(app),
      membershipCache: membershipCache(app),
    }),
  );

  // Room changes are writes with a churn cost, so both are bounded per caller on top of the
  // server-side cooldown (which is what actually throttles switching, with or without Redis).
  app.post(
    "/api/v1/mining/pools/join",
    { ...authenticated, config: { rateLimit: miningRateLimit(app.config, 20, 60_000) } },
    async (request) => {
      const body = parseBody(z.object({ poolId: z.enum(["low", "medium"]) }).strict(), request.body ?? {});
      return pools.joinMiningPool({
        collections: app.collections,
        config: app.config,
        ownerUserId: getAuth(request).userId,
        poolId: body.poolId,
        cache: settingsCache(app),
        membershipCache: membershipCache(app),
      });
    },
  );

  app.post(
    "/api/v1/mining/pools/leave",
    { ...authenticated, config: { rateLimit: miningRateLimit(app.config, 20, 60_000) } },
    async (request) =>
      pools.leaveMiningPool({
        collections: app.collections,
        config: app.config,
        ownerUserId: getAuth(request).userId,
        cache: settingsCache(app),
        membershipCache: membershipCache(app),
      }),
  );

  app.post(
    "/api/v1/mining/start",
    {
      ...authenticated,
      config: { rateLimit: miningRateLimit(app.config, 10, 60_000) },
      schema: authBody(z.object({ device: z.unknown().optional(), proofNonce: z.string().min(16).max(128).optional(),
        verification: z.object({ password: z.string().min(1).max(128), twoFactorCode: z.string().max(64).optional() }).strict().optional() }).strict()),
    },
    async (request, reply) => {
      // Distributed abuse throttle, fail-open: a Redis outage never blocks a legitimate start.
      const starter = getAuth(request);
      const allowed = await enforceRateLimit({ app, reply, scope: "mining-start", identity: starter.userId, limit: app.config.redis.miningStartMaxPerMinute, requestId: request.id });
      if (!allowed) return reply;
      // Browser mode requires key evidence and a fresh proof in the service layer.
      // The transport remains optional for strict maintenance and legacy audit handling.
      const body = parseBody(z.object({ device: z.unknown().optional(), proofNonce: z.string().min(16).max(128).optional(),
        verification: z.object({ password: z.string().min(1).max(128), twoFactorCode: z.string().max(64).optional() }).strict().optional() }).strict(), request.body ?? {});
      const current = getAuth(request);
      return mining.startMining({
        collections: app.collections,
        mongoClient: app.mongoClient,
        config: app.config,
        ownerUserId: current.userId,
        correlationId: request.id,
        cache: settingsCache(app),
        membershipCache: membershipCache(app),
        ...(body.device === undefined
          ? {}
          : { device: { evidenceRaw: body.device, ip: clientIp(request).slice(0, 45), proofNonce: body.proofNonce,
              origin: request.headers.origin ?? null, verification: body.verification } }),
      });
    },
  );

  app.post(
    "/api/v1/mining/stop",
    { ...authenticated, config: { rateLimit: miningRateLimit(app.config, 30, 60_000) } },
    async (request) =>
      mining.stopMining({
        collections: app.collections,
        mongoClient: app.mongoClient,
        config: app.config,
        ownerUserId: getAuth(request).userId,
        correlationId: request.id,
        cache: settingsCache(app),
        membershipCache: membershipCache(app),
      }),
  );

  app.post(
    "/api/v1/mining/settle",
    { ...authenticated, config: { rateLimit: miningRateLimit(app.config, 30, 60_000) } },
    async (request) =>
      mining.settleMining({
        collections: app.collections,
        mongoClient: app.mongoClient,
        config: app.config,
        ownerUserId: getAuth(request).userId,
        correlationId: request.id,
        cache: settingsCache(app),
        membershipCache: membershipCache(app),
      }),
  );

  app.get("/api/v1/mining/history", { ...authenticated, config: { rateLimit: miningRateLimit(app.config, 120, 60_000) } }, async (request) => {
    const query = parseBody(
      z.object({ cursor: z.string().uuid().optional(), limit: pageLimitSchema, days: historyDaysSchema }).strict(),
      request.query,
    );
    const days = await historyWindowDays(app.collections, getAuth(request).userId, query.days);
    return mining.listMiningHistory({
      collections: app.collections,
      config: app.config,
      ownerUserId: getAuth(request).userId,
      cursor: query.cursor,
      limit: query.limit,
      days,
    });
  });
}
