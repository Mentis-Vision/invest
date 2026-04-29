/**
 * Minimal structured logging helper.
 *
 * Emits single-line JSON to console so Vercel's runtime logs collect it
 * in a grep-friendly format. When we upgrade to Sentry / Datadog / Axiom,
 * this is the single place to swap in the transport.
 *
 * Never include PII (email, tokens, passwords) in the payload.
 */

type Level = "error" | "warn" | "info" | "debug";

type Payload = Record<string, unknown>;

const REDACTED = "[redacted]";
const CIRCULAR = "[circular]";
const TRUNCATED = "[truncated]";
const MAX_LOG_DEPTH = 8;
const SENSITIVE_KEY_RE =
  /(^ip$|^to$|authorization|cookie|email|ipaddress|password|secret|token|usersecret)/i;

export function redactLogPayload(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): unknown {
  if (depth > MAX_LOG_DEPTH) return TRUNCATED;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[function]";
  if (Array.isArray(value)) {
    return value.map((item) => redactLogPayload(item, seen, depth + 1));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_RE.test(key)
        ? REDACTED
        : redactLogPayload(nested, seen, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: Level, scope: string, msg: string, data?: Payload) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...((redactLogPayload(data ?? {}) as Payload) ?? {}),
  };
  const json = JSON.stringify(entry, (_k, v) => {
    if (v instanceof Error) {
      return {
        name: v.name,
        message: v.message,
        stack: v.stack,
      };
    }
    if (typeof v === "bigint") return v.toString();
    return v;
  });

  const fn =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(json);
}

export const log = {
  error(scope: string, msg: string, data?: Payload) {
    emit("error", scope, msg, data);
  },
  warn(scope: string, msg: string, data?: Payload) {
    emit("warn", scope, msg, data);
  },
  info(scope: string, msg: string, data?: Payload) {
    emit("info", scope, msg, data);
  },
  debug(scope: string, msg: string, data?: Payload) {
    if (process.env.NODE_ENV !== "production") emit("debug", scope, msg, data);
  },
};

/**
 * Extract a safe, stringifiable representation of an unknown error.
 * Use when logging inside catch(err).
 */
export function errorInfo(err: unknown): Payload {
  if (err instanceof Error) {
    return {
      errName: err.name,
      errMessage: err.message,
      errStack: err.stack,
    };
  }
  return { err: String(err) };
}
