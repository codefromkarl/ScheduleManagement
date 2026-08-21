import { config as loadEnv } from "dotenv";
import { AstrBotGateway, parseAstrBotConfig } from "@/server/astrbot/gateway";

loadEnv({ path: ".env.local" });

async function main() {
  const gateway = new AstrBotGateway(parseAstrBotConfig(process.env));
  await gateway.probe();
  console.info("[goalset-astrbot-smoke] AstrBot IM API is reachable");
  if (process.env.ASTRBOT_SMOKE_SEND === "true") {
    await gateway.sendText("Goalset AstrBot 网关测试：仅验证主动文本投递。");
    console.info("[goalset-astrbot-smoke] test message accepted by AstrBot");
  } else {
    console.info("[goalset-astrbot-smoke] dry run only; set ASTRBOT_SMOKE_SEND=true to send one external message");
  }
}

void main().catch((error) => {
  console.error("[goalset-astrbot-smoke] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
