// ---------------------------------------------------------------------------
// Browser device key (Web Crypto ECDSA P-256, IndexedDB-persisted)
// ---------------------------------------------------------------------------

const IDB_NAME = "louma-lmdg";
const IDB_STORE = "keys";
const KEY_ID = "device-key";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(): Promise<CryptoKeyPair | null> {
  try {
    const db = await openIdb();
    try {
      const value = await new Promise<CryptoKeyPair | undefined>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(KEY_ID);
        req.onsuccess = () => resolve(req.result as CryptoKeyPair | undefined);
        req.onerror = () => reject(req.error);
      });
      return value ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function idbPut(pair: CryptoKeyPair): Promise<void> {
  const db = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(pair, KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

let memoryKeyPair: CryptoKeyPair | null = null;

export async function getOrCreateKeyPair(): Promise<CryptoKeyPair | null> {
  try {
    const stored = await idbGet();
    if (stored) return stored;
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ]);
    // Best effort: private browsing may refuse the write; the in-memory key still proves
    // possession for this tab's handshake.
    await idbPut(pair).catch(() => undefined);
    return pair;
  } catch {
    if (!memoryKeyPair) {
      try {
        memoryKeyPair = await crypto.subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign", "verify"],
        );
      } catch {
        return null;
      }
    }
    return memoryKeyPair;
  }
}

export async function publicKeyMarker(pair: CryptoKeyPair): Promise<string | null> {
  try {
    // The marker binds evidence to the key across handshakes. It is the public JWK (never the
    // private key) and the server stores only this public value.
    return JSON.stringify(await crypto.subtle.exportKey("jwk", pair.publicKey));
  } catch {
    return null;
  }
}

export function toBase64Url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
