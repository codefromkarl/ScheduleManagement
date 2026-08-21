export function normalizeQqPairingText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function qqPairingCommand(code: string) {
  if (!/^\d{6}$/.test(code)) throw new Error("QQ pairing code must contain exactly six digits");
  return `绑定 Goalset ${code}`;
}

export function matchesQqPairingCommand(content: string, code: string) {
  return normalizeQqPairingText(content) === qqPairingCommand(code);
}
