import { expect, test, type APIRequestContext } from "@playwright/test";

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}

async function createFixed(request: APIRequestContext, id: string, title: string, date: string, startMinutes: number, duration = 30) {
  const response = await request.post("/api/schedule", { data: { task: { id, title, date, kind: "fixed", priority: "normal", status: "todo", estimatedMinutes: duration, movable: false, preferredStartMinutes: startMinutes } } });
  expect(response.status()).toBe(201);
  return response.json();
}

test("desktop week mode renders a real Monday-to-Sunday timetable without redundant daily summary blocks", async ({ page, request }) => {
  const today = todayKey();
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDays(today, -((weekday + 6) % 7));
  const sunday = addDays(monday, 6);
  const suffix = crypto.randomUUID();
  const ids = [`week-monday-${suffix}`, `week-sunday-${suffix}`];
  try {
    await createFixed(request, ids[0], "星期表周一任务", monday, 10 * 60);
    await createFixed(request, ids[1], "星期表周日任务", sunday, 16 * 60);

    await page.clock.install({ time: new Date(`${today}T04:45:00Z`) });
    await page.goto("/");
    const timetable = page.getByLabel("本周星期表");
    await expect(timetable).toBeVisible();
    await expect(timetable.locator(`.week-timetable__track[data-date="${monday}"]`)).toContainText("星期表周一任务");
    await expect(timetable.locator(`.week-timetable__track[data-date="${sunday}"]`)).toContainText("星期表周日任务");
    const mondayBlock = timetable.locator(`.week-timetable__track[data-date="${monday}"] .schedule-item--week`).filter({ hasText: "星期表周一任务" });
    await expect(mondayBlock).toContainText("10:00–10:30");
    await expect(mondayBlock).not.toContainText("固定");
    await expect(mondayBlock).toHaveAttribute("data-tooltip", /星期表周一任务，固定任务，待开始，未分类，30 分钟，10:00–10:30/);
    await mondayBlock.focus();
    await expect(mondayBlock).toBeFocused();
    expect(await mondayBlock.evaluate((element) => getComputedStyle(element, "::after").display)).toBe("block");
    await expect(timetable.locator(".timeline-grid__half-hour").first()).toBeVisible();
    await expect(timetable.locator(".current-time--week b")).toHaveText("现在 12:45");
    expect(await timetable.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
    await expect(page.locator(".timeline-shell")).toHaveCount(0);
    await expect(page.locator(".next-up-card, .summary-strip")).toHaveCount(0);
  } finally {
    for (const id of ids.reverse()) await request.delete(`/api/tasks/${id}`);
  }
});

test("activity groups cross-date unplanned work, shows capacity, and expands the timeline", async ({ page, request }) => {
  const today = todayKey();
  const suffix = crypto.randomUUID();
  const dates = [addDays(today, -1), today, addDays(today, 1)];
  const ids: string[] = [];
  const availability = await request.get("/api/availability").then((response) => response.json());
  const restoreRules = availability.weekly.length === 7 ? availability.weekly : Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinutes: 9 * 60, endMinutes: 18 * 60, enabled: true }));
  try {
    await request.put("/api/availability", { data: { rules: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinutes: 7 * 60, endMinutes: 22 * 60, enabled: true })) } });
    for (const [index, date] of dates.entries()) {
      const baseId = `overview-base-${index}-${suffix}`;
      const pendingId = `overview-pending-${index}-${suffix}`;
      ids.push(baseId, pendingId);
      await createFixed(request, baseId, `总览基准 ${index}`, date, 9 * 60);
      const pending = await createFixed(request, pendingId, `跨日期待安排 ${index}`, date, 9 * 60);
      expect(pending.proposal.decision).toBe("no_slot");
    }
    const lateId = `late-${suffix}`; ids.push(lateId);
    await createFixed(request, lateId, "晚间动态时间轴", today, 21 * 60);

    await page.goto("/");
    await expect(page.getByText("本周规划", { exact: true })).toBeVisible();
    await expect(page.locator(".planning-rail")).toBeVisible();
    await expect(page.locator(".planning-rail")).toContainText("本周容量与风险");
    await expect(page.locator(".planning-rail")).toContainText("待安排");
    await expect(page.locator(".timeline-labels").getByText("22:00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "活动记录" }).click();
    await expect(page.locator(".activity-sheet .capacity-summary")).toContainText("本周容量");
    await expect(page.locator(".overview-groups")).toContainText("已逾期");
    await expect(page.locator(".overview-groups")).toContainText("今天");
    await expect(page.locator(".overview-groups")).toContainText("明天");
    await expect(page.locator(".overview-groups")).toContainText("跨日期待安排 2");
  } finally {
    for (const id of ids.reverse()) await request.delete(`/api/tasks/${id}`);
    await request.put("/api/availability", { data: { rules: restoreRules } });
  }
});

test("task details persist the three-state reminder policy and explain QQ importance", async ({ page, request }) => {
  const today = todayKey();
  const id = `reminder-policy-${crypto.randomUUID()}`;
  try {
    await createFixed(request, id, "提醒策略测试", today, 14 * 60);
    await page.goto("/");
    await page.locator(".schedule-item").filter({ hasText: "提醒策略测试" }).click();
    await page.getByText("备注、提醒、重复与更多设置", { exact: true }).click();
    await expect(page.locator("#task-reminder-policy")).toHaveValue("auto");
    await page.locator("#task-reminder-policy").selectOption("always");
    await page.getByRole("button", { name: "保存任务信息" }).click();
    await expect(page.getByText("任务已更新", { exact: true })).toBeVisible();
    const snapshot = await request.get(`/api/schedule?date=${today}`).then((response) => response.json());
    expect(snapshot.tasks.find((task: { id: string }) => task.id === id)?.reminderPolicy).toBe("always");

    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "设置与偏好", exact: true }).click();
    await page.getByText("提醒与集成状态", { exact: true }).click();
    const integrationStatus = await request.get("/api/status").then((response) => response.json());
    expect(integrationStatus.reminderChannels).toEqual(["qq"]);
    const qqTestResponse = await request.post("/api/qq/test");
    expect(qqTestResponse.status()).toBe(409);
    expect((await qqTestResponse.json()).error.code).toBe("QQ_NOT_CONFIGURED");
    await expect(page.getByText("QQ 唯一提醒通道", { exact: true })).toBeVisible();
    await expect(page.getByText(/配置并启动 QQ worker 前不会发送提醒/)).toBeVisible();
    await expect(page.getByRole("button", { name: "开启 PWA 提醒" })).toHaveCount(0);
  } finally {
    await request.delete(`/api/tasks/${id}`);
  }
});
