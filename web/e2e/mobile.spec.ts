import { expect, test } from "@playwright/test";

test("mobile dashboard stays operable without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "日", exact: true })).toHaveClass(/view-switcher__active/);
  await expect(page.getByText("今天执行", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "前一天" })).toBeVisible();
  await expect(page.getByRole("button", { name: "后一天" })).toBeVisible();
  const datePicker = page.getByLabel("选择日期");
  const currentDate = await datePicker.inputValue();
  const next = new Date(`${currentDate}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  await datePicker.fill(nextDate);
  await expect(datePicker).toHaveValue(nextDate);
  await expect(page.getByRole("button", { name: "日", exact: true })).toHaveClass(/view-switcher__active/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await expect(page.getByRole("button", { name: "添加任务" })).toBeVisible();
  await page.getByRole("button", { name: "添加任务" }).click();
  await expect(page.getByRole("tab", { name: "快速填写" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "一句话输入" })).toBeVisible();
});
