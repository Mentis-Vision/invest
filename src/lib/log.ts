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

function emit(level: Level, scope: string, msg: string, data?: Payload) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(data ?? {}),
  };
  const json = JSON.stringify(entry, (_k, v) => {
    if (v instanceof Error) {
      return {
        name: v.name,
        message: v.message,
        stack: v.stack,
      };
    }
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
