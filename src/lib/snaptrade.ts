import { Snaptrade } from "snaptrade-typescript-sdk";
import crypto from "node:crypto";
import { pool } from "./db";
import { log, errorInfo } from "./log";

/**
 * SnapTrade client + user-secret encryption.
 *
 * SnapTrade's auth model:
 * 1. We hold a clientId + consumerKey (server-side, never exposed).
 * 2. Each end-user gets a unique (userId, userSecret) pair after registration.
 *    We generate userId from our BetterAuth userId; SnapTrade returns userSecret.
 * 3. userSecret grants access to that user's linked brokerages. Encrypted at rest.
 * 4. Link flow opens a Connection Portal URL in a popup window; user picks a
 *    broker, authenticates, and is redirected back to our customRedirect URL.
 *
 * Never log userSecret or the consumerKey.
 */

let _client: Snaptrade | null = null;

export function snaptradeConfigured(): boolean {
  return !!(process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY);
}

export function snaptradeClient(): Snaptrade {
  if (_client) return _client;
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;
  if (!clientId || !consumerKey) {
    throw new Error(
      "SnapTrade is not configured. Set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY."
    );
  }
  _client = new Snaptrade({ clientId, consumerKey });
  return _client;
}

/**
 * Encryption key-versioning system.
 *
 * Why versioning: if the encryption key ever leaks, we must rotate —
 * but swapping the env var without versioning would make every
 * stored ciphertext undecryptable and break every user's linked
 * brokerage. Versioned ciphertexts let us run two keys in parallel:
 * decrypt old ciphertexts with the old key (v1), write new ones with
 * the new key (v2), then back-fill re-encryption asynchronously.
 *
 * Ciphertext formats supported:
 *   Legacy (v1, implicit): `${iv.hex}:${tag.hex}:${ct.hex}`       (3 parts)
 *   Versioned (v2+):       `v2:${iv.hex}:${tag.hex}:${ct.hex}`    (4 parts)
 *
 * Env vars:
 *   SNAPTRADE_ENCRYPTION_KEY      (required, v1) — originally-deployed
 *                                  key. Never delete this env var
 *                                  while any legacy ciphertexts exist.
 *   SNAPTRADE_ENCRYPTION_KEY_V2   (optional) — the rotated key. When
 *                                  unset, v2 writes reuse v1's key
 *                                  material (so we can ship the
 *                                  format change independently of the
 *                                  first actual rotation).
 *
 * Rotation playbook (future, not required for this deploy):
 *   1. Generate a new key: `openssl rand -base64 32`
 *   2. Set SNAPTRADE_ENCRYPTION_KEY_V2 in Vercel Production
 *   3. Deploy — new writes tagged v2 use the new key; legacy v1
 *      ciphertexts still decrypt via SNAPTRADE_ENCRYPTION_KEY
 *   4. Run the re-encryption cron to migrate v1 → v2 rows
 *   5. Once all ciphertexts are v2-tagged, remove
 *      SNAPTRADE_ENCRYPTION_KEY (or keep as belt-and-suspenders)
 */

type KeyVersion = "v1" | "v2";

/** Which version new writes are tagged with. Bump here when rotating. */
const CURRENT_VERSION: KeyVersion = "v2";

/** Derive a 32-byte AES-256 key from an env-var value via SHA-256. */
function deriveKey(raw: string | undefined, label: string): Buffer {
  if (!raw || raw.length < 16) {
    throw new Error(
      `${label} must be set to at least 16 chars (32+ recommended). Use \`openssl rand -base64 32\`.`
    );
  }
  return crypto.createHash("sha256").update(raw, "utf-8").digest();
}

/**
 * Resolve the AES key for a given ciphertext version. v2 prefers its
 * own env var; if absent we fall through to v1's key material so the
 * format change can ship before the first actual key rotation.
 */
function getKeyForVersion(version: KeyVersion): Buffer {
  if (version === "v2") {
    const v2 = process.env.SNAPTRADE_ENCRYPTION_KEY_V2;
    if (v2 && v2.length >= 16) {
      return deriveKey(v2, "SNAPTRADE_ENCRYPTION_KEY_V2");
    }
    // Fallback: v2-tagged ciphertexts written before a real rotation
    // are encrypted with v1's key material. They stay decryptable
    // under either env config (v2 set or unset).
    return deriveKey(
      process.env.SNAPTRADE_ENCRYPTION_KEY,
      "SNAPTRADE_ENCRYPTION_KEY"
    );
  }
  return deriveKey(
    process.env.SNAPTRADE_ENCRYPTION_KEY,
    "SNAPTRADE_ENCRYPTION_KEY"
  );
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    getKeyForVersion(CURRENT_VERSION),
    iv
  );
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${CURRENT_VERSION}:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * Decrypt either a legacy 3-part payload (no version prefix → v1) or
 * a versioned 4-part payload (`v2:iv:tag:ct`). Throws on malformed
 * input or when the required key version isn't configured.
 */
