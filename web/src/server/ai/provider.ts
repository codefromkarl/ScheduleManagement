import OpenAI from "openai";
import { z } from "zod";
import { scheduleDateSchema, scheduleMinutesSchema } from "@/features/schedule/data/contract";
import type { ScheduleSnapshot } from "@/features/schedule/data/types";

const aiTaskSchema = z.object({
  title: z.string().min(1).max(200),
  kind: z.enum(["fixed", "flexible", "floating"]),
  estimatedMinutes: z.number().int().positive().refine((value) => value % 15 === 0),
  priority: z.enum(["low", "normal", "high"]),
  preferredStartMinutes: z.number().int().min(0).max(1440).nullable(),
  deadlineMinutes: z.number().int().min(0).max(1440).nullable(),
});

const aiUpdateSchema = z.object({
  status: z.enum(["todo", "doing", "blocked", "done"]).nullable(),
  priority: z.enum(["low", "normal", "high"]).nullable(),
  notes: z.string().max(2000).nullable(),
});

const aiPlanSchema = z.object({
  operation: z.enum(["create_task", "update_task", "reschedule_task"]),
  targetDate: scheduleDateSchema.nullable(),
  targetStartMinutes: scheduleMinutesSchema.nullable(),
  reply: z.string().min(1),
  needsClarification: z.boolean(),
  clarifyingQuestion: z.string().nullable(),
  task: aiTaskSchema.nullable(),
  targetTaskId: z.string().nullable(),
  update: aiUpdateSchema.nullable(),
});

const aiPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { type: "string", enum: ["create_task", "update_task", "reschedule_task"] },
    targetDate: { anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }] },
    targetStartMinutes: { anyOf: [{ type: "integer" }, { type: "null" }] },
    reply: { type: "string" },
    needsClarification: { type: "boolean" },
    clarifyingQuestion: { anyOf: [{ type: "string" }, { type: "null" }] },
    targetTaskId: { anyOf: [{ type: "string" }, { type: "null" }] },
    update: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { anyOf: [{ type: "string", enum: ["todo", "doing", "blocked", "done"] }, { type: "null" }] },
            priority: { anyOf: [{ type: "string", enum: ["low", "normal", "high"] }, { type: "null" }] },
            notes: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
          required: ["status", "priority", "notes"],
        },
        { type: "null" },
      ],
    },
    task: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            kind: { type: "string", enum: ["fixed", "flexible", "floating"] },
            estimatedMinutes: { type: "integer" },
            priority: { type: "string", enum: ["low", "normal", "high"] },
            preferredStartMinutes: { anyOf: [{ type: "integer" }, { type: "null" }] },
            deadlineMinutes: { anyOf: [{ type: "integer" }, { type: "null" }] },
          },
          required: ["title", "kind", "estimatedMinutes", "priority", "preferredStartMinutes", "deadlineMinutes"],
        },
        { type: "null" },
      ],
    },
  },
  required: ["operation", "targetDate", "targetStartMinutes", "reply", "needsClarification", "clarifyingQuestion", "targetTaskId", "update", "task"],
} as const;

export class AIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigurationError";
  }
}

function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function targetDateFromMessage(date: string, message: string) {
  const explicit = message.match(/(20\d{2}-\d{2}-\d{2})/);
  if (explicit?.[1] && scheduleDateSchema.safeParse(explicit[1]).success) return explicit[1];
  if (/后天/.test(message)) return shiftDate(date, 2);
  if (/明天/.test(message)) return shiftDate(date, 1);
  return null;
}

