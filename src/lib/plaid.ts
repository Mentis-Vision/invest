import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import crypto from "node:crypto";

/**
 * Plaid client + encryption utilities.
 *
 * Security: access tokens are encrypted at rest using AES-256-GCM keyed by
 * PLAID_ENCRYPTION_KEY. Never log or return the raw access token.
 *
 * Environments:
 * - sandbox: fake data, safe to test end-to-end
 * - development: real institutions, limited to 100 items (no longer used post-2024)
 * - production: real institutions, real money. Requires Plaid production key.
 */

type PlaidEnvName = "sandbox" | "development" | "production";

function getEnv(): PlaidEnvName {
  const v = (process.env.PLAID_ENV ?? "sandbox").toLowerCase();
  if (v === "production" || v === "sandbox" || v === "development") return v;
  return "sandbox";
}

let _client: PlaidApi | null = null;

export function plaidClient(): PlaidApi {
  if (_client) return _client;
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error(
      "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET in environment."
    );
  }
  const env = getEnv();
  const basePath = PlaidEnvironments[env as keyof typeof PlaidEnvironments] as string;
  const config = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
        "Plaid-Version": "2020-09-14",
      },
    },
  });
  _client = new PlaidApi(config);
  return _client;
}

export function plaidEnv(): string {
  return getEnv();
}

export function plaidConfigured(): boolean {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

/**
 * Derive a 32-byte key from PLAID_ENCRYPTION_KEY using SHA-256.
 * The env var may be any length — we normalize it.
 */
function getKey(): Buffer {
  const raw = process.env.PLAID_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      "PLAID_ENCRYPTION_KEY must be set to at least 16 chars (32+ recommended). Use `openssl rand -base64 32`."
    );
  }
  return crypto.createHash("sha256").update(raw, "utf-8").digest();
}

/**
 * Encrypts `plaintext` with AES-256-GCM. Returns `iv:tag:ciphertext` in hex.
 */
export function encryptAccessToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptAccessToken(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted token");
  const [ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString("utf-8");
}
