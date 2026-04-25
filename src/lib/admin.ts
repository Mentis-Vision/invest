import { headers } from "next/headers";
import { auth } from "./auth";

/**
 * Demo account — used for marketing site walkthroughs and due-diligence
 * demos. Per AGENTS.md rule #7, never delete this account.
 *
 * Holdings for this account are pre-seeded manually; the account must
 * never:
 *   - Link a real Plaid Item (would cost $0.35/mo recurring)
 *   - Link a real SnapTrade connection (leaks real brokerage metadata)
 *   - Trigger paid AI calls that count against real budgets
 *   - Appear in admin health aggregates or stuck-user queries
 *
 * The exclusion is enforced at each choke point via `isDemoUser()`.
 */
export const DEMO_USER_EMAIL = "demo@clearpathinvest.app";

export function isDemoUser(
  user: { email?: string | null } | null | undefined
): boolean {
  return user?.email === DEMO_USER_EMAIL;
}

/**
 * Founder-only auth guard for admin endpoints.
 *
 * Admin surfaces (health dashboard, stuck-user investigation, manual
 * re-auth triggers) expose internal operational data — never expose to
 * regular users. Single-founder scale, so we gate by email.
 *
 * When additional engineers need admin access, extend this to read
 * from a small `admin_user` table or an env-var list, and drop the
 * hardcoded email.
 */

const FOUNDER_EMAILS = new Set(["sang@mentisvision.com"]);

export type AdminGuardResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; status: 401 | 403 };

export async function requireAdmin(): Promise<AdminGuardResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, status: 401 };
  const email = session.user.email;
  if (!FOUNDER_EMAILS.has(email)) return { ok: false, status: 403 };
  return { ok: true, userId: session.user.id, email };
}
