import { resolve } from "node:path";

export function sqlitePathFromUrl(url: string) {
  if (!url.startsWith("file:")) {
    throw new Error("DATABASE_URL must be a local SQLite file: URL");
  }
  const value = url.slice("file:".length);
  if (!value) throw new Error("DATABASE_URL must include a SQLite file path");
  return resolve(value);
}
