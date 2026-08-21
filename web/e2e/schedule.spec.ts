import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type TaskInput = {
  id: string;
  title: string;
  date: string;
  kind: "fixed" | "flexible" | "floating";
  priority: "low" | "normal" | "high";
  status: "todo" | "doing" | "blocked" | "done";
  estimatedMinutes: number;
  movable: boolean;
  preferredStartMinutes?: number;
  deadlineMinutes?: number;
};

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function task(id: string, title: string, date: string, overrides: Partial<TaskInput> = {}): TaskInput {
  return { id, title, date, kind: "flexible", priority: "normal", status: "todo", estimatedMinutes: 30, movable: true, preferredStartMinutes: 9 * 60, ...overrides };
}

async function createTask(request: APIRequestContext, value: TaskInput) {
  const response = await request.post("/api/schedule", { data: { task: value } });
  expect(response.status()).toBe(201);
  return response.json();
}

async function cleanup(request: APIRequestContext, ids: string[]) {
  for (const id of ids.reverse()) await request.delete(`/api/tasks/${id}`);
}

async function dragToMinute(page: Page, title: string, startMinutes: number) {
  await page.locator(".schedule-item").filter({ hasText: title }).waitFor();
  await page.evaluate(({ title: targetTitle, startMinutes: targetStart }) => {
    const block = [...document.querySelectorAll<HTMLElement>(".schedule-item")].find((item) => item.innerText.includes(targetTitle));
    const track = document.querySelector<HTMLElement>(".timeline-track");
    if (!block || !track) throw new Error("drag source or timeline missing");
    const rangeStart = Number(track.dataset.startMinutes);
    const rangeEnd = Number(track.dataset.endMinutes);
    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) throw new Error("timeline range missing");
    const transfer = new DataTransfer();
    block.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const rect = track.getBoundingClientRect();
    const clientY = rect.top + ((targetStart - rangeStart) / (rangeEnd - rangeStart)) * rect.height;
    for (const type of ["dragenter", "dragover", "drop"]) track.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientY, dataTransfer: transfer }));
  }, { title, startMinutes });
}

test("rules batch, scheduled drag/click, and conflict feedback stay deterministic", async ({ page, request }) => {
  const date = todayKey();
  const suffix = crypto.randomUUID();
  const ids = [`baseline-${suffix}`, `batch-${suffix}`, `drag-${suffix}`, `blocker-${suffix}`, `opt-blocker-${suffix}`, `opt-task-${suffix}`];
  const availability = await request.get("/api/availability").then((response) => response.json());
  const restoreRules = availability.weekly;
  try {
    await request.put("/api/availability", { data: { rules: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinutes: 9 * 60, endMinutes: 18 * 60, enabled: true })) } });
    await createTask(request, task(ids[0], "批排基准", date, { kind: "fixed", movable: false, estimatedMinutes: 60 }));
    const unplanned = await createTask(request, task(ids[1], "批排待安排", date, { kind: "fixed", movable: false, estimatedMinutes: 30 }));
    expect(unplanned.proposal.decision).toBe("no_slot");
    await request.delete(`/api/tasks/${ids[0]}`);

    await page.goto("/");
    await page.getByRole("button", { name: "处理", exact: true }).click();
    await expect(page.getByRole("button", { name: "按规则安排全部" })).toBeVisible();
    await page.getByRole("button", { name: "按规则安排全部" }).click();
    await expect(page.locator(".schedule-item").filter({ hasText: "批排待安排" })).toBeVisible();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("button", { name: "处理", exact: true }).click();
    await expect(page.locator(".unplanned-row").filter({ hasText: "批排待安排" })).toBeVisible();
    await page.getByRole("button", { name: "按规则安排全部" }).click();
    await expect(page.locator(".schedule-item").filter({ hasText: "批排待安排" })).toBeVisible();

    await createTask(request, task(ids[2], "拖动改期任务", date, { preferredStartMinutes: 10 * 60 + 30 }));
    await createTask(request, task(ids[3], "冲突固定安排", date, { kind: "fixed", movable: false, preferredStartMinutes: 12 * 60 }));
    await page.reload();
    await expect(page.locator(".schedule-item").filter({ hasText: "拖动改期任务" })).toBeVisible();

    await dragToMinute(page, "拖动改期任务", 13 * 60);
    await expect(page.getByText("任务已改到 13:00", { exact: true })).toBeVisible();
    await dragToMinute(page, "拖动改期任务", 12 * 60);
    await expect(page.getByText("12:00 无法放置")).toBeVisible();

    await page.getByRole("button", { name: /拖动改期任务/ }).click();
    await page.locator("#task-reschedule-time").fill("14:00");
    await page.getByRole("button", { name: "改到此时间" }).click();
    await expect(page.getByText("任务已改到 14:00", { exact: true })).toBeVisible();
    const snapshot = await request.get(`/api/schedule?date=${date}`).then((response) => response.json());
    expect(snapshot.blocks.find((block: { taskId: string }) => block.taskId === ids[2])?.startMinutes).toBe(14 * 60);
    await page.getByRole("button", { name: "关闭", exact: true }).click();

    const optimizeDateValue = new Date(`${date}T00:00:00Z`); optimizeDateValue.setUTCDate(optimizeDateValue.getUTCDate() + 1);
    const optimizeDate = optimizeDateValue.toISOString().slice(0, 10);
    await createTask(request, task(ids[4], "优化预览阻挡", optimizeDate, { preferredStartMinutes: 9 * 60, estimatedMinutes: 60 }));
    const optimizePending = await createTask(request, task(ids[5], "优化预览任务", optimizeDate, { preferredStartMinutes: 9 * 60, estimatedMinutes: 60, deadlineMinutes: 10 * 60 }));
    expect(optimizePending.proposal.decision).toBe("no_slot");
    const preview = await request.post(`/api/tasks/${ids[5]}/schedule`, { data: { date: optimizeDate, mode: "optimize" } });
    expect(preview.status()).toBe(409);
    const previewBody = await preview.json();
    expect(previewBody.proposal.decision).toBe("needs_confirmation");
    expect(previewBody.snapshot.blocks.find((block: { taskId: string }) => block.taskId === ids[4])?.startMinutes).toBe(9 * 60);
    expect(previewBody.snapshot.blocks.some((block: { taskId: string }) => block.taskId === ids[5])).toBe(false);

    await page.locator(".week-column").filter({ hasText: optimizeDate.slice(5).replace("-", "/") }).click();
    await page.getByRole("button", { name: "处理", exact: true }).click();
    const optimizeRow = page.locator(".unplanned-row").filter({ hasText: "优化预览任务" });
    await optimizeRow.getByRole("button", { name: "AI 优化" }).click();
    await expect(page.locator(".schedule-change-preview")).toContainText("优化预览阻挡");
    await expect(page.locator(".schedule-change-preview")).toContainText("09:00 → 10:15");
    await page.locator(".schedule-change-preview").getByRole("button", { name: "取消", exact: true }).click();
  } finally {
    await cleanup(request, ids);
    await request.put("/api/availability", { data: { rules: restoreRules } });
  }
});

