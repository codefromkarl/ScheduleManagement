import { describe, expect, it } from "vitest";
import { isMobileUserAgent } from "./user-agent";

describe("isMobileUserAgent", () => {
  it("detects phone and tablet agents without classifying desktop Chrome as mobile", () => {
    expect(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Mobile/15E148")).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit Chrome/132 Mobile Safari/537.36")).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Chrome/132 Safari/537.36")).toBe(false);
  });
});
