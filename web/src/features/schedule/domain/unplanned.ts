import type { Priority } from "./types";

type RankableTask = {
  id: string;
  title: string;
  priority: Priority;
  deadlineMinutes?: number;
};

const priorityRank: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export function rankUnplannedTasks<T extends RankableTask>(tasks: T[]) {
  return [...tasks].sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority]
    || (left.deadlineMinutes ?? Number.POSITIVE_INFINITY) - (right.deadlineMinutes ?? Number.POSITIVE_INFINITY)
    || left.title.localeCompare(right.title, "zh-CN")
    || left.id.localeCompare(right.id));
}
