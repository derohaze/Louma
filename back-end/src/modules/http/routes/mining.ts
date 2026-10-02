import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as mining from "../../mining/service.js";
import * as pools from "../../mining/pools.js";
import { authBody, pageLimitSchema } from "../schemas.js";
import { authenticated, getAuth, parseBody } from "../http-helpers.js";
import { enforceRateLimit, membershipCache, settingsCache } from "../../../app.js";

export async function registerMiningRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Mining is a persisted cycle plus a clock, so these endpoints read and settle state; they never
   * accept a rate, a window, or an elapsed time from the caller. `start` and `settle` are the only
   * writes, and both are safe to repeat: `start` while a cycle runs is refused, and a settle with
   * nothing new to post writes nothing.
   */
  app.get(
    "/api/v1/mining/state",
    { ...authenticated, config: { rateLimit: { max: 240, timeWindow: 60_000 } } },
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
   * Community mining rooms (MVP): two system pools, membership required to start.
   * Join is an idempotent upsert (switching pools just moves the membership; the running
   * cycle keeps the pool it started in). Counts are live member counts.
   */
  app.get("/api/v1/mining/pools", authenticated, async (request) =>
    pools.getMiningPoolsState({
      collections: app.collections,
      config: app.config,
      ownerUserId: getAuth(request).userId,
      cache: settingsCache(app),
      membershipCache: membershipCache(app),
    }),
  );

  app.post("/api/v1/mining/pools/join", authenticated, async (request) => {
    const body = parseBody(z.object({ poolId: z.enum(["low", "medium"]) }).strict(), request.body ?? {});
    return pools.joinMiningPool({
      collections: app.collections,
      config: app.config,
      ownerUserId: getAuth(request).userId,
      poolId: body.poolId,
      cache: settingsCache(app),
      membershipCache: membershipCache(app),
    });
  });

  app.post("/api/v1/mining/pools/leave", authenticated, async (request) =>
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
      config: { rateLimit: { max: 10, timeWindow: 60_000 } },
      schema: authBody(z.object({ device: z.unknown().optional() }).loose()),
    },
    async (request, reply) => {
      // Distributed abuse throttle, fail-open: a Redis outage never blocks a legitimate start.
      const starter = getAuth(request);
      const allowed = await enforceRateLimit({ app, reply, scope: "mining-start", identity: starter.userId, limit: app.config.redis.miningStartMaxPerMinute, requestId: request.id });
      if (!allowed) return reply;
      // Device evidence is optional: old clients and existing tests keep working, and the
      // per-account unique index still applies. When present it is sanitized server-side and
      // enforced through the LMDG lease — the server stays authoritative, never the client.
      const body = (request.body ?? {}) as { device?: unknown };
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
          : { device: { evidenceRaw: body.device, ip: request.ip.slice(0, 45) } }),
      });
    },
  );

  app.post(
    "/api/v1/mining/settle",
    { ...authenticated, config: { rateLimit: { max: 30, timeWindow: 60_000 } } },
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

  app.get("/api/v1/mining/history", authenticated, async (request) => {
    const query = parseBody(
      z.object({ cursor: z.string().uuid().optional(), limit: pageLimitSchema }).strict(),
      request.query,
    );
    return mining.listMiningHistory({
      collections: app.collections,
      config: app.config,
      ownerUserId: getAuth(request).userId,
      cursor: query.cursor,
      limit: query.limit,
    });
  });
}
