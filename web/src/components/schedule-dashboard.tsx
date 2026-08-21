"use client";

import type { CSSProperties, DragEvent, FormEvent } from "react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Archive,
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GripVertical,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEMO_ITEMS,
  KIND_LABELS,
  PROJECTS,
  STATUS_LABELS,
  TIMELINE_HOURS,
  scheduleItemsFromSnapshot,
  unplannedTasksFromSnapshot,
  type ScheduleItem,
  type UnplannedTask,
} from "@/features/schedule/model";
import { scheduleSnapshotSchema } from "@/features/schedule/data/contract";
import type { ScheduleTask } from "@/features/schedule/domain/types";
import { enablePwaNotifications } from "@/components/pwa-register";
import { QuickSettings } from "@/components/quick-settings";

type ViewMode = "day" | "week";
type DataSource = "demo" | "api" | "loading";
type IntegrationStatus = { authDisabled?: boolean; databaseConfigured: boolean; aiConfigured: boolean; aiMode?: string; qqConfigured: boolean; pwaConfigured: boolean; workers?: Array<{ workerName: string; status: string; lastSuccessAt?: string | null; lastError?: string | null }> };
type ProjectSummary = { id?: string; name: string; count: number; tone: string; archived?: boolean; totalMinutes?: number; doneMinutes?: number; blockedCount?: number; overdueCount?: number; unplannedCount?: number; deadlineRiskCount?: number; progress?: number; remainingMinutes?: number; health?: "healthy" | "at_risk" | "blocked" | "empty"; healthReason?: string };
type ChangeSummary = { id: string; source: string; status: string; originalCommand?: string | null; createdAt: string };
type ReminderSummary = { id: string; taskId?: string | null; kind: "start" | "schedule_change" | "daily_summary"; channel: "qq" | "pwa"; scheduledAt: string; status: "pending" | "sending" | "sent" | "failed" | "cancelled"; error?: string | null };
type RecurrenceSummary = { id: string; taskId: string; frequency: "daily" | "weekly" | "workday" | "weekdays"; weekdays?: number[] | null; startDate: string; endDate?: string | null; timezone: string };
type PendingReschedule = { taskId: string; date: string; startMinutes: number; moves: number; reply: string };
type PendingPlacement = { taskId: string; date: string; moves: number };

const reminderKindLabels: Record<ReminderSummary["kind"], string> = { start: "任务开始", schedule_change: "日程调整", daily_summary: "每日摘要" };
const reminderChannelLabels: Record<ReminderSummary["channel"], string> = { qq: "QQ", pwa: "PWA" };
const projectHealthLabels: Record<NonNullable<ProjectSummary["health"]>, string> = { healthy: "正常", at_risk: "需留意", blocked: "已阻塞", empty: "待安排" };
const recurrenceFrequencyLabels: Record<RecurrenceSummary["frequency"], string> = { daily: "每天", weekly: "每周", workday: "工作日", weekdays: "指定星期" };
const priorityLabels: Record<ScheduleTask["priority"], string> = { high: "重要", normal: "普通", low: "低" };

const timelineStart = 8 * 60;
const timelineEnd = 19 * 60;
const timelineMinutes = timelineEnd - timelineStart;
const mobileQuery = "(max-width: 767px)";

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

