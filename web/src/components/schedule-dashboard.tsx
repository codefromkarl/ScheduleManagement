"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
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
import { ToastRegion } from "@/components/ui/toast";
import {
  DEMO_ITEMS,
  KIND_LABELS,
  PROJECTS,
  scheduleItemsFromSnapshot,
  unplannedTasksFromSnapshot,
  type ScheduleItem,
  type UnplannedTask,
} from "@/features/schedule/model";
import { dashboardResponseSchema, reminderListResponseSchema, scheduleSnapshotSchema, type ReminderSummary } from "@/features/schedule/data/contract";
import type { ScheduleSnapshot } from "@/features/schedule/data/types";
import type { ScheduleTask } from "@/features/schedule/domain/types";
import { enablePwaNotifications } from "@/components/pwa-register";
import { CapacitySummary } from "@/components/planning-overview";
import type { PreviewMove } from "@/components/schedule-change-preview";
import type { DailyCapacity } from "@/features/schedule/domain/capacity";
import type { ReminderImportanceReason } from "@/features/schedule/domain/reminder-policy";
import { groupUnplannedTasks } from "@/features/schedule/domain/unplanned-groups";
import { DEFAULT_TIMELINE_RANGE, deriveTimelineRange, expandTimelineRange, type TimelineRange } from "@/features/schedule/domain/timeline";
import { DayView, WeekView, type ConflictMarker } from "@/features/schedule/components/schedule-timeline";
import type { AddMode, TaskFormValue } from "@/features/schedule/components/schedule-add-task-surface";
import type { OccurrenceOverrideFormValue, RecurrenceFormValue, RecurrenceSummary } from "@/features/schedule/components/schedule-task-detail-surface";
import { dateFromKey, dateKeyFromDate, formatDateKey, formatDayHeading, formatDuration, formatHours, formatMinutesOfDay, formatWeekHeading, timeToMinutes, todayDateKey, weekDateKeys } from "@/features/schedule/view-utils";

const Sheet = dynamic(() => import("@/components/ui/sheet").then((module) => module.Sheet), { ssr: false });
const SheetContent = dynamic(() => import("@/components/ui/sheet").then((module) => module.SheetContent), { ssr: false });
const QuickSettings = dynamic(() => import("@/components/quick-settings").then((module) => module.QuickSettings), { ssr: false });
const UnplannedOverview = dynamic(() => import("@/components/planning-overview").then((module) => module.UnplannedOverview), { ssr: false });
const ScheduleChangePreview = dynamic(() => import("@/components/schedule-change-preview").then((module) => module.ScheduleChangePreview), { ssr: false });
const ScheduleAddTaskSurface = dynamic(() => import("@/features/schedule/components/schedule-add-task-surface").then((module) => module.ScheduleAddTaskSurface), { ssr: false });
const ScheduleTaskDetailSurface = dynamic(() => import("@/features/schedule/components/schedule-task-detail-surface").then((module) => module.ScheduleTaskDetailSurface), { ssr: false });

type ViewMode = "day" | "week";
type DataSource = "demo" | "api" | "loading";
type IntegrationStatus = { authDisabled?: boolean; databaseConfigured: boolean; aiConfigured: boolean; aiMode?: string; qqConfigured: boolean; pwaConfigured: boolean; reminderChannels?: Array<"qq" | "pwa">; pwaSubscriptionCount?: number; workers?: Array<{ workerName: string; status: string; lastSuccessAt?: string | null; lastError?: string | null }> };
type ProjectSummary = { id?: string; name: string; count: number; tone: string; archived?: boolean; totalMinutes?: number; doneMinutes?: number; blockedCount?: number; overdueCount?: number; unplannedCount?: number; deadlineRiskCount?: number; progress?: number; remainingMinutes?: number; health?: "healthy" | "at_risk" | "blocked" | "empty"; healthReason?: string };
type ChangeSummary = { id: string; source: string; status: string; originalCommand?: string | null; createdAt: string };
type PendingReschedule = { taskId: string; date: string; startMinutes: number; moves: PreviewMove[]; reply: string };
type PendingPlacement = { taskId: string; date: string; placementStartMinutes?: number; moves: PreviewMove[] };
type ProposalMove = { blockId: string; fromStartMinutes: number; toStartMinutes: number; durationMinutes: number };
type TopLayer = "search" | "notifications" | "profile" | null;
type ActiveSurface = "settings" | "add-task" | "task-detail" | "mobile-nav" | "unplanned" | "activity" | null;
type Confirmation =
  | { kind: "archive-project"; project: ProjectSummary }
  | { kind: "delete-task"; task: ScheduleItem }
  | { kind: "daily-close"; action: "unplan" | "move_tomorrow"; count: number };

