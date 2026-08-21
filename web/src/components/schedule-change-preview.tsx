"use client";

import { RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type PreviewMove = { blockId: string; title: string; fromStartMinutes: number; toStartMinutes: number; durationMinutes: number };

function time(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function ScheduleChangePreview({ summary, placementStartMinutes, moves, confirmLabel, onConfirm, onCancel }: { summary: string; placementStartMinutes?: number; moves: PreviewMove[]; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  return <section className="schedule-change-preview" role="alert"><div className="schedule-change-preview__heading"><RotateCcw size={15} /><div><strong>{summary}</strong><span>原日程尚未改变，确认后才会执行。</span></div><Button variant="ghost" size="icon" type="button" aria-label="取消调整方案" onClick={onCancel}><X size={14} /></Button></div>{placementStartMinutes !== undefined && <p>新任务位置：<strong>{time(placementStartMinutes)}</strong></p>}<div className="schedule-change-preview__moves">{moves.map((move) => <div key={move.blockId}><strong>{move.title}</strong><span>{time(move.fromStartMinutes)} → {time(move.toStartMinutes)} · {move.durationMinutes} 分钟</span></div>)}</div><div className="schedule-change-preview__actions"><Button variant="soft" size="sm" type="button" onClick={onConfirm}>{confirmLabel}</Button><Button variant="ghost" size="sm" type="button" onClick={onCancel}>取消</Button></div></section>;
}
