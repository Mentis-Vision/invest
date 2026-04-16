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
 * Query helper — lazily resolves the pool. Most call sites can just
 * use `pool.query(...)` after importing.
 */
export const pool = {
  query: (text: string, params?: unknown[]) => getPool().query(text, params),
};
