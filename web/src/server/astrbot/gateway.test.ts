import { describe, expect, it, vi } from "vitest";
import { AstrBotGateway, handleAstrBotInbound, parseAstrBotConfig } from "./gateway";

const config = { baseUrl: "http://127.0.0.1:6185", apiKey: "abk_test_key", ownerUmo: "qq_official:FriendMessage:owner" };

describe("AstrBot gateway contract", () => {
  it("allows HTTPS or loopback HTTP but rejects cleartext remote gateways", () => {
    expect(parseAstrBotConfig({ ASTRBOT_BASE_URL: "http://127.0.0.1:6185/", ASTRBOT_API_KEY: "abk_test_key", ASTRBOT_OWNER_UMO: config.ownerUmo }).baseUrl).toBe(config.baseUrl);
    expect(() => parseAstrBotConfig({ ASTRBOT_BASE_URL: "http://astrbot.example.com", ASTRBOT_API_KEY: "abk_test_key", ASTRBOT_OWNER_UMO: config.ownerUmo })).toThrow("HTTPS or loopback");
  });

  it("sends the documented UMO message envelope with a bearer token", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const gateway = new AstrBotGateway(config, fetcher as typeof fetch);
    await gateway.probe();
    await gateway.sendText("Goalset 测试提醒");
    expect(fetcher).toHaveBeenNthCalledWith(1, `${config.baseUrl}/api/v1/im/bots`, expect.objectContaining({ method: "GET", headers: expect.objectContaining({ authorization: `Bearer ${config.apiKey}` }) }));
    expect(fetcher).toHaveBeenNthCalledWith(2, `${config.baseUrl}/api/v1/im/message`, expect.objectContaining({ method: "POST", body: JSON.stringify({ umo: config.ownerUmo, message: [{ type: "plain", text: "Goalset 测试提醒" }] }) }));
  });

  it("rejects non-owner traffic and claims duplicates before Goalset command execution", async () => {
    const claim = vi.fn(async (messageId: string) => messageId !== "duplicate");
    const command = vi.fn(async (text: string) => `handled:${text}`);
    await expect(handleAstrBotInbound(config, { messageId: "other", senderUmo: "qq_official:FriendMessage:other", replyUmo: "qq_official:FriendMessage:other", text: "突发任务" }, claim, command)).resolves.toEqual({ kind: "unauthorized" });
    await expect(handleAstrBotInbound(config, { messageId: "duplicate", senderUmo: config.ownerUmo, replyUmo: config.ownerUmo, text: "突发任务" }, claim, command)).resolves.toEqual({ kind: "duplicate" });
    await expect(handleAstrBotInbound(config, { messageId: "new", senderUmo: config.ownerUmo, replyUmo: config.ownerUmo, text: "突发任务" }, claim, command)).resolves.toEqual({ kind: "processed", reply: "handled:突发任务" });
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("does not expose AstrBot response bodies in transport errors", async () => {
    const fetcher = vi.fn(async () => new Response("secret upstream detail", { status: 403 }));
    await expect(new AstrBotGateway(config, fetcher as typeof fetch).probe()).rejects.toThrow("HTTP 403");
    await expect(new AstrBotGateway(config, fetcher as typeof fetch).probe()).rejects.not.toThrow("secret upstream detail");
  });
});
