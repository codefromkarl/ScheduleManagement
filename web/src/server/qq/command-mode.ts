export function parseQqCommandMode(message: string) {
  const text = message.trim();
  const optimize = /^(优化日程|AI\s*重排)(?:[：:，,\s]|$)/i.test(text);
  const commandText = optimize ? text.replace(/^(优化日程|AI\s*重排)(?:[：:，,\s]*)/i, "").trim() : text;
  return { optimize, commandText };
}