function weekCardTone(item?: ScheduleItem) {
  if (!item) return "week-card--slate";
  return {
    "schedule-item--blue": "week-card--blue",
    "schedule-item--orange": "week-card--orange",
    "schedule-item--green": "week-card--green",
  }[item.tone] ?? "week-card--purple";
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

function currentTimeTop(dateKey: string) {
  if (dateKey !== todayDateKey()) return null;
  const minutes = currentShanghaiMinutes();
  if (minutes < timelineStart || minutes > timelineEnd) return null;
  return `${((minutes - timelineStart) / timelineMinutes) * 100}%`;
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
  let doneCount = 0;
  const today = todayDateKey();
  for (const task of snapshot.tasks) {
    if (task.status === "done") doneCount += 1;
    const unplanned = !blockTaskIds.has(task.id) && task.status !== "done";
    const overdue = task.status !== "done" && task.date < today;
    if (unplanned) unplannedCount += 1;
    if (overdue) overdueCount += 1;
    if (unplanned || overdue || task.status === "blocked") riskTaskIds.add(task.id);
  }
  return { riskCount: riskTaskIds.size, unplannedCount, overdueCount, totalCount: snapshot.tasks.length, doneCount };
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

function getBlockStyle(item: ScheduleItem): CSSProperties {
  const top = ((item.startMinutes - timelineStart) / timelineMinutes) * 100;
  const height = (item.durationMinutes / timelineMinutes) * 100;

  return {
    top: `${top}%`,
    height: `max(${height}%, 56px)`,
  };
}

function ScheduleBlock({ item, onSelect }: { item: ScheduleItem; onSelect: (item: ScheduleItem) => void }) {
  return (
    <button className={`schedule-item ${item.tone}`} style={getBlockStyle(item)} type="button" onClick={() => onSelect(item)}>
      <div className="schedule-item__heading">
        <span className="schedule-item__kind">{KIND_LABELS[item.kind]}</span>
        <span className="schedule-item__status">{STATUS_LABELS[item.status]}</span>
      </div>
      <strong>{item.title}</strong>
      <span className="schedule-item__meta">{formatDuration(item.durationMinutes)} · {item.project}</span>
    </button>
  );
}

function DayView({ dateKey, items, onSelect, onDropTask }: { dateKey: string; items: ScheduleItem[]; onSelect: (item: ScheduleItem) => void; onDropTask: (taskId: string, startMinutes: number) => void }) {
  const timeTop = currentTimeTop(dateKey);
  const [dropActive, setDropActive] = useState(false);

  function dropTask(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropActive(false);
    const taskId = event.dataTransfer.getData("application/x-goalset-task");
    if (!taskId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const rawMinutes = timelineStart + ratio * timelineMinutes;
    const startMinutes = Math.max(timelineStart, Math.min(timelineEnd - 15, Math.round(rawMinutes / 15) * 15));
    onDropTask(taskId, startMinutes);
  }

  return (
    <div className="timeline-shell" aria-label="今日时间轴">
      <div className="timeline-labels" aria-hidden="true">
        {TIMELINE_HOURS.map((hour) => <span key={hour}>{formatHour(hour)}</span>)}
      </div>
      <div
        className={`timeline-track ${dropActive ? "timeline-track--drop-target" : ""}`}
        onDragEnter={() => setDropActive(true)}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
        onDrop={dropTask}
      >
        <div className="timeline-grid" aria-hidden="true">
          {TIMELINE_HOURS.map((hour) => <span key={hour} />)}
        </div>
        {items.map((item) => <ScheduleBlock key={item.id} item={item} onSelect={onSelect} />)}
        {timeTop && <div className="current-time" style={{ top: timeTop }}><span /><b>现在</b></div>}
      </div>
    </div>
  );
}

function WeekView({ selectedDate, days, onSelectDay }: { selectedDate: string; days: Record<string, ScheduleItem[]> | null; onSelectDay: (dateKey: string) => void }) {
  return (
    <div className="week-view" aria-label="本周安排">
      {weekDateKeys(selectedDate).map((dateKey) => {
        const items = days?.[dateKey] ?? [];
        const firstItem = items[0];
        const scheduledMinutes = items.reduce((total, item) => total + item.durationMinutes, 0);
        return (
        <button
          className={`week-column ${dateKey === selectedDate ? "week-column--active" : ""}`}
          key={dateKey}
          type="button"
          onClick={() => onSelectDay(dateKey)}
        >
          <span className="week-column__day">{weekdayLabel(dateKey)}</span>
          <span className="week-column__date">{dateKey.slice(5).replace("-", "/")}</span>
          <span className={`week-card ${weekCardTone(firstItem)}`}>
            <span className="week-card__metric">{items.length ? `${items.length} 项 · ${formatHours(scheduledMinutes)}` : "空闲"}</span>
            <span className="week-card__preview">{firstItem?.title ?? "没有安排"}</span>
          </span>
        </button>
        );
      })}
    </div>
  );
}

export function ScheduleDashboard() {
  const router = useRouter();
  const isMobile = useSyncExternalStore(subscribeToMobile, getMobileSnapshot, getMobileServerSnapshot);
  const [viewOverride, setViewOverride] = useState<ViewMode | null>(null);
  const [project, setProject] = useState("全部安排");
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>(DEMO_ITEMS);
  const [unplannedTasks, setUnplannedTasks] = useState<UnplannedTask[]>([]);
  const [showAllUnplanned, setShowAllUnplanned] = useState(false);
  const [placementTaskId, setPlacementTaskId] = useState<string | null>(null);
  const [placementTime, setPlacementTime] = useState("09:00");
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const [scheduleRisk, setScheduleRisk] = useState({ riskCount: 0, unplannedCount: 0, overdueCount: 0, totalCount: DEMO_ITEMS.length, doneCount: DEMO_ITEMS.filter((item) => item.status === "done").length });
  const [scheduleFreeMinutes, setScheduleFreeMinutes] = useState<number | null>(null);
  const [weekSchedule, setWeekSchedule] = useState<Record<string, ScheduleItem[]> | null>(null);
  const [dataSource, setDataSource] = useState<DataSource>("loading");
  const [selectedDate, setSelectedDate] = useState(todayDateKey);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const [taskFormError, setTaskFormError] = useState("");
  const [pendingTask, setPendingTask] = useState<ScheduleTask | null>(null);
  const [pendingReschedule, setPendingReschedule] = useState<PendingReschedule | null>(null);
  const [taskForm, setTaskForm] = useState({ title: "", kind: "flexible" as ScheduleTask["kind"], duration: "15", start: "09:00", deadline: "18:00", priority: "normal" as ScheduleTask["priority"] });
  const [projects, setProjects] = useState<ProjectSummary[]>(PROJECTS);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showChangeHistory, setShowChangeHistory] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ScheduleItem | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState<ScheduleTask["priority"]>("normal");
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
        if (!controller.signal.aborted) setDataSource("demo");
      });
    return () => controller.abort();
  }, [selectedDate]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(currentWeekDates.map(async (dateKey) => {
      const response = await fetch(`/api/schedule?date=${dateKey}`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("week schedule request failed");
      const snapshot = scheduleSnapshotSchema.parse(await response.json());
      return [dateKey, scheduleItemsFromSnapshot(snapshot)] as const;
    }))
      .then((entries) => {
        if (!controller.signal.aborted) setWeekSchedule(Object.fromEntries(entries));
      })
      .catch(() => {
        if (!controller.signal.aborted) setWeekSchedule({});
      });
    return () => controller.abort();
  }, [currentWeekDates]);

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
    fetch("/api/status", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("status request failed"))).then((body: IntegrationStatus) => setIntegrationStatus(body)).catch(() => undefined);
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
  const scheduleStats = useMemo(() => {
    const scheduledMinutes = scheduleItems.reduce((total, item) => total + item.durationMinutes, 0);
    const doneCount = scheduleRisk.doneCount;
    const blockedCount = scheduleItems.filter((item) => item.status === "blocked").length;
    return { taskCount: scheduleRisk.totalCount, scheduledMinutes, freeMinutes: scheduleFreeMinutes, doneCount, blockedCount, riskCount: scheduleRisk.riskCount, unplannedCount: scheduleRisk.unplannedCount, overdueCount: scheduleRisk.overdueCount };
  }, [scheduleFreeMinutes, scheduleItems, scheduleRisk]);
  const nextItem = useMemo(() => {
    const candidates = visibleItems.filter((item) => item.status !== "done").sort((left, right) => left.startMinutes - right.startMinutes);
    if (selectedDate !== todayDateKey()) return candidates[0] ?? null;
    const now = currentShanghaiMinutes();
    return candidates.find((item) => item.startMinutes + item.durationMinutes > now) ?? candidates[0] ?? null;
  }, [selectedDate, visibleItems]);
  const hasSideContext = scheduleStats.riskCount > 0 || changes.length > 0;

  function notify(message: string) {
    setNotice(message);
  }

  function applySnapshot(snapshot: ReturnType<typeof scheduleSnapshotSchema.parse>) {
    setScheduleItems(scheduleItemsFromSnapshot(snapshot));
    setUnplannedTasks(unplannedTasksFromSnapshot(snapshot));
    setScheduleRisk(snapshotRisk(snapshot));
    setScheduleFreeMinutes(snapshotFreeMinutes(snapshot));
    setDataSource("api");
  }

  async function refreshReminders() {
    const response = await fetch("/api/reminders", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const body = await response.json().catch(() => null) as { reminders?: ReminderSummary[] } | null;
    if (body?.reminders) setReminders(body.reminders);
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
    notify((await enablePwaNotifications()).message);
  }

  function moveDate(days: number) {
    const nextDate = dateFromKey(selectedDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + days);
    const nextDateKey = dateKeyFromDate(nextDate);
    setWeekSchedule(null);
    setSelectedDate(nextDateKey);
    setScheduleFreeMinutes(null);
    setDataSource("loading");
    notify(`正在加载 ${formatDateKey(nextDateKey)} 的日程`);
  }

  function selectWeekDay(dateKey: string) {
    setWeekSchedule(null);
    setSelectedDate(dateKey);
    setScheduleFreeMinutes(null);
    setDataSource("loading");
    notify(`已切换到 ${formatDayHeading(dateKey)}`);
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

  async function archiveProject(item: ProjectSummary) {
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

  function selectTask(item: ScheduleItem) {
    setSelectedTask(item);
    setTaskTitle(item.title);
    setTaskPriority(item.priority);
    setTaskNote(item.notes ?? "");
    setRecurrences([]);
    void loadRecurrences(item.taskId);
    notify(`已选中「${item.title}」· ${KIND_LABELS[item.kind]}任务`);
  }

  async function updateTask(item: ScheduleItem, changes: { title?: string; status?: ScheduleTask["status"]; priority?: ScheduleTask["priority"]; notes?: string }) {
    const response = await fetch(`/api/tasks/${item.taskId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
    const body = await response.json().catch(() => null) as { snapshot?: unknown; error?: { message?: string } } | null;
    if (!response.ok || !body?.snapshot) {
      notify(body?.error?.message ?? "任务更新失败");
      return;
    }
    const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
    applySnapshot(snapshot);
    if (selectedTask?.taskId === item.taskId) {
      const refreshed = scheduleItemsFromSnapshot(snapshot).find((candidate) => candidate.taskId === item.taskId);
      setSelectedTask(refreshed ?? null);
      if (refreshed) {
        setTaskTitle(refreshed.title);
        setTaskPriority(refreshed.priority);
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
    }
    setSelectedTask(null);
    notify(action === "skip" ? "已跳过这一次重复任务" : "这一次重复任务已单独调整");
  }

  async function updateSelectedTask(changes: { title?: string; status?: ScheduleTask["status"]; priority?: ScheduleTask["priority"]; notes?: string }) {
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
    setPendingReschedule(null);
    notify("已确认改期，受影响任务已重新安排");
  }

  async function deleteSelectedTask() {
    if (!selectedTask) return;
    if (!window.confirm(`确定删除「${selectedTask.title}」吗？此操作不能直接撤销。`)) return;
    const response = await fetch(`/api/tasks/${selectedTask.taskId}`, { method: "DELETE" });
    const body = await response.json().catch(() => null) as { snapshot?: unknown; error?: { message?: string } } | null;
    if (!response.ok || !body?.snapshot) {
      notify(body?.error?.message ?? "任务删除失败");
      return;
    }
    const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
    applySnapshot(snapshot);
    setSelectedTask(null);
    void refreshReminders();
    notify("任务已删除");
  }

  function beginUnplannedPlacement(task: UnplannedTask) {
    setPlacementTaskId(task.id);
    const startMinutes = task.preferredStartMinutes ?? timelineStart;
    setPlacementTime(`${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`);
  }

  async function scheduleUnplannedTask(taskId: string, mode: "rules" | "optimize", startMinutes?: number, confirm = false, targetDate = selectedDate) {
    const response = await fetch(`/api/tasks/${taskId}/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: targetDate, mode, startMinutes, confirm }),
    });
    const body = await response.json().catch(() => null) as { snapshot?: unknown; changeSetId?: string; proposal?: { placement?: { startMinutes?: number }; moves?: unknown[]; reasons?: string[] }; error?: { message?: string } } | null;
    if (response.status === 409 && mode === "optimize") {
      setPendingPlacement({ taskId, date: targetDate, moves: body?.proposal?.moves?.length ?? 0 });
      notify("AI 已生成重排方案，确认前原日程不会改变");
      return;
    }
    if (!response.ok || !body?.snapshot) {
      notify(body?.proposal?.reasons?.join(" ") ?? body?.error?.message ?? "该时间与现有安排冲突，任务仍在待安排中");
      return;
    }
    const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
    applySnapshot(snapshot);
    setLastChangeSetId(body.changeSetId ?? null);
    setPlacementTaskId(null);
    setPendingPlacement(null);
    void refreshReminders();
    const placedAt = body.proposal?.placement?.startMinutes;
    notify(mode === "optimize" ? "AI 优化方案已应用" : `任务已布置到 ${placedAt === undefined ? "指定时间" : `${String(Math.floor(placedAt / 60)).padStart(2, "0")}:${String(placedAt % 60).padStart(2, "0")}`}`);
  }

  async function confirmPendingPlacement() {
    if (!pendingPlacement) return;
    await scheduleUnplannedTask(pendingPlacement.taskId, "optimize", undefined, true, pendingPlacement.date);
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
      const body = await response.json().catch(() => null) as { kind?: string; reply?: string; task?: ScheduleTask; taskId?: string; reschedule?: { taskId: string; date: string; startMinutes: number }; snapshot?: unknown; changeSetId?: string; proposal?: { moves?: unknown[] }; error?: { message?: string } } | null;
      if (!response.ok && response.status !== 409) {
        const message = body?.error?.message ?? "自然语言解析暂时不可用，原日程没有改变";
        setAiReply(message);
        notify(message);
        return;
      }
      setAiReply(body?.reply ?? "已生成排程方案");
      if (response.status === 409 && body?.reschedule) {
        setPendingReschedule({ taskId: body.reschedule.taskId, date: body.reschedule.date, startMinutes: body.reschedule.startMinutes, moves: body.proposal?.moves?.length ?? 0, reply: body.reply ?? "AI 建议调整现有日程" });
        notify("AI 建议改期，需要确认后才会移动其他任务");
      } else if (response.status === 409 && body?.task) {
        if (body.task.date !== selectedDate) { setSelectedDate(body.task.date); setWeekSchedule(null); }
        setPendingTask(body.task);
        setShowTaskForm(true);
        setTaskFormError(`规则检测到需要移动 ${body.proposal?.moves?.length ?? 1} 个弹性任务，请确认后执行。`);
        notify("已生成需要确认的调整方案");
      } else if (body?.snapshot) {
        if (body.task?.date && body.task.date !== selectedDate) { setSelectedDate(body.task.date); setWeekSchedule(null); }
        const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
        applySnapshot(snapshot);
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
    setLastChangeSetId(body.changeSetId ?? null);
    setShowTaskForm(false);
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
    setLastChangeSetId(body.changeSetId ?? null);
    setPendingTask(null);
    setShowTaskForm(false);
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
    applySnapshot(snapshot);
    setLastChangeSetId(null);
    void refreshReminders();
    notify("已撤销最近一次日程调整");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">G</div>
          <div>
            <strong>goalset</strong>
            <span>个人日程调度</span>
          </div>
        </div>

        <div className="side-section side-section--primary" id="projects">
          <div className="side-section__title"><span>我的项目</span><Button variant="ghost" size="icon" type="button" aria-label="新建项目" onClick={() => setShowNewProject((current) => !current)}><Plus size={15} /></Button></div>
          {showNewProject && <form className="new-project-form" onSubmit={createProject}><Input aria-label="新项目名称" value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="项目名称" autoFocus /><Button size="icon" type="submit" aria-label="创建项目"><Plus size={14} /></Button></form>}
          <div className="project-list">
            {projects.map((item) => (
              <div className="project-list__row" key={item.name}>
                <Button
                  className={`project-list__item ${project === item.name ? "project-list__item--active" : ""}`}
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => { setProject(item.name); setViewOverride("day"); notify(`已筛选项目「${item.name}」`); }}
                >
                  <i style={{ background: item.tone }} />
                  <span className="project-list__label"><strong>{item.name}</strong><small>{item.count} 项 · {item.progress ?? 0}%</small></span>
                  <em className={`project-health project-health--${item.health ?? "empty"}`} title={item.healthReason}>{projectHealthLabels[item.health ?? "empty"]}</em>
                </Button>
                {item.id && <Button className="project-list__archive" variant="ghost" size="icon" type="button" aria-label={`归档 ${item.name}`} onClick={() => void archiveProject(item)}><Archive size={12} /></Button>}
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-bottom">
          <Button className="settings-link" variant="ghost" size="sm" type="button" onClick={() => setShowSettings((current) => !current)}><Settings2 size={15} /> 设置与偏好</Button>
          <div className="profile-chip"><span>Y</span><div><strong>Yuanzhi</strong><small>个人工作区</small></div><b>•••</b></div>
        </div>
      </aside>

      <section className="workspace" id="dashboard">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark">G</div><strong>goalset</strong></div>
          <div className="date-context">
            <span className="eyebrow">{formatDayHeading(selectedDate)}</span>
          <h1>{selectedDate === todayDateKey() ? "今天，专注于重要的事。" : `${formatDateKey(selectedDate)}，安排清晰地推进。`}</h1>
          </div>
          <div className="topbar-actions">
            {searchOpen && <Input className="top-search" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); if (event.target.value.trim()) setViewOverride("day"); }} placeholder="搜索任务或项目" autoFocus />}
            <Button className="icon-button" variant="ghost" size="icon" type="button" aria-label="搜索" onClick={() => setSearchOpen((current) => !current)}><Search size={17} /></Button>
            <div className="topbar-popover-wrap">
              <Button className="icon-button notification-button" variant="ghost" size="icon" type="button" aria-label="通知" onClick={() => setShowNotifications((current) => !current)}><Bell size={16} />{reminders.some((reminder) => reminder.status === "pending" || reminder.status === "failed") && <i />}</Button>
            {showNotifications && <div className="topbar-popover notification-popover"><strong>通知</strong>{reminders.length === 0 ? <><p>暂无提醒记录</p><small>任务开始、日程调整和每日摘要会在配置渠道后出现在这里。</small></> : <div className="notification-list">{reminders.slice(0, 6).map((reminder) => <div className="notification-row" key={reminder.id}><div><strong>{reminderKindLabels[reminder.kind]} · {reminderChannelLabels[reminder.channel]}</strong><span>{reminder.status === "pending" ? "等待发送" : reminder.status === "sending" ? "发送中" : reminder.status === "sent" ? "已发送" : reminder.status === "failed" ? `发送失败：${reminder.error ?? "未知原因"}` : "已取消"}</span></div>{reminder.status === "failed" && <Button variant="ghost" size="sm" type="button" onClick={() => void retryReminder(reminder.id)}>重试</Button>}</div>)}</div>}</div>}
            </div>
            <div className="topbar-popover-wrap">
              <Button className="avatar-button" variant="ghost" size="icon" type="button" aria-label="个人菜单" onClick={() => setShowProfile((current) => !current)}>Y</Button>
              {showProfile && <div className="topbar-popover profile-popover"><strong>Yuanzhi</strong><span>个人工作区</span><button type="button" onClick={() => { setShowProfile(false); setShowSettings(true); notify("已打开工作区设置"); }}>账号设置</button>{integrationStatus.authDisabled ? <span>当前无需密码</span> : <button type="button" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }}>退出登录</button>}</div>}
            </div>
          </div>
        </header>

        {notice && <div className="action-notice" role="status" aria-live="polite"><Sparkles size={14} /><span>{notice}</span>{lastChangeSetId && <Button variant="soft" size="sm" type="button" onClick={undoLastChange}>撤销</Button>}<Button variant="ghost" size="icon" type="button" aria-label="关闭提示" onClick={() => setNotice("")}><X size={14} /></Button></div>}
        {pendingReschedule && <div className="action-notice action-notice--warning" role="alert"><RotateCcw size={14} /><span>{pendingReschedule.reply} 将移动 {pendingReschedule.moves} 个弹性任务，原日程尚未改变。</span><Button variant="soft" size="sm" type="button" onClick={() => void confirmPendingReschedule()}>确认改期</Button><Button variant="ghost" size="icon" type="button" aria-label="取消改期" onClick={() => setPendingReschedule(null)}><X size={14} /></Button></div>}
        {pendingPlacement && <div className="action-notice action-notice--warning" role="alert"><Sparkles size={14} /><span>AI 优化建议移动 {pendingPlacement.moves} 个弹性任务，并将待安排任务放入 {formatDateKey(pendingPlacement.date)}。原日程尚未改变。</span><Button variant="soft" size="sm" type="button" onClick={() => void confirmPendingPlacement()}>确认优化</Button><Button variant="ghost" size="icon" type="button" aria-label="取消 AI 优化" onClick={() => setPendingPlacement(null)}><X size={14} /></Button></div>}
        {pendingPlacement && <div className="action-notice action-notice--warning" role="alert"><RotateCcw size={14} /><span>AI 优化需要移动 {pendingPlacement.moves} 个弹性任务，原日程尚未改变。</span><Button variant="soft" size="sm" type="button" onClick={() => void confirmPendingPlacement()}>确认优化</Button><Button variant="ghost" size="icon" type="button" aria-label="取消 AI 优化" onClick={() => setPendingPlacement(null)}><X size={14} /></Button></div>}

        {showSettings && <QuickSettings bufferMinutes={bufferMinutes} onBufferChange={saveBuffer} onPwaEnable={enablePwa} onNotify={notify} onClose={() => setShowSettings(false)} workers={integrationStatus.workers} qqConfigured={integrationStatus.qqConfigured} />}

        <div className={`content-grid ${hasSideContext ? "" : "content-grid--single"}`}>
          <div className="main-column">
            <section className="hero-row">
              <div>
                <div className="section-kicker"><span className="live-dot" /> 规则排程已启用</div>
                <h2>{view === "week" ? "本周与今天" : "今日安排"}</h2>
                <p className="section-copy">普通任务只会放入安全空档；找不到空位时保留到待安排，不会移动已有任务。</p>
                <label className="mobile-project-filter">项目<select className="native-select" value={project} onChange={(event) => setProject(event.target.value)}>{projects.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
              </div>
              <div className="hero-actions">
                <Button variant="outline" size="sm" type="button" onClick={() => setShowQuickCapture((current) => !current)}><Sparkles size={14} /> 一句话添加</Button>
                <Button variant="soft" size="sm" type="button" onClick={() => { setShowTaskForm((current) => !current); setPendingTask(null); setTaskFormError(""); }}><Plus size={14} /> 新建任务</Button>
                <div className="view-switcher" role="group" aria-label="切换日程视图">
                  <Button className={view === "day" ? "view-switcher__active" : ""} variant="ghost" size="sm" onClick={() => setViewOverride("day")} type="button">日</Button>
                  <Button className={view === "week" ? "view-switcher__active" : ""} variant="ghost" size="sm" onClick={() => setViewOverride("week")} type="button">周</Button>
                </div>
              </div>
            </section>

            {showQuickCapture && <section className="quick-capture-card" aria-label="一句话添加与调整">
              <div className="panel-heading"><div><span className="panel-icon"><Sparkles size={14} /></span><div><strong>一句话添加与调整</strong><small>{aiOptimize ? "本次指令已明确授权 AI 生成重排方案，执行前仍会确认。" : "自然语言只识别任务，具体时间由规则排程，不会移动已有安排。"}</small></div></div><div className="quick-capture-card__status"><Button variant={aiOptimize ? "soft" : "outline"} size="sm" type="button" aria-pressed={aiOptimize} onClick={() => setAiOptimize((current) => !current)}><Sparkles size={12} /> AI 优化日程</Button><Button variant="ghost" size="icon" type="button" aria-label="关闭一句话添加" onClick={() => setShowQuickCapture(false)}><X size={14} /></Button></div></div>
              {aiReply && <p className="quick-capture-card__reply">{aiReply}</p>}
              <form className="ai-input-wrap" onSubmit={capturePrompt}>
                <label className="sr-only" htmlFor="ai-input">用一句话添加或调整任务</label>
                <Input id="ai-input" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={aiOptimize ? "说明希望 AI 优化或重排的任务…" : "例如：明天下午前安排两小时准备方案"} autoFocus />
                <Button size="icon" type="submit" aria-label="提交自然语言指令" disabled={aiBusy}>{aiBusy ? "…" : <ArrowUp size={15} />}</Button>
              </form>
              {capturedPrompts.length > 0 && <div className="captured-prompts"><span>最近提交</span>{capturedPrompts.map((item) => <p key={item}>“{item}”</p>)}</div>}
              <div className="ai-panel__footer"><span>{aiOptimize ? "AI 优化授权仅对下一条指令有效" : "普通指令不会授权重排"}</span><span>QQ 需以“优化日程”或“AI 重排”开头</span></div>
            </section>}

            <section className={`next-up-card ${nextItem ? "" : "next-up-card--empty"}`} aria-label="下一项任务">
              <div><span>{selectedDate === todayDateKey() ? "现在 / 下一项" : `${formatDateKey(selectedDate)} · 第一项`}</span>{nextItem ? <><strong>{formatMinutesOfDay(nextItem.startMinutes)} · {nextItem.title}</strong><small>{KIND_LABELS[nextItem.kind]}任务 · {formatDuration(nextItem.durationMinutes)} · {nextItem.project}</small></> : <><strong>当前没有已排期任务</strong><small>{unplannedTasks.length ? `还有 ${unplannedTasks.length} 项待安排，请先选择时间。` : "可以留作空档，或添加一个新任务。"}</small></>}</div>
              {nextItem && <div className="next-up-card__actions">{nextItem.status !== "doing" && <Button variant="soft" size="sm" type="button" onClick={() => void updateTask(nextItem, { status: "doing" })}>开始</Button>}<Button variant="default" size="sm" type="button" onClick={() => void updateTask(nextItem, { status: "done" })}>完成</Button><Button variant="ghost" size="sm" type="button" onClick={() => selectTask(nextItem)}>详情</Button></div>}
            </section>

            {showTaskForm && <section className="task-form-card" aria-label="新建任务">
              <div className="panel-heading"><div><span className="panel-icon"><Plus size={14} /></span><div><strong>新建任务</strong><small>默认作为弹性任务，由程序放入现有安全空档。</small></div></div><Button variant="ghost" size="icon" type="button" aria-label="关闭新建任务" onClick={() => setShowTaskForm(false)}><X size={14} /></Button></div>
              <form className="task-form" onSubmit={createTask}>
                <div className="task-form__quick-row">
                  <Input aria-label="任务标题" placeholder="例如：准备产品方案" value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} autoFocus />
                  <label><span>预计时长</span><select className="native-select" value={taskForm.duration} onChange={(event) => setTaskForm((current) => ({ ...current, duration: event.target.value }))}><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="45">45 分钟</option><option value="60">1 小时</option><option value="90">1.5 小时</option><option value="120">2 小时</option></select></label>
                </div>
                <details className="task-form__advanced"><summary>更多选项</summary><div className="task-form__grid">
                  <label>安排类型<select className="native-select" value={taskForm.kind} onChange={(event) => setTaskForm((current) => ({ ...current, kind: event.target.value as ScheduleTask["kind"] }))}><option value="flexible">弹性任务</option><option value="fixed">固定安排</option><option value="floating">浮动任务</option></select></label>
                  <label>优先级<select className="native-select" value={taskForm.priority} onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value as ScheduleTask["priority"] }))}><option value="normal">普通</option><option value="high">重要</option><option value="low">低</option></select></label>
                  {taskForm.kind === "fixed" ? <label>开始时间<input className="native-input" type="time" value={taskForm.start} onChange={(event) => setTaskForm((current) => ({ ...current, start: event.target.value }))} /></label> : <label>截止时间<input className="native-input" type="time" value={taskForm.deadline} onChange={(event) => setTaskForm((current) => ({ ...current, deadline: event.target.value }))} /></label>}
                </div></details>
                {taskFormError && <p className="task-form__error" role="alert">{taskFormError}</p>}
                <div className="task-form__actions"><span>{pendingTask ? "原日程尚未改变" : `目标日期：${formatDateKey(selectedDate)}`}</span>{pendingTask && <Button variant="soft" size="sm" type="button" onClick={confirmTask}>确认移动并排入</Button>}<Button variant="default" size="sm" type="submit">{pendingTask ? "重新计算" : "自动排入空档"}</Button></div>
              </form>
            </section>}

            {selectedTask && <section className="task-detail-card" aria-label="任务详情">
              <div className="panel-heading"><div><span className={`task-detail-dot ${selectedTask.tone}`} /><Input className="task-detail-title" aria-label="任务标题" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></div><Button variant="ghost" size="icon" type="button" aria-label="关闭任务详情" onClick={() => setSelectedTask(null)}><X size={14} /></Button></div>
              <div className="task-detail-meta"><span>{KIND_LABELS[selectedTask.kind]}任务</span><span>{selectedTask.project}</span><span>{formatDuration(selectedTask.durationMinutes)}</span><label className="task-detail-priority">优先级<select className="native-select" value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as ScheduleTask["priority"])}><option value="low">低</option><option value="normal">普通</option><option value="high">重要</option></select></label></div>
              <div className="task-detail-status"><span>状态</span>{(["todo", "doing", "blocked", "done"] as const).map((status) => <Button key={status} variant={selectedTask.status === status ? "soft" : "outline"} size="sm" type="button" onClick={() => updateSelectedTask({ status })}>{STATUS_LABELS[status]}</Button>)}</div>
              <details className="task-detail-advanced"><summary>备注、重复与更多设置</summary><label className="task-detail-note">进展备注<textarea value={taskNote} onChange={(event) => setTaskNote(event.target.value)} placeholder="记录这次任务的进展…" /></label>
              <div className="task-detail-recurrence">
                <div className="task-detail-recurrence__heading"><strong>重复安排</strong><span>{recurrences.length ? "单次例外不会修改整条规则" : "让基础任务按周期生成实例"}</span></div>
                {recurrences.map((recurrence) => <div className="recurrence-row" key={recurrence.id}><span>{recurrenceFrequencyLabels[recurrence.frequency]} · {recurrence.startDate}{recurrence.endDate ? ` 至 ${recurrence.endDate}` : " 起"}</span><Button variant="ghost" size="icon" type="button" aria-label="删除重复规则" onClick={() => void deleteRecurrence(recurrence.id)}><X size={13} /></Button></div>)}
                <div className="recurrence-form"><select className="native-select" value={recurrenceForm.frequency} onChange={(event) => setRecurrenceForm((current) => ({ ...current, frequency: event.target.value as RecurrenceSummary["frequency"] }))}><option value="daily">每天</option><option value="workday">工作日</option><option value="weekly">每周</option></select><input className="native-input" type="date" value={recurrenceForm.endDate} onChange={(event) => setRecurrenceForm((current) => ({ ...current, endDate: event.target.value }))} /><Button variant="soft" size="sm" type="button" onClick={() => void createRecurrence()}><Plus size={13} /> 保存规则</Button></div>
                {recurrences.length > 0 && <div className="recurrence-override"><span>当前实例：{selectedTask.date}</span><input className="native-input" type="time" value={overrideForm.start} onChange={(event) => setOverrideForm((current) => ({ ...current, start: event.target.value }))} /><select className="native-select" value={overrideForm.duration} onChange={(event) => setOverrideForm((current) => ({ ...current, duration: event.target.value }))}><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="45">45 分钟</option><option value="60">1 小时</option></select><Button variant="outline" size="sm" type="button" onClick={() => void overrideSelectedOccurrence("move")}>改时间</Button><Button variant="outline" size="sm" type="button" onClick={() => void overrideSelectedOccurrence("override")}>覆盖这次</Button><Button variant="outline" size="sm" type="button" onClick={() => void overrideSelectedOccurrence("skip")}>跳过这次</Button></div>}
              </div><div className="task-detail-actions"><Button variant="outline" size="sm" type="button" onClick={() => updateSelectedTask({ title: taskTitle.trim(), priority: taskPriority, notes: taskNote })}>保存任务信息</Button><Button className="danger-button" variant="outline" size="sm" type="button" onClick={deleteSelectedTask}>删除任务</Button></div></details>
            </section>}

            <section className="summary-strip" aria-label="所选日期摘要">
              <span><strong>{scheduleStats.taskCount}</strong> 项任务</span><span><strong>{scheduleStats.doneCount}</strong> 项完成</span><span><strong>{formatHours(scheduleStats.scheduledMinutes)}</strong> 已安排</span><span><strong>{scheduleStats.freeMinutes === null ? "—" : formatHours(scheduleStats.freeMinutes)}</strong> 可用空档</span>{scheduleStats.riskCount > 0 ? <button type="button" className="summary-strip__risk" onClick={() => document.getElementById(unplannedTasks.length ? "unplanned" : "attention")?.scrollIntoView({ behavior: "smooth", block: "center" })}>{scheduleStats.riskCount} 项需处理</button> : <span className="summary-strip__healthy">日程无风险</span>}
            </section>

            {unplannedTasks.length > 0 && <section className="unplanned-tray" id="unplanned" aria-labelledby="unplanned-title">
              <div className="unplanned-section__heading">
                <div><strong id="unplanned-title">待安排 {unplannedTasks.length} 项</strong><small>选择明确时间；电脑端也可以拖到下方时间轴。</small></div>
                {unplannedTasks.length > 3 && <Button variant="ghost" size="sm" type="button" aria-expanded={showAllUnplanned} onClick={() => setShowAllUnplanned((current) => !current)}>{showAllUnplanned ? "收起" : `展开其余 ${unplannedTasks.length - 3} 项`}<ChevronDown className={showAllUnplanned ? "chevron-up" : ""} size={14} /></Button>}
              </div>
              <div className="unplanned-list">{(showAllUnplanned ? unplannedTasks : unplannedTasks.slice(0, 3)).map((task) => <article className="unplanned-row" draggable key={task.id} onDragStart={(event) => { event.dataTransfer.setData("application/x-goalset-task", task.id); event.dataTransfer.effectAllowed = "move"; }}>
                <GripVertical className="unplanned-row__grip" size={15} aria-hidden="true" />
                <div className="unplanned-row__body"><strong>{task.title}</strong><small>{KIND_LABELS[task.kind]} · {formatDuration(task.estimatedMinutes)} · {priorityLabels[task.priority]}{task.deadlineMinutes === undefined ? "" : ` · ${formatMinutesOfDay(task.deadlineMinutes)} 前`}</small>{placementTaskId === task.id && <div className="unplanned-placement"><Clock3 size={14} /><label className="sr-only" htmlFor={`placement-${task.id}`}>开始时间</label><input id={`placement-${task.id}`} className="native-input" type="time" step={900} value={placementTime} onChange={(event) => setPlacementTime(event.target.value)} /><Button variant="soft" size="sm" type="button" onClick={() => void scheduleUnplannedTask(task.id, "rules", timeToMinutes(placementTime))}>确认布置</Button><Button variant="ghost" size="sm" type="button" onClick={() => setPlacementTaskId(null)}>取消</Button></div>}</div>
                <div className="unplanned-row__actions"><Button variant="outline" size="sm" type="button" onClick={() => beginUnplannedPlacement(task)}>选择时间</Button><Button variant="soft" size="sm" type="button" onClick={() => void scheduleUnplannedTask(task.id, "optimize")}><Sparkles size={12} /> AI 优化</Button></div>
              </article>)}</div>
            </section>}

            <section className="calendar-card">
              <div className="calendar-card__header">
                <div><strong>{view === "week" ? formatWeekHeading(selectedDate) : formatDayHeading(selectedDate)}</strong><span>{dataSource === "loading" ? "正在同步日程" : view === "week" ? "选择一天，下方查看完整时间轴" : `${visibleItems.length} 个安排 · ${scheduleStats.freeMinutes === null ? "可用空档计算中" : `${formatHours(scheduleStats.freeMinutes)} 可用空档`}`}</span></div>
                <div className="calendar-actions"><Button variant="ghost" size="icon" type="button" aria-label="上一个时间段" onClick={() => moveDate(view === "week" ? -7 : -1)}><ChevronLeft size={15} /></Button><Button variant="ghost" size="icon" type="button" aria-label="下一个时间段" onClick={() => moveDate(view === "week" ? 7 : 1)}><ChevronRight size={15} /></Button><Button className="today-button" variant="outline" size="sm" type="button" onClick={() => { setWeekSchedule(null); setSelectedDate(todayDateKey()); setScheduleFreeMinutes(null); setDataSource("loading"); notify("已回到今天"); }}>今天</Button></div>
              </div>
              {view === "week" && <><WeekView selectedDate={selectedDate} days={weekSchedule} onSelectDay={selectWeekDay} /><div className="selected-day-heading"><strong>{formatDayHeading(selectedDate)}</strong><span>{visibleItems.length} 个安排</span></div></>}
              <DayView dateKey={selectedDate} items={visibleItems} onSelect={selectTask} onDropTask={(taskId, startMinutes) => void scheduleUnplannedTask(taskId, "rules", startMinutes)} />
              <div className="calendar-card__footer"><span><i className="legend-dot legend-dot--fixed" /> 固定安排</span><span><i className="legend-dot legend-dot--flexible" /> 弹性任务</span><span><i className="legend-dot legend-dot--floating" /> 浮动任务</span><small>{dataSource === "api" ? `SQLite 数据 · ${integrationStatus.aiConfigured ? integrationStatus.aiMode === "local" ? "本地解析" : "自然语言解析可用" : "仅规则排程"}` : dataSource === "loading" ? "正在同步数据" : "API 不可用 · 显示演示数据"}</small></div>
            </section>
          </div>

          {hasSideContext && <aside className="right-column">
            {scheduleStats.riskCount > 0 && <section className="attention-card" id="attention"><div className="panel-heading"><div><span className="panel-icon panel-icon--warm"><CalendarDays size={14} /></span><strong>待处理</strong></div><Badge className="risk-badge">{scheduleStats.riskCount} 项</Badge></div><div className="attention-list">{scheduleStats.unplannedCount > 0 && <span><strong>{scheduleStats.unplannedCount}</strong> 项未排期</span>}{scheduleStats.overdueCount > 0 && <span><strong>{scheduleStats.overdueCount}</strong> 项已逾期</span>}{scheduleStats.blockedCount > 0 && <span><strong>{scheduleStats.blockedCount}</strong> 项已阻塞</span>}</div><Button className="text-action" variant="ghost" size="sm" type="button" onClick={() => setViewOverride("day")}>查看所选日期 <span>→</span></Button></section>}
            {changes.length > 0 && <section className="change-card" id="changes"><div className="change-card__title"><span>最近变更</span><span className="change-card__time">{changes.length} 条</span></div><div className="change-row"><span className="change-avatar"><RotateCcw size={13} /></span><p>{changes[0]?.originalCommand ?? "未命名变更"}<small>{changes[0]?.source} · {changes[0]?.status}</small></p></div>{showChangeHistory && <><div className="change-history-list">{changes.map((change) => <div className="change-history-row" key={change.id}><span>{change.originalCommand ?? "未命名变更"}</span><small>{change.source} · {change.status}</small></div>)}</div><Button variant="outline" size="sm" type="button" onClick={exportChangeHistory}>导出 CSV</Button></>}<Button className="text-action" variant="ghost" size="sm" type="button" onClick={() => setShowChangeHistory((current) => !current)}>{showChangeHistory ? "收起变更记录" : "查看全部变更"} <span>→</span></Button></section>}
          </aside>}
        </div>
      </section>
    </main>
  );
}
