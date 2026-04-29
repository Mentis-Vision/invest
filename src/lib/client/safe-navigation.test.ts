import { describe, expect, it } from "vitest";
import {
  safeExternalHttpsUrl,
  safeInternalRedirectPath,
} from "./safe-navigation";

describe("safeInternalRedirectPath", () => {
  it("keeps internal paths with query strings", () => {
    expect(safeInternalRedirectPath("/app?view=research")).toBe(
      "/app?view=research"
    );
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeInternalRedirectPath("https://evil.example/phish")).toBe("/app");
    expect(safeInternalRedirectPath("//evil.example/phish")).toBe("/app");
  });

  it("uses the provided fallback for invalid values", () => {
    expect(safeInternalRedirectPath(null, "/login")).toBe("/login");
    expect(safeInternalRedirectPath("   ", "/login")).toBe("/login");
  });
});

describe("safeExternalHttpsUrl", () => {
  it("allows HTTPS URLs for explicitly allowed hosts", () => {
    expect(
      safeExternalHttpsUrl("https://checkout.stripe.com/c/pay/test", [
        "checkout.stripe.com",
      ])
    ).toBe("https://checkout.stripe.com/c/pay/test");
  });

  it("rejects non-HTTPS and unapproved hosts", () => {
    expect(
      safeExternalHttpsUrl("http://checkout.stripe.com/c/pay/test", [
        "checkout.stripe.com",
      ])
    ).toBeNull();
    expect(
      safeExternalHttpsUrl("https://evil.example/c/pay/test", [
        "checkout.stripe.com",
      ])
    ).toBeNull();
  });
});
