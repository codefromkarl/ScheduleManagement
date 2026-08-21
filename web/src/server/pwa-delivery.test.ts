import { describe, expect, it } from "vitest";
import { deliverPwaPayload } from "./pwa-delivery";

const targets = [
  { id: "ok", endpoint: "https://push.example/ok", p256dh: "key", auth: "auth" },
  { id: "gone", endpoint: "https://push.example/gone", p256dh: "key", auth: "auth" },
  { id: "failed", endpoint: "https://push.example/failed", p256dh: "key", auth: "auth" },
];

describe("deliverPwaPayload", () => {
  it("keeps successful devices, prunes expired subscriptions, and isolates transient failures", async () => {
    const result = await deliverPwaPayload(targets, "payload", async (subscription) => {
      if (subscription.endpoint.endsWith("/gone")) throw Object.assign(new Error("expired"), { statusCode: 410 });
      if (subscription.endpoint.endsWith("/failed")) throw new Error("temporary push failure");
    });
    expect(result.acceptedIds).toEqual(["ok"]);
    expect(result.staleIds).toEqual(["gone"]);
    expect(result.errors).toEqual(["temporary push failure"]);
  });
});
