export function parseQqCommandMode(message: string) {
  const text = message.trim();
  const optimize = /^(优化日程|AI\s*重排)(?:[：:，,\s]|$)/i.test(text);
  const commandText = optimize ? text.replace(/^(优化日程|AI\s*重排)(?:[：:，,\s]*)/i, "").trim() : text;
  return { optimize, commandText };
}

export type QqControlCommand = { kind: "receipt" | "help"; reply: string };

export function parseQqControlCommand(message: string): QqControlCommand | null {
  const text = message.trim().replace(/\s+/g, " ");
  const compact = text.replace(/\s+/g, "");
  if (["已发送", "已收到"].includes(compact) || /^(都收到了|身份验证收到)/.test(compact)) {
    return { kind: "receipt", reply: "已记录你的 QQ 到达回执，不会创建或修改任务。" };
  }
  if (["帮助", "菜单", "/help", "help"].includes(text.toLowerCase())) {
    return { kind: "help", reply: "Goalset QQ 指令：\n1. 直接描述突发任务，并写明时长/截止时间\n2. 以“优化日程”或“AI 重排”开头请求候选重排\n3. 回复“确认”应用待确认调整\n4. 回复“已收到”只记录通知回执" };
  }
  return null;
}
