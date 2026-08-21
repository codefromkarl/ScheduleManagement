"use client";

import type { FormEvent, RefObject } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { ScheduleTask } from "@/features/schedule/domain/types";
import { formatDateKey } from "@/features/schedule/view-utils";

export type AddMode = "manual" | "natural";
export type TaskFormValue = {
  title: string;
  kind: ScheduleTask["kind"];
  duration: string;
  start: string;
  deadline: string;
  priority: ScheduleTask["priority"];
};

type ScheduleAddTaskSurfaceProps = {
  addMode: AddMode;
  aiBusy: boolean;
  aiOptimize: boolean;
  aiReply: string;
  capturedPrompts: string[];
  pendingTask: boolean;
  prompt: string;
  selectedDate: string;
  taskForm: TaskFormValue;
  taskFormError: string;
  triggerRef: RefObject<HTMLElement | null>;
  onAddModeChange: (mode: AddMode) => void;
  onAiOptimizeChange: (enabled: boolean) => void;
  onCapturePrompt: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onConfirmTask: () => void;
  onCreateTask: (event: FormEvent<HTMLFormElement>) => void;
  onPromptChange: (value: string) => void;
  onTaskFormChange: (changes: Partial<TaskFormValue>) => void;
};

export function ScheduleAddTaskSurface({ addMode, aiBusy, aiOptimize, aiReply, capturedPrompts, pendingTask, prompt, selectedDate, taskForm, taskFormError, triggerRef, onAddModeChange, onAiOptimizeChange, onCapturePrompt, onClose, onConfirmTask, onCreateTask, onPromptChange, onTaskFormChange }: ScheduleAddTaskSurfaceProps) {
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent title="添加任务" description={addMode === "manual" ? "填写标题和时长，程序会放入安全空档。" : "用一句话描述任务，时间仍由规则排程校验。"} returnFocusRef={triggerRef}>
        <div className="add-mode-switch" role="tablist" aria-label="添加方式"><Button variant={addMode === "manual" ? "soft" : "ghost"} size="sm" type="button" role="tab" aria-selected={addMode === "manual"} onClick={() => onAddModeChange("manual")}>快速填写</Button><Button variant={addMode === "natural" ? "soft" : "ghost"} size="sm" type="button" role="tab" aria-selected={addMode === "natural"} onClick={() => onAddModeChange("natural")}><Sparkles size={13} />一句话输入</Button></div>
        {addMode === "natural" ? <section className="quick-capture-card quick-capture-card--sheet" aria-label="一句话添加与调整">
          <div className="quick-capture-card__status"><Button variant={aiOptimize ? "soft" : "outline"} size="sm" type="button" aria-pressed={aiOptimize} onClick={() => onAiOptimizeChange(!aiOptimize)}><Sparkles size={12} /> AI 优化日程</Button></div>
          {aiReply && <p className="quick-capture-card__reply">{aiReply}</p>}
          <form className="ai-input-wrap" onSubmit={onCapturePrompt}>
            <label className="sr-only" htmlFor="ai-input">用一句话添加或调整任务</label>
            <Input id="ai-input" value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder={aiOptimize ? "说明希望 AI 优化或重排的任务…" : "例如：明天下午前安排两小时准备方案"} autoFocus />
            <Button size="icon" type="submit" aria-label="提交自然语言指令" disabled={aiBusy}>{aiBusy ? "…" : <ArrowUp size={15} />}</Button>
          </form>
          {capturedPrompts.length > 0 && <div className="captured-prompts"><span>最近提交</span>{capturedPrompts.map((item) => <p key={item}>“{item}”</p>)}</div>}
          <div className="ai-panel__footer"><span>{aiOptimize ? "AI 优化授权仅对下一条指令有效" : "普通指令不会授权重排"}</span><span>QQ 需以“优化日程”或“AI 重排”开头</span></div>
        </section> : <section className="task-form-card task-form-card--sheet" aria-label="新建任务"><form className="task-form" onSubmit={onCreateTask}>
          <div className="task-form__quick-row"><Input aria-label="任务标题" placeholder="例如：准备产品方案" value={taskForm.title} onChange={(event) => onTaskFormChange({ title: event.target.value })} autoFocus /><label><span>预计时长</span><select className="native-select" value={taskForm.duration} onChange={(event) => onTaskFormChange({ duration: event.target.value })}><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="45">45 分钟</option><option value="60">1 小时</option><option value="90">1.5 小时</option><option value="120">2 小时</option></select></label></div>
          <details className="task-form__advanced"><summary>更多选项</summary><div className="task-form__grid"><label>安排类型<select className="native-select" value={taskForm.kind} onChange={(event) => onTaskFormChange({ kind: event.target.value as ScheduleTask["kind"] })}><option value="flexible">弹性任务</option><option value="fixed">固定安排</option><option value="floating">浮动任务</option></select></label><label>优先级<select className="native-select" value={taskForm.priority} onChange={(event) => onTaskFormChange({ priority: event.target.value as ScheduleTask["priority"] })}><option value="normal">普通</option><option value="high">重要</option><option value="low">低</option></select></label>{taskForm.kind === "fixed" ? <label>开始时间<input className="native-input" type="time" value={taskForm.start} onChange={(event) => onTaskFormChange({ start: event.target.value })} /></label> : <label>截止时间<input className="native-input" type="time" value={taskForm.deadline} onChange={(event) => onTaskFormChange({ deadline: event.target.value })} /></label>}</div></details>
          {taskFormError && <p className="task-form__error" role="alert">{taskFormError}</p>}<div className="task-form__actions"><span>{pendingTask ? "原日程尚未改变" : `目标日期：${formatDateKey(selectedDate)}`}</span>{pendingTask && <Button variant="soft" size="sm" type="button" onClick={onConfirmTask}>确认移动并排入</Button>}<Button variant="default" size="sm" type="submit">{pendingTask ? "重新计算" : "自动排入空档"}</Button></div>
        </form></section>}
      </SheetContent>
    </Sheet>
  );
}
