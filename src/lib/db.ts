import { Pool, type QueryResult, type QueryResultRow } from "@neondatabase/serverless";

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
 * Query helper — lazily resolves the pool. Forwards the generic row
 * type so callers can do `pool.query<{ foo: string }>(...)` and get
 * typed `rows` without casting every result.
 *
 *   const { rows } = await pool.query<{ userId: string }>(`SELECT ...`)
 *   //    ^-- rows is { userId: string }[]
 *
 * When no type parameter is passed, defaults to `Record<string, unknown>`
 * — safe default that forces callers to widen explicitly rather than
 * silently assume a shape.
 */
export const pool = {
  query: <R extends QueryResultRow = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<R>> => getPool().query<R>(text, params),
};
