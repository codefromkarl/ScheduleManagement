import { describe, expect, it } from "vitest";
import { pwaIsConfigured, qqIsConfigured, reminderChannelIsEnabled, sanitizedQqError, selectedReminderChannels } from "./config";

describe("reminder channel configuration", () => {
  it("keeps both channels enabled when no explicit selection exists", () => {
    expect(selectedReminderChannels({})).toEqual(["qq", "pwa"]);
  });

  it("supports an explicit QQ-only mode and ignores unknown values", () => {
    const env = { REMINDER_CHANNELS: " QQ,unknown " };
    expect(selectedReminderChannels(env)).toEqual(["qq"]);
    expect(reminderChannelIsEnabled("qq", env)).toBe(true);
    expect(reminderChannelIsEnabled("pwa", env)).toBe(false);
  });

  it("keeps channel selection separate from transport credentials", () => {
    expect(qqIsConfigured({ QQBOT_APP_ID: "app", QQBOT_APP_SECRET: "secret", QQBOT_OWNER_USER_ID: "owner" })).toBe(true);
    expect(pwaIsConfigured({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private", VAPID_SUBJECT: "mailto:owner@example.com" })).toBe(true);
  });

  it("redacts QQ secrets and bounds provider errors", () => {
    expect(sanitizedQqError(new Error("request failed with private-secret"), { QQBOT_APP_SECRET: "private-secret" })).toBe("request failed with [redacted]");
    expect(sanitizedQqError("x".repeat(800))).toHaveLength(500);
  });
});
