import { randomUUID } from "node:crypto";
import type { Collections } from "../../infrastructure/mongodb/collections.js";
import type { SecurityEventRecord } from "../../shared/types.js";
import type { ClientSession } from "mongodb";

export async function recordSecurityEvent(input: {
  collections: Pick<Collections, "securityEvents">;
  ownerUserId: string | null;
  sessionId?: string | null;
  eventType: string;
  outcome: "success" | "failure";
  correlationId: string;
  metadata?: Record<string, string | number | boolean | null>;
  mongoSession?: ClientSession;
}): Promise<void> {
  const event: Omit<SecurityEventRecord, "_id"> = {
    publicId: randomUUID(),
    ownerUserId: input.ownerUserId,
    sessionId: input.sessionId ?? null,
    eventType: input.eventType,
    outcome: input.outcome,
    correlationId: input.correlationId,
    metadata: input.metadata ?? {},
    createdAt: new Date(),
  };
  await input.collections.securityEvents.insertOne(event as unknown as SecurityEventRecord, {
    ...(input.mongoSession ? { session: input.mongoSession } : {}),
  });
}

/**
 * Reports a failed audit write. Audit writes stay non-fatal — a failed trail must never turn a
 * verified action into an error the caller cannot recover from — but the gap must be visible: an
 * action that proceeds without its authorization event, with no log or metric showing it, is a
 * hole nobody can investigate. Callers use this in the `catch` of every best-effort audit write.
 */
export function logAuditFailure(eventType: string, error: unknown): void {
  console.error(`[security-audit] failed to record "${eventType}":`, error instanceof Error ? error.message : String(error));
}
