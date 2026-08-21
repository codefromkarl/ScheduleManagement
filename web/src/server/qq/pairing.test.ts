import { describe, expect, it } from "vitest";
import { matchesQqPairingCommand, normalizeQqPairingText, qqPairingCommand } from "./pairing";

describe("QQ owner pairing", () => {
  it("accepts only the exact one-time six-digit command after whitespace normalization", () => {
    expect(qqPairingCommand("123456")).toBe("绑定 Goalset 123456");
    expect(normalizeQqPairingText("  绑定   Goalset\n123456 ")).toBe("绑定 Goalset 123456");
    expect(matchesQqPairingCommand(" 绑定  Goalset  123456 ", "123456")).toBe(true);
    expect(matchesQqPairingCommand("绑定 Goalset 654321", "123456")).toBe(false);
    expect(matchesQqPairingCommand("绑定 Goalset", "123456")).toBe(false);
  });

  it("rejects pairing codes outside the fixed format", () => {
    expect(() => qqPairingCommand("12345")).toThrow("six digits");
    expect(() => qqPairingCommand("abcdef")).toThrow("six digits");
  });
});
