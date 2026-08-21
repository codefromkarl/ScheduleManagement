import sharp from "sharp";
import type { QqScheduleContextBlock, QqScheduleProposalPreview } from "./schedule-proposal-types";

const WIDTH = 900;
const HEIGHT = 720;
const TOP = 116;
const BOTTOM = 48;

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function clock(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function shouldRenderQqProposalImage(preview: QqScheduleProposalPreview) {
  return preview.moves.length > 0 || preview.crossDate || preview.occupiedNoSlot;
}

function relevantRange(preview: QqScheduleProposalPreview) {
  const minutes = preview.contextBlocks.flatMap((block) => [block.startMinutes, block.startMinutes + block.durationMinutes]);
  if (preview.placement) minutes.push(preview.placement.startMinutes, preview.placement.endMinutes);
  for (const move of preview.moves) minutes.push(move.fromStartMinutes, move.fromStartMinutes + move.durationMinutes, move.toStartMinutes, move.toStartMinutes + move.durationMinutes);
  if (minutes.length === 0) return { startMinutes: 8 * 60, endMinutes: 12 * 60 };
  const naturalStart = Math.max(0, Math.floor((Math.min(...minutes) - 60) / 60) * 60);
  const naturalEnd = Math.min(24 * 60, Math.ceil((Math.max(...minutes) + 60) / 60) * 60);
  if (naturalEnd - naturalStart <= 8 * 60) return { startMinutes: naturalStart, endMinutes: naturalEnd };
  return { startMinutes: naturalStart, endMinutes: Math.min(24 * 60, naturalStart + 8 * 60) };
}

function yFor(minutes: number, range: ReturnType<typeof relevantRange>) {
  return TOP + ((minutes - range.startMinutes) / (range.endMinutes - range.startMinutes)) * (HEIGHT - TOP - BOTTOM);
}

function blockSvg(block: QqScheduleContextBlock, range: ReturnType<typeof relevantRange>) {
  const start = Math.max(block.startMinutes, range.startMinutes);
  const end = Math.min(block.startMinutes + block.durationMinutes, range.endMinutes);
  if (end <= start) return "";
  const y = yFor(start, range);
  const height = Math.max(28, yFor(end, range) - y);
  const fill = block.kind === "fixed" ? "#e9e7ff" : "#f0f2f8";
  const stroke = block.kind === "fixed" ? "#655ce6" : "#9aa1b5";
  return `<rect x="190" y="${y}" width="620" height="${height}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="2"/><text x="208" y="${y + 23}" class="block-title">${block.kind === "fixed" ? "Fixed" : "Scheduled"}</text><text x="208" y="${Math.min(y + height - 8, y + 44)}" class="block-time">${clock(block.startMinutes)}–${clock(block.startMinutes + block.durationMinutes)}</text>`;
}

export function qqProposalSvg(preview: QqScheduleProposalPreview) {
  const range = relevantRange(preview);
  const hours: number[] = [];
  for (let value = range.startMinutes; value <= range.endMinutes; value += 60) hours.push(value);
  const grid = hours.map((minutes) => {
    const y = yFor(minutes, range);
    return `<line x1="92" y1="${y}" x2="830" y2="${y}" stroke="#e5e7ef" stroke-width="1"/><text x="34" y="${y + 5}" class="time">${clock(minutes)}</text>`;
  }).join("");
  const blocks = preview.contextBlocks.map((block) => blockSvg(block, range)).join("");
  const placement = preview.placement ? (() => {
    const y = yFor(preview.placement!.startMinutes, range);
    const height = Math.max(32, yFor(preview.placement!.endMinutes, range) - y);
    return `<rect x="170" y="${y}" width="660" height="${height}" rx="12" fill="#f4f1ff" fill-opacity="0.92" stroke="#654ee8" stroke-width="4" stroke-dasharray="10 7"/><text x="190" y="${y + 25}" class="proposal-title">Proposed</text><text x="190" y="${Math.min(y + height - 9, y + 47)}" class="proposal-time">${clock(preview.placement!.startMinutes)}–${clock(preview.placement!.endMinutes)}</text>`;
  })() : "";
  const moves = preview.moves.map((move, index) => `<text x="110" y="${HEIGHT - 24 - index * 23}" class="move">Move ${index + 1}: ${clock(move.fromStartMinutes)} -&gt; ${clock(move.toStartMinutes)}</text>`).join("");
  const description = [preview.taskTitle, ...preview.contextBlocks.map((block) => block.title), ...preview.moves.map((move) => move.title)].join(" | ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><desc>${escapeXml(description)}</desc><style>text{font-family:Arial,sans-serif}.title{font-size:28px;font-weight:700;fill:#282a36}.subtitle{font-size:17px;fill:#686c7d}.time{font-size:15px;fill:#8d91a1}.block-title{font-size:18px;font-weight:650;fill:#3e4150}.block-time{font-size:14px;fill:#727789}.proposal-title{font-size:20px;font-weight:700;fill:#4938c9}.proposal-time{font-size:15px;fill:#655ce6}.move{font-size:15px;fill:#8a5c00}</style><rect width="100%" height="100%" fill="#ffffff"/><text x="34" y="42" class="title">Goalset Schedule Proposal</text><text x="34" y="75" class="subtitle">${escapeXml(preview.date)} · Review before confirm</text>${grid}${blocks}${placement}${moves}</svg>`;
}

export async function renderQqProposalPng(preview: QqScheduleProposalPreview) {
  return sharp(Buffer.from(qqProposalSvg(preview))).png({ compressionLevel: 9 }).toBuffer();
}
