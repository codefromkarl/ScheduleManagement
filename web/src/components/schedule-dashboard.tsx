"use client";

import type { CSSProperties, DragEvent, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Archive,
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  GripVertical,
  Plus,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ToastRegion } from "@/components/ui/toast";
import {
  DEMO_ITEMS,
  KIND_LABELS,
  PROJECTS,
  STATUS_LABELS,
  scheduleItemsFromSnapshot,
  unplannedTasksFromSnapshot,
  type ScheduleItem,
  type UnplannedTask,
} from "@/features/schedule/model";
import { reminderListResponseSchema, scheduleSnapshotSchema, type ReminderSummary } from "@/features/schedule/data/contract";
import type { ScheduleTask } from "@/features/schedule/domain/types";
import { enablePwaNotifications } from "@/components/pwa-register";
import { QuickSettings } from "@/components/quick-settings";
import { CapacitySummary, UnplannedOverview } from "@/components/planning-overview";
import { ScheduleChangePreview, type PreviewMove } from "@/components/schedule-change-preview";
import type { DailyCapacity } from "@/features/schedule/domain/capacity";
import type { ReminderImportanceReason } from "@/features/schedule/domain/reminder-policy";
import { groupUnplannedTasks } from "@/features/schedule/domain/unplanned-groups";
import { DEFAULT_TIMELINE_RANGE, deriveTimelineRange, expandTimelineRange, timelineHours, type TimelineRange } from "@/features/schedule/domain/timeline";

type ViewMode = "day" | "week";
type DataSource = "demo" | "api" | "loading";
type IntegrationStatus = { authDisabled?: boolean; databaseConfigured: boolean; aiConfigured: boolean; aiMode?: string; qqConfigured: boolean; pwaConfigured: boolean; reminderChannels?: Array<"qq" | "pwa">; pwaSubscriptionCount?: number; workers?: Array<{ workerName: string; status: string; lastSuccessAt?: string | null; lastError?: string | null }> };
type ProjectSummary = { id?: string; name: string; count: number; tone: string; archived?: boolean; totalMinutes?: number; doneMinutes?: number; blockedCount?: number; overdueCount?: number; unplannedCount?: number; deadlineRiskCount?: number; progress?: number; remainingMinutes?: number; health?: "healthy" | "at_risk" | "blocked" | "empty"; healthReason?: string };
type ChangeSummary = { id: string; source: string; status: string; originalCommand?: string | null; createdAt: string };
type RecurrenceSummary = { id: string; taskId: string; frequency: "daily" | "weekly" | "workday" | "weekdays"; weekdays?: number[] | null; startDate: string; endDate?: string | null; timezone: string };
type PendingReschedule = { taskId: string; date: string; startMinutes: number; moves: PreviewMove[]; reply: string };
type PendingPlacement = { taskId: string; date: string; placementStartMinutes?: number; moves: PreviewMove[] };
type ConflictMarker = { date: string; startMinutes: number; durationMinutes: number; reason: string };
type DragPreview = { startMinutes: number; durationMinutes: number };
type ProposalMove = { blockId: string; fromStartMinutes: number; toStartMinutes: number; durationMinutes: number };
type TopLayer = "search" | "notifications" | "profile" | null;
type ActiveSurface = "settings" | "add-task" | "task-detail" | "mobile-nav" | "unplanned" | "activity" | null;
type AddMode = "manual" | "natural";
type Confirmation =
  | { kind: "archive-project"; project: ProjectSummary }
  | { kind: "delete-task"; task: ScheduleItem }
  | { kind: "daily-close"; action: "unplan" | "move_tomorrow"; count: number };

const reminderKindLabels: Record<ReminderSummary["kind"], string> = { start: "任务开始", schedule_change: "日程调整", daily_summary: "每日摘要", test: "通道测试" };
const reminderChannelLabels: Record<ReminderSummary["channel"], string> = { qq: "QQ", pwa: "PWA" };
const reminderImportanceLabels: Record<ReminderImportanceReason, string> = { task_override: "单任务强制", high_priority: "高优先级", fixed_schedule: "固定安排", blocked_task: "阻塞", deadline_risk: "截止风险", impossible_capacity: "容量不可行", unhandled_high_priority: "重要任务待处理" };
const projectHealthLabels: Record<NonNullable<ProjectSummary["health"]>, string> = { healthy: "正常", at_risk: "需留意", blocked: "已阻塞", empty: "待安排" };
const recurrenceFrequencyLabels: Record<RecurrenceSummary["frequency"], string> = { daily: "每天", weekly: "每周", workday: "工作日", weekdays: "指定星期" };
const priorityLabels: Record<ScheduleTask["priority"], string> = { high: "重要", normal: "普通", low: "低" };
const reminderPolicyLabels: Record<ScheduleTask["reminderPolicy"], string> = { auto: "自动", always: "强制提醒", never: "不提醒" };

function reminderDeliveryStatus(reminder: ReminderSummary) {
  if (reminder.receivedAt) return "设备已收到";
  if (reminder.status === "pending") return "等待发送";
  if (reminder.status === "sending") return "发送中";
  if (reminder.status === "sent") return reminder.channel === "qq" ? "QQ API 已接受，请确认客户端收到" : "推送服务已接受，等待设备回执";
  if (reminder.status === "failed") return `发送失败：${reminder.error ?? "未知原因"}`;
  return "已取消";
}

function hasReadyReminderChannel(status: IntegrationStatus) {
  const channels = status.reminderChannels ?? ["qq", "pwa"];
  return (channels.includes("qq") && status.qqConfigured) || (channels.includes("pwa") && status.pwaConfigured);
}

const mobileQuery = "(max-width: 767px)";
const sidebarStorageKey = "goalset:sidebar-collapsed";
const sidebarChangeEvent = "goalset:sidebar-change";

function confirmationDetails(confirmation: Confirmation | null) {
  if (!confirmation) return { title: "确认操作", description: "请确认是否继续。", confirmLabel: "确认", danger: false };
  if (confirmation.kind === "archive-project") return { title: `归档「${confirmation.project.name}」？`, description: "项目中的任务不会被删除，之后仍可通过数据恢复。", confirmLabel: "归档项目", danger: true };
  if (confirmation.kind === "delete-task") return { title: `删除「${confirmation.task.title}」？`, description: "任务和对应时间块会被删除，此操作不能直接撤销。", confirmLabel: "删除任务", danger: true };
  return confirmation.action === "move_tomorrow"
    ? { title: "将未完成任务移到明天？", description: `将 ${confirmation.count} 项弹性或浮动任务移到明天待安排，固定安排保持不变。`, confirmLabel: "移到明天", danger: false }
    : { title: "移回今日待安排？", description: `移除 ${confirmation.count} 项未完成任务的时间块，任务仍保留在今天。`, confirmLabel: "移回待安排", danger: false };
}

function subscribeToMobile(callback: () => void) {
  const mediaQuery = window.matchMedia(mobileQuery);
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getMobileSnapshot() {
  return window.matchMedia(mobileQuery).matches;
}

function getMobileServerSnapshot() {
  return false;
}

function subscribeToClock(callback: () => void) {
  const intervalId = window.setInterval(callback, 60_000);
  return () => window.clearInterval(intervalId);
}

function getClockSnapshot() {
  return currentShanghaiMinutes();
}

function getClockServerSnapshot() {
  return -1;
}

function subscribeToSidebar(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(sidebarChangeEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(sidebarChangeEvent, callback);
  };
}

function getSidebarSnapshot() {
  return window.localStorage.getItem(sidebarStorageKey) === "true";
}

function getSidebarServerSnapshot() {
  return false;
}

function saveSidebarCollapsed(collapsed: boolean) {
  window.localStorage.setItem(sidebarStorageKey, String(collapsed));
  window.dispatchEvent(new Event(sidebarChangeEvent));
}

function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function todayDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function formatDateKey(dateKey: string) {
  const date = dateFromKey(dateKey);
  return `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`;
}

function formatDayHeading(dateKey: string) {
  const date = dateFromKey(dateKey);
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return `${formatDateKey(dateKey)} · ${weekdays[date.getUTCDay()]}`;
}

function formatWeekHeading(dateKey: string) {
  const selected = dateFromKey(dateKey);
  const mondayOffset = (selected.getUTCDay() + 6) % 7;
  const monday = new Date(selected);
  monday.setUTCDate(monday.getUTCDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return `${monday.getUTCMonth() + 1} 月 ${monday.getUTCDate()} 日 — ${sunday.getUTCMonth() + 1} 月 ${sunday.getUTCDate()} 日`;
}

function weekDateKeys(dateKey: string) {
  const selected = dateFromKey(dateKey);
  const mondayOffset = (selected.getUTCDay() + 6) % 7;
  const monday = new Date(selected);
  monday.setUTCDate(monday.getUTCDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return dateKeyFromDate(date);
  });
}

function weekdayLabel(dateKey: string) {
  const date = dateFromKey(dateKey);
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getUTCDay()];
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatMinutesOfDay(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function formatHours(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function currentTimeMarker(dateKey: string, range: TimelineRange, currentMinutes: number) {
  if (dateKey !== todayDateKey()) return null;
  if (currentMinutes < range.startMinutes || currentMinutes > range.endMinutes) return null;
  return { top: `${((currentMinutes - range.startMinutes) / (range.endMinutes - range.startMinutes)) * 100}%`, label: formatMinutesOfDay(currentMinutes) };
}

function currentShanghaiMinutes() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function snapshotRisk(snapshot: ReturnType<typeof scheduleSnapshotSchema.parse>) {
  const blockTaskIds = new Set(snapshot.blocks.map((block) => block.taskId));
  const riskTaskIds = new Set<string>();
  let unplannedCount = 0;
  let overdueCount = 0;
  const today = todayDateKey();
  for (const task of snapshot.tasks) {
    const unplanned = !blockTaskIds.has(task.id) && task.status !== "done";
    const overdue = task.status !== "done" && task.date < today;
    if (unplanned) unplannedCount += 1;
    if (overdue) overdueCount += 1;
    if (unplanned || overdue || task.status === "blocked") riskTaskIds.add(task.id);
  }
  return { riskCount: riskTaskIds.size, unplannedCount, overdueCount, totalCount: snapshot.tasks.length };
}

function snapshotFreeMinutes(snapshot: ReturnType<typeof scheduleSnapshotSchema.parse>) {
  const availableSlots = new Set<number>();
  for (const window of snapshot.availability) {
    for (let minute = window.startMinutes; minute < window.endMinutes; minute += 15) availableSlots.add(minute);
  }
  for (const window of snapshot.unavailable) {
    for (let minute = window.startMinutes; minute < window.endMinutes; minute += 15) availableSlots.delete(minute);
  }
  for (const block of snapshot.blocks) {
    const start = Math.max(0, block.startMinutes - snapshot.bufferMinutes);
    const end = Math.min(24 * 60, block.startMinutes + block.durationMinutes + snapshot.bufferMinutes);
    for (let minute = start; minute < end; minute += 15) availableSlots.delete(minute);
  }
  return availableSlots.size * 15;
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function getBlockStyle(item: ScheduleItem, range: TimelineRange, compact = false): CSSProperties {
  const rangeMinutes = range.endMinutes - range.startMinutes;
  const top = ((item.startMinutes - range.startMinutes) / rangeMinutes) * 100;
  const height = (item.durationMinutes / rangeMinutes) * 100;

  return {
    top: `${top}%`,
    height: `max(${height}%, ${compact ? 42 : 56}px)`,
  };
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

function DayView({ dateKey, range, items, conflict, currentMinutes, onSelect, onDropTask, onDropScheduledTask }: { dateKey: string; range: TimelineRange; items: ScheduleItem[]; conflict: ConflictMarker | null; currentMinutes: number; onSelect: (item: ScheduleItem, trigger: HTMLButtonElement) => void; onDropTask: (taskId: string, startMinutes: number) => void; onDropScheduledTask: (taskId: string, startMinutes: number) => void }) {
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
      <div className="timeline-labels" aria-hidden="true">
        {timelineHours(range).map((hour) => <span key={hour}>{formatHour(hour)}</span>)}
      </div>
      <div
        className={`timeline-track ${dropActive ? "timeline-track--drop-target" : ""}`}
        data-start-minutes={range.startMinutes}
        data-end-minutes={range.endMinutes}
        onDragEnter={() => setDropActive(true)}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setDropActive(false); setDropPreview(null); } }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; const target = getDropTarget(event, range); setDropPreview(target ? { startMinutes: target.startMinutes, durationMinutes: target.durationMinutes } : null); }}
        onDrop={dropTask}
      >
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
    <div
      className={`week-timetable__track ${selected ? "week-timetable__track--selected" : ""} ${dropActive ? "timeline-track--drop-target" : ""}`}
      aria-label={`${weekdayLabel(dateKey)} ${formatDateKey(dateKey)} 日程`}
      data-date={dateKey}
      data-start-minutes={range.startMinutes}
      data-end-minutes={range.endMinutes}
      onDragEnter={() => setDropActive(true)}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setDropActive(false); setDropPreview(null); } }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; const target = getDropTarget(event, range); setDropPreview(target ? { startMinutes: target.startMinutes, durationMinutes: target.durationMinutes } : null); }}
      onDrop={dropTask}
    >
      <TimelineGrid range={range} halfHours />
      {items.map((item) => <ScheduleBlock key={item.id} item={item} range={range} compact onSelect={onSelect} />)}
      {dropPreview && <TimelineDropPreview {...dropPreview} range={range} />}
      {conflict?.date === dateKey && <div className="timeline-conflict timeline-conflict--week" style={{ top: `${((conflict.startMinutes - range.startMinutes) / (range.endMinutes - range.startMinutes)) * 100}%`, height: `max(${(conflict.durationMinutes / (range.endMinutes - range.startMinutes)) * 100}%, 34px)` }} role="alert"><strong>{formatMinutesOfDay(conflict.startMinutes)} 无法放置</strong><span>{conflict.reason}</span></div>}
      {timeMarker && <div className="current-time current-time--week" style={{ top: timeMarker.top }}><span /><b>现在 {timeMarker.label}</b></div>}
    </div>
  );
}

