"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { BellRing, Check, Clock3, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type WeeklyRule = { weekday: number; startMinutes: number; endMinutes: number; enabled: boolean };
type UnavailableWindow = { id: string; date: string; startMinutes: number; endMinutes: number; reason: string };
type WorkerHealth = { workerName: string; status: string; lastSuccessAt?: string | null; lastError?: string | null };

const weekdayLabels: Record<number, string> = { 0: "周日", 1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六" };
const displayWeekdays = [1, 2, 3, 4, 5, 6, 0];

function todayDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function minutesToTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function defaultRules(): WeeklyRule[] {
  return Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinutes: 540, endMinutes: 1080, enabled: true }));
}

type QuickSettingsProps = {
  bufferMinutes: number;
  onBufferChange: (minutes: number) => Promise<void>;
  onQqTest: () => Promise<void>;
  onPwaEnable: () => Promise<void>;
  onPwaTest: () => Promise<void>;
  onNotify: (message: string) => void;
  onClose: () => void;
  showHeader?: boolean;
  workers?: WorkerHealth[];
  qqConfigured?: boolean;
  pwaConfigured?: boolean;
  pwaSubscriptionCount?: number;
  reminderChannels?: Array<"qq" | "pwa">;
};

export function QuickSettings({ bufferMinutes, onBufferChange, onQqTest, onPwaEnable, onPwaTest, onNotify, onClose, showHeader = true, workers = [], qqConfigured = false, pwaConfigured = false, pwaSubscriptionCount = 0, reminderChannels = ["qq", "pwa"] }: QuickSettingsProps) {
  const [rules, setRules] = useState<WeeklyRule[]>(defaultRules);
  const [unavailable, setUnavailable] = useState<UnavailableWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [defaultDuration, setDefaultDuration] = useState<number | null>(null);
  const [durationSuggestion, setDurationSuggestion] = useState<{ value: number; sampleCount: number; message: string } | null>(null);
  const [testingQq, setTestingQq] = useState(false);
  const [testingPwa, setTestingPwa] = useState(false);
  const [unavailableForm, setUnavailableForm] = useState({ date: todayDateKey(), startMinutes: 720, endMinutes: 780, reason: "午休" });

  const orderedRules = useMemo(() => displayWeekdays.map((weekday) => rules.find((rule) => rule.weekday === weekday) ?? { weekday, startMinutes: 540, endMinutes: 1080, enabled: true }), [rules]);
  const qqSelected = reminderChannels.includes("qq");
  const pwaSelected = reminderChannels.includes("pwa");
  const selectedWorkers = workers.filter((worker) => reminderChannels.includes(worker.workerName as "qq" | "pwa"));

  useEffect(() => {
    fetch("/api/availability", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("availability request failed");
        return response.json() as Promise<{ weekly?: WeeklyRule[]; unavailable?: UnavailableWindow[] }>;
      })
      .then((body) => {
        if (body.weekly?.length === 7) setRules(body.weekly);
        setUnavailable(body.unavailable ?? []);
      })
      .catch(() => setError("可用时间暂时无法加载"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/preferences/suggestions", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("suggestion request failed")))
      .then((body: { suggestion?: { value: number; sampleCount: number; message: string } | null }) => setDurationSuggestion(body.suggestion ?? null))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch("/api/preferences", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("preferences request failed")))
      .then((body: { preferences?: Array<{ key: string; value: unknown }> }) => {
        const value = body.preferences?.find((item) => item.key === "defaultDurationMinutes")?.value;
        if (typeof value === "number" && [15, 30, 45, 60, 90, 120].includes(value)) setDefaultDuration(value);
      })
      .catch(() => undefined);
  }, []);

  function updateRule(weekday: number, changes: Partial<WeeklyRule>) {
    setRules((current) => current.map((rule) => rule.weekday === weekday ? { ...rule, ...changes } : rule));
  }

  async function saveRules() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/availability", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rules }) });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "可用时间保存失败");
      onNotify("每周可用时间已保存");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "可用时间保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveDefaultDuration(value: number | null) {
    setDefaultDuration(value);
    const response = value === null
      ? await fetch("/api/preferences?key=defaultDurationMinutes", { method: "DELETE" })
      : await fetch("/api/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "defaultDurationMinutes", value }) });
    onNotify(response.ok ? value === null ? "AI 默认时长已清除，将先追问" : `AI 默认时长已保存为 ${value} 分钟` : "AI 默认时长保存失败");
  }

  async function addUnavailable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/availability", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(unavailableForm) });
    const body = await response.json().catch(() => null) as { window?: UnavailableWindow; error?: { message?: string } } | null;
    if (!response.ok || !body?.window) {
      setError(body?.error?.message ?? "不可用时间保存失败");
      return;
    }
    setUnavailable((current) => [...current, body.window!].sort((left, right) => left.date.localeCompare(right.date) || left.startMinutes - right.startMinutes));
    onNotify("临时不可用时间已添加");
  }

  async function removeUnavailable(id: string) {
    const response = await fetch(`/api/availability?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      setError("不可用时间删除失败");
      return;
    }
    setUnavailable((current) => current.filter((item) => item.id !== id));
    onNotify("临时不可用时间已删除");
  }

  async function testPwa() {
    setTestingPwa(true);
    try {
      await onPwaTest();
    } finally {
      setTestingPwa(false);
    }
  }

  async function testQq() {
    setTestingQq(true);
    try {
      await onQqTest();
    } finally {
      setTestingQq(false);
    }
  }

  return (
    <section className="quick-settings" aria-label="快速设置">
      {showHeader && <div className="quick-settings__header">
        <div><strong>设置与偏好</strong><span>排程只使用这里显示的可用时间；缓冲和提醒会保存到当前工作区。</span></div>
        <Button variant="ghost" size="icon" type="button" aria-label="关闭设置" onClick={onClose}><X size={14} /></Button>
      </div>}
      <div className="quick-settings__body">
        <div className="quick-settings__controls">
          <span>任务间缓冲</span>
          {[0, 15, 30].map((minutes) => <Button key={minutes} variant={bufferMinutes === minutes ? "soft" : "outline"} size="sm" type="button" onClick={() => void onBufferChange(minutes)}>{minutes} 分钟</Button>)}
          <span>缺少时长时默认</span>
          <select className="native-select settings-duration-select" value={defaultDuration?.toString() ?? ""} onChange={(event) => void saveDefaultDuration(event.target.value ? Number(event.target.value) : null)}><option value="">每次先追问</option><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="45">45 分钟</option><option value="60">1 小时</option><option value="90">1.5 小时</option><option value="120">2 小时</option></select>
          {durationSuggestion && durationSuggestion.value !== defaultDuration && <Button variant="ghost" size="sm" type="button" onClick={() => void saveDefaultDuration(durationSuggestion.value)}>采用 {durationSuggestion.value} 分钟建议</Button>}
        </div>

        <div className="availability-editor">
          <div className="availability-editor__heading"><div><strong>每周可用时间</strong><span>关闭某天后，AI 不会把任务排入该日。</span></div><Button variant="soft" size="sm" type="button" disabled={loading || saving} onClick={() => void saveRules()}>{saving ? "保存中…" : <><Check size={13} /> 保存时间模板</>}</Button></div>
          <div className="availability-grid">
            {orderedRules.map((rule) => <label className={`availability-row ${rule.enabled ? "" : "availability-row--disabled"}`} key={rule.weekday}>
              <input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.weekday, { enabled: event.target.checked })} />
              <strong>{weekdayLabels[rule.weekday]}</strong>
              <input className="native-input" type="time" value={minutesToTime(rule.startMinutes)} disabled={!rule.enabled} onChange={(event) => updateRule(rule.weekday, { startMinutes: timeToMinutes(event.target.value) })} />
              <span>至</span>
              <input className="native-input" type="time" value={minutesToTime(rule.endMinutes)} disabled={!rule.enabled} onChange={(event) => updateRule(rule.weekday, { endMinutes: timeToMinutes(event.target.value) })} />
            </label>)}
          </div>
        </div>

        <div className="unavailable-editor">
          <div className="availability-editor__heading"><div><strong>临时不可用时间</strong><span>例如午休、外出或临时会议。</span></div></div>
          <form className="unavailable-form" onSubmit={addUnavailable}>
            <input className="native-input" type="date" value={unavailableForm.date} onChange={(event) => setUnavailableForm((current) => ({ ...current, date: event.target.value }))} />
            <input className="native-input" type="time" value={minutesToTime(unavailableForm.startMinutes)} onChange={(event) => setUnavailableForm((current) => ({ ...current, startMinutes: timeToMinutes(event.target.value) }))} />
            <input className="native-input" type="time" value={minutesToTime(unavailableForm.endMinutes)} onChange={(event) => setUnavailableForm((current) => ({ ...current, endMinutes: timeToMinutes(event.target.value) }))} />
            <Input aria-label="不可用时间原因" value={unavailableForm.reason} onChange={(event) => setUnavailableForm((current) => ({ ...current, reason: event.target.value }))} placeholder="原因" />
            <Button size="icon" type="submit" aria-label="添加不可用时间"><Plus size={14} /></Button>
          </form>
          {unavailable.length > 0 && <div className="unavailable-list">{unavailable.map((item) => <div className="unavailable-row" key={item.id}><span>{item.date} · {minutesToTime(item.startMinutes)}–{minutesToTime(item.endMinutes)} · {item.reason}</span><Button variant="ghost" size="icon" type="button" aria-label={`删除 ${item.reason}`} onClick={() => void removeUnavailable(item.id)}><Trash2 size={13} /></Button></div>)}</div>}
        </div>
        <details className="settings-advanced"><summary>提醒与集成状态</summary><div className="settings-advanced__content"><div><div className="worker-health"><span>后台提醒状态</span>{selectedWorkers.length === 0 ? <strong>尚未运行</strong> : selectedWorkers.map((worker) => <span key={worker.workerName} className={`worker-health__item worker-health__item--${worker.status}`}><i />{worker.workerName.toUpperCase()} {worker.status === "success" ? "正常" : worker.status === "error" ? "异常" : worker.status}</span>)}{qqSelected && !qqConfigured && <span className="worker-health__item worker-health__item--muted"><i />QQ 凭据未配置</span>}{pwaSelected && !pwaConfigured && <span className="worker-health__item worker-health__item--muted"><i />PWA 凭据未配置</span>}</div>{qqSelected && <p className="reminder-policy-summary"><strong>QQ {pwaSelected ? "提醒与突发任务通道" : "唯一提醒通道"}</strong><span>{qqConfigured ? "重要任务、固定安排和每日 09:00 实际风险会发送到绑定 QQ；突发任务仍调用 Goalset 的同一套排程规则。真实客户端收到、超回复窗口和 worker 重启仍需分别验收。" : "当前已选择仅通过 QQ 提醒，但凭据尚未配置；在配置并启动 QQ worker 前不会发送提醒。"}</span></p>}{pwaSelected && <p className="reminder-policy-summary"><strong>PWA 提醒 · {pwaSubscriptionCount} 台设备</strong><span>测试提醒只有在推送服务接受且设备服务工作线程回执后才算成功。</span></p>}</div><div className="reminder-channel-actions">{qqSelected && <Button variant="soft" size="sm" type="button" disabled={!qqConfigured || testingQq} onClick={() => void testQq()}><BellRing size={13} />{testingQq ? "等待 QQ 发送…" : "发送 QQ 测试提醒"}</Button>}{pwaSelected && <><Button variant="outline" size="sm" type="button" onClick={() => void onPwaEnable()}><Clock3 size={13} /> 开启 PWA 提醒</Button><Button variant="soft" size="sm" type="button" disabled={!pwaConfigured || pwaSubscriptionCount === 0 || testingPwa} onClick={() => void testPwa()}><BellRing size={13} />{testingPwa ? "等待回执…" : "发送 PWA 测试提醒"}</Button></>}</div></div></details>
        {error && <p className="settings-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}
