export function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function dateKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function todayDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

export function formatDateKey(dateKey: string) {
  const date = dateFromKey(dateKey);
  return `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`;
}

export function formatDayHeading(dateKey: string) {
  const date = dateFromKey(dateKey);
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return `${formatDateKey(dateKey)} · ${weekdays[date.getUTCDay()]}`;
}

export function formatWeekHeading(dateKey: string) {
  const selected = dateFromKey(dateKey);
  const mondayOffset = (selected.getUTCDay() + 6) % 7;
  const monday = new Date(selected);
  monday.setUTCDate(monday.getUTCDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return `${monday.getUTCMonth() + 1} 月 ${monday.getUTCDate()} 日 — ${sunday.getUTCMonth() + 1} 月 ${sunday.getUTCDate()} 日`;
}

export function weekDateKeys(dateKey: string) {
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

export function weekdayLabel(dateKey: string) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][dateFromKey(dateKey).getUTCDay()];
}

export function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function formatMinutesOfDay(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

export function formatHours(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
