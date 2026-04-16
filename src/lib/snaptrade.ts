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
 * 32-byte key derived from SNAPTRADE_ENCRYPTION_KEY via SHA-256.
 */
function getKey(): Buffer {
  const raw = process.env.SNAPTRADE_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      "SNAPTRADE_ENCRYPTION_KEY must be set to at least 16 chars (32+ recommended). Use `openssl rand -base64 32`."
    );
  }
  return crypto.createHash("sha256").update(raw, "utf-8").digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted payload");
  const [ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString("utf-8");
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
