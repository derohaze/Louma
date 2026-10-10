import type { FastifyInstance } from "fastify";
import { enforceMiningAttempt } from "../../mining-device/attempts.js";
import { z } from "zod";
import * as deviceGuard from "../../mining-device/service.js";
import { authenticated, clientIp, getAuth, parseBody } from "../http-helpers.js";

export async function registerMiningDeviceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * LMDG device endpoints. None of them exposes another account, an IP, a fingerprint, or a risk
   * score — only this account's own lease state and its own challenge nonces.
   */
  app.post(
    "/api/v1/mining/device/challenge",
    { ...authenticated, config: { rateLimit: { max: 20, timeWindow: 3_600_000 } } },
    async (request) => {
      const current = getAuth(request);
      await enforceMiningAttempt(app.collections, current.userId, "challenge");
      const body = parseBody(
        z.object({ deviceKeyHash: z.string().max(128).optional(), device: z.unknown().optional() }).strict(),
        request.body ?? {},
      );
      // The origin header is the value the browser itself attached to this request: binding the
      // challenge to it is what stops a proof minted on (or claimed for) another origin.
      const originHeader = request.headers["origin"];
      const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
      // The device binding is resolved server-side from the evidence — never taken from the body. The
      // challenge payload commits to the server-owned identity the evidence describes, so a proof
      // minted for one enrollment cannot be spent on another.
      const binding =
        body.device === undefined
          ? null
          : await deviceGuard.resolveDeviceBinding({
              collections: app.collections,
              config: app.config,
              evidenceRaw: body.device,
            });
      return deviceGuard.issueChallenge({
        collections: app.collections,
        config: app.config,
        ownerUserId: current.userId,
        deviceKeyHash: body.deviceKeyHash ?? null,
        binding,
        origin: origin ?? null,
        correlationId: request.id,
      });
    },
  );

  app.post(
    "/api/v1/mining/device/prove",
    { ...authenticated, config: { rateLimit: { max: 30, timeWindow: 3_600_000 } } },
    async (request) => {
      const current = getAuth(request);
      await enforceMiningAttempt(app.collections, current.userId, "prove");
      const body = parseBody(
        z
          .object({
            nonce: z.string().min(16).max(128),
            signature: z.string().min(16).max(2048),
            publicKeyJwk: z.record(z.string(), z.unknown()),
            device: z.unknown().optional(),
          })
          .strict(),
        request.body,
      );
      // The proof binds the origin the request actually arrived on: a signed payload replayed from a
      // different origin (or a forged signature claiming another) fails the canonical comparison.
      const originHeader = request.headers["origin"];
      const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
      // Recomputed here, independently of the challenge request: the proof is only valid for the same
      // server-resolved enrollment the handshake was issued for.
      const binding =
        body.device === undefined
          ? null
          : await deviceGuard.resolveDeviceBinding({
              collections: app.collections,
              config: app.config,
              evidenceRaw: body.device,
            });
      return deviceGuard.verifyProof({
        collections: app.collections,
        config: app.config,
        ownerUserId: current.userId,
        nonce: body.nonce,
        signature: body.signature,
        publicKeyJwk: body.publicKeyJwk,
        binding,
        // The proof credits the network context it was actually answered from, so a verified handshake
        // counts as activity on the network it happened on (never on one it was only claimed for).
        ip: clientIp(request) ?? null,
        origin: origin ?? null,
        correlationId: request.id,
      });
    },
  );

  app.get("/api/v1/mining/device/status", authenticated, async (request) =>
    deviceGuard.getDeviceStatus({
      collections: app.collections,
      ownerUserId: getAuth(request).userId,
    }),
  );
}
