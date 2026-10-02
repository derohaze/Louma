import { MongoServerError, type Db, type Document } from "mongodb";

export async function applyValidator(db: Db, name: string, validator: Document): Promise<void> {
  await db.command({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
}

export async function ensureCollection(db: Db, name: string, validator: Document): Promise<void> {
  const [existing] = await db.listCollections({ name }, { nameOnly: false }).toArray();
  if (existing) {
    // `collMod` is a metadata write that takes the collection's lock, and every process applies the
    // same schema at boot: re-sending an unchanged validator is pure cost on every deploy and every
    // restart. Both sides of this comparison are produced by this module, so a string comparison is
    // enough to tell "the same schema" from "a schema that changed".
    //
    // The validator alone is not the whole enforcement story: a collection whose level or action was
    // relaxed (for example `moderate`/`warn` during an incident) compares equal here yet keeps
    // accepting records the application expects MongoDB to reject. Startup previously reapplied
    // `strict`/`error`, so those settings are checked before skipping `collMod`.
    if (
      JSON.stringify(existing.options?.["validator"] ?? null) === JSON.stringify(validator) &&
      (existing.options?.["validationLevel"] ?? "strict") === "strict" &&
      (existing.options?.["validationAction"] ?? "error") === "error"
    ) return;
    await applyValidator(db, name, validator);
    return;
  }
  try {
    await db.createCollection(name, { validator, validationLevel: "strict", validationAction: "error" });
  } catch (error) {
    // Another process created it between the listing above and this call.
    if (!(error instanceof MongoServerError) || error.code !== 48) throw error;
    await applyValidator(db, name, validator);
  }
}
