import { connectMongo } from "../infrastructure/mongodb/client.js";
import { getCollections } from "../infrastructure/mongodb/collections.js";

/**
 * Read-only operational report of why starts were refused, for use before customers complain.
 *
 *   npm run ops:mining-refusals -- --hours 24
 *   npm run ops:mining-refusals -- --hours 72 --limit 40
 *
 * Every refusal already writes a `security_events` row with the machine-readable code in
 * `metadata.reason` (and, for the quota, the scope it ran out of). Nothing here is a new write path
 * and nothing here is an endpoint: it reads one slice of the database and prints it. The point is
 * that a burst of refusals — a cohort of new accounts that cannot start — is visible as a number
 * *before* it is visible as support tickets.
 *
 * Query shape: one range scan of `security_events` bounded by `createdAt`, then two grouped counts
 * (events per reason, then distinct accounts per reason). The collection's indexes are
 * `{ publicId }` and `{ ownerUserId, createdAt }`, so a global time-window scan is a collection scan
 * by design; that is why the plan is printed with the numbers. If the volume ever makes this scan
 * expensive, the fix is an index decision measured against this query — not a second query path.
 *
 * Exit codes: 0 = the report was produced, 2 = the run itself failed.
 */

const REFUSAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "mining_rejected",
  "mining_device_rejected",
  "mining_device_evidence_missing",
  "mining_device_conflict",
  "mining_device_network_in_use",
  "mining_device_enrollment_limited",
  "mining_device_challenge_failed",
]);

const MAX_WINDOW_HOURS = 24 * 30;

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? "";
}

function positiveInteger(name: string, raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid environment variable: ${name}`);
  return value;
}

function windowHours(): number {
  const raw = argument("--hours");
  if (raw === null) return 24;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_WINDOW_HOURS) {
    throw new Error(`--hours must be a whole number of hours between 1 and ${MAX_WINDOW_HOURS}`);
  }
  return value;
}

/** The plan stages of an explain result, so the operator can see scan vs. index without reading JSON. */
function planStages(node: unknown, found: string[] = []): string[] {
  if (node === null || typeof node !== "object") return found;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "indexName" && typeof value === "string") found.push(`index:${value}`);
    if (key === "stage" && typeof value === "string") found.push(value);
    planStages(value, found);
  }
  return found;
}

function text(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "(none)";
}

async function main(): Promise<void> {
  const mongoUri = process.env["MONGODB_URI"]?.trim();
  if (!mongoUri) throw new Error("Missing required environment variable: MONGODB_URI");
  if (!mongoUri.startsWith("mongodb://") && !mongoUri.startsWith("mongodb+srv://")) {
    throw new Error("MONGODB_URI must use the mongodb or mongodb+srv scheme");
  }
  const mongoDatabase = process.env["MONGODB_DATABASE"]?.trim();
  if (!mongoDatabase) throw new Error("Missing required environment variable: MONGODB_DATABASE");

  const config = {
    mongoUri,
    mongoDatabase,
    mongoConnectTimeoutMs: positiveInteger("MONGODB_CONNECT_TIMEOUT_MS", process.env["MONGODB_CONNECT_TIMEOUT_MS"], 5000),
    mongoServerSelectionTimeoutMs: positiveInteger("MONGODB_SERVER_SELECTION_TIMEOUT_MS", process.env["MONGODB_SERVER_SELECTION_TIMEOUT_MS"], 5000),
    mongoMaxPoolSize: positiveInteger("MONGODB_MAX_POOL_SIZE", process.env["MONGODB_MAX_POOL_SIZE"], 20),
  };

  const hours = windowHours();
  const limit = positiveInteger("--limit", argument("--limit") ?? undefined, 25);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const { client, db } = await connectMongo(config);
  try {
    const collections = getCollections(db);
    // Grouped by account first so "how many people" is answered by the data, not by a bounded sample
    // of rows: a reason hit by 400 accounts once each and a bug hit by one account 400 times are the
    // same event count and completely different incidents.
    const groups = await collections.securityEvents
      .aggregate<{ _id: { eventType: unknown; reason: unknown; scope: unknown }; events: number; accounts: number }>([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: {
              eventType: "$eventType",
              reason: "$metadata.reason",
              scope: "$metadata.scope",
              ownerUserId: "$ownerUserId",
            },
            events: { $sum: 1 },
          },
        },
        { $group: { _id: { eventType: "$_id.eventType", reason: "$_id.reason", scope: "$_id.scope" }, events: { $sum: "$events" }, accounts: { $sum: 1 } } },
        { $sort: { events: -1, accounts: -1 } },
      ])
      .toArray();

    const planned = await collections.securityEvents.find({ createdAt: { $gte: since } }).explain("queryPlanner");
    const winning = (planned as unknown as { queryPlanner?: { winningPlan?: unknown } }).queryPlanner?.winningPlan ?? null;
    const plan = [...new Set(planStages(winning))];

    const refusals = groups.filter((group) => REFUSAL_EVENT_TYPES.has(text(group._id.eventType)));
    const totals = {
      hours,
      since: since.toISOString(),
      events: groups.reduce((sum, group) => sum + group.events, 0),
      accounts: groups.reduce((sum, group) => sum + group.accounts, 0),
      refusalEvents: refusals.reduce((sum, group) => sum + group.events, 0),
      grounds: groups.length,
    };

    console.log(`security_events over the last ${hours}h (since ${totals.since})`);
    console.log(`${String("events").padStart(7)} ${String("accounts").padStart(8)}  eventType / reason / scope`);
    for (const group of groups.slice(0, limit)) {
      const line = `${text(group._id.eventType)} / ${text(group._id.reason)}${group._id.scope === undefined ? "" : ` / ${text(group._id.scope)}`}`;
      const marker = REFUSAL_EVENT_TYPES.has(text(group._id.eventType)) ? "!" : " ";
      console.log(`${String(group.events).padStart(7)} ${String(group.accounts).padStart(8)} ${marker} ${line}`);
    }
    if (groups.length > limit) console.log(`  … ${groups.length - limit} more grounds (raise --limit)`);
    console.log("`!` marks a documented mining-start refusal; events/accounts are the group's totals.");

    console.log(
      JSON.stringify({
        ok: true,
        totals,
        plan,
        refusals: refusals.slice(0, limit).map((group) => ({
          eventType: text(group._id.eventType),
          reason: text(group._id.reason),
          ...(group._id.scope === undefined ? {} : { scope: text(group._id.scope) }),
          events: group.events,
          accounts: group.accounts,
        })),
      }),
    );
  } finally {
    await client.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 2;
}