const reminderKindLabels: Record<ReminderSummary["kind"], string> = { start: "任务开始", schedule_change: "日程调整", daily_summary: "每日摘要", test: "通道测试" };
const reminderChannelLabels: Record<ReminderSummary["channel"], string> = { qq: "QQ", pwa: "PWA" };
const reminderImportanceLabels: Record<ReminderImportanceReason, string> = { task_override: "单任务强制", high_priority: "高优先级", fixed_schedule: "固定安排", blocked_task: "阻塞", deadline_risk: "截止风险", impossible_capacity: "容量不可行", unhandled_high_priority: "重要任务待处理" };
const projectHealthLabels: Record<NonNullable<ProjectSummary["health"]>, string> = { healthy: "正常", at_risk: "需留意", blocked: "已阻塞", empty: "待安排" };
const priorityLabels: Record<ScheduleTask["priority"], string> = { high: "重要", normal: "普通", low: "低" };

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

export function ScheduleDashboard({ initialMobile = false }: { initialMobile?: boolean }) {
  const router = useRouter();
  const getInitialMobileSnapshot = useCallback(() => initialMobile, [initialMobile]);
  const isMobile = useSyncExternalStore(subscribeToMobile, getMobileSnapshot, getInitialMobileSnapshot);
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
  const [weekSnapshots, setWeekSnapshots] = useState<Record<string, ScheduleSnapshot>>({});
  const [weekTimelineRange, setWeekTimelineRange] = useState<TimelineRange>(DEFAULT_TIMELINE_RANGE);
  const [dashboardRevision, setDashboardRevision] = useState(0);
  const [dataSource, setDataSource] = useState<DataSource>("loading");
  const [selectedDate, setSelectedDate] = useState(todayDateKey);
  const [taskFormError, setTaskFormError] = useState("");
  const [pendingTask, setPendingTask] = useState<ScheduleTask | null>(null);
  const [pendingReschedule, setPendingReschedule] = useState<PendingReschedule | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormValue>({ title: "", kind: "flexible", duration: "15", start: "09:00", deadline: "18:00", priority: "normal" });
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
  const [recurrenceForm, setRecurrenceForm] = useState<RecurrenceFormValue>({ frequency: "daily", endDate: "" });
  const [overrideForm, setOverrideForm] = useState<OccurrenceOverrideFormValue>({ start: "09:00", duration: "30" });
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
  const currentWeekFrom = currentWeekDates[0];
  const currentWeekTo = currentWeekDates.at(-1)!;
  const unplannedGroups = useMemo(() => groupUnplannedTasks(allUnplannedTasks, todayDateKey()), [allUnplannedTasks]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/dashboard?from=${currentWeekFrom}&to=${currentWeekTo}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("dashboard request failed");
        return dashboardResponseSchema.parse(await response.json());
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          const snapshots = Object.fromEntries(body.snapshots.map((snapshot) => [snapshot.date, snapshot]));
          setWeekSnapshots(snapshots);
          setWeekSchedule(Object.fromEntries(body.snapshots.map((snapshot) => [snapshot.date, scheduleItemsFromSnapshot(snapshot)])));
          setWeekTimelineRange(body.snapshots.reduce((range, snapshot) => {
            const dayRange = deriveTimelineRange(snapshot);
            return { startMinutes: Math.min(range.startMinutes, dayRange.startMinutes), endMinutes: Math.max(range.endMinutes, dayRange.endMinutes) };
          }, DEFAULT_TIMELINE_RANGE));
          setCapacityDays(body.capacityDays);
          setAllUnplannedTasks(body.unplannedTasks);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setWeekSnapshots({});
          setWeekSchedule({});
          setCapacityDays([]);
          setAllUnplannedTasks([]);
          setScheduleItems(DEMO_ITEMS);
          setUnplannedTasks([]);
          setScheduleRisk({ riskCount: 0, unplannedCount: 0, overdueCount: 0, totalCount: DEMO_ITEMS.length });
          setScheduleFreeMinutes(null);
          setTimelineRange(DEFAULT_TIMELINE_RANGE);
          setDataSource("demo");
        }
      });
    return () => controller.abort();
  }, [currentWeekFrom, currentWeekTo, dashboardRevision]);

  useEffect(() => {
    const snapshot = weekSnapshots[selectedDate];
    if (snapshot) applySnapshot(snapshot);
  }, [selectedDate, weekSnapshots]);

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
  }, [dashboardRevision]);

  useEffect(() => {
    fetch("/api/change-sets", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("changes request failed"))).then((body: { changes: ChangeSummary[] }) => setChanges(body.changes)).catch(() => undefined);
  }, [dashboardRevision]);

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

  function refreshDashboard(clear = false) {
    if (clear) setWeekSchedule(null);
    setDashboardRevision((revision) => revision + 1);
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
    refreshDashboard();
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
      refreshDashboard();
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
    refreshDashboard();
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
    refreshDashboard();
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
    refreshDashboard();
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
    refreshDashboard();
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
      refreshDashboard();
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
      refreshDashboard();
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
        if (body.task.date !== selectedDate) { setSelectedDate(body.task.date); refreshDashboard(); }
        setPendingTask(body.task);
        setAddMode("manual");
        setActiveSurface("add-task");
        setTaskFormError(`规则检测到需要移动 ${body.proposal?.moves?.length ?? 1} 个弹性任务，请确认后执行。`);
        notify("已生成需要确认的调整方案");
      } else if (body?.snapshot) {
        if (body.task?.date && body.task.date !== selectedDate) { setSelectedDate(body.task.date); refreshDashboard(); }
        const snapshot = scheduleSnapshotSchema.parse(body.snapshot);
        applySnapshot(snapshot);
        refreshDashboard();
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
    refreshDashboard();
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
    refreshDashboard();
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
    refreshDashboard();
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

        {activeSurface === "settings" && <Sheet open onOpenChange={(open) => { if (!open) setActiveSurface(null); }}><SheetContent title="设置与偏好" description="管理可用时间、缓冲、提醒和集成状态。" returnFocusRef={surfaceTriggerRef}><QuickSettings bufferMinutes={bufferMinutes} onBufferChange={saveBuffer} onQqTest={testQq} onPwaEnable={enablePwa} onPwaTest={testPwa} onNotify={notify} onClose={() => setActiveSurface(null)} showHeader={false} workers={integrationStatus.workers} qqConfigured={integrationStatus.qqConfigured} pwaConfigured={integrationStatus.pwaConfigured} pwaSubscriptionCount={integrationStatus.pwaSubscriptionCount ?? 0} reminderChannels={integrationStatus.reminderChannels} /></SheetContent></Sheet>}
        {activeSurface === "mobile-nav" && <Sheet open onOpenChange={(open) => { if (!open) setActiveSurface(null); }}><SheetContent title="导航与项目" description="切换项目、创建项目或打开工作区设置。" returnFocusRef={surfaceTriggerRef}><div className="mobile-navigation"><ProjectNavigation sectionId="mobile-projects" projects={projects} selectedProject={project} showNewProject={showNewProject} newProjectName={newProjectName} onToggleNewProject={() => setShowNewProject((current) => !current)} onNewProjectNameChange={setNewProjectName} onCreateProject={createProject} onSelectProject={(name) => { setProject(name); setViewOverride("day"); setActiveSurface(null); notify(`已筛选项目「${name}」`); }} onArchiveProject={(item) => void archiveProject(item)} /><div className="mobile-navigation__actions"><Button variant="outline" type="button" onClick={() => openSurface("settings", document.querySelector(".mobile-menu-button"))}><Settings2 size={16} />设置与偏好</Button><Button variant="ghost" type="button" onClick={() => openSurface("settings", document.querySelector(".mobile-menu-button"))}><span className="mobile-navigation__avatar">Y</span>Yuanzhi · 个人工作区</Button></div></div></SheetContent></Sheet>}
        <ConfirmDialog open={Boolean(confirmation)} title={confirmationCopy.title} description={confirmationCopy.description} confirmLabel={confirmationCopy.confirmLabel} danger={confirmationCopy.danger} onConfirm={() => { if (confirmation) void confirmRequestedAction(confirmation); }} onOpenChange={(open) => { if (!open) setConfirmation(null); }} returnFocusRef={confirmationTriggerRef} />
        {activeSurface === "unplanned" && <Sheet open onOpenChange={(open) => { if (!open) { setActiveSurface(null); setPlacementTaskId(null); } }}><SheetContent title={`待安排 ${unplannedTasks.length} 项`} description="选择明确时间、按规则批量安排，或显式请求 AI 优化。" returnFocusRef={surfaceTriggerRef}><section className="unplanned-tray unplanned-tray--sheet" aria-labelledby="unplanned-sheet-title"><div className="unplanned-section__heading"><div><strong id="unplanned-sheet-title">优先处理高优先级和临近截止任务</strong><small>精确选时、批量安排和 AI 优化都在此处；桌面拖放请使用 Dashboard 上的紧凑任务条。</small></div><div className="unplanned-section__actions"><Button variant="soft" size="sm" type="button" disabled={batchBusy} onClick={() => void arrangeAllUnplanned()}>{batchBusy ? "安排中…" : "按规则安排全部"}</Button></div></div><div className="unplanned-list">{unplannedTasks.map((task) => <article className="unplanned-row" key={task.id}><div className="unplanned-row__body"><strong>{task.title}</strong><small>{KIND_LABELS[task.kind]} · {formatDuration(task.estimatedMinutes)} · {priorityLabels[task.priority]}{task.deadlineMinutes === undefined ? "" : ` · ${formatMinutesOfDay(task.deadlineMinutes)} 前`}</small>{placementTaskId === task.id && <div className="unplanned-placement"><Clock3 size={14} /><label className="sr-only" htmlFor={`placement-${task.id}`}>开始时间</label><input id={`placement-${task.id}`} className="native-input" type="time" step={900} value={placementTime} onChange={(event) => setPlacementTime(event.target.value)} /><Button variant="soft" size="sm" type="button" onClick={() => void scheduleUnplannedTask(task.id, "rules", timeToMinutes(placementTime))}>确认布置</Button><Button variant="ghost" size="sm" type="button" onClick={() => setPlacementTaskId(null)}>取消</Button></div>}</div><div className="unplanned-row__actions"><Button variant="outline" size="sm" type="button" onClick={() => beginUnplannedPlacement(task)}>选择时间</Button><Button variant="soft" size="sm" type="button" onClick={() => void scheduleUnplannedTask(task.id, "optimize")}><Sparkles size={12} /> AI 优化</Button></div></article>)}</div></section></SheetContent></Sheet>}
        {activeSurface === "activity" && <Sheet open onOpenChange={(open) => { if (!open) setActiveSurface(null); }}><SheetContent title="活动与风险" description="查看容量、跨日期待安排和最近日程变更。" returnFocusRef={surfaceTriggerRef}><div className="activity-sheet"><CapacitySummary days={capacityDays} /><UnplannedOverview groups={unplannedGroups} onSelectDate={(date) => { setSelectedDate(date); setActiveSurface(null); }} />{scheduleStats.riskCount > 0 && <section className="attention-card"><div className="panel-heading"><div><span className="panel-icon panel-icon--warm"><CalendarDays size={14} /></span><strong>所选日期需要处理</strong></div><Badge className="risk-badge">{scheduleStats.riskCount} 项</Badge></div><div className="attention-list">{scheduleStats.unplannedCount > 0 && <span><strong>{scheduleStats.unplannedCount}</strong> 项未排期</span>}{scheduleStats.overdueCount > 0 && <span><strong>{scheduleStats.overdueCount}</strong> 项已逾期</span>}{scheduleStats.blockedCount > 0 && <span><strong>{scheduleStats.blockedCount}</strong> 项已阻塞</span>}</div>{unplannedTasks.length > 0 && <Button variant="soft" size="sm" type="button" onClick={() => openSurface("unplanned", document.querySelector('button[aria-label="活动记录"]'))}>处理待安排</Button>}</section>}<section className="change-card"><div className="change-card__title"><span>最近变更</span><span className="change-card__time">{changes.length} 条</span></div>{changes.length ? <div className="change-history-list">{changes.map((change) => <div className="change-history-row" key={change.id}><span>{change.originalCommand ?? "未命名变更"}</span><small>{change.source} · {change.status}</small></div>)}</div> : <p className="activity-empty">暂无变更记录</p>}{changes.length > 0 && <Button variant="outline" size="sm" type="button" onClick={exportChangeHistory}>导出 CSV</Button>}</section></div></SheetContent></Sheet>}

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

            {activeSurface === "add-task" && <ScheduleAddTaskSurface addMode={addMode} aiBusy={aiBusy} aiOptimize={aiOptimize} aiReply={aiReply} capturedPrompts={capturedPrompts} pendingTask={Boolean(pendingTask)} prompt={prompt} selectedDate={selectedDate} taskForm={taskForm} taskFormError={taskFormError} triggerRef={surfaceTriggerRef} onAddModeChange={setAddMode} onAiOptimizeChange={setAiOptimize} onCapturePrompt={capturePrompt} onClose={() => { setActiveSurface(null); setAiOptimize(false); setPendingTask(null); setTaskFormError(""); }} onConfirmTask={() => void confirmTask()} onCreateTask={createTask} onPromptChange={setPrompt} onTaskFormChange={(changes) => setTaskForm((current) => ({ ...current, ...changes }))} />}

            {activeSurface === "task-detail" && selectedTask && <ScheduleTaskDetailSurface item={selectedTask} note={taskNote} overrideForm={overrideForm} priority={taskPriority} recurrenceForm={recurrenceForm} recurrences={recurrences} reminderChannelReady={hasReadyReminderChannel(integrationStatus)} reminderPolicy={taskReminderPolicy} rescheduleTime={rescheduleTime} title={taskTitle} triggerRef={surfaceTriggerRef} onClose={() => { setActiveSurface(null); setSelectedTask(null); }} onCreateRecurrence={() => void createRecurrence()} onDeleteRecurrence={(id) => void deleteRecurrence(id)} onDeleteTask={deleteSelectedTask} onNoteChange={setTaskNote} onOverrideFormChange={(changes) => setOverrideForm((current) => ({ ...current, ...changes }))} onOverrideOccurrence={(action) => void overrideSelectedOccurrence(action)} onPriorityChange={setTaskPriority} onRecurrenceFormChange={(changes) => setRecurrenceForm((current) => ({ ...current, ...changes }))} onReminderPolicyChange={setTaskReminderPolicy} onReschedule={(startMinutes) => void rescheduleScheduledTask(selectedTask.taskId, startMinutes, selectedTask.date)} onRescheduleTimeChange={setRescheduleTime} onTitleChange={setTaskTitle} onUpdateTask={(changes) => void updateSelectedTask(changes)} />}

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