function WeekView({ selectedDate, range, days, conflict, currentMinutes, onSelectDay, onSelect, onDropTask, onDropScheduledTask }: { selectedDate: string; range: TimelineRange; days: Record<string, ScheduleItem[]> | null; conflict: ConflictMarker | null; currentMinutes: number; onSelectDay: (dateKey: string) => void; onSelect: (item: ScheduleItem, trigger: HTMLButtonElement) => void; onDropTask: (taskId: string, dateKey: string, startMinutes: number) => void; onDropScheduledTask: (taskId: string, dateKey: string, startMinutes: number) => void }) {
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

type ProjectNavigationProps = {
  sectionId?: string;
  projects: ProjectSummary[];
  selectedProject: string;
  showNewProject: boolean;
  newProjectName: string;
  onToggleNewProject: () => void;
  onNewProjectNameChange: (value: string) => void;
  onCreateProject: (event: FormEvent<HTMLFormElement>) => void;
  onSelectProject: (name: string) => void;
  onArchiveProject: (project: ProjectSummary) => void;
};

function ProjectNavigation({ sectionId = "projects", projects, selectedProject, showNewProject, newProjectName, onToggleNewProject, onNewProjectNameChange, onCreateProject, onSelectProject, onArchiveProject }: ProjectNavigationProps) {
  return (
    <div className="side-section side-section--primary" id={sectionId}>
      <div className="side-section__title"><span>我的项目</span><Button variant="ghost" size="icon" type="button" aria-label="新建项目" aria-expanded={showNewProject} onClick={onToggleNewProject}><Plus size={15} /></Button></div>
      {showNewProject && <form className="new-project-form" onSubmit={onCreateProject}><Input aria-label="新项目名称" value={newProjectName} onChange={(event) => onNewProjectNameChange(event.target.value)} placeholder="项目名称" autoFocus /><Button size="icon" type="submit" aria-label="创建项目"><Plus size={14} /></Button></form>}
      <div className="project-list">
        {projects.map((item) => (
          <div className="project-list__row" key={item.name}>
            <Button className={`project-list__item ${selectedProject === item.name ? "project-list__item--active" : ""}`} variant="ghost" size="sm" type="button" aria-label={`${item.name}，${item.count} 项，${projectHealthLabels[item.health ?? "empty"]}`} onClick={() => onSelectProject(item.name)}>
              <i style={{ background: item.tone }} />
              <span className="project-list__label"><strong>{item.name}</strong><small>{item.count} 项 · {item.progress ?? 0}%</small></span>
              <em className={`project-health project-health--${item.health ?? "empty"}`} title={item.healthReason}>{projectHealthLabels[item.health ?? "empty"]}</em>
            </Button>
            {item.id && <Button className="project-list__archive" variant="ghost" size="icon" type="button" aria-label={`归档 ${item.name}`} onClick={() => onArchiveProject(item)}><Archive size={12} /></Button>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScheduleDashboard() {
  const router = useRouter();
  const isMobile = useSyncExternalStore(subscribeToMobile, getMobileSnapshot, getMobileServerSnapshot);
  const sidebarCollapsed = useSyncExternalStore(subscribeToSidebar, getSidebarSnapshot, getSidebarServerSnapshot);
  const currentMinutes = useSyncExternalStore(subscribeToClock, getClockSnapshot, getClockServerSnapshot);
  const surfaceTriggerRef = useRef<HTMLElement | null>(null);
  const confirmationTriggerRef = useRef<HTMLElement | null>(null);
  const [topLayer, setTopLayer] = useState<TopLayer>(null);
  const [activeSurface, setActiveSurface] = useState<ActiveSurface>(null);
  const [addMode, setAddMode] = useState<AddMode>("manual");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [viewOverride, setViewOverride] = useState<ViewMode | null>(null);
  const [project, setProject] = useState("全部安排");
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [unplannedTasks, setUnplannedTasks] = useState<UnplannedTask[]>([]);
  const [allUnplannedTasks, setAllUnplannedTasks] = useState<ScheduleTask[]>([]);
  const [capacityDays, setCapacityDays] = useState<DailyCapacity[]>([]);
  const [timelineRange, setTimelineRange] = useState<TimelineRange>(DEFAULT_TIMELINE_RANGE);
  const [placementTaskId, setPlacementTaskId] = useState<string | null>(null);
  const [placementTime, setPlacementTime] = useState("09:00");
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const [conflictMarker, setConflictMarker] = useState<ConflictMarker | null>(null);
  const [rescheduleTime, setRescheduleTime] = useState("09:00");
  const [batchBusy, setBatchBusy] = useState(false);
  const [scheduleRisk, setScheduleRisk] = useState({ riskCount: 0, unplannedCount: 0, overdueCount: 0, totalCount: 0 });
  const [scheduleFreeMinutes, setScheduleFreeMinutes] = useState<number | null>(null);
  const [weekSchedule, setWeekSchedule] = useState<Record<string, ScheduleItem[]> | null>(null);
  const [weekTimelineRange, setWeekTimelineRange] = useState<TimelineRange>(DEFAULT_TIMELINE_RANGE);
  const [weekScheduleRevision, setWeekScheduleRevision] = useState(0);
  const [dataSource, setDataSource] = useState<DataSource>("loading");
  const [selectedDate, setSelectedDate] = useState(todayDateKey);
  const [taskFormError, setTaskFormError] = useState("");
  const [pendingTask, setPendingTask] = useState<ScheduleTask | null>(null);
  const [pendingReschedule, setPendingReschedule] = useState<PendingReschedule | null>(null);
  const [taskForm, setTaskForm] = useState({ title: "", kind: "flexible" as ScheduleTask["kind"], duration: "15", start: "09:00", deadline: "18:00", priority: "normal" as ScheduleTask["priority"] });
  const [projects, setProjects] = useState<ProjectSummary[]>(PROJECTS);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTask, setSelectedTask] = useState<ScheduleItem | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState<ScheduleTask["priority"]>("normal");
  const [taskReminderPolicy, setTaskReminderPolicy] = useState<ScheduleTask["reminderPolicy"]>("auto");
  const [taskNote, setTaskNote] = useState("");
  const [recurrences, setRecurrences] = useState<RecurrenceSummary[]>([]);
  const [recurrenceForm, setRecurrenceForm] = useState<{ frequency: RecurrenceSummary["frequency"]; endDate: string }>({ frequency: "daily", endDate: "" });
  const [overrideForm, setOverrideForm] = useState({ start: "09:00", duration: "30" });
  const [bufferMinutes, setBufferMinutes] = useState(15);
  const [notice, setNotice] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiOptimize, setAiOptimize] = useState(false);
  const [aiReply, setAiReply] = useState("");
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus>({ databaseConfigured: false, aiConfigured: false, qqConfigured: false, pwaConfigured: false });
  const [lastChangeSetId, setLastChangeSetId] = useState<string | null>(null);
  const [changes, setChanges] = useState<ChangeSummary[]>([]);
  const [reminders, setReminders] = useState<ReminderSummary[]>([]);
  const [prompt, setPrompt] = useState("");
  const [capturedPrompts, setCapturedPrompts] = useState<string[]>([]);

  const view = viewOverride ?? (isMobile ? "day" : "week");
  const currentWeekDates = useMemo(() => weekDateKeys(selectedDate), [selectedDate]);
  const unplannedGroups = useMemo(() => groupUnplannedTasks(allUnplannedTasks, todayDateKey()), [allUnplannedTasks]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/schedule?date=${selectedDate}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("schedule request failed");
        return scheduleSnapshotSchema.parse(await response.json());
      })
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        applySnapshot(snapshot);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setScheduleItems(DEMO_ITEMS);
          setUnplannedTasks([]);
          setScheduleRisk({ riskCount: 0, unplannedCount: 0, overdueCount: 0, totalCount: DEMO_ITEMS.length });
          setScheduleFreeMinutes(null);
          setTimelineRange(DEFAULT_TIMELINE_RANGE);
          setDataSource("demo");
        }
      });
    return () => controller.abort();
  }, [selectedDate]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(currentWeekDates.map(async (dateKey) => {
      const response = await fetch(`/api/schedule?date=${dateKey}`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("week schedule request failed");
      const snapshot = scheduleSnapshotSchema.parse(await response.json());
      return [dateKey, { items: scheduleItemsFromSnapshot(snapshot), range: deriveTimelineRange(snapshot) }] as const;
    }))
      .then((entries) => {
        if (!controller.signal.aborted) {
          setWeekSchedule(Object.fromEntries(entries.map(([dateKey, day]) => [dateKey, day.items])));
          setWeekTimelineRange(entries.reduce((range, [, day]) => ({ startMinutes: Math.min(range.startMinutes, day.range.startMinutes), endMinutes: Math.max(range.endMinutes, day.range.endMinutes) }), DEFAULT_TIMELINE_RANGE));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setWeekSchedule({});
      });
    return () => controller.abort();
  }, [currentWeekDates, weekScheduleRevision]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/tasks/unplanned", { signal: controller.signal, cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("unplanned overview failed"))).then((body: { tasks: ScheduleTask[] }) => { if (!controller.signal.aborted) setAllUnplannedTasks(body.tasks); }).catch(() => undefined);
    return () => controller.abort();
  }, [scheduleRisk.unplannedCount]);

  useEffect(() => {
    const controller = new AbortController();
    const from = currentWeekDates[0];
    const to = currentWeekDates.at(-1)!;
    fetch(`/api/capacity?from=${from}&to=${to}`, { signal: controller.signal, cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("capacity failed"))).then((body: { days: DailyCapacity[] }) => { if (!controller.signal.aborted) setCapacityDays(body.days); }).catch(() => { if (!controller.signal.aborted) setCapacityDays([]); });
    return () => controller.abort();
  }, [currentWeekDates, scheduleRisk.totalCount, scheduleRisk.unplannedCount]);

  useEffect(() => {
    fetch("/api/preferences", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("preferences request failed")))
      .then((body: { preferences: Array<{ key: string; value: unknown }> }) => {
        const buffer = body.preferences.find((item) => item.key === "bufferMinutes")?.value;
        if (typeof buffer === "number" && [0, 15, 30].includes(buffer)) setBufferMinutes(buffer);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void refreshIntegrationStatus();
  }, []);

  useEffect(() => {
    fetch("/api/projects", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("projects request failed")))
      .then((body: { projects: ProjectSummary[] }) => {
        const activeProjects = body.projects.filter((item) => !item.archived);
        const totalCount = activeProjects.reduce((total, item) => total + item.count, 0);
        setProjects([{ name: "全部安排", count: totalCount, tone: "#5d63e9", progress: activeProjects.length ? Math.round(activeProjects.reduce((total, item) => total + (item.progress ?? 0), 0) / activeProjects.length) : 0, health: "healthy", healthReason: "显示所有项目" }, ...activeProjects]);
      })
      .catch(() => notify("项目列表暂时不可用，当前显示本地默认项目"));
  }, []);

  useEffect(() => {
    fetch("/api/change-sets", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("changes request failed"))).then((body: { changes: ChangeSummary[] }) => setChanges(body.changes)).catch(() => undefined);
  }, []);

  useEffect(() => {
    void refreshReminders();
  }, []);

  const visibleItems = useMemo(
    () => {
      const query = searchQuery.trim().toLowerCase();
      const selectedProject = projects.find((item) => item.name === project);
      return scheduleItems.filter((item) => {
        const matchesProject = project === "全部安排" || item.project === project || item.project === selectedProject?.id;
        const matchesSearch = !query || `${item.title} ${item.project}`.toLowerCase().includes(query);
        return matchesProject && matchesSearch;
      });
    },
    [project, projects, scheduleItems, searchQuery],
  );
  const visibleWeekSchedule = useMemo(() => {
    if (!weekSchedule) return null;
    const query = searchQuery.trim().toLowerCase();
    const selectedProject = projects.find((item) => item.name === project);
    return Object.fromEntries(Object.entries(weekSchedule).map(([dateKey, items]) => [dateKey, items.filter((item) => {
      const matchesProject = project === "全部安排" || item.project === project || item.project === selectedProject?.id;
      const matchesSearch = !query || `${item.title} ${item.project}`.toLowerCase().includes(query);
      return matchesProject && matchesSearch;
    })]));
  }, [project, projects, searchQuery, weekSchedule]);
  const scheduleStats = useMemo(() => {
    const blockedCount = scheduleItems.filter((item) => item.status === "blocked").length;
    return { freeMinutes: scheduleFreeMinutes, blockedCount, riskCount: scheduleRisk.riskCount, unplannedCount: scheduleRisk.unplannedCount, overdueCount: scheduleRisk.overdueCount };
  }, [scheduleFreeMinutes, scheduleItems, scheduleRisk]);
  const closeableCount = useMemo(() => scheduleItems.filter((item) => item.status !== "done" && item.kind !== "fixed").length + unplannedTasks.filter((item) => item.kind !== "fixed").length, [scheduleItems, unplannedTasks]);
  const confirmationCopy = confirmationDetails(confirmation);

  function notify(message: string) {
    setNotice(message);
  }

  function refreshWeekSchedule(clear = false) {
    if (clear) setWeekSchedule(null);
    setWeekScheduleRevision((revision) => revision + 1);
  }

  function resolvePreviewMoves(moves: ProposalMove[] = [], snapshotValue?: unknown): PreviewMove[] {
    const parsed = scheduleSnapshotSchema.safeParse(snapshotValue);
    const sourceItems = parsed.success ? scheduleItemsFromSnapshot(parsed.data) : scheduleItems;
    return moves.map((move) => ({ ...move, title: sourceItems.find((item) => item.id === move.blockId)?.title ?? "弹性任务" }));
  }

  function openSurface(surface: Exclude<ActiveSurface, null>, trigger?: Element | null) {
    surfaceTriggerRef.current = trigger instanceof HTMLElement ? trigger : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setTopLayer(null);
    setActiveSurface(surface);
  }

  function requestConfirmation(next: Confirmation, trigger?: Element | null) {
    confirmationTriggerRef.current = trigger instanceof HTMLElement ? trigger : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setConfirmation(next);
  }

  function applySnapshot(snapshot: ReturnType<typeof scheduleSnapshotSchema.parse>) {
    setScheduleItems(scheduleItemsFromSnapshot(snapshot));
    setUnplannedTasks(unplannedTasksFromSnapshot(snapshot));
    setTimelineRange(deriveTimelineRange(snapshot));
    setScheduleRisk(snapshotRisk(snapshot));
    setScheduleFreeMinutes(snapshotFreeMinutes(snapshot));
    setDataSource("api");
  }

  async function refreshReminders() {
    const response = await fetch("/api/reminders", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const body = reminderListResponseSchema.safeParse(await response.json().catch(() => null));
    if (body.success) setReminders(body.data.reminders);
  }

  async function retryReminder(id: string) {
    const response = await fetch(`/api/reminders/${id}/retry`, { method: "POST" });
    if (!response.ok) {
      notify("提醒暂时不能重试");
      return;
    }
    await refreshReminders();
    notify("提醒已重新排队");
  }

  function exportChangeHistory() {
    window.open("/api/change-sets/export?format=csv", "_blank", "noopener,noreferrer");
  }

  async function saveBuffer(minutes: number) {
    setBufferMinutes(minutes);
    const response = await fetch("/api/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "bufferMinutes", value: minutes }) });
    notify(response.ok ? `默认缓冲已保存为 ${minutes} 分钟` : "缓冲偏好保存失败");
  }

  async function enablePwa() {
    const result = await enablePwaNotifications();
    notify(result.message);
    if (result.ok) await refreshIntegrationStatus();
  }

  async function refreshIntegrationStatus() {
    const response = await fetch("/api/status", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    setIntegrationStatus(await response.json() as IntegrationStatus);
  }

  async function testPwa() {
    const response = await fetch("/api/pwa/test", { method: "POST" });
    const body = await response.json().catch(() => null) as { reminderId?: string; error?: { message?: string } } | null;
    if (!response.ok || !body?.reminderId) {
      notify(body?.error?.message ?? "PWA 测试提醒创建失败");
      return;
    }
    notify("测试提醒已排队，等待设备回执…");
    for (let attempt = 0; attempt < 45; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const reminderResponse = await fetch("/api/reminders", { cache: "no-store" }).catch(() => null);
      if (!reminderResponse?.ok) continue;
      const parsed = reminderListResponseSchema.safeParse(await reminderResponse.json().catch(() => null));
      if (!parsed.success) continue;
      setReminders(parsed.data.reminders);
      const reminder = parsed.data.reminders.find((item) => item.id === body.reminderId);
      if (reminder?.receivedAt) {
        notify("PWA 测试成功：设备服务工作线程已回执");
        await refreshIntegrationStatus();
        return;
      }
      if (reminder?.status === "failed") {
        notify(`PWA 测试失败：${reminder.error ?? "推送服务未接受"}`);
        return;
      }
    }
    notify("PWA 测试尚未收到设备回执，请检查 worker 和系统通知");
  }

  async function testQq() {
    const response = await fetch("/api/qq/test", { method: "POST" });
    const body = await response.json().catch(() => null) as { reminderId?: string; error?: { message?: string } } | null;
    if (!response.ok || !body?.reminderId) {
      notify(body?.error?.message ?? "QQ 测试提醒创建失败");
      return;
    }
    notify("QQ 测试提醒已排队…");
    for (let attempt = 0; attempt < 45; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const reminderResponse = await fetch("/api/reminders", { cache: "no-store" }).catch(() => null);
      if (!reminderResponse?.ok) continue;
      const parsed = reminderListResponseSchema.safeParse(await reminderResponse.json().catch(() => null));
      if (!parsed.success) continue;
      setReminders(parsed.data.reminders);
      const reminder = parsed.data.reminders.find((item) => item.id === body.reminderId);
      if (reminder?.status === "sent") {
        notify("QQ API 已接受测试提醒，请确认 QQ 客户端收到消息");
        await refreshIntegrationStatus();
        return;
      }
      if (reminder?.status === "failed") {
        notify(`QQ 测试失败：${reminder.error ?? "QQ API 未接受"}`);
        return;
      }
    }
    notify("QQ 测试仍在等待发送，请检查 QQ worker 状态");
  }

  function moveDate(days: number) {
    const nextDate = dateFromKey(selectedDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + days);
    selectDate(dateKeyFromDate(nextDate), `正在加载 ${formatDateKey(dateKeyFromDate(nextDate))} 的日程`);
  }

  function selectDate(dateKey: string, message = `已切换到 ${formatDayHeading(dateKey)}`) {
    refreshWeekSchedule(true);
    setSelectedDate(dateKey);
    setScheduleFreeMinutes(null);
    setDataSource("loading");
    notify(message);
  }

  function selectWeekDay(dateKey: string) {
    if (dateKey === selectedDate) {
      notify(`已选中 ${formatDayHeading(dateKey)}`);
      return;
    }
    setSelectedDate(dateKey);
    setScheduleFreeMinutes(null);
    setDataSource("loading");
    notify(`已选中 ${formatDayHeading(dateKey)}`);
  }

  function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { project?: { id: string; name: string; tone: string; count: number }; error?: { message?: string } } | null;
        if (!response.ok || !body?.project) throw new Error(body?.error?.message ?? "项目创建失败");
        setProjects((current) => [...current, { ...body.project!, count: 0, progress: 0, health: "empty" as const, healthReason: "还没有任务" }]);
        setProject(body.project.name);
        setNewProjectName("");
        setShowNewProject(false);
        notify(`已创建项目「${body.project.name}」`);
      })
      .catch((error) => notify(error instanceof Error ? error.message : "项目创建失败"));
  }

  function archiveProject(item: ProjectSummary) {
    requestConfirmation({ kind: "archive-project", project: item });
  }

  async function applyArchiveProject(item: ProjectSummary) {
    if (!item.id) return;
    const response = await fetch(`/api/projects/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: true }) });
    if (!response.ok) {
      notify("项目归档失败");
      return;
    }
    setProjects((current) => current.filter((project) => project.id !== item.id));
    if (project === item.name) setProject("全部安排");
    notify(`项目「${item.name}」已归档`);
  }

  function selectTask(item: ScheduleItem, trigger?: HTMLElement | null) {
    if (item.date !== selectedDate) setSelectedDate(item.date);
    setSelectedTask(item);
    openSurface("task-detail", trigger);
    setTaskTitle(item.title);
    setTaskPriority(item.priority);
    setTaskReminderPolicy(item.reminderPolicy);
    setTaskNote(item.notes ?? "");
    setRescheduleTime(formatMinutesOfDay(item.startMinutes));
    setRecurrences([]);
    void loadRecurrences(item.taskId);
    notify(`已选中「${item.title}」· ${KIND_LABELS[item.kind]}任务`);
  }

  async function updateTask(item: ScheduleItem, changes: { title?: string; status?: ScheduleTask["status"]; priority?: ScheduleTask["priority"]; reminderPolicy?: ScheduleTask["reminderPolicy"]; notes?: string }) {
    const response = await fetch(`/api/tasks/${item.taskId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
    const body = await response.json().catch(() => null) as { snapshot?: unknown; error?: { message?: string } } | null;
    if (!response.ok || !body?.snapshot) {
      notify(body?.error?.message ?? "任务更新失败");
      return;
    }
    const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
    setSelectedDate(snapshot.date);
    refreshWeekSchedule();
    applySnapshot(snapshot);
    if (selectedTask?.taskId === item.taskId) {
      const refreshed = scheduleItemsFromSnapshot(snapshot).find((candidate) => candidate.taskId === item.taskId);
      setSelectedTask(refreshed ?? null);
      if (refreshed) {
        setTaskTitle(refreshed.title);
        setTaskPriority(refreshed.priority);
        setTaskReminderPolicy(refreshed.reminderPolicy);
        setTaskNote(refreshed.notes ?? "");
      }
    }
    notify(changes.status === "doing" ? "任务已开始" : changes.status === "done" ? "任务已完成" : "任务已更新");
  }

  async function loadRecurrences(taskId: string) {
    const response = await fetch(`/api/recurrence?taskId=${encodeURIComponent(taskId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json().catch(() => null) as { rules?: RecurrenceSummary[] } | null;
    setRecurrences(body?.rules ?? []);
  }

  async function createRecurrence() {
    if (!selectedTask) return;
    const response = await fetch("/api/recurrence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: selectedTask.taskId, frequency: recurrenceForm.frequency, startDate: selectedTask.date, endDate: recurrenceForm.endDate || undefined }) });
    const body = await response.json().catch(() => null) as { id?: string; error?: { message?: string } } | null;
    if (!response.ok || !body?.id) {
      notify(body?.error?.message ?? "重复规则创建失败");
      return;
    }
    await loadRecurrences(selectedTask.taskId);
    notify("重复规则已保存，未来实例会自动排入日程");
  }

  async function deleteRecurrence(id: string) {
    const response = await fetch(`/api/recurrence/${id}`, { method: "DELETE" });
    if (!response.ok) {
      notify("重复规则删除失败");
      return;
    }
    if (selectedTask) await loadRecurrences(selectedTask.taskId);
    notify("重复规则及其未来实例已删除");
  }

  async function overrideSelectedOccurrence(action: "skip" | "move" | "override") {
    if (!selectedTask || recurrences.length === 0) return;
    const response = await fetch(`/api/recurrence/${recurrences[0].id}/overrides`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ occurrenceDate: selectedTask.date, action, startMinutes: action === "skip" ? undefined : timeToMinutes(overrideForm.start), durationMinutes: action === "skip" ? undefined : Number(overrideForm.duration) }) });
    if (!response.ok) {
      notify("单次重复例外保存失败");
      return;
    }
    setDataSource("loading");
    const snapshotResponse = await fetch(`/api/schedule?date=${selectedTask.date}`, { cache: "no-store" });
    if (snapshotResponse.ok) {
      const snapshot = scheduleSnapshotSchema.parse(await snapshotResponse.json());
      applySnapshot(snapshot);
      refreshWeekSchedule();
    }
    setSelectedTask(null);
    notify(action === "skip" ? "已跳过这一次重复任务" : "这一次重复任务已单独调整");
  }

  async function updateSelectedTask(changes: { title?: string; status?: ScheduleTask["status"]; priority?: ScheduleTask["priority"]; reminderPolicy?: ScheduleTask["reminderPolicy"]; notes?: string }) {
    if (!selectedTask) return;
    await updateTask(selectedTask, changes);
  }

  async function confirmPendingReschedule() {
    if (!pendingReschedule) return;
    const response = await fetch(`/api/tasks/${pendingReschedule.taskId}/reschedule`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: pendingReschedule.date, startMinutes: pendingReschedule.startMinutes, confirm: true, optimize: true }) });
    const body = await response.json().catch(() => null) as { snapshot?: unknown; error?: { message?: string } } | null;
    if (!response.ok || !body?.snapshot) {
      notify(body?.error?.message ?? "确认改期失败，原日程没有改变");
      return;
    }
    const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
    applySnapshot(snapshot);
    setSelectedDate(pendingReschedule.date);
    refreshWeekSchedule();
    setPendingReschedule(null);
    notify("已确认改期，受影响任务已重新安排");
  }

  function deleteSelectedTask() {
    if (selectedTask) requestConfirmation({ kind: "delete-task", task: selectedTask });
  }

  async function applyDeleteSelectedTask() {
    if (!selectedTask) return;
    const response = await fetch(`/api/tasks/${selectedTask.taskId}`, { method: "DELETE" });
    const body = await response.json().catch(() => null) as { snapshot?: unknown; error?: { message?: string } } | null;
    if (!response.ok || !body?.snapshot) {
      notify(body?.error?.message ?? "任务删除失败");
      return;
    }
    const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
    applySnapshot(snapshot);
    refreshWeekSchedule();
    setSelectedTask(null);
    setActiveSurface(null);
    void refreshReminders();
    notify("任务已删除");
  }

  function beginUnplannedPlacement(task: UnplannedTask) {
    setPlacementTaskId(task.id);
    const startMinutes = task.preferredStartMinutes ?? timelineRange.startMinutes;
    setPlacementTime(`${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`);
  }

  async function scheduleUnplannedTask(taskId: string, mode: "rules" | "optimize", startMinutes?: number, confirm = false, targetDate = selectedDate) {
    const response = await fetch(`/api/tasks/${taskId}/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: targetDate, mode, startMinutes, confirm }),
    });
    const body = await response.json().catch(() => null) as { snapshot?: unknown; changeSetId?: string; proposal?: { placement?: { startMinutes?: number }; moves?: ProposalMove[]; reasons?: string[] }; error?: { message?: string } } | null;
    if (response.status === 409 && mode === "optimize") {
      setPendingPlacement({ taskId, date: targetDate, placementStartMinutes: body?.proposal?.placement?.startMinutes, moves: resolvePreviewMoves(body?.proposal?.moves, body?.snapshot) });
      setActiveSurface(null);
      notify("AI 已生成重排方案，确认前原日程不会改变");
      return;
    }
    if (!response.ok || !body?.snapshot) {
      const reason = body?.proposal?.reasons?.join(" ") ?? body?.error?.message ?? "该时间与现有安排冲突，任务仍在待安排中";
      const task = unplannedTasks.find((item) => item.id === taskId);
      if (startMinutes !== undefined && task) { setConflictMarker({ date: targetDate, startMinutes, durationMinutes: task.estimatedMinutes, reason }); setTimelineRange((current) => expandTimelineRange(current, startMinutes, task.estimatedMinutes)); setWeekTimelineRange((current) => expandTimelineRange(current, startMinutes, task.estimatedMinutes)); }
      notify(reason);
      return;
    }
    const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
    setSelectedDate(snapshot.date);
    applySnapshot(snapshot);
    refreshWeekSchedule();
    setLastChangeSetId(body.changeSetId ?? null);
    setPlacementTaskId(null);
    setPendingPlacement(null);
    setConflictMarker(null);
    if (activeSurface === "unplanned" && unplannedTasks.length <= 1) setActiveSurface(null);
    void refreshReminders();
    const placedAt = body.proposal?.placement?.startMinutes;
    notify(mode === "optimize" ? "AI 优化方案已应用" : `任务已布置到 ${placedAt === undefined ? "指定时间" : `${String(Math.floor(placedAt / 60)).padStart(2, "0")}:${String(placedAt % 60).padStart(2, "0")}`}`);
  }

  async function confirmPendingPlacement() {
    if (!pendingPlacement) return;
    await scheduleUnplannedTask(pendingPlacement.taskId, "optimize", undefined, true, pendingPlacement.date);
  }

  async function rescheduleScheduledTask(taskId: string, startMinutes: number, targetDate = selectedDate) {
    const item = scheduleItems.find((candidate) => candidate.taskId === taskId) ?? Object.values(weekSchedule ?? {}).flat().find((candidate) => candidate.taskId === taskId);
    if (!item) return;
    const response = await fetch(`/api/tasks/${taskId}/reschedule`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: targetDate, startMinutes }) });
    const body = await response.json().catch(() => null) as { snapshot?: unknown; changeSetId?: string; proposal?: { reasons?: string[] }; error?: { message?: string } } | null;
    if (!response.ok || !body?.snapshot) {
      const reason = body?.proposal?.reasons?.join(" ") ?? body?.error?.message ?? "该时间与现有安排冲突，原时间保持不变";
      setConflictMarker({ date: targetDate, startMinutes, durationMinutes: item.durationMinutes, reason });
      setTimelineRange((current) => expandTimelineRange(current, startMinutes, item.durationMinutes));
      setWeekTimelineRange((current) => expandTimelineRange(current, startMinutes, item.durationMinutes));
      notify(reason);
      return;
    }
    const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
    setSelectedDate(snapshot.date);
    applySnapshot(snapshot);
    const refreshed = scheduleItemsFromSnapshot(snapshot).find((candidate) => candidate.taskId === taskId) ?? null;
    setSelectedTask(refreshed);
    if (refreshed) setRescheduleTime(formatMinutesOfDay(refreshed.startMinutes));
    setLastChangeSetId(body.changeSetId ?? null);
    setConflictMarker(null);
    refreshWeekSchedule();
    notify(`任务已改到 ${formatMinutesOfDay(startMinutes)}`);
  }

  async function arrangeAllUnplanned() {
    setBatchBusy(true);
    try {
      const response = await fetch("/api/schedule/arrange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: selectedDate }) });
      const body = await response.json().catch(() => null) as { arrangedTaskIds?: string[]; remainingTaskIds?: string[]; snapshot?: unknown; changeSetId?: string; error?: { message?: string } } | null;
      if (!response.ok || !body?.snapshot) {
        notify(body?.error?.message ?? "批量排程失败，原日程没有改变");
        return;
      }
      applySnapshot(scheduleSnapshotSchema.parse(body.snapshot));
      setLastChangeSetId(body.changeSetId ?? null);
      setConflictMarker(null);
      refreshWeekSchedule();
      if ((body.remainingTaskIds?.length ?? 0) === 0) setActiveSurface(null);
      notify(body.arrangedTaskIds?.length ? `已按规则安排 ${body.arrangedTaskIds.length} 项，${body.remainingTaskIds?.length ?? 0} 项继续待安排` : "当前没有能安全排入的待安排任务");
    } finally {
      setBatchBusy(false);
    }
  }

  async function applyCloseCurrentDay(action: "unplan" | "move_tomorrow") {
    setBatchBusy(true);
    try {
      const response = await fetch("/api/schedule/daily-close", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: selectedDate, action }) });
      const body = await response.json().catch(() => null) as { affectedTaskIds?: string[]; targetDate?: string; snapshot?: unknown; changeSetId?: string; error?: { message?: string } } | null;
      if (!response.ok || !body?.snapshot || !body.targetDate) {
        notify(body?.error?.message ?? "今日收尾失败，原日程没有改变");
        return;
      }
      const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
      setSelectedDate(body.targetDate);
      applySnapshot(snapshot);
      setLastChangeSetId(body.changeSetId ?? null);
      setConflictMarker(null);
      refreshWeekSchedule();
      notify(action === "move_tomorrow" ? `已将 ${body.affectedTaskIds?.length ?? 0} 项移到明天待安排` : `已将 ${body.affectedTaskIds?.length ?? 0} 项移回今日待安排`);
    } finally {
      setBatchBusy(false);
    }
  }

  async function confirmRequestedAction(current: Confirmation) {
    setConfirmation(null);
    if (current.kind === "archive-project") {
      await applyArchiveProject(current.project);
      return;
    }
    if (current.kind === "delete-task") {
      await applyDeleteSelectedTask();
      return;
    }
    await applyCloseCurrentDay(current.action);
  }

  async function capturePrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = prompt.trim();
    if (!value) return;
    setAiBusy(true);
    setAiReply("");
    setCapturedPrompts((current) => [value, ...current].slice(0, 3));
    setPrompt("");
    const optimize = aiOptimize;
    setAiOptimize(false);
    try {
      const response = await fetch("/api/ai/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: value, date: selectedDate, optimize }) });
      const body = await response.json().catch(() => null) as { kind?: string; reply?: string; task?: ScheduleTask; taskId?: string; reschedule?: { taskId: string; date: string; startMinutes: number }; snapshot?: unknown; changeSetId?: string; proposal?: { moves?: ProposalMove[] }; error?: { message?: string } } | null;
      if (!response.ok && response.status !== 409) {
        const message = body?.error?.message ?? "自然语言解析暂时不可用，原日程没有改变";
        setAiReply(message);
        notify(message);
        return;
      }
      setAiReply(body?.reply ?? "已生成排程方案");
      if (response.status === 409 && body?.reschedule) {
        setPendingReschedule({ taskId: body.reschedule.taskId, date: body.reschedule.date, startMinutes: body.reschedule.startMinutes, moves: resolvePreviewMoves(body.proposal?.moves, body.snapshot), reply: body.reply ?? "AI 建议调整现有日程" });
        notify("AI 建议改期，需要确认后才会移动其他任务");
      } else if (response.status === 409 && body?.task) {
        if (body.task.date !== selectedDate) { setSelectedDate(body.task.date); refreshWeekSchedule(); }
        setPendingTask(body.task);
        setAddMode("manual");
        setActiveSurface("add-task");
        setTaskFormError(`规则检测到需要移动 ${body.proposal?.moves?.length ?? 1} 个弹性任务，请确认后执行。`);
        notify("已生成需要确认的调整方案");
      } else if (body?.snapshot) {
        if (body.task?.date && body.task.date !== selectedDate) { setSelectedDate(body.task.date); refreshWeekSchedule(); }
        const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
        applySnapshot(snapshot);
        refreshWeekSchedule();
        setLastChangeSetId(body.changeSetId ?? null);
        void refreshReminders();
        notify(body?.kind === "updated" ? "任务状态已更新" : body?.kind === "rescheduled" ? optimize ? "AI 优化已完成改期" : "任务已按规则完成改期" : body?.kind === "unplanned" ? "没有安全空档，任务已保存到待安排" : optimize ? "AI 已将任务放入优化后的时段" : "任务已按规则放入空闲时段");
      }
    } catch {
      setAiReply("自然语言解析暂时不可用，原日程没有改变");
      notify("自然语言解析暂时不可用，原日程没有改变");
    } finally {
      setAiBusy(false);
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const duration = Number(taskForm.duration);
    if (!taskForm.title.trim() || !Number.isInteger(duration) || duration <= 0 || duration % 15 !== 0) {
      setTaskFormError("请填写标题，并使用 15 分钟的整数倍时长。");
      return;
    }
    setTaskFormError("");
    const task: ScheduleTask = {
      id: `task-${crypto.randomUUID()}`,
      title: taskForm.title.trim(),
      date: selectedDate,
      kind: taskForm.kind,
      priority: taskForm.priority,
      status: "todo",
      reminderPolicy: "auto",
      estimatedMinutes: duration,
      movable: taskForm.kind !== "fixed",
      preferredStartMinutes: taskForm.kind === "fixed" ? timeToMinutes(taskForm.start) : undefined,
      deadlineMinutes: taskForm.kind === "fixed" ? undefined : timeToMinutes(taskForm.deadline),
      projectId: project === "全部安排" ? undefined : projects.find((item) => item.name === project)?.id ?? project,
    };
    const response = await fetch("/api/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task }) });
    const body = await response.json().catch(() => null) as { proposal?: { decision?: string; moves?: Array<{ fromStartMinutes: number; toStartMinutes: number }> }; snapshot?: unknown; changeSetId?: string; error?: { message?: string } } | null;
    if (response.status === 409) {
      setPendingTask(task);
      setTaskFormError(`需要确认：当前空档不足，规则方案会移动 ${body?.proposal?.moves?.length ?? 1} 个弹性任务。`);
      notify("临时任务需要确认后才能改变现有日程");
      return;
    }
    if (!response.ok || !body?.snapshot) {
      setTaskFormError(body?.error?.message ?? "任务暂时无法排入日程。");
      return;
    }
    const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
    applySnapshot(snapshot);
    refreshWeekSchedule();
    setLastChangeSetId(body.changeSetId ?? null);
    setActiveSurface(null);
    void refreshReminders();
    notify(body?.proposal?.decision === "no_slot" ? "没有安全空档，任务已保存到待安排" : "任务已按规则加入日程");
  }

  async function confirmTask() {
    if (!pendingTask) return;
    const response = await fetch("/api/schedule/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: pendingTask }) });
    const body = await response.json().catch(() => null) as { snapshot?: unknown; changeSetId?: string; error?: { message?: string } } | null;
    if (!response.ok || !body?.snapshot) {
      setTaskFormError(body?.error?.message ?? "确认失败，原日程没有改变。");
      return;
    }
    const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
    applySnapshot(snapshot);
    refreshWeekSchedule();
    setLastChangeSetId(body.changeSetId ?? null);
    setPendingTask(null);
    setActiveSurface(null);
    setTaskFormError("");
    void refreshReminders();
    notify("已确认调整，弹性任务已移动");
  }

  async function undoLastChange() {
    if (!lastChangeSetId) return;
    const response = await fetch("/api/schedule/undo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeSetId: lastChangeSetId }) });
    const body = await response.json().catch(() => null) as { snapshot?: unknown; error?: { message?: string } } | null;
    if (!response.ok || !body?.snapshot) {
      notify(body?.error?.message ?? "撤销失败");
      return;
    }
    const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
    setSelectedDate(snapshot.date);
    refreshWeekSchedule();
    applySnapshot(snapshot);
    setLastChangeSetId(null);
    void refreshReminders();
    notify("已撤销最近一次日程调整");
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarCollapsed ? "sidebar--collapsed" : ""}`}>
        <div className="sidebar-brand-row"><div className="brand-lockup"><div className="brand-mark">G</div><div><strong>goalset</strong><span>个人日程调度</span></div></div><Button className="sidebar-collapse" variant="ghost" size="icon" type="button" aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} aria-pressed={sidebarCollapsed} onClick={() => saveSidebarCollapsed(!sidebarCollapsed)}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</Button></div>
        <ProjectNavigation projects={projects} selectedProject={project} showNewProject={showNewProject} newProjectName={newProjectName} onToggleNewProject={() => setShowNewProject((current) => !current)} onNewProjectNameChange={setNewProjectName} onCreateProject={createProject} onSelectProject={(name) => { setProject(name); setViewOverride("day"); notify(`已筛选项目「${name}」`); }} onArchiveProject={(item) => void archiveProject(item)} />
        <div className="sidebar-bottom">
          <Button className="settings-link" variant="ghost" size="sm" type="button" aria-label="设置与偏好" onClick={(event) => openSurface("settings", event.currentTarget)}><Settings2 size={15} /><span>设置与偏好</span></Button>
          <Button className="profile-chip" variant="ghost" type="button" aria-label="打开工作区设置" onClick={(event) => openSurface("settings", event.currentTarget)}><span>Y</span><div><strong>Yuanzhi</strong><small>个人工作区</small></div><b>•••</b></Button>
        </div>
      </aside>

      <section className="workspace" id="dashboard">
        <header className="topbar">
          <div className="mobile-brand"><Button className="mobile-menu-button" variant="ghost" size="icon" type="button" aria-label="打开导航" onClick={(event) => openSurface("mobile-nav", event.currentTarget)}><Menu size={20} /></Button><div className="brand-mark">G</div><strong>goalset</strong></div>
          <div className="topbar-actions">
            {searchQuery && topLayer !== "search" && <Button className="active-search-chip" variant="soft" size="sm" type="button" aria-label={`清除搜索：${searchQuery}`} onClick={() => setSearchQuery("")}>搜索：{searchQuery}<X size={13} /></Button>}
            <Popover open={topLayer === "search"} onOpenChange={(open) => { setTopLayer(open ? "search" : null); if (!open) setSearchQuery(""); }}><PopoverTrigger asChild><Button className="icon-button" variant="ghost" size="icon" type="button" aria-label="搜索" aria-expanded={topLayer === "search"}><Search size={17} /></Button></PopoverTrigger><PopoverContent className="search-popover"><label htmlFor="global-search">搜索任务或项目</label><div><Input id="global-search" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); if (event.target.value.trim()) setViewOverride("day"); }} placeholder="输入标题或项目…" autoFocus />{searchQuery && <Button variant="ghost" size="icon" type="button" aria-label="清除搜索" onClick={() => setSearchQuery("")}><X size={14} /></Button>}</div></PopoverContent></Popover>
            <Popover open={topLayer === "notifications"} onOpenChange={(open) => setTopLayer(open ? "notifications" : null)}><PopoverTrigger asChild><Button className="icon-button notification-button" variant="ghost" size="icon" type="button" aria-label="通知" aria-expanded={topLayer === "notifications"}><Bell size={16} />{reminders.some((reminder) => reminder.status === "pending" || reminder.status === "failed") && <i />}</Button></PopoverTrigger><PopoverContent className="notification-popover"><strong>通知</strong>{reminders.length === 0 ? <><p>暂无重要提醒记录</p><small>高优先级任务、固定安排、重要调整和真实风险会在配置渠道后出现在这里。</small></> : <div className="notification-list">{reminders.slice(0, 6).map((reminder) => <div className="notification-row" key={reminder.id}><div><strong>{reminderKindLabels[reminder.kind]} · {reminderChannelLabels[reminder.channel]}</strong><span>{reminderDeliveryStatus(reminder)}{reminder.importanceReasons?.length ? ` · ${reminder.importanceReasons.map((reason) => reminderImportanceLabels[reason]).join("、")}` : ""}</span></div>{reminder.status === "failed" && <Button variant="ghost" size="sm" type="button" onClick={() => void retryReminder(reminder.id)}>重试</Button>}</div>)}</div>}</PopoverContent></Popover>
            <Button className="icon-button notification-button" variant="ghost" size="icon" type="button" aria-label="活动记录" aria-haspopup="dialog" onClick={(event) => openSurface("activity", event.currentTarget)}><History size={16} />{changes.length > 0 && <i />}</Button>
            <DropdownMenu open={topLayer === "profile"} onOpenChange={(open) => setTopLayer(open ? "profile" : null)}><DropdownMenuTrigger asChild><Button className="avatar-button" variant="ghost" size="icon" type="button" aria-label="个人菜单" aria-expanded={topLayer === "profile"}>Y</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuLabel>Yuanzhi · 个人工作区</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => openSurface("settings", document.querySelector('button[aria-label="个人菜单"]'))}><Settings2 size={15} />账号设置</DropdownMenuItem>{integrationStatus.authDisabled ? <DropdownMenuItem disabled>当前无需密码</DropdownMenuItem> : <DropdownMenuItem onSelect={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }}>退出登录</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
          </div>
        </header>

        {pendingReschedule && <ScheduleChangePreview summary={pendingReschedule.reply} placementStartMinutes={pendingReschedule.startMinutes} moves={pendingReschedule.moves} confirmLabel="确认改期" onConfirm={() => void confirmPendingReschedule()} onCancel={() => setPendingReschedule(null)} />}
        {pendingPlacement && <ScheduleChangePreview summary={`AI 优化 ${formatDateKey(pendingPlacement.date)} 的待安排任务`} placementStartMinutes={pendingPlacement.placementStartMinutes} moves={pendingPlacement.moves} confirmLabel="确认优化" onConfirm={() => void confirmPendingPlacement()} onCancel={() => setPendingPlacement(null)} />}

        <Sheet open={activeSurface === "settings"} onOpenChange={(open) => { if (!open) setActiveSurface(null); }}><SheetContent title="设置与偏好" description="管理可用时间、缓冲、提醒和集成状态。" returnFocusRef={surfaceTriggerRef}><QuickSettings bufferMinutes={bufferMinutes} onBufferChange={saveBuffer} onQqTest={testQq} onPwaEnable={enablePwa} onPwaTest={testPwa} onNotify={notify} onClose={() => setActiveSurface(null)} showHeader={false} workers={integrationStatus.workers} qqConfigured={integrationStatus.qqConfigured} pwaConfigured={integrationStatus.pwaConfigured} pwaSubscriptionCount={integrationStatus.pwaSubscriptionCount ?? 0} reminderChannels={integrationStatus.reminderChannels} /></SheetContent></Sheet>
        <Sheet open={activeSurface === "mobile-nav"} onOpenChange={(open) => { if (!open) setActiveSurface(null); }}><SheetContent title="导航与项目" description="切换项目、创建项目或打开工作区设置。" returnFocusRef={surfaceTriggerRef}><div className="mobile-navigation"><ProjectNavigation sectionId="mobile-projects" projects={projects} selectedProject={project} showNewProject={showNewProject} newProjectName={newProjectName} onToggleNewProject={() => setShowNewProject((current) => !current)} onNewProjectNameChange={setNewProjectName} onCreateProject={createProject} onSelectProject={(name) => { setProject(name); setViewOverride("day"); setActiveSurface(null); notify(`已筛选项目「${name}」`); }} onArchiveProject={(item) => void archiveProject(item)} /><div className="mobile-navigation__actions"><Button variant="outline" type="button" onClick={() => openSurface("settings", document.querySelector(".mobile-menu-button"))}><Settings2 size={16} />设置与偏好</Button><Button variant="ghost" type="button" onClick={() => openSurface("settings", document.querySelector(".mobile-menu-button"))}><span className="mobile-navigation__avatar">Y</span>Yuanzhi · 个人工作区</Button></div></div></SheetContent></Sheet>
        <ConfirmDialog open={Boolean(confirmation)} title={confirmationCopy.title} description={confirmationCopy.description} confirmLabel={confirmationCopy.confirmLabel} danger={confirmationCopy.danger} onConfirm={() => { if (confirmation) void confirmRequestedAction(confirmation); }} onOpenChange={(open) => { if (!open) setConfirmation(null); }} returnFocusRef={confirmationTriggerRef} />
        <Sheet open={activeSurface === "unplanned"} onOpenChange={(open) => { if (!open) { setActiveSurface(null); setPlacementTaskId(null); } }}><SheetContent title={`待安排 ${unplannedTasks.length} 项`} description="选择明确时间、按规则批量安排，或显式请求 AI 优化。" returnFocusRef={surfaceTriggerRef}><section className="unplanned-tray unplanned-tray--sheet" aria-labelledby="unplanned-sheet-title"><div className="unplanned-section__heading"><div><strong id="unplanned-sheet-title">优先处理高优先级和临近截止任务</strong><small>精确选时、批量安排和 AI 优化都在此处；桌面拖放请使用 Dashboard 上的紧凑任务条。</small></div><div className="unplanned-section__actions"><Button variant="soft" size="sm" type="button" disabled={batchBusy} onClick={() => void arrangeAllUnplanned()}>{batchBusy ? "安排中…" : "按规则安排全部"}</Button></div></div><div className="unplanned-list">{unplannedTasks.map((task) => <article className="unplanned-row" key={task.id}><div className="unplanned-row__body"><strong>{task.title}</strong><small>{KIND_LABELS[task.kind]} · {formatDuration(task.estimatedMinutes)} · {priorityLabels[task.priority]}{task.deadlineMinutes === undefined ? "" : ` · ${formatMinutesOfDay(task.deadlineMinutes)} 前`}</small>{placementTaskId === task.id && <div className="unplanned-placement"><Clock3 size={14} /><label className="sr-only" htmlFor={`placement-${task.id}`}>开始时间</label><input id={`placement-${task.id}`} className="native-input" type="time" step={900} value={placementTime} onChange={(event) => setPlacementTime(event.target.value)} /><Button variant="soft" size="sm" type="button" onClick={() => void scheduleUnplannedTask(task.id, "rules", timeToMinutes(placementTime))}>确认布置</Button><Button variant="ghost" size="sm" type="button" onClick={() => setPlacementTaskId(null)}>取消</Button></div>}</div><div className="unplanned-row__actions"><Button variant="outline" size="sm" type="button" onClick={() => beginUnplannedPlacement(task)}>选择时间</Button><Button variant="soft" size="sm" type="button" onClick={() => void scheduleUnplannedTask(task.id, "optimize")}><Sparkles size={12} /> AI 优化</Button></div></article>)}</div></section></SheetContent></Sheet>
        <Sheet open={activeSurface === "activity"} onOpenChange={(open) => { if (!open) setActiveSurface(null); }}><SheetContent title="活动与风险" description="查看容量、跨日期待安排和最近日程变更。" returnFocusRef={surfaceTriggerRef}><div className="activity-sheet"><CapacitySummary days={capacityDays} /><UnplannedOverview groups={unplannedGroups} onSelectDate={(date) => { setSelectedDate(date); setActiveSurface(null); }} />{scheduleStats.riskCount > 0 && <section className="attention-card"><div className="panel-heading"><div><span className="panel-icon panel-icon--warm"><CalendarDays size={14} /></span><strong>所选日期需要处理</strong></div><Badge className="risk-badge">{scheduleStats.riskCount} 项</Badge></div><div className="attention-list">{scheduleStats.unplannedCount > 0 && <span><strong>{scheduleStats.unplannedCount}</strong> 项未排期</span>}{scheduleStats.overdueCount > 0 && <span><strong>{scheduleStats.overdueCount}</strong> 项已逾期</span>}{scheduleStats.blockedCount > 0 && <span><strong>{scheduleStats.blockedCount}</strong> 项已阻塞</span>}</div>{unplannedTasks.length > 0 && <Button variant="soft" size="sm" type="button" onClick={() => openSurface("unplanned", document.querySelector('button[aria-label="活动记录"]'))}>处理待安排</Button>}</section>}<section className="change-card"><div className="change-card__title"><span>最近变更</span><span className="change-card__time">{changes.length} 条</span></div>{changes.length ? <div className="change-history-list">{changes.map((change) => <div className="change-history-row" key={change.id}><span>{change.originalCommand ?? "未命名变更"}</span><small>{change.source} · {change.status}</small></div>)}</div> : <p className="activity-empty">暂无变更记录</p>}{changes.length > 0 && <Button variant="outline" size="sm" type="button" onClick={exportChangeHistory}>导出 CSV</Button>}</section></div></SheetContent></Sheet>

        <div className={`content-grid ${view === "week" ? "content-grid--planning" : "content-grid--single"}`}>
          <div className="main-column">
            <section className="hero-row">
              <div className="hero-copy">
                <span className="section-kicker"><i className="live-dot" />{view === "week" ? "本周规划" : selectedDate === todayDateKey() ? "今天执行" : "日期执行"}</span>
                <div className="hero-title-row"><h2>{view === "week" ? formatWeekHeading(selectedDate) : formatDayHeading(selectedDate)}</h2>{projects.length > 1 && <label className="project-filter">项目<select className="native-select" value={project} onChange={(event) => setProject(event.target.value)}>{projects.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>}</div>
              </div>
              <div className="hero-actions">
                <Button variant="soft" size="sm" type="button" aria-haspopup="dialog" onClick={(event) => { setAddMode("manual"); openSurface("add-task", event.currentTarget); setPendingTask(null); setTaskFormError(""); }}><Plus size={14} /> 添加任务</Button>
                <div className="view-switcher" role="group" aria-label="切换日程视图">
                  <Button className={view === "day" ? "view-switcher__active" : ""} variant="ghost" size="sm" onClick={() => setViewOverride("day")} type="button">日</Button>
                  <Button className={view === "week" ? "view-switcher__active" : ""} variant="ghost" size="sm" onClick={() => setViewOverride("week")} type="button">周</Button>
                </div>
              </div>
            </section>

            <Sheet open={activeSurface === "add-task"} onOpenChange={(open) => { if (!open) { setActiveSurface(null); setAiOptimize(false); setPendingTask(null); setTaskFormError(""); } }}><SheetContent title="添加任务" description={addMode === "manual" ? "填写标题和时长，程序会放入安全空档。" : "用一句话描述任务，时间仍由规则排程校验。"} returnFocusRef={surfaceTriggerRef}><div className="add-mode-switch" role="tablist" aria-label="添加方式"><Button variant={addMode === "manual" ? "soft" : "ghost"} size="sm" type="button" role="tab" aria-selected={addMode === "manual"} onClick={() => setAddMode("manual")}>快速填写</Button><Button variant={addMode === "natural" ? "soft" : "ghost"} size="sm" type="button" role="tab" aria-selected={addMode === "natural"} onClick={() => setAddMode("natural")}><Sparkles size={13} />一句话输入</Button></div>{addMode === "natural" ? <section className="quick-capture-card quick-capture-card--sheet" aria-label="一句话添加与调整">
              <div className="quick-capture-card__status"><Button variant={aiOptimize ? "soft" : "outline"} size="sm" type="button" aria-pressed={aiOptimize} onClick={() => setAiOptimize((current) => !current)}><Sparkles size={12} /> AI 优化日程</Button></div>
              {aiReply && <p className="quick-capture-card__reply">{aiReply}</p>}
              <form className="ai-input-wrap" onSubmit={capturePrompt}>
                <label className="sr-only" htmlFor="ai-input">用一句话添加或调整任务</label>
                <Input id="ai-input" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={aiOptimize ? "说明希望 AI 优化或重排的任务…" : "例如：明天下午前安排两小时准备方案"} autoFocus />
                <Button size="icon" type="submit" aria-label="提交自然语言指令" disabled={aiBusy}>{aiBusy ? "…" : <ArrowUp size={15} />}</Button>
              </form>
              {capturedPrompts.length > 0 && <div className="captured-prompts"><span>最近提交</span>{capturedPrompts.map((item) => <p key={item}>“{item}”</p>)}</div>}
              <div className="ai-panel__footer"><span>{aiOptimize ? "AI 优化授权仅对下一条指令有效" : "普通指令不会授权重排"}</span><span>QQ 需以“优化日程”或“AI 重排”开头</span></div>
            </section> : <section className="task-form-card task-form-card--sheet" aria-label="新建任务"><form className="task-form" onSubmit={createTask}>
                <div className="task-form__quick-row"><Input aria-label="任务标题" placeholder="例如：准备产品方案" value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} autoFocus /><label><span>预计时长</span><select className="native-select" value={taskForm.duration} onChange={(event) => setTaskForm((current) => ({ ...current, duration: event.target.value }))}><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="45">45 分钟</option><option value="60">1 小时</option><option value="90">1.5 小时</option><option value="120">2 小时</option></select></label></div>
                <details className="task-form__advanced"><summary>更多选项</summary><div className="task-form__grid"><label>安排类型<select className="native-select" value={taskForm.kind} onChange={(event) => setTaskForm((current) => ({ ...current, kind: event.target.value as ScheduleTask["kind"] }))}><option value="flexible">弹性任务</option><option value="fixed">固定安排</option><option value="floating">浮动任务</option></select></label><label>优先级<select className="native-select" value={taskForm.priority} onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value as ScheduleTask["priority"] }))}><option value="normal">普通</option><option value="high">重要</option><option value="low">低</option></select></label>{taskForm.kind === "fixed" ? <label>开始时间<input className="native-input" type="time" value={taskForm.start} onChange={(event) => setTaskForm((current) => ({ ...current, start: event.target.value }))} /></label> : <label>截止时间<input className="native-input" type="time" value={taskForm.deadline} onChange={(event) => setTaskForm((current) => ({ ...current, deadline: event.target.value }))} /></label>}</div></details>
                {taskFormError && <p className="task-form__error" role="alert">{taskFormError}</p>}<div className="task-form__actions"><span>{pendingTask ? "原日程尚未改变" : `目标日期：${formatDateKey(selectedDate)}`}</span>{pendingTask && <Button variant="soft" size="sm" type="button" onClick={confirmTask}>确认移动并排入</Button>}<Button variant="default" size="sm" type="submit">{pendingTask ? "重新计算" : "自动排入空档"}</Button></div>
              </form></section>}</SheetContent></Sheet>

            <Sheet open={activeSurface === "task-detail" && Boolean(selectedTask)} onOpenChange={(open) => { if (!open) { setActiveSurface(null); setSelectedTask(null); } }}>{selectedTask && <SheetContent title="任务详情" description={`${formatDayHeading(selectedTask.date)} · ${formatMinutesOfDay(selectedTask.startMinutes)}`} returnFocusRef={surfaceTriggerRef}><section className="task-detail-card task-detail-card--sheet" aria-label="任务详情">
              <div className="panel-heading"><div><span className={`task-detail-dot ${selectedTask.tone}`} /><Input className="task-detail-title" aria-label="任务标题" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></div></div>
              <div className="task-detail-meta"><span>{KIND_LABELS[selectedTask.kind]}任务</span><span>{selectedTask.project}</span><span>{formatDuration(selectedTask.durationMinutes)}</span><label className="task-detail-priority">优先级<select className="native-select" value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as ScheduleTask["priority"])}><option value="low">低</option><option value="normal">普通</option><option value="high">重要</option></select></label></div>
              <div className="task-detail-reschedule"><Clock3 size={14} /><label htmlFor="task-reschedule-time">开始时间</label><input id="task-reschedule-time" className="native-input" type="time" step={900} value={rescheduleTime} onChange={(event) => setRescheduleTime(event.target.value)} /><Button variant="soft" size="sm" type="button" onClick={() => void rescheduleScheduledTask(selectedTask.taskId, timeToMinutes(rescheduleTime), selectedTask.date)}>改到此时间</Button><small>{selectedTask.kind === "fixed" ? "固定安排只能在详情中明确改时间，不能直接拖动。" : "也可以在电脑端直接拖动时间块。"}</small></div>
              <div className="task-detail-status"><span>状态</span>{(["todo", "doing", "blocked", "done"] as const).map((status) => <Button key={status} variant={selectedTask.status === status ? "soft" : "outline"} size="sm" type="button" onClick={() => updateSelectedTask({ status })}>{STATUS_LABELS[status]}</Button>)}</div>
              <details className="task-detail-advanced"><summary>备注、提醒、重复与更多设置</summary><div className="task-reminder-policy"><label htmlFor="task-reminder-policy">主动提醒<select id="task-reminder-policy" className="native-select" value={taskReminderPolicy} onChange={(event) => setTaskReminderPolicy(event.target.value as ScheduleTask["reminderPolicy"])}>{Object.entries(reminderPolicyLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><small>{hasReadyReminderChannel(integrationStatus) ? taskReminderPolicy === "auto" ? "重要任务、固定安排和实际风险会按规则提醒。" : taskReminderPolicy === "always" ? "该任务的开始和相关日程调整都会提醒。" : "该任务自身的开始和调整不会主动提醒。" : "当前选中的提醒通道尚未配置；策略会保存，接入后自动生效。"}</small></div><label className="task-detail-note">进展备注<textarea value={taskNote} onChange={(event) => setTaskNote(event.target.value)} placeholder="记录这次任务的进展…" /></label>
              <div className="task-detail-recurrence">
                <div className="task-detail-recurrence__heading"><strong>重复安排</strong><span>{recurrences.length ? "单次例外不会修改整条规则" : "让基础任务按周期生成实例"}</span></div>
                {recurrences.map((recurrence) => <div className="recurrence-row" key={recurrence.id}><span>{recurrenceFrequencyLabels[recurrence.frequency]} · {recurrence.startDate}{recurrence.endDate ? ` 至 ${recurrence.endDate}` : " 起"}</span><Button variant="ghost" size="icon" type="button" aria-label="删除重复规则" onClick={() => void deleteRecurrence(recurrence.id)}><X size={13} /></Button></div>)}
                <div className="recurrence-form"><select className="native-select" value={recurrenceForm.frequency} onChange={(event) => setRecurrenceForm((current) => ({ ...current, frequency: event.target.value as RecurrenceSummary["frequency"] }))}><option value="daily">每天</option><option value="workday">工作日</option><option value="weekly">每周</option></select><input className="native-input" type="date" value={recurrenceForm.endDate} onChange={(event) => setRecurrenceForm((current) => ({ ...current, endDate: event.target.value }))} /><Button variant="soft" size="sm" type="button" onClick={() => void createRecurrence()}><Plus size={13} /> 保存规则</Button></div>
                {recurrences.length > 0 && <div className="recurrence-override"><span>当前实例：{selectedTask.date}</span><input className="native-input" type="time" value={overrideForm.start} onChange={(event) => setOverrideForm((current) => ({ ...current, start: event.target.value }))} /><select className="native-select" value={overrideForm.duration} onChange={(event) => setOverrideForm((current) => ({ ...current, duration: event.target.value }))}><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="45">45 分钟</option><option value="60">1 小时</option></select><Button variant="outline" size="sm" type="button" onClick={() => void overrideSelectedOccurrence("move")}>改时间</Button><Button variant="outline" size="sm" type="button" onClick={() => void overrideSelectedOccurrence("override")}>覆盖这次</Button><Button variant="outline" size="sm" type="button" onClick={() => void overrideSelectedOccurrence("skip")}>跳过这次</Button></div>}
              </div><div className="task-detail-actions"><Button variant="outline" size="sm" type="button" onClick={() => updateSelectedTask({ title: taskTitle.trim(), priority: taskPriority, reminderPolicy: taskReminderPolicy, notes: taskNote })}>保存任务信息</Button><Button className="danger-button" variant="outline" size="sm" type="button" onClick={deleteSelectedTask}>删除任务</Button></div></details>
            </section></SheetContent>}</Sheet>

            {unplannedTasks.length > 0 && <section className="unplanned-entry" aria-label={`${unplannedTasks.length} 项待安排`}><div className="unplanned-entry__summary"><strong>待安排 {unplannedTasks.length} 项</strong><small>{unplannedTasks[0]?.title}{unplannedTasks.length > 1 ? ` 等 ${unplannedTasks.length} 项` : ""}</small></div><div className="unplanned-entry__drag-list" aria-label="可拖动的待安排任务">{unplannedTasks.slice(0, 3).map((task) => <button className="unplanned-drag-chip" draggable key={task.id} type="button" aria-label={`拖动待安排任务：${task.title}`} title={`${task.title} · ${formatDuration(task.estimatedMinutes)}`} onDragStart={(event) => { event.dataTransfer.setData("application/x-goalset-task", task.id); event.dataTransfer.setData("application/x-goalset-duration", String(task.estimatedMinutes)); event.dataTransfer.effectAllowed = "move"; }} onClick={(event) => openSurface("unplanned", event.currentTarget)}><GripVertical size={13} aria-hidden="true" /><span>{task.title}</span><small>{formatDuration(task.estimatedMinutes)}</small></button>)}</div><Button variant="soft" size="sm" type="button" onClick={(event) => openSurface("unplanned", event.currentTarget)}>处理</Button></section>}

            <section className="calendar-card">
              <div className="calendar-card__header">
                <div><strong>{view === "week" ? formatWeekHeading(selectedDate) : formatDayHeading(selectedDate)}</strong><span>{dataSource === "loading" ? "正在同步日程" : view === "week" ? `${Object.values(visibleWeekSchedule ?? {}).flat().length} 个安排 · 拖动可跨日改期` : `${visibleItems.length} 个安排 · ${scheduleStats.freeMinutes === null ? "可用空档计算中" : `${formatHours(scheduleStats.freeMinutes)} 可用空档`}`}</span></div>
                <div className="calendar-actions"><Button variant="ghost" size="icon" type="button" aria-label={view === "week" ? "上一周" : "前一天"} onClick={() => moveDate(view === "week" ? -7 : -1)}><ChevronLeft size={15} /></Button><Button variant="ghost" size="icon" type="button" aria-label={view === "week" ? "下一周" : "后一天"} onClick={() => moveDate(view === "week" ? 7 : 1)}><ChevronRight size={15} /></Button><label className="calendar-date-picker"><CalendarDays size={14} aria-hidden="true" /><span className="sr-only">选择日期</span><input aria-label="选择日期" type="date" value={selectedDate} onChange={(event) => selectDate(event.target.value)} /></label><Button className="today-button" variant="outline" size="sm" type="button" onClick={() => selectDate(todayDateKey(), "已回到今天")}>今天</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" type="button" aria-label="更多日程操作"><MoreHorizontal size={16} /></Button></DropdownMenuTrigger><DropdownMenuContent>{selectedDate === todayDateKey() && closeableCount > 0 && <><DropdownMenuLabel>今日收尾</DropdownMenuLabel><DropdownMenuItem disabled={batchBusy} onSelect={() => requestConfirmation({ kind: "daily-close", action: "move_tomorrow", count: closeableCount }, document.querySelector('button[aria-label="更多日程操作"]'))}>移到明天待安排</DropdownMenuItem><DropdownMenuItem disabled={batchBusy} onSelect={() => requestConfirmation({ kind: "daily-close", action: "unplan", count: closeableCount }, document.querySelector('button[aria-label="更多日程操作"]'))}>留在今日待安排</DropdownMenuItem><DropdownMenuSeparator /></>}<DropdownMenuItem onSelect={() => openSurface("activity", document.querySelector('button[aria-label="活动记录"]'))}><History size={14} />活动与风险</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
              </div>
              {view === "week" ? <WeekView selectedDate={selectedDate} range={weekTimelineRange} days={visibleWeekSchedule} conflict={conflictMarker} currentMinutes={currentMinutes} onSelectDay={selectWeekDay} onSelect={selectTask} onDropTask={(taskId, dateKey, startMinutes) => void scheduleUnplannedTask(taskId, "rules", startMinutes, false, dateKey)} onDropScheduledTask={(taskId, dateKey, startMinutes) => void rescheduleScheduledTask(taskId, startMinutes, dateKey)} /> : <DayView dateKey={selectedDate} range={timelineRange} items={visibleItems} conflict={conflictMarker} currentMinutes={currentMinutes} onSelect={selectTask} onDropTask={(taskId, startMinutes) => void scheduleUnplannedTask(taskId, "rules", startMinutes)} onDropScheduledTask={(taskId, startMinutes) => void rescheduleScheduledTask(taskId, startMinutes)} />}
              <div className="calendar-card__footer"><span><i className="legend-dot legend-dot--fixed" /> 固定安排</span><span><i className="legend-dot legend-dot--flexible" /> 弹性任务</span><span><i className="legend-dot legend-dot--floating" /> 浮动任务</span>{dataSource !== "api" && <small>{dataSource === "loading" ? "正在同步数据" : "数据暂时不可用 · 显示演示内容"}</small>}</div>
            </section>
          </div>
          {view === "week" && <aside className="planning-rail" aria-label="本周规划辅助信息">
            <section className="planning-rail__card planning-rail__capacity"><div className="planning-rail__heading"><div><span>计划健康度</span><strong>本周容量与风险</strong></div><Button variant="ghost" size="sm" type="button" onClick={(event) => openSurface("activity", event.currentTarget)}>查看详情</Button></div><CapacitySummary days={capacityDays} /></section>
            <section className="planning-rail__card" aria-label={`跨日期待安排 ${allUnplannedTasks.length} 项`}><div className="planning-rail__heading"><div><span>需要决策</span><strong>待安排 {allUnplannedTasks.length} 项</strong></div>{allUnplannedTasks.length > 0 && <Button variant="soft" size="sm" type="button" onClick={(event) => openSurface("activity", event.currentTarget)}>查看全部</Button>}</div>{allUnplannedTasks.length === 0 ? <p className="planning-rail__empty">本周没有跨日期待安排任务。</p> : <div className="planning-rail__tasks">{allUnplannedTasks.slice(0, 4).map((task) => <Button className="planning-rail__task" variant="ghost" type="button" key={task.id} onClick={() => selectDate(task.date)}><span><strong>{task.title}</strong><small>{formatDateKey(task.date)} · {priorityLabels[task.priority]} · {formatDuration(task.estimatedMinutes)}</small></span><ChevronRight size={14} /></Button>)}</div>}</section>
            {scheduleStats.riskCount > 0 && <section className="attention-card planning-rail__risk"><div className="panel-heading"><div><span className="panel-icon panel-icon--warm"><CalendarDays size={14} /></span><strong>{formatDateKey(selectedDate)} 需处理</strong></div><Badge className="risk-badge">{scheduleStats.riskCount} 项</Badge></div><div className="attention-list">{scheduleStats.unplannedCount > 0 && <span><strong>{scheduleStats.unplannedCount}</strong> 项未排期</span>}{scheduleStats.overdueCount > 0 && <span><strong>{scheduleStats.overdueCount}</strong> 项已逾期</span>}{scheduleStats.blockedCount > 0 && <span><strong>{scheduleStats.blockedCount}</strong> 项已阻塞</span>}</div><Button variant="soft" size="sm" type="button" onClick={(event) => openSurface(unplannedTasks.length ? "unplanned" : "activity", event.currentTarget)}>立即处理</Button></section>}
            <section className="change-card planning-rail__changes"><div className="change-card__title"><span>最近变更</span><span className="change-card__time">{changes.length} 条</span></div>{changes.length ? <div className="change-history-list">{changes.slice(0, 4).map((change) => <div className="change-history-row" key={change.id}><span>{change.originalCommand ?? "未命名变更"}</span><small>{change.status}</small></div>)}</div> : <p className="activity-empty">暂无变更记录</p>}<Button variant="outline" size="sm" type="button" onClick={(event) => openSurface("activity", event.currentTarget)}>活动与风险</Button></section>
          </aside>}
        </div>
        <ToastRegion message={notice} open={Boolean(notice)} onOpenChange={(open) => { if (!open) setNotice(""); }} actionLabel={lastChangeSetId ? "撤销" : undefined} onAction={lastChangeSetId ? () => void undoLastChange() : undefined} />
      </section>
    </main>
  );
}
