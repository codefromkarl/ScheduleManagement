export const reminderChannelNames = ["qq", "pwa"] as const;
export type ReminderChannelName = (typeof reminderChannelNames)[number];

type Environment = Record<string, string | undefined>;

export function selectedReminderChannels(env: Environment = process.env): ReminderChannelName[] {
  const configured = env.REMINDER_CHANNELS;
  if (configured === undefined || configured.trim() === "") return [...reminderChannelNames];
  const requested = new Set(configured.split(",").map((value) => value.trim().toLowerCase()));
  return reminderChannelNames.filter((channel) => requested.has(channel));
}

export function reminderChannelIsEnabled(channel: ReminderChannelName, env: Environment = process.env) {
  return selectedReminderChannels(env).includes(channel);
}

export function qqIsConfigured(env: Environment = process.env) {
  return Boolean(env.QQBOT_APP_ID && env.QQBOT_APP_SECRET && env.QQBOT_OWNER_USER_ID);
}

export function qqConfigError() {
  return "QQBOT_APP_ID、QQBOT_APP_SECRET、QQBOT_OWNER_USER_ID must be configured";
}

export function sanitizedQqError(error: unknown, env: Environment = process.env) {
  let message = error instanceof Error ? error.message : typeof error === "string" ? error : "unknown QQ error";
  for (const secret of [env.QQBOT_APP_SECRET]) {
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  return message.slice(0, 500);
}

export function pwaIsConfigured(env: Environment = process.env) {
  return Boolean(env.VAPID_PUBLIC_KEY ?? env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) && Boolean(env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}
