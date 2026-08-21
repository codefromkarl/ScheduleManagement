"use client";

import type { CSSProperties, DragEvent } from "react";
import { useState } from "react";
import { KIND_LABELS, STATUS_LABELS, type ScheduleItem } from "@/features/schedule/model";
import { timelineHours, type TimelineRange } from "@/features/schedule/domain/timeline";
import { formatDateKey, formatDuration, formatHour, formatMinutesOfDay, todayDateKey, weekdayLabel, weekDateKeys } from "@/features/schedule/view-utils";

export type ConflictMarker = { date: string; startMinutes: number; durationMinutes: number; reason: string };
type DragPreview = { startMinutes: number; durationMinutes: number };

function currentTimeMarker(dateKey: string, range: TimelineRange, currentMinutes: number) {
  if (dateKey !== todayDateKey()) return null;
  if (currentMinutes < range.startMinutes || currentMinutes > range.endMinutes) return null;
  return { top: `${((currentMinutes - range.startMinutes) / (range.endMinutes - range.startMinutes)) * 100}%`, label: formatMinutesOfDay(currentMinutes) };
}

function getBlockStyle(item: ScheduleItem, range: TimelineRange, compact = false): CSSProperties {
  const rangeMinutes = range.endMinutes - range.startMinutes;
  const top = ((item.startMinutes - range.startMinutes) / rangeMinutes) * 100;
  const height = (item.durationMinutes / rangeMinutes) * 100;
  return { top: `${top}%`, height: `max(${height}%, ${compact ? 42 : 56}px)` };
}

function ScheduleBlock({ item, range, compact = false, onSelect }: { item: ScheduleItem; range: TimelineRange; compact?: boolean; onSelect: (item: ScheduleItem, trigger: HTMLButtonElement) => void }) {
  const endMinutes = item.startMinutes + item.durationMinutes;
  const timeLabel = `${formatMinutesOfDay(item.startMinutes)}–${formatMinutesOfDay(endMinutes)}`;
  const disclosure = `${item.title}，${KIND_LABELS[item.kind]}任务，${STATUS_LABELS[item.status]}，${item.project}，${formatDuration(item.durationMinutes)}，${timeLabel}`;
  const tooltipAbove = endMinutes > range.startMinutes + (range.endMinutes - range.startMinutes) * 0.75;
  return (
    <button aria-label={compact ? disclosure : undefined} className={`schedule-item ${compact ? `schedule-item--week ${tooltipAbove ? "schedule-item--tooltip-above" : ""}` : ""} ${item.tone}`} data-tooltip={compact ? disclosure : undefined} style={getBlockStyle(item, range, compact)} type="button" draggable={item.kind !== "fixed"} title={compact ? undefined : item.kind === "fixed" ? "固定安排请点击后修改时间" : "可以拖动改期，也可以点击查看详情"} onDragStart={(event) => { if (item.kind !== "fixed") { event.dataTransfer.setData("application/x-goalset-scheduled-task", item.taskId); event.dataTransfer.setData("application/x-goalset-duration", String(item.durationMinutes)); event.dataTransfer.effectAllowed = "move"; } }} onClick={(event) => onSelect(item, event.currentTarget)}>
      {compact ? <><strong>{item.title}</strong><span className="schedule-item__meta">{timeLabel}</span></> : <><div className="schedule-item__heading"><span className="schedule-item__kind">{KIND_LABELS[item.kind]}</span><span className="schedule-item__status">{STATUS_LABELS[item.status]}</span></div><strong>{item.title}</strong><span className="schedule-item__meta">{formatDuration(item.durationMinutes)} · {item.project}</span></>}
    </button>
  );
}

function TimelineGrid({ range, halfHours = false }: { range: TimelineRange; halfHours?: boolean }) {
  const rangeMinutes = range.endMinutes - range.startMinutes;
  const halfHourMarks = halfHours ? Array.from({ length: Math.floor(rangeMinutes / 60) }, (_, index) => range.startMinutes + index * 60 + 30).filter((minutes) => minutes < range.endMinutes) : [];
  return <div className="timeline-grid" aria-hidden="true">{timelineHours(range).map((hour) => <span key={hour} />)}{halfHourMarks.map((minutes) => <i className="timeline-grid__half-hour" style={{ top: `${((minutes - range.startMinutes) / rangeMinutes) * 100}%` }} key={minutes} />)}</div>;
}