export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  let version: KeyVersion;
  let ivHex: string;
  let tagHex: string;
  let ctHex: string;

  if (parts.length === 3) {
    // Legacy, pre-rotation ciphertext — implicit v1.
    version = "v1";
    [ivHex, tagHex, ctHex] = parts;
  } else if (parts.length === 4) {
    const [versionTag, iv, tag, ct] = parts;
    if (versionTag !== "v1" && versionTag !== "v2") {
      throw new Error(`Unknown encryption version: ${versionTag}`);
    }
    version = versionTag;
    ivHex = iv;
    tagHex = tag;
    ctHex = ct;
  } else {
    throw new Error("Malformed encrypted payload");
  }

  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKeyForVersion(version),
    iv
  );
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString("utf-8");
}

/**
 * Parse the version tag of an existing ciphertext without decrypting.
 * Useful for the migration cron to identify which rows still need
 * re-encryption after a rotation.
 */
export function ciphertextVersion(payload: string): KeyVersion {
  const parts = payload.split(":");
  if (parts.length === 3) return "v1";
  if (parts.length === 4 && (parts[0] === "v1" || parts[0] === "v2")) {
    return parts[0] as KeyVersion;
  }
  throw new Error("Malformed encrypted payload");
}

/**
 * Generate a stable, non-PII SnapTrade userId from our BetterAuth id.
 * Using a hashed version avoids leaking our internal id format to SnapTrade
 * and guarantees idempotency across re-registration attempts.
 */
export function deriveSnaptradeUserId(betterAuthUserId: string): string {
  return crypto
    .createHash("sha256")
    .update(`clearpath:${betterAuthUserId}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Fetch or create the SnapTrade user for a given app user.
 * Idempotent — safe to call multiple times.
 */
export async function ensureSnaptradeUser(appUserId: string): Promise<{
  snaptradeUserId: string;
  userSecret: string;
}> {
  const { rows } = await pool.query(
    `SELECT "snaptradeUserId", "userSecretEncrypted"
     FROM "snaptrade_user" WHERE "userId" = $1`,
    [appUserId]
  );

  if (rows.length > 0) {
    return {
      snaptradeUserId: rows[0].snaptradeUserId as string,
      userSecret: decryptSecret(rows[0].userSecretEncrypted as string),
    };
  }

  const snaptradeUserId = deriveSnaptradeUserId(appUserId);
  const client = snaptradeClient();

  try {
    const resp = await client.authentication.registerSnapTradeUser({
      userId: snaptradeUserId,
    });
    const userSecret = resp.data?.userSecret;
    if (!userSecret) {
      throw new Error("SnapTrade did not return userSecret");
    }

    await pool.query(
      `INSERT INTO "snaptrade_user" ("userId", "snaptradeUserId", "userSecretEncrypted")
       VALUES ($1, $2, $3)
       ON CONFLICT ("userId") DO NOTHING`,
      [appUserId, snaptradeUserId, encryptSecret(userSecret)]
    );

    return { snaptradeUserId, userSecret };
  } catch (err) {
    log.error("snaptrade", "ensureUser failed", {
      appUserId,
      ...errorInfo(err),
    });
    throw err;
  }
}

/**
 * Disconnect a SnapTrade user entirely. Used when the user deletes their account
 * or asks us to wipe their brokerage integration.
 */
export async function deleteSnaptradeUser(appUserId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT "snaptradeUserId", "userSecretEncrypted"
     FROM "snaptrade_user" WHERE "userId" = $1`,
    [appUserId]
  );
  if (rows.length === 0) return;

  const snaptradeUserId = rows[0].snaptradeUserId as string;
  const userSecret = decryptSecret(rows[0].userSecretEncrypted as string);

  try {
    await snaptradeClient().authentication.deleteSnapTradeUser({
      userId: snaptradeUserId,
    });
  } catch (err) {
    log.warn("snaptrade", "deleteUser API failed (continuing with local cleanup)", {
      appUserId,
      ...errorInfo(err),
    });
  }

  // Avoid unused-var lint — the secret is pulled for API-call parity but we
  // don't need to pass it to delete.
  void userSecret;

  await pool.query(`DELETE FROM "snaptrade_user" WHERE "userId" = $1`, [appUserId]);
  await pool.query(`DELETE FROM "snaptrade_connection" WHERE "userId" = $1`, [
    appUserId,
  ]);
  await pool.query(
    `DELETE FROM "holding" WHERE "userId" = $1 AND source = 'snaptrade'`,
    [appUserId]
  );
}