function parseLocalCommand(message: string, date: string, snapshot: ScheduleSnapshot) {
  const rescheduleMatch = message.match(/(?:把|将)?\s*(.+?)\s*(?:改到|安排到|移动到|调整到)\s*(上午|下午|晚上)?\s*(\d{1,2})(?:点|:)(\d{0,2})?/);
  if (rescheduleMatch) {
    const targetText = rescheduleMatch[1].trim().replace(/^(今天|明天|后天)\s*把\s*/, "").replace(/[“”「」]/g, "");
    const target = snapshot.tasks.find((task) => task.title.includes(targetText) || targetText.includes(task.title));
    let hour = Number(rescheduleMatch[3]);
    const minute = Number(rescheduleMatch[4] || 0);
    if ((rescheduleMatch[2] === "下午" || rescheduleMatch[2] === "晚上") && hour < 12) hour += 12;
    const targetStartMinutes = hour * 60 + minute;
    if (!target) return { operation: "reschedule_task" as const, targetDate: targetDateFromMessage(date, message), targetStartMinutes, reply: "我没有找到要改期的任务。", needsClarification: true, clarifyingQuestion: `你要改期哪一个任务？我没有找到「${targetText}」。`, task: null, targetTaskId: null, update: null };
    return { operation: "reschedule_task" as const, targetDate: targetDateFromMessage(date, message), targetStartMinutes, reply: `已识别要把「${target.title}」改到 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}。`, needsClarification: false, clarifyingQuestion: null, task: null, targetTaskId: target.id, update: null };
  }
  const statusMatch = message.match(/(?:把|将)?\s*(.+?)\s*(?:标记为|改成|改为|设为)\s*(完成|已完成|进行中|阻塞|已阻塞|待开始|未开始)/);
  if (statusMatch) {
    const targetText = statusMatch[1].trim().replace(/[“”「」]/g, "");
    const target = snapshot.tasks.find((task) => task.title.includes(targetText) || targetText.includes(task.title));
    if (!target) return { operation: "update_task" as const, targetDate: null, targetStartMinutes: null, reply: "我没有找到要更新的任务。", needsClarification: true, clarifyingQuestion: `你要更新哪一个任务？我没有找到「${targetText}」。`, task: null, targetTaskId: null, update: null };
    const status = /完成/.test(statusMatch[2]) ? "done" as const : /进行中/.test(statusMatch[2]) ? "doing" as const : /阻塞/.test(statusMatch[2]) ? "blocked" as const : "todo" as const;
    return { operation: "update_task" as const, targetDate: null, targetStartMinutes: null, reply: `已识别要把「${target.title}」更新为${statusMatch[2]}。`, needsClarification: false, clarifyingQuestion: null, task: null, targetTaskId: target.id, update: { status, priority: null, notes: null } };
  }
  const durationMatch = message.match(/(\d+(?:\.\d+)?)\s*(小时|h|分钟|min)/i);
  if (!durationMatch) {
    if (snapshot.defaultDurationMinutes) {
      return { operation: "create_task" as const, targetDate: targetDateFromMessage(date, message), targetStartMinutes: null, reply: `没有明确时长，我将使用已保存的默认时长 ${snapshot.defaultDurationMinutes} 分钟，并寻找空闲时间。`, needsClarification: false, clarifyingQuestion: null, targetTaskId: null, update: null, task: { title: message.slice(0, 80), kind: "floating" as const, estimatedMinutes: snapshot.defaultDurationMinutes, priority: "normal" as const, preferredStartMinutes: null, deadlineMinutes: null } };
    }
    return { operation: "create_task" as const, targetDate: targetDateFromMessage(date, message), targetStartMinutes: null, reply: "本地调度模式需要知道任务时长。", needsClarification: true, clarifyingQuestion: "这个临时任务需要安排多长时间？", task: null, targetTaskId: null, update: null };
  }
  const rawDuration = Number(durationMatch[1]);
  const estimatedMinutes = Math.round((durationMatch[2].toLowerCase().startsWith("小") || durationMatch[2].toLowerCase() === "h" ? rawDuration * 60 : rawDuration) / 15) * 15;
  const timeMatch = message.match(/(上午|下午|晚上)?\s*(\d{1,2})(?:点|:)(\d{0,2})?/);
  let preferredStartMinutes: number | null = null;
  if (timeMatch) {
    let hour = Number(timeMatch[2]);
    const minute = Number(timeMatch[3] || 0);
    if ((timeMatch[1] === "下午" || timeMatch[1] === "晚上") && hour < 12) hour += 12;
    preferredStartMinutes = hour * 60 + minute;
  }
  const priority = /重要|紧急|优先/.test(message) ? "high" as const : "normal" as const;
  return { operation: "create_task" as const, targetDate: targetDateFromMessage(date, message), targetStartMinutes: null, reply: `本地规则模式已识别：${estimatedMinutes} 分钟${preferredStartMinutes === null ? "，将寻找空闲时间" : `，偏好 ${preferredStartMinutes} 分钟开始`}。`, needsClarification: false, clarifyingQuestion: null, targetTaskId: null, update: null, task: { title: message.slice(0, 80), kind: preferredStartMinutes === null ? "floating" as const : "flexible" as const, estimatedMinutes, priority, preferredStartMinutes, deadlineMinutes: null } };
}