test("daily close moves only incomplete non-fixed work and undo restores it", async ({ page, request }) => {
  const date = todayKey();
  const suffix = crypto.randomUUID();
  const flexibleId = `close-flex-${suffix}`;
  const fixedId = `close-fixed-${suffix}`;
  try {
    await createTask(request, task(flexibleId, "收尾弹性任务", date, { preferredStartMinutes: 9 * 60 }));
    await createTask(request, task(fixedId, "收尾固定安排", date, { kind: "fixed", movable: false, preferredStartMinutes: 11 * 60 }));
    await page.goto("/");
    await page.getByRole("button", { name: "更多日程操作" }).click();
    const closeResponse = page.waitForResponse((response) => response.url().includes("/api/schedule/daily-close") && response.request().method() === "POST");
    await page.getByRole("menuitem", { name: "移到明天待安排" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "移到明天", exact: true }).click();
    expect((await closeResponse).status()).toBe(200);
    await page.getByRole("button", { name: "活动记录" }).click();
    await expect(page.locator(".overview-groups")).toContainText("收尾弹性任务");
    const tomorrow = new Date(`${date}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const targetDate = tomorrow.toISOString().slice(0, 10);
    const tomorrowSnapshot = await request.get(`/api/schedule?date=${targetDate}`).then((response) => response.json());
    expect(tomorrowSnapshot.tasks.some((item: { id: string }) => item.id === flexibleId)).toBe(true);
    expect(tomorrowSnapshot.blocks.some((item: { taskId: string }) => item.taskId === flexibleId)).toBe(false);
    const todaySnapshot = await request.get(`/api/schedule?date=${date}`).then((response) => response.json());
    expect(todaySnapshot.blocks.some((item: { taskId: string }) => item.taskId === fixedId)).toBe(true);

    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "撤销" }).click();
    const restored = await request.get(`/api/schedule?date=${date}`).then((response) => response.json());
    expect(restored.blocks.some((item: { taskId: string }) => item.taskId === flexibleId)).toBe(true);
  } finally {
    await cleanup(request, [flexibleId, fixedId]);
  }
});
