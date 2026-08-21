import { z } from "zod";

const astrBotConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(8),
  ownerUmo: z.string().min(3).max(500),
});

export const astrBotInboundSchema = z.object({
  messageId: z.string().min(1).max(500),
  senderUmo: z.string().min(3).max(500),
  replyUmo: z.string().min(3).max(500),
  text: z.string().min(1).max(2000),
});

export type AstrBotConfig = z.infer<typeof astrBotConfigSchema>;
export type AstrBotInbound = z.infer<typeof astrBotInboundSchema>;
export type AstrBotFetch = typeof fetch;

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function isPrivateHttp(url: URL) {
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
}

export function parseAstrBotConfig(env: Record<string, string | undefined>): AstrBotConfig {
  const parsed = astrBotConfigSchema.parse({
    baseUrl: env.ASTRBOT_BASE_URL,
    apiKey: env.ASTRBOT_API_KEY,
    ownerUmo: env.ASTRBOT_OWNER_UMO,
  });
  const url = new URL(parsed.baseUrl);
  if (url.protocol !== "https:" && !isPrivateHttp(url)) throw new Error("ASTRBOT_BASE_URL must use HTTPS or loopback HTTP");
  return { ...parsed, baseUrl: normalizeBaseUrl(parsed.baseUrl) };
}

export type AstrBotInboundResult =
  | { kind: "processed"; reply: string }
  | { kind: "duplicate" }
  | { kind: "unauthorized" };

export async function handleAstrBotInbound(
  config: AstrBotConfig,
  input: AstrBotInbound,
  claim: (messageId: string, senderUmo: string) => Promise<boolean>,
  command: (text: string, replyUmo: string) => Promise<string>,
): Promise<AstrBotInboundResult> {
  if (input.senderUmo !== config.ownerUmo) return { kind: "unauthorized" };
  if (!await claim(input.messageId, input.senderUmo)) return { kind: "duplicate" };
  return { kind: "processed", reply: await command(input.text, input.replyUmo) };
}

export class AstrBotGateway {
  public constructor(private readonly config: AstrBotConfig, private readonly fetcher: AstrBotFetch = fetch) {}

  private async request(path: string, init: RequestInit) {
    const response = await this.fetcher(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`AstrBot request failed with HTTP ${response.status}`);
    return response;
  }

  public async probe() {
    await this.request("/api/v1/im/bots", { method: "GET" });
  }

  public async sendText(text: string, targetUmo = this.config.ownerUmo) {
    await this.request("/api/v1/im/message", {
      method: "POST",
      body: JSON.stringify({ umo: targetUmo, message: [{ type: "plain", text }] }),
    });
  }
}
