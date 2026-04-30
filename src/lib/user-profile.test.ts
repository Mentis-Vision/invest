import { describe, expect, it } from "vitest";
import { buildProfileRider, type UserProfile } from "./user-profile";

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: "user_123",
    riskTolerance: null,
    investmentGoals: [],
    horizon: null,
    preferences: {},
    disclaimerAcceptedAt: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("buildProfileRider", () => {
  it("includes investment value preferences as analysis context", () => {
    const rider = buildProfileRider(
      profile({
        preferences: {
          esgPreference: true,
          governancePreference: true,
          climatePreference: true,
          controversialSectorsPreference: true,
        },
      })
    );

    expect(rider).toContain("ESG-aligned investments");
    expect(rider).toContain("governance quality");
    expect(rider).toContain("climate transition");
    expect(rider).toContain("controversial-sector exposure");
    expect(rider).toContain("NOT to skip analysis");
  });
});
