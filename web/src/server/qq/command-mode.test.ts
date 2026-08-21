import { describe, expect, it } from "vitest";
import { parseQqCommandMode, parseQqControlCommand } from "./command-mode";

describe("parseQqCommandMode", () => {
  it("requires a strict optimization prefix", () => {
    expect(parseQqCommandMode("优化日程：把写方案放到下午")).toEqual({ optimize: true, commandText: "把写方案放到下午" });
    expect(parseQqCommandMode("AI 重排 把写方案放到下午")).toEqual({ optimize: true, commandText: "把写方案放到下午" });
    expect(parseQqCommandMode("帮我优化日程，把写方案放到下午")).toEqual({ optimize: false, commandText: "帮我优化日程，把写方案放到下午" });
    expect(parseQqCommandMode("新增一个任务")).toEqual({ optimize: false, commandText: "新增一个任务" });
  });
});

describe("parseQqControlCommand", () => {
  it("keeps notification receipts out of task parsing", () => {
    expect(parseQqControlCommand("已发送")?.kind).toBe("receipt");
    expect(parseQqControlCommand("都收到了，测试提醒2条")?.kind).toBe("receipt");
    expect(parseQqControlCommand("身份验证收到，风险摘要收到，测试提醒收到2条")?.kind).toBe("receipt");
    expect(parseQqControlCommand("整理已收到的客户文件")).toBeNull();
  });

  it("returns concise channel help only for reserved commands", () => {
    expect(parseQqControlCommand("帮助")?.kind).toBe("help");
    expect(parseQqControlCommand("/HELP")?.reply).toContain("直接描述突发任务");
    expect(parseQqControlCommand("帮我添加任务")).toBeNull();
  });
});
