import { config } from "dotenv";
import { QQBot } from "@tencent-connect/qqbot-nodejs";
import { sanitizedQqError } from "../src/server/qq/config";
import { renderQqProposalPng, shouldRenderQqProposalImage } from "../src/server/qq/schedule-proposal-image";
import type { QqScheduleProposalPreview } from "../src/server/qq/schedule-proposal-types";

config({ path: ".env.local", quiet: true });

const preview: QqScheduleProposalPreview = {
  decision: "needs_confirmation",
  taskTitle: "QQ complex proposal image smoke",
  date: "2026-08-22",
  durationMinutes: 60,
  placement: { date: "2026-08-22", startMinutes: 14 * 60, endMinutes: 15 * 60 },
  moves: [{ blockId: "smoke-move", title: "Existing flexible task", fromStartMinutes: 14 * 60, toStartMinutes: 15 * 60 + 15, durationMinutes: 30 }],
  contextBlocks: [{ id: "smoke-fixed", title: "Fixed appointment", startMinutes: 16 * 60, durationMinutes: 60, kind: "fixed" }],
  crossDate: false,
  occupiedNoSlot: false,
  reasons: ["isolated image transport smoke"],
  baseFingerprint: "smoke",
};

if (!shouldRenderQqProposalImage(preview)) throw new Error("image smoke preview must require an image");
const buffer = await renderQqProposalPng(preview);

if (process.env.QQ_PROPOSAL_IMAGE_SMOKE_SEND !== "true") {
  console.info(`[goalset-qq-image-smoke] dry run: rendered ${buffer.length} PNG bytes; set QQ_PROPOSAL_IMAGE_SMOKE_SEND=true to send`);
} else {
  const appId = process.env.QQBOT_APP_ID;
  const appSecret = process.env.QQBOT_APP_SECRET;
  const ownerId = process.env.QQBOT_OWNER_USER_ID;
  if (!appId || !appSecret || !ownerId) throw new Error("QQ Bot credentials and owner must be configured");
  const bot = new QQBot({ appId, appSecret, accountId: "goalset-image-smoke", tokenPrefetch: "sync", logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: (message) => console.error("[goalset-qq-image-smoke]", sanitizedQqError(message)) } });
  try {
    await bot.sendImage({ scope: "c2c", targetId: ownerId }, { buffer }, { content: "Goalset complex schedule image smoke · no task was created" });
    console.info(`[goalset-qq-image-smoke] QQ API accepted ${buffer.length} PNG bytes`);
  } catch (error) {
    console.error(`[goalset-qq-image-smoke] send failed: ${sanitizedQqError(error)}`);
    process.exitCode = 1;
  } finally {
    bot.stop();
  }
}
