import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import {
  recordAuthEvent,
  getRequestIp,
  getRequestUa,
  type AuthEventType,
} from "@/lib/auth-events";

const baseHandlers = toNextJsHandler(auth);

/**
 * Map an auth endpoint path + response status to our internal event type.
 * Returns null when the endpoint is one we don't audit (session checks,
 * prefetch calls, etc.).
 */
function eventFor(
  pathname: string,
  method: string,
  ok: boolean
): AuthEventType | null {
  if (method !== "POST" && pathname !== "/api/auth/callback/google") return null;

  // BetterAuth endpoints are /api/auth/<action> or /api/auth/<action>/<sub>
  if (pathname.endsWith("/sign-in/email")) {
    return ok ? "sign_in_email_success" : "sign_in_email_failure";
  }
  if (pathname.endsWith("/sign-up/email")) {
    return ok ? "sign_up_email_success" : "sign_up_email_failure";
  }
  if (pathname.endsWith("/sign-in/social")) {
    return ok ? "sign_in_oauth_success" : "sign_in_oauth_failure";
  }
  if (pathname.includes("/callback/")) {
    return ok ? "sign_in_oauth_success" : "sign_in_oauth_failure";
  }
  if (pathname.endsWith("/sign-out")) {
    return "sign_out";
  }
  if (pathname.endsWith("/request-password-reset") || pathname.endsWith("/forget-password")) {
    return "password_reset_requested";
  }
  if (pathname.endsWith("/reset-password")) {
    return ok ? "password_reset_success" : "password_reset_failure";
  }
  if (pathname.endsWith("/verify-email")) {
    return "email_verified";
  }
  return null;
}

/**
 * Best-effort peek at a cloned request body for the email field.
 * Never reads password or token fields. Silently no-ops on any failure.
 */
async function peekEmail(req: Request): Promise<string | null> {
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return null;
    const cloned = req.clone();
    const body = (await cloned.json()) as { email?: unknown };
    if (typeof body.email === "string" && body.email.length <= 254) {
      return body.email.toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

export const GET = async (req: Request) => {
  const res = await baseHandlers.GET(req);
  // Only audit OAuth callbacks on GET; other GETs are routine session checks.
  try {
    const pathname = new URL(req.url).pathname;
    const type = eventFor(pathname, "GET", res.ok);
    if (type) {
      recordAuthEvent({
        eventType: type,
        success: res.ok,
        ipAddress: getRequestIp(req),
        userAgent: getRequestUa(req),
        metadata: { status: res.status, path: pathname },
      });
    }
  } catch {
    /* never block auth on audit */
  }
  return res;
};

export const POST = async (req: Request) => {
  const pathname = new URL(req.url).pathname;
  const email = await peekEmail(req);
  const res = await baseHandlers.POST(req);
  try {
    const type = eventFor(pathname, "POST", res.ok);
    if (type) {
      recordAuthEvent({
        eventType: type,
        email,
        success: res.ok,
        ipAddress: getRequestIp(req),
        userAgent: getRequestUa(req),
        metadata: { status: res.status, path: pathname },
      });
    }
  } catch {
    /* never block auth on audit */
  }
  return res;
};
