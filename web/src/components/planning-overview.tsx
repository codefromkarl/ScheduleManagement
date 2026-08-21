"use client";

import { CalendarDays, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DailyCapacity } from "@/features/schedule/domain/capacity";
import type { UnplannedGroup } from "@/features/schedule/domain/unplanned-groups";

const capacityLabels = { healthy: "容量充足", tight: "容量紧张", impossible: "当前不可行", unknown: "无法判断" } as const;

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${rest}m`;
}

export function CapacitySummary({ days }: { days: DailyCapacity[] }) {
  if (days.length === 0) return <section className="capacity-summary capacity-summary--empty"><strong>本周容量计算中</strong><span>容量数据暂时不可用。</span></section>;
  const impossible = days.filter((day) => day.status === "impossible").length;
  const tight = days.filter((day) => day.status === "tight").length;
  const free = days.reduce((total, day) => total + day.safeFreeMinutes, 0);
  const unplanned = days.reduce((total, day) => total + day.unplannedMinutes, 0);
  return <section className={`capacity-summary ${impossible ? "capacity-summary--risk" : tight ? "capacity-summary--tight" : ""}`} aria-label="本周容量预测"><div><span>本周容量</span><strong>{impossible ? `${impossible} 天不可行` : tight ? `${tight} 天紧张` : "当前可执行"}</strong><small>{unplanned ? `${duration(unplanned)} 未排期 · ${duration(free)} 安全空档` : `${duration(free)} 安全空档`}</small></div><div className="capacity-days">{days.map((day) => <span className={`capacity-day capacity-day--${day.status}`} title={day.reason} key={day.date}><b>{day.date.slice(5).replace("-", "/")}</b><em>{capacityLabels[day.status]}</em></span>)}</div></section>;
}

export function UnplannedOverview({ groups, onSelectDate }: { groups: UnplannedGroup[]; onSelectDate: (date: string) => void }) {
  if (groups.length === 0) return <div className="overview-empty"><CalendarDays size={22} /><strong>没有跨日期待安排任务</strong><span>所有未完成任务都已经进入时间轴。</span></div>;
  return <div className="overview-groups">{groups.map((group) => <section key={group.key}><div className="overview-group__heading"><strong>{group.label}</strong><span>{group.tasks.length} 项</span></div><div>{group.tasks.map((task) => <article className="overview-task" key={task.id}><div><strong>{task.title}</strong><span>{task.date} · {duration(task.estimatedMinutes)} · {task.priority === "high" ? "重要" : task.priority === "low" ? "低" : "普通"}</span></div><Button variant="ghost" size="sm" type="button" onClick={() => onSelectDate(task.date)}>查看日期 <ChevronRight size={13} /></Button></article>)}</div></section>)}</div>;
}
