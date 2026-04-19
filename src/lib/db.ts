import { Pool } from "@neondatabase/serverless";

/**
 * Shared Neon pool. Re-used across modules to avoid exhausting connections
 * during serverless invocations. The @neondatabase/serverless driver handles
 * per-invocation connection pooling via the edge-compatible fetch transport.
 *
 * We lazily construct on first import because the module may load during
 * Next.js build-time page data collection where DATABASE_URL isn't yet set.
 */
let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _pool = new Pool({ connectionString: url });
  }
  return _pool;
}

/**
 * Lazy proxy over the underlying Neon Pool. Every property access
 * resolves the pool on first use (so we don't need DATABASE_URL at
 * module-import time) and binds any function methods so they stay
 * bound to the pool instance.
 *
 * Typed as `Pool` so every overload — `pool.query(text)`,
 * `pool.query<T>(text, params)`, `pool.connect()`, `pool.on(...)` —
 * is visible to callers without wrapping each one. Using `Pool`
 * directly means no custom signatures to keep in sync with pg
 * type evolution.
 *
 * Prior iterations used a hand-written `{ query: ... }` object, but
 * that hid the generic overloads and caused "Expected 0 type
 * arguments" build failures for callers that wanted typed rows.
 */
export const pool: Pool = new Proxy({} as Pool, {
  get(_, prop, receiver) {
    const p = getPool();
    const value = Reflect.get(p, prop, receiver);
    return typeof value === "function" ? value.bind(p) : value;
  },
});