function TimelineDropPreview({ startMinutes, durationMinutes, range }: DragPreview & { range: TimelineRange }) {
  const top = ((startMinutes - range.startMinutes) / (range.endMinutes - range.startMinutes)) * 100;
  const height = (durationMinutes / (range.endMinutes - range.startMinutes)) * 100;
  const timeRange = `${formatMinutesOfDay(startMinutes)}–${formatMinutesOfDay(startMinutes + durationMinutes)}`;
  return <div className="timeline-drop-preview" style={{ top: `${top}%`, height: `max(${height}%, 22px)` }} role="status" aria-label={`目标时间 ${timeRange}`}><b>{timeRange}</b><small>释放后校验</small></div>;
}

function getDropTarget(event: DragEvent<HTMLDivElement>, range: TimelineRange) {
  const taskId = event.dataTransfer.getData("application/x-goalset-task");
  const scheduledTaskId = event.dataTransfer.getData("application/x-goalset-scheduled-task");
  if (!taskId && !scheduledTaskId) return null;
  const durationValue = Number(event.dataTransfer.getData("application/x-goalset-duration"));
  const durationMinutes = Number.isInteger(durationValue) && durationValue > 0 ? durationValue : 15;
  const bounds = event.currentTarget.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
  const rawMinutes = range.startMinutes + ratio * (range.endMinutes - range.startMinutes);
  const startMinutes = Math.max(range.startMinutes, Math.min(range.endMinutes - 15, Math.round(rawMinutes / 15) * 15));
  return { taskId, scheduledTaskId, startMinutes, durationMinutes };
}

export function DayView({ dateKey, range, items, conflict, currentMinutes, onSelect, onDropTask, onDropScheduledTask }: { dateKey: string; range: TimelineRange; items: ScheduleItem[]; conflict: ConflictMarker | null; currentMinutes: number; onSelect: (item: ScheduleItem, trigger: HTMLButtonElement) => void; onDropTask: (taskId: string, startMinutes: number) => void; onDropScheduledTask: (taskId: string, startMinutes: number) => void }) {
  const timeMarker = currentTimeMarker(dateKey, range, currentMinutes);
  const [dropActive, setDropActive] = useState(false);
  const [dropPreview, setDropPreview] = useState<DragPreview | null>(null);

  function dropTask(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropActive(false);
    setDropPreview(null);
    const target = getDropTarget(event, range);
    if (!target) return;
    if (target.scheduledTaskId) onDropScheduledTask(target.scheduledTaskId, target.startMinutes);
    else onDropTask(target.taskId, target.startMinutes);
  }

  return (
    <div className="timeline-shell" aria-label="今日时间轴">
      <div className="timeline-labels" aria-hidden="true">{timelineHours(range).map((hour) => <span key={hour}>{formatHour(hour)}</span>)}</div>
      <div className={`timeline-track ${dropActive ? "timeline-track--drop-target" : ""}`} data-start-minutes={range.startMinutes} data-end-minutes={range.endMinutes} onDragEnter={() => setDropActive(true)} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setDropActive(false); setDropPreview(null); } }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; const target = getDropTarget(event, range); setDropPreview(target ? { startMinutes: target.startMinutes, durationMinutes: target.durationMinutes } : null); }} onDrop={dropTask}>
        <TimelineGrid range={range} />
        {items.map((item) => <ScheduleBlock key={item.id} item={item} range={range} onSelect={onSelect} />)}
        {dropPreview && <TimelineDropPreview {...dropPreview} range={range} />}
        {conflict?.date === dateKey && <div className="timeline-conflict" style={{ top: `${((conflict.startMinutes - range.startMinutes) / (range.endMinutes - range.startMinutes)) * 100}%`, height: `max(${(conflict.durationMinutes / (range.endMinutes - range.startMinutes)) * 100}%, 42px)` }} role="alert"><strong>{formatMinutesOfDay(conflict.startMinutes)} 无法放置</strong><span>{conflict.reason}</span></div>}
        {timeMarker && <div className="current-time" style={{ top: timeMarker.top }}><span /><b>现在 {timeMarker.label}</b></div>}
      </div>
    </div>
  );
}

