import {
  DEFAULT_BUFFER_MINUTES,
  ScheduleValidationError,
  TIME_GRANULARITY_MINUTES,
  type ScheduleContext,
  type ScheduleMove,
  type SchedulePlacement,
  type ScheduleProposal,
  type ScheduleTask,
  type ScheduledBlock,
  type TimeRange,
} from "./types";

function isAligned(value: number) {
  return Number.isInteger(value) && value % TIME_GRANULARITY_MINUTES === 0;
}

function assertTime(value: number, name: string) {
  if (!isAligned(value) || value < 0 || value > 24 * 60) {
    throw new ScheduleValidationError("invalid_time", `${name} must use 15-minute increments.`);
  }
}

function assertRange(range: TimeRange, name: string) {
  assertTime(range.startMinutes, `${name}.startMinutes`);
  assertTime(range.endMinutes, `${name}.endMinutes`);
  if (range.endMinutes <= range.startMinutes) {
    throw new ScheduleValidationError("invalid_time", `${name} must end after it starts.`);
  }
}

function assertTask(task: ScheduleTask) {
  if (!isAligned(task.estimatedMinutes) || task.estimatedMinutes <= 0) {
    throw new ScheduleValidationError("invalid_duration", "Task duration must be a positive 15-minute increment.");
  }
  if (task.kind === "fixed" && task.preferredStartMinutes === undefined) {
    throw new ScheduleValidationError("missing_fixed_start", "Fixed tasks need an exact start time.");
  }
  if (task.kind === "fixed" && task.movable) {
    throw new ScheduleValidationError("invalid_time", "Fixed tasks cannot be movable.");
  }
  if (task.preferredStartMinutes !== undefined) assertTime(task.preferredStartMinutes, "preferredStartMinutes");
  if (task.exactStartMinutes !== undefined) assertTime(task.exactStartMinutes, "exactStartMinutes");
  if (task.deadlineMinutes !== undefined) assertTime(task.deadlineMinutes, "deadlineMinutes");
}

function endAt(startMinutes: number, durationMinutes: number) {
  return startMinutes + durationMinutes;
}

function blockRange(block: ScheduledBlock): TimeRange {
  return { startMinutes: block.startMinutes, endMinutes: endAt(block.startMinutes, block.durationMinutes) };
}

function overlaps(left: TimeRange, right: TimeRange) {
  return left.startMinutes < right.endMinutes && right.startMinutes < left.endMinutes;
}

function isInside(range: TimeRange, container: TimeRange) {
  return range.startMinutes >= container.startMinutes && range.endMinutes <= container.endMinutes;
}

function candidateStarts(task: ScheduleTask, context: ScheduleContext, durationMinutes: number) {
  const starts = context.availability.flatMap((window) => {
    if (window.date !== context.date) return [];
    const latestStart = window.endMinutes - durationMinutes;
    const values: number[] = [];
    for (let start = window.startMinutes; start <= latestStart; start += TIME_GRANULARITY_MINUTES) values.push(start);
    return values;
  });

  if (task.exactStartMinutes !== undefined) return starts.filter((start) => start === task.exactStartMinutes);
  if (task.kind === "fixed") return starts.filter((start) => start === task.preferredStartMinutes);
  if (context.mode === "optimize") {
    return starts.sort((left, right) => candidateScore(task, context, left, durationMinutes) - candidateScore(task, context, right, durationMinutes) || left - right);
  }
  if (task.preferredStartMinutes !== undefined) {
    return starts.sort((left, right) => Math.abs(left - task.preferredStartMinutes!) - Math.abs(right - task.preferredStartMinutes!) || left - right);
  }
  return starts;
}

function candidateScore(task: ScheduleTask, context: ScheduleContext, startMinutes: number, durationMinutes: number) {
  const endMinutes = startMinutes + durationMinutes;
  const priorityWeight = task.priority === "high" ? 2 : task.priority === "low" ? 0.75 : 1;
  let score = startMinutes * priorityWeight;
  if (task.preferredStartMinutes !== undefined) score += Math.abs(startMinutes - task.preferredStartMinutes) * 20;
  if (task.deadlineMinutes !== undefined) score -= Math.max(0, task.deadlineMinutes - endMinutes) * (task.priority === "high" ? 1 : 0.25);
  if (context.existing.length > 0) {
    const nearestScheduleGap = Math.min(...context.existing.map((block) => Math.min(Math.abs(startMinutes - (block.startMinutes + block.durationMinutes)), Math.abs(endMinutes - block.startMinutes))));
    score += nearestScheduleGap * 0.1;
  }
  if (task.projectId) {
    const sameProject = context.existing.filter((block) => block.projectId === task.projectId);
    if (sameProject.length > 0) {
      const nearestProjectGap = Math.min(...sameProject.map((block) => Math.min(Math.abs(startMinutes - (block.startMinutes + block.durationMinutes)), Math.abs(endMinutes - block.startMinutes))));
      score += nearestProjectGap * 2;
    }
  }
  return score;
}

