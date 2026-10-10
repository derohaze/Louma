import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import type { Application, Credential } from "../domain/models.js";
import { reject } from "../domain/money.js";
import { mac, secret } from "../security.js";
import { changed, duplicate, type GatewayStore } from "./store.js";
export interface Principal {
  app: Application;
  credential: Pick<Credential, "publicId">;
  internal?: boolean;
}
export async function eligible(
  store: GatewayStore,
  owner: string,
  session?: ClientSession,
): Promise<void> {
  if (
    !(await store.find(
      "gateway_developers",
      { ownerUserId: owner, status: "active" },
      session,
    ))
  )
    reject("developer_access_required", 403);
}
export async function application(
  store: GatewayStore,
  owner: string,
  id: string,
): Promise<Application> {
  return store.require<Application>("gateway_applications", {
    publicId: id,
    ownerUserId: owner,
  });
}
export async function authenticate(
  store: GatewayStore,
  raw: string,
  scope: string,
): Promise<Principal> {
  if (!raw.startsWith(`lma_${store.config.environment}_`) || raw.length > 160)
    return reject("invalid_api_key", 401);
  const key = await store.find<Credential>("gateway_credentials", {
    hash: mac(store.config.pepper, raw),
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  });
  if (!key) return reject("invalid_api_key", 401);
  if (!key.scopes.includes(scope)) return reject("insufficient_scope", 403);
  const app = await store.find<Application>("gateway_applications", {
    publicId: key.applicationId,
    status: { $in: ["active", "disabled"] },
  });
  if (!app) return reject("application_suspended", 403);
  await eligible(store, app.ownerUserId);
  return { app, credential: key };
}
export async function guardManagement(
  store: GatewayStore,
  principal: Principal,
  session: ClientSession,
): Promise<void> {
  const app = principal.app;
  changed(
    await store
      .c("gateway_developers")
      .updateOne(
        { ownerUserId: app.ownerUserId, status: "active" },
        { $inc: { financialVersion: 1 } },
        { session },
      ),
    "merchant_suspended",
  );
  changed(
    await store
      .c("gateway_applications")
      .updateOne(
        {
          publicId: app.publicId,
          ownerUserId: app.ownerUserId,
          status: { $in: ["active", "disabled"] },
          walletId: app.walletId,
        },
        { $inc: { version: 1 } },
        { session },
      ),
    "application_suspended",
  );
}
export async function guardApplication(
  store: GatewayStore,
  principal: Principal,
  session: ClientSession,
): Promise<void> {
  const app = principal.app;
  changed(
    await store
      .c("gateway_developers")
      .updateOne(
        { ownerUserId: app.ownerUserId, status: "active" },
        { $inc: { financialVersion: 1 } },
        { session },
      ),
    "merchant_suspended",
  );
  changed(
    await store
      .c("gateway_applications")
      .updateOne(
        {
          publicId: app.publicId,
          ownerUserId: app.ownerUserId,
          status: "active",
          walletId: app.walletId,
        },
        { $inc: { version: 1 } },
        { session },
      ),
    "application_suspended",
  );
  if (principal.credential.publicId)
    changed(
      await store
        .c("gateway_credentials")
        .updateOne(
          {
            publicId: principal.credential.publicId,
            applicationId: app.publicId,
            status: "active",
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
          },
          { $inc: { version: 1 } },
          { session },
        ),
      "credential_revoked",
    );
}
export async function createApplication(
  store: GatewayStore,
  input: Pick<
    Application,
    | "ownerUserId"
    | "name"
    | "walletId"
    | "domains"
    | "idempotencyKey"
    | "requestFingerprint"
  >,
): Promise<Application> {
  await eligible(store, input.ownerUserId);
  if (
    !(await store.find("wallets", {
      publicId: input.walletId,
      ownerUserId: input.ownerUserId,
      status: "active",
    }))
  )
    return reject("invalid_receiving_wallet");
  const find = async () => {
    const prior = await store.find<Application>("gateway_applications", {
      ownerUserId: input.ownerUserId,
      idempotencyKey: input.idempotencyKey,
    });
    if (prior && prior.requestFingerprint !== input.requestFingerprint)
      reject("idempotency_key_reused", 409);
    return prior;
  };
  const prior = await find();
  if (prior) return prior;
  const app: Application = {
    ...input,
    publicId: randomUUID(),
    status: "active",
    createdAt: new Date(),
    version: 0,
  };
  try {
    await store.c("gateway_applications").insertOne(app);
  } catch (error) {
    if (!duplicate(error)) throw error;
    const winner = await find();
    if (!winner) throw error;
    return winner;
  }
  return app;
}
function newCredential(
  store: GatewayStore,
  appId: string,
  scopes: string[],
  expiresAt: Date | null,
): {
  credential: Credential;
  api_key: string;
  id: string;
} {
  const id = randomUUID();
  const raw = `lma_${store.config.environment}_${id.replaceAll("-", "")}_${secret()}`;
  return {
    id,
    api_key: raw,
    credential: {
      publicId: id,
      applicationId: appId,
      hash: mac(store.config.pepper, raw),
      prefix: raw.slice(0, 18),
      scopes,
      status: "active",
      expiresAt,
      version: 0,
      createdAt: new Date(),
    },
  };
}
export async function createCredential(
  store: GatewayStore,
  principal: Principal,
  scopes: string[],
  expiresAt: Date | null,
) {
  const result = newCredential(
    store,
    principal.app.publicId,
    scopes,
    expiresAt,
  );
  await store.transaction(async (session) => {
    await guardManagement(store, principal, session);
    await store
      .c("gateway_credentials")
      .insertOne(result.credential, { session });
  });
  return result;
}
export async function rotateCredential(
  store: GatewayStore,
  principal: Principal,
  id: string,
) {
  const old = await store.require<Credential>("gateway_credentials", {
    publicId: id,
    applicationId: principal.app.publicId,
    status: "active",
  });
  const result = newCredential(
    store,
    principal.app.publicId,
    old.scopes,
    old.expiresAt,
  );
  await store.transaction(async (session) => {
    await guardManagement(store, principal, session);
    changed(
      await store
        .c("gateway_credentials")
        .updateOne(
          {
            publicId: id,
            applicationId: principal.app.publicId,
            status: "active",
          },
          { $set: { status: "revoked" }, $inc: { version: 1 } },
          { session },
        ),
      "credential_revoked",
    );
    await store
      .c("gateway_credentials")
      .insertOne(result.credential, { session });
  });
  return result;
}