function WeekDayTrack({ dateKey, selected, range, items, conflict, currentMinutes, onSelectDay, onSelect, onDropTask, onDropScheduledTask }: { dateKey: string; selected: boolean; range: TimelineRange; items: ScheduleItem[]; conflict: ConflictMarker | null; currentMinutes: number; onSelectDay: (dateKey: string) => void; onSelect: (item: ScheduleItem, trigger: HTMLButtonElement) => void; onDropTask: (taskId: string, dateKey: string, startMinutes: number) => void; onDropScheduledTask: (taskId: string, dateKey: string, startMinutes: number) => void }) {
  const [dropActive, setDropActive] = useState(false);
  const [dropPreview, setDropPreview] = useState<DragPreview | null>(null);
  const timeMarker = currentTimeMarker(dateKey, range, currentMinutes);

  function dropTask(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropActive(false);
    setDropPreview(null);
    const target = getDropTarget(event, range);
    if (!target) return;
    onSelectDay(dateKey);
    if (target.scheduledTaskId) onDropScheduledTask(target.scheduledTaskId, dateKey, target.startMinutes);
    else onDropTask(target.taskId, dateKey, target.startMinutes);
  }

  return (
    <div className={`week-timetable__track ${selected ? "week-timetable__track--selected" : ""} ${dropActive ? "timeline-track--drop-target" : ""}`} aria-label={`${weekdayLabel(dateKey)} ${formatDateKey(dateKey)} 日程`} data-date={dateKey} data-start-minutes={range.startMinutes} data-end-minutes={range.endMinutes} onDragEnter={() => setDropActive(true)} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setDropActive(false); setDropPreview(null); } }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; const target = getDropTarget(event, range); setDropPreview(target ? { startMinutes: target.startMinutes, durationMinutes: target.durationMinutes } : null); }} onDrop={dropTask}>
      <TimelineGrid range={range} halfHours />
      {items.map((item) => <ScheduleBlock key={item.id} item={item} range={range} compact onSelect={onSelect} />)}
      {dropPreview && <TimelineDropPreview {...dropPreview} range={range} />}
      {conflict?.date === dateKey && <div className="timeline-conflict timeline-conflict--week" style={{ top: `${((conflict.startMinutes - range.startMinutes) / (range.endMinutes - range.startMinutes)) * 100}%`, height: `max(${(conflict.durationMinutes / (range.endMinutes - range.startMinutes)) * 100}%, 34px)` }} role="alert"><strong>{formatMinutesOfDay(conflict.startMinutes)} 无法放置</strong><span>{conflict.reason}</span></div>}
      {timeMarker && <div className="current-time current-time--week" style={{ top: timeMarker.top }}><span /><b>现在 {timeMarker.label}</b></div>}
    </div>
  );
}

export function WeekView({ selectedDate, range, days, conflict, currentMinutes, onSelectDay, onSelect, onDropTask, onDropScheduledTask }: { selectedDate: string; range: TimelineRange; days: Record<string, ScheduleItem[]> | null; conflict: ConflictMarker | null; currentMinutes: number; onSelectDay: (dateKey: string) => void; onSelect: (item: ScheduleItem, trigger: HTMLButtonElement) => void; onDropTask: (taskId: string, dateKey: string, startMinutes: number) => void; onDropScheduledTask: (taskId: string, dateKey: string, startMinutes: number) => void }) {
  const dates = weekDateKeys(selectedDate);
  return (
    <div className="week-timetable" aria-label="本周星期表">
      <div className="week-timetable__canvas">
        <div className="week-timetable__header"><span className="week-timetable__corner">时间</span>{dates.map((dateKey) => <button className={`week-column ${dateKey === selectedDate ? "week-column--active" : ""}`} key={dateKey} type="button" onClick={() => onSelectDay(dateKey)}><span className="week-column__day">{weekdayLabel(dateKey)}</span><span className="week-column__date">{dateKey.slice(5).replace("-", "/")}</span></button>)}</div>
        <div className="week-timetable__body">
          <div className="timeline-labels week-timetable__labels" aria-hidden="true">{timelineHours(range).map((hour) => <span key={hour}>{formatHour(hour)}</span>)}</div>
          {dates.map((dateKey) => <WeekDayTrack key={dateKey} dateKey={dateKey} selected={dateKey === selectedDate} range={range} items={days?.[dateKey] ?? []} conflict={conflict} currentMinutes={currentMinutes} onSelectDay={onSelectDay} onSelect={onSelect} onDropTask={onDropTask} onDropScheduledTask={onDropScheduledTask} />)}
        </div>
      </div>
    </div>
  );
}