function blockingBlocks(
  startMinutes: number,
  endMinutes: number,
  context: ScheduleContext,
  ignoreMovable: boolean,
) {
  const buffer = context.bufferMinutes ?? DEFAULT_BUFFER_MINUTES;
  const candidateWithBuffer = bufferedRange(startMinutes, endMinutes, buffer);
  return context.existing.filter((block) => {
    if (block.date !== context.date || (ignoreMovable && block.movable)) return false;
    return overlaps(candidateWithBuffer, blockRange(block));
  });
}

function bufferedRange(startMinutes: number, endMinutes: number, buffer: number): TimeRange {
  return { startMinutes: Math.max(0, startMinutes - buffer), endMinutes: endMinutes + buffer };
}

function findCandidate(task: ScheduleTask, context: ScheduleContext, ignoreMovable: boolean) {
  for (const startMinutes of candidateStarts(task, context, task.estimatedMinutes)) {
    const placement = { date: context.date, startMinutes, endMinutes: endAt(startMinutes, task.estimatedMinutes) };
    const availability = context.availability.find((window) => window.date === context.date && isInside(placement, window));
    if (!availability) continue;
    const buffer = context.bufferMinutes ?? DEFAULT_BUFFER_MINUTES;
    if (context.unavailable.some((window) => window.date === context.date && overlaps(bufferedRange(placement.startMinutes, placement.endMinutes, buffer), window))) continue;
    if (task.deadlineMinutes !== undefined && placement.endMinutes > task.deadlineMinutes) continue;
    if (blockingBlocks(placement.startMinutes, placement.endMinutes, context, ignoreMovable).length > 0) continue;
    return placement;
  }
  return undefined;
}

function buildMoves(task: ScheduleTask, context: ScheduleContext, placement: SchedulePlacement, movedBlockIds: string[]) {
  const moved = context.existing.filter((block) => movedBlockIds.includes(block.id));
  let working = context.existing.filter((block) => !movedBlockIds.includes(block.id));
  working = [...working, placementToBlock(task, placement)];
  const moves: ScheduleMove[] = [];

  for (const block of moved) {
    const relocationTask: ScheduleTask = {
      id: block.taskId,
      title: block.title,
      date: block.date,
      kind: block.kind,
      priority: "normal",
      status: "todo",
      reminderPolicy: "auto",
      estimatedMinutes: block.durationMinutes,
      movable: true,
      preferredStartMinutes: block.startMinutes,
    };
    const relocation = findCandidate(relocationTask, { ...context, existing: working }, false);
    if (!relocation) return undefined;
    moves.push({ blockId: block.id, fromStartMinutes: block.startMinutes, toStartMinutes: relocation.startMinutes, durationMinutes: block.durationMinutes });
    working = [...working, { ...block, startMinutes: relocation.startMinutes }];
  }
  return moves;
}

export function findScheduleProposal(task: ScheduleTask, context: ScheduleContext): ScheduleProposal {
  assertTask(task);
  if (task.date !== context.date) return { decision: "needs_information", movedBlockIds: [], moves: [], reasons: ["任务日期与当前排程日期不一致。"] };

  const buffer = context.bufferMinutes ?? DEFAULT_BUFFER_MINUTES;
  if (!isAligned(buffer) || buffer < 0) {
    throw new ScheduleValidationError("invalid_buffer", "Buffer must use non-negative 15-minute increments.");
  }
  context.availability.filter((window) => window.date === context.date).forEach((window) => assertRange(window, "availability"));
  context.unavailable.filter((window) => window.date === context.date).forEach((window) => assertRange(window, "unavailable"));

  const directPlacement = findCandidate(task, context, false);
  if (directPlacement) {
    return { decision: "auto", placement: directPlacement, movedBlockIds: [], moves: [], reasons: ["已找到符合可用时间、缓冲和截止时间的空档。"] };
  }

  if (context.mode === "optimize" && task.kind !== "fixed" && task.movable) {
    const movablePlacement = findCandidate(task, context, true);
    if (movablePlacement) {
      const movedBlockIds = blockingBlocks(movablePlacement.startMinutes, movablePlacement.endMinutes, context, false)
        .filter((block) => block.movable)
        .map((block) => block.id);
      if (movedBlockIds.length > 0) {
        const moves = buildMoves(task, context, movablePlacement, movedBlockIds);
        if (!moves) return { decision: "no_slot", movedBlockIds, moves: [], reasons: ["存在需要移动的弹性任务，但没有找到安全的替代时段。"] };
        return {
          decision: "needs_confirmation",
          placement: movablePlacement,
          movedBlockIds,
          moves,
          reasons: ["需要移动弹性任务才能插入，保留原日程并等待确认。"],
        };
      }
    }
  }

  return {
    decision: "no_slot",
    movedBlockIds: [],
    moves: [],
    reasons: task.kind === "fixed" ? ["固定安排没有可用的精确时间，未自动移动其他任务。"] : ["在当前可用时间、缓冲和截止时间约束下没有可执行空档。"],
  };
}

export function placementToBlock(task: ScheduleTask, placement: SchedulePlacement): ScheduledBlock {
  return {
    id: `${task.id}:${placement.date}:${placement.startMinutes}`,
    taskId: task.id,
    date: placement.date,
    startMinutes: placement.startMinutes,
    durationMinutes: task.estimatedMinutes,
    kind: task.kind,
    movable: task.movable,
    title: task.title,
    priority: task.priority,
    projectId: task.projectId,
  };
}
