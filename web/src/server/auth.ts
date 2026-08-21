import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "goalset_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required");
  return new TextEncoder().encode(secret);
}

export function authIsConfigured() {
  return Boolean(process.env.AUTH_SECRET && process.env.OWNER_PASSWORD);
}

export function authIsDisabled() {
  return process.env.AUTH_DISABLED === "true";
}

export async function createSessionToken() {
  return new SignJWT({ role: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined) {
  if (!token || !authIsConfigured()) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload.sub === "owner" && payload.role === "owner";
  } catch {
    return false;
  }
}

export { SESSION_MAX_AGE_SECONDS };
