const INTERNAL_FALLBACK_PATH = "/app";

export function safeInternalRedirectPath(
  value: string | null | undefined,
  fallback = INTERNAL_FALLBACK_PATH
): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  try {
    const parsed = new URL(trimmed, "https://clearpath.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function safeExternalHttpsUrl(
  value: unknown,
  allowedHosts: readonly string[]
): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    if (!allowedHosts.includes(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
