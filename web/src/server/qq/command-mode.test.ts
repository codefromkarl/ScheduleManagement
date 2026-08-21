import { describe, expect, it } from "vitest";
import { parseQqCommandMode } from "./command-mode";

describe("parseQqCommandMode", () => {
  it("requires a strict optimization prefix", () => {
    expect(parseQqCommandMode("优化日程：把写方案放到下午")).toEqual({ optimize: true, commandText: "把写方案放到下午" });
    expect(parseQqCommandMode("AI 重排 把写方案放到下午")).toEqual({ optimize: true, commandText: "把写方案放到下午" });
    expect(parseQqCommandMode("帮我优化日程，把写方案放到下午")).toEqual({ optimize: false, commandText: "帮我优化日程，把写方案放到下午" });
    expect(parseQqCommandMode("新增一个任务")).toEqual({ optimize: false, commandText: "新增一个任务" });
  });
});
