import {
  Long,
  ReadConcern,
  MongoServerError,
  type ClientSession,
  type Db,
  type Document,
  type Filter,
  type MongoClient,
  type UpdateResult,
} from "mongodb";
import type { GatewayConfig } from "../config.js";
import { GatewayError, reject } from "../domain/money.js";
export class GatewayStore {
  readonly counters = { transactions: 0, retries: 0, failures: 0 };
  readonly db: Db;
  constructor(
    readonly client: MongoClient,
    db: Db,
    readonly config: GatewayConfig,
  ) {
    this.db = client.db(db.databaseName, {
      readConcern: new ReadConcern("majority"),
      writeConcern: { w: "majority" },
    });
  }
  c(name: string) {
    return this.db.collection(name, { timeoutMS: 8000 });
  }
  async find<T>(
    name: string,
    filter: Filter<Document>,
    session?: ClientSession,
  ): Promise<T | null> {
    return (await this.c(name).findOne(
      filter,
      session ? { session } : {},
    )) as T | null;
  }
  async require<T>(
    name: string,
    filter: Filter<Document>,
    session?: ClientSession,
  ): Promise<T> {
    return (
      (await this.find<T>(name, filter, session)) ?? reject("not_found", 404)
    );
  }
  async transaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    let attempts = 0;
    try {
      const result = await session.withTransaction(
        async () => {
          attempts += 1;
          if (attempts > 3) throw new GatewayError("transaction_conflict", 503);
          if (attempts > 1) this.counters.retries += 1;
          return fn(session);
        },
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
          timeoutMS: 8000,
          maxCommitTimeMS: 3000,
        },
      );
      this.counters.transactions += 1;
      return result;
    } catch (error) {
      this.counters.failures += 1;
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
export function changed(result: UpdateResult, code: string): void {
  if (result.modifiedCount !== 1) reject(code, 409);
}
export function duplicate(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}
/** Preserve the Go int64 money representation required by existing validators. */
export function moneyDocument(value: object): Document {
  const document: Document = { ...value };
  for (const [key, amount] of Object.entries(document)) {
    if (key.endsWith("Minor") && typeof amount === "number") {
      if (!Number.isSafeInteger(amount))
        throw new Error("Money exceeds safe integer range");
      document[key] = Long.fromNumber(amount);
    }
  }
  return document;
}
