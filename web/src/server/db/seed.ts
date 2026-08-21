import { config } from "dotenv";
config({ path: ".env.local" });
import { seedDate } from "@/features/schedule/data/sqlite-store";

async function main() {
  const date = process.env.SEED_DATE ?? "2026-08-20";
  await seedDate(date);
  console.info(`[goalset] seeded demo schedule for ${date}`);
}

void main().catch((error) => {
  console.error("[goalset] seed failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
