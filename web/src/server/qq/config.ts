export function qqIsConfigured() {
  return Boolean(process.env.QQBOT_APP_ID && process.env.QQBOT_APP_SECRET && process.env.QQBOT_OWNER_USER_ID);
}

export function qqConfigError() {
  return "QQBOT_APP_ID、QQBOT_APP_SECRET、QQBOT_OWNER_USER_ID must be configured";
}

export function pwaIsConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) && Boolean(process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}