export async function parseScheduleCommand(message: string, date: string, snapshot: ScheduleSnapshot) {
  if (process.env.AI_PROVIDER === "local") return parseLocalCommand(message, date, snapshot);
  if (process.env.AI_PROVIDER === "mock") {
    return {
      operation: "create_task" as const,
      targetDate: null,
      targetStartMinutes: null,
      reply: `本地测试模式：我把「${message.slice(0, 40)}」按 30 分钟浮动任务处理。`,
      needsClarification: false,
      clarifyingQuestion: null,
      targetTaskId: null,
      update: null,
      task: { title: message.slice(0, 80), kind: "floating" as const, estimatedMinutes: 30, priority: "normal" as const, preferredStartMinutes: null, deadlineMinutes: null },
    };
  }
  const apiKey = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AIConfigurationError("AI_API_KEY or OPENAI_API_KEY is required");
  const model = process.env.AI_MODEL ?? "gpt-5.2";
  const client = new OpenAI({ apiKey, baseURL: process.env.AI_BASE_URL ?? "https://api.openai.com/v1" });
  const context = JSON.stringify({
    date,
    availability: snapshot.availability,
    unavailable: snapshot.unavailable,
    tasks: snapshot.tasks.map(({ id, title, kind, status, priority, estimatedMinutes, movable, preferredStartMinutes, deadlineMinutes }) => ({ id, title, kind, status, priority, estimatedMinutes, movable, preferredStartMinutes, deadlineMinutes })),
    blocks: snapshot.blocks,
    defaultDurationMinutes: snapshot.defaultDurationMinutes ?? null,
  });

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: "你是个人日程调度助手。只负责把用户的一句话转换成结构化任务意图，不直接写数据库。operation=create_task 时解析临时任务并输出 targetDate（用户说了明天、后天或具体日期时）；operation=update_task 时从上下文任务中选择 targetTaskId，并只填写需要更新的 status、priority、notes；operation=reschedule_task 时选择 targetTaskId、targetDate 和 targetStartMinutes，其余字段为 null。不要直接声称已经修改日程；如果缺少会影响排程的关键信息，设置 needsClarification=true 并提出一个最小追问。日期已经由系统确定。任务时长必须是15分钟的整数倍；只有在上下文明确提供 defaultDurationMinutes 时才可以使用该默认值。fixed 需要明确开始时间；flexible 或 floating 可以没有开始时间，但需要预计时长，floating 应尽量有截止时间。",
      },
      { role: "user", content: `当前日期：${date}\n当前日程上下文：${context}\n用户请求：${message}` },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "schedule_command",
        strict: true,
        schema: aiPlanJsonSchema,
      },
    },
    max_output_tokens: 800,
  });
  return aiPlanSchema.parse(JSON.parse(response.output_text));
}
