import { randomInt } from "node:crypto";
import { config } from "dotenv";
import { QQBot } from "@tencent-connect/qqbot-nodejs";
import { sanitizedQqError } from "../src/server/qq/config";
import { matchesQqPairingCommand, qqPairingCommand } from "../src/server/qq/pairing";

config({ path: ".env.local", quiet: true });

const configuredAppId = process.env.QQBOT_APP_ID;
const configuredAppSecret = process.env.QQBOT_APP_SECRET;
const existingOwner = process.env.QQBOT_OWNER_USER_ID;

if (!configuredAppId || !configuredAppSecret) {
  console.error("[goalset-qq-pair] QQBOT_APP_ID and QQBOT_APP_SECRET must be configured");
  process.exit(1);
}
const appId = configuredAppId as string;
const appSecret = configuredAppSecret as string;
if (existingOwner && process.env.QQBOT_PAIRING_ALLOW_REBIND !== "true") {
  console.error("[goalset-qq-pair] QQBOT_OWNER_USER_ID is already configured; refusing to rebind");
  process.exit(1);
}

const code = process.env.QQBOT_PAIRING_CODE ?? String(randomInt(100_000, 1_000_000));
const command = qqPairingCommand(code);
const abort = new AbortController();
let paired = false;

const bot = new QQBot({
  appId,
  appSecret,
  accountId: "goalset-owner-pairing",
  tokenPrefetch: "sync",
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: (message) => console.warn("[goalset-qq-pair]", message),
    error: (message) => console.error("[goalset-qq-pair]", sanitizedQqError(message)),
  },
});

bot.on("ready", () => {
  console.info(`[goalset-qq-pair] ready; send this exact C2C message within 10 minutes: ${command}`);
});

bot.on("message", async (_context, message) => {
  if (paired || message.kind !== "c2c" || !matchesQqPairingCommand(message.content, code)) return;
  paired = true;
  try {
    await bot.sendText(message.replyTarget, "Goalset 身份验证成功，正在绑定为唯一所有者。");
  } catch (error) {
    console.error(`[goalset-qq-pair] acknowledgement failed: ${sanitizedQqError(error)}`);
  }
  console.info(`[goalset-qq-pair] owner_user_id=${message.senderId}`);
  abort.abort();
});

bot.on("error", (error) => {
  console.error(`[goalset-qq-pair] QQ Bot error: ${sanitizedQqError(error)}`);
});

const timeout = setTimeout(() => {
  console.error("[goalset-qq-pair] timed out without a matching C2C message");
  abort.abort();
}, 10 * 60_000);

process.once("SIGINT", () => abort.abort());
process.once("SIGTERM", () => abort.abort());

try {
  await bot.start(abort.signal);
  if (!paired) process.exitCode = 1;
} catch (error) {
  console.error(`[goalset-qq-pair] stopped with error: ${sanitizedQqError(error)}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
