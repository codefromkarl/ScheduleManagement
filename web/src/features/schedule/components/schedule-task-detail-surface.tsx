"use client";

import type { RefObject } from "react";
import { Clock3, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { KIND_LABELS, STATUS_LABELS, type ScheduleItem } from "@/features/schedule/model";
import type { ScheduleTask } from "@/features/schedule/domain/types";
import { formatDayHeading, formatDuration, formatMinutesOfDay, timeToMinutes } from "@/features/schedule/view-utils";

export type RecurrenceSummary = { id: string; taskId: string; frequency: "daily" | "weekly" | "workday" | "weekdays"; weekdays?: number[] | null; startDate: string; endDate?: string | null; timezone: string };
export type RecurrenceFormValue = { frequency: RecurrenceSummary["frequency"]; endDate: string };
export type OccurrenceOverrideFormValue = { start: string; duration: string };

const recurrenceFrequencyLabels: Record<RecurrenceSummary["frequency"], string> = { daily: "每天", weekly: "每周", workday: "工作日", weekdays: "指定星期" };
const reminderPolicyLabels: Record<ScheduleTask["reminderPolicy"], string> = { auto: "自动", always: "强制提醒", never: "不提醒" };

type TaskChanges = Partial<Pick<ScheduleTask, "title" | "status" | "priority" | "reminderPolicy" | "notes">>;

type ScheduleTaskDetailSurfaceProps = {
  item: ScheduleItem;
  note: string;
  overrideForm: OccurrenceOverrideFormValue;
  priority: ScheduleTask["priority"];
  recurrenceForm: RecurrenceFormValue;
  recurrences: RecurrenceSummary[];
  reminderChannelReady: boolean;
  reminderPolicy: ScheduleTask["reminderPolicy"];
  rescheduleTime: string;
  title: string;
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCreateRecurrence: () => void;
  onDeleteRecurrence: (id: string) => void;
  onDeleteTask: () => void;
  onNoteChange: (value: string) => void;
  onOverrideFormChange: (changes: Partial<OccurrenceOverrideFormValue>) => void;
  onOverrideOccurrence: (action: "skip" | "move" | "override") => void;
  onPriorityChange: (value: ScheduleTask["priority"]) => void;
  onRecurrenceFormChange: (changes: Partial<RecurrenceFormValue>) => void;
  onReminderPolicyChange: (value: ScheduleTask["reminderPolicy"]) => void;
  onReschedule: (startMinutes: number) => void;
  onRescheduleTimeChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onUpdateTask: (changes: TaskChanges) => void;
};

export function ScheduleTaskDetailSurface({ item, note, overrideForm, priority, recurrenceForm, recurrences, reminderChannelReady, reminderPolicy, rescheduleTime, title, triggerRef, onClose, onCreateRecurrence, onDeleteRecurrence, onDeleteTask, onNoteChange, onOverrideFormChange, onOverrideOccurrence, onPriorityChange, onRecurrenceFormChange, onReminderPolicyChange, onReschedule, onRescheduleTimeChange, onTitleChange, onUpdateTask }: ScheduleTaskDetailSurfaceProps) {
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent title="任务详情" description={`${formatDayHeading(item.date)} · ${formatMinutesOfDay(item.startMinutes)}`} returnFocusRef={triggerRef}>
        <section className="task-detail-card task-detail-card--sheet" aria-label="任务详情">
          <div className="panel-heading"><div><span className={`task-detail-dot ${item.tone}`} /><Input className="task-detail-title" aria-label="任务标题" value={title} onChange={(event) => onTitleChange(event.target.value)} /></div></div>
          <div className="task-detail-meta"><span>{KIND_LABELS[item.kind]}任务</span><span>{item.project}</span><span>{formatDuration(item.durationMinutes)}</span><label className="task-detail-priority">优先级<select className="native-select" value={priority} onChange={(event) => onPriorityChange(event.target.value as ScheduleTask["priority"])}><option value="low">低</option><option value="normal">普通</option><option value="high">重要</option></select></label></div>
          <div className="task-detail-reschedule"><Clock3 size={14} /><label htmlFor="task-reschedule-time">开始时间</label><input id="task-reschedule-time" className="native-input" type="time" step={900} value={rescheduleTime} onChange={(event) => onRescheduleTimeChange(event.target.value)} /><Button variant="soft" size="sm" type="button" onClick={() => onReschedule(timeToMinutes(rescheduleTime))}>改到此时间</Button><small>{item.kind === "fixed" ? "固定安排只能在详情中明确改时间，不能直接拖动。" : "也可以在电脑端直接拖动时间块。"}</small></div>
          <div className="task-detail-status"><span>状态</span>{(["todo", "doing", "blocked", "done"] as const).map((status) => <Button key={status} variant={item.status === status ? "soft" : "outline"} size="sm" type="button" onClick={() => onUpdateTask({ status })}>{STATUS_LABELS[status]}</Button>)}</div>
          <details className="task-detail-advanced"><summary>备注、提醒、重复与更多设置</summary><div className="task-reminder-policy"><label htmlFor="task-reminder-policy">主动提醒<select id="task-reminder-policy" className="native-select" value={reminderPolicy} onChange={(event) => onReminderPolicyChange(event.target.value as ScheduleTask["reminderPolicy"])}>{Object.entries(reminderPolicyLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><small>{reminderChannelReady ? reminderPolicy === "auto" ? "重要任务、固定安排和实际风险会按规则提醒。" : reminderPolicy === "always" ? "该任务的开始和相关日程调整都会提醒。" : "该任务自身的开始和调整不会主动提醒。" : "当前选中的提醒通道尚未配置；策略会保存，接入后自动生效。"}</small></div><label className="task-detail-note">进展备注<textarea value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="记录这次任务的进展…" /></label>
            <div className="task-detail-recurrence">
              <div className="task-detail-recurrence__heading"><strong>重复安排</strong><span>{recurrences.length ? "单次例外不会修改整条规则" : "让基础任务按周期生成实例"}</span></div>
              {recurrences.map((recurrence) => <div className="recurrence-row" key={recurrence.id}><span>{recurrenceFrequencyLabels[recurrence.frequency]} · {recurrence.startDate}{recurrence.endDate ? ` 至 ${recurrence.endDate}` : " 起"}</span><Button variant="ghost" size="icon" type="button" aria-label="删除重复规则" onClick={() => onDeleteRecurrence(recurrence.id)}><X size={13} /></Button></div>)}
              <div className="recurrence-form"><select className="native-select" value={recurrenceForm.frequency} onChange={(event) => onRecurrenceFormChange({ frequency: event.target.value as RecurrenceSummary["frequency"] })}><option value="daily">每天</option><option value="workday">工作日</option><option value="weekly">每周</option></select><input className="native-input" type="date" value={recurrenceForm.endDate} onChange={(event) => onRecurrenceFormChange({ endDate: event.target.value })} /><Button variant="soft" size="sm" type="button" onClick={onCreateRecurrence}><Plus size={13} /> 保存规则</Button></div>
              {recurrences.length > 0 && <div className="recurrence-override"><span>当前实例：{item.date}</span><input className="native-input" type="time" value={overrideForm.start} onChange={(event) => onOverrideFormChange({ start: event.target.value })} /><select className="native-select" value={overrideForm.duration} onChange={(event) => onOverrideFormChange({ duration: event.target.value })}><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="45">45 分钟</option><option value="60">1 小时</option></select><Button variant="outline" size="sm" type="button" onClick={() => onOverrideOccurrence("move")}>改时间</Button><Button variant="outline" size="sm" type="button" onClick={() => onOverrideOccurrence("override")}>覆盖这次</Button><Button variant="outline" size="sm" type="button" onClick={() => onOverrideOccurrence("skip")}>跳过这次</Button></div>}
            </div><div className="task-detail-actions"><Button variant="outline" size="sm" type="button" onClick={() => onUpdateTask({ title: title.trim(), priority, reminderPolicy, notes: note })}>保存任务信息</Button><Button className="danger-button" variant="outline" size="sm" type="button" onClick={onDeleteTask}>删除任务</Button></div>
          </details>
        </section>
      </SheetContent>
    </Sheet>
  );
}
